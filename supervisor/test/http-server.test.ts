import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { signCanonicalJson } from "../../contracts/src/signing.ts";
import { createSupervisorHttpServer, handleSupervisorRequest } from "../src/http-server.ts";
import { SimDriver } from "../src/sim-driver.ts";
import { SupervisorKernel } from "../src/supervisor-kernel.ts";

test("Supervisor HTTP binding exposes status, execute, events, stop, and recovery", async () => {
  const fixture = makeStreamFixture();
  const server = createSupervisorHttpServer({ kernel: fixture.kernel });
  const baseUrl = await listen(server);
  try {
    const status = await request(`${baseUrl}/status`);
    assert.equal(status.status, 200);
    assert.equal(status.body.robot_id, "go2");
    assert.equal(status.body.kernel.stop_state, false);

    const execute = await request(`${baseUrl}/execute`, {
      method: "POST",
      body: { authorization: fixture.authorization }
    });
    assert.equal(execute.status, 200);
    assert.equal(execute.body.state, "active");
    assert.equal(execute.body.chunk_channel, `chunks/${fixture.authorization.id}`);

    const chunk = await request(`${baseUrl}/chunks`, {
      method: "POST",
      body: {
        auth_id: fixture.authorization.id,
        seq: 1,
        setpoint: { vx_mps: 0.4, vy_mps: -0.2, yaw_rps: 0.4 }
      }
    });
    assert.equal(chunk.status, 200);
    assert.deepEqual(chunk.body, { accepted: true, seq: 1 });

    const tick = await request(`${baseUrl}/tick`, { method: "POST" });
    assert.equal(tick.status, 200);
    assert.deepEqual(tick.body.chunk_ack.applied_setpoint, { vx_mps: 0.2, vy_mps: -0.15, yaw_rps: 0.3 });

    const events = await request(`${baseUrl}/events?after=0`);
    assert.equal(events.status, 200);
    assert.equal(events.body.items.some((event) => event.event_type === "kernel.chunk_applied"), true);

    const stop = await request(`${baseUrl}/stop`, { method: "POST", body: { source: "http-test" } });
    assert.equal(stop.status, 200);
    assert.equal(stop.body.stop_state, true);

    const blocked = await request(`${baseUrl}/execute`, {
      method: "POST",
      body: { authorization: fixture.makeAuthorization("auth_http_blocked") }
    });
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.error_code, "STOP_STATE_ACTIVE");

    const clear = await request(`${baseUrl}/clear-stop`, { method: "POST" });
    assert.equal(clear.status, 200);
    assert.equal(clear.body.stop_state, false);
  } finally {
    await close(server);
  }
});

test("Supervisor request handler returns structured route and kernel errors", () => {
  const fixture = makeStreamFixture();
  const missing = handleSupervisorRequest({ kernel: fixture.kernel, method: "GET", url: new URL("http://test/nope") });
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error_code, "SUPERVISOR_ROUTE_NOT_FOUND");

  const mismatch = handleSupervisorRequest({
    body: { auth_id: "missing", seq: 1, setpoint: { vx_mps: 0 } },
    kernel: fixture.kernel,
    method: "POST",
    url: new URL("http://test/chunks")
  });
  assert.equal(mismatch.status, 409);
  assert.equal(mismatch.body.error_code, "NO_ACTIVE_AUTHORIZATION");
});

test("Supervisor HTTP binding streams kernel events over WebSocket /events", async () => {
  const fixture = makeStreamFixture();
  const server = createSupervisorHttpServer({ kernel: fixture.kernel });
  const baseUrl = await listen(server);
  const socket = new WebSocket(`${baseUrl.replace("http://", "ws://")}/events?after=0`);
  try {
    await opened(socket);
    const nextMessage = onceMessage(socket);

    const stop = await request(`${baseUrl}/stop`, { method: "POST", body: { source: "ws-test" } });
    assert.equal(stop.status, 200);

    const event = JSON.parse(await nextMessage);
    assert.equal(event.event_type, "kernel.stop_state_set");
    assert.equal(event.robot_id, "go2");
    assert.equal(typeof event.seq, "number");
  } finally {
    socket.close();
    await close(server);
  }
});

test("Supervisor HTTP idle stop does not stream physical events without run context", async () => {
  const fixture = makeStreamFixture();
  const server = createSupervisorHttpServer({ kernel: fixture.kernel });
  const baseUrl = await listen(server);
  try {
    const stop = await request(`${baseUrl}/stop`, { method: "POST", body: { source: "idle-stop-test" } });
    assert.equal(stop.status, 200);

    const events = await request(`${baseUrl}/events?after=0`);
    assertPhysicalEventsHaveRunId(events.body.items);
    assert.equal(events.body.items.some((event) => event.event_type === "driver.safe_state_commanded"), false);
    assert.equal(events.body.items.some((event) => event.event_type === "kernel.stop_state_set"), true);
  } finally {
    await close(server);
  }
});

function makeStreamFixture() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const clock = () => new Date("2026-07-07T17:00:00.000Z");
  const driver = new SimDriver({ clock });
  driver.connect();
  const makeAuthorization = (id = `auth_${Math.random().toString(36).slice(2)}`) => {
    const unsigned = {
      id,
      schema_version: 1,
      robot_id: "go2",
      run_id: "run_http",
      mission_id: "msn_http",
      grant: {
        stream: {
          action_space: "base_velocity_3d",
          limits: { max_speed_mps: 0.2, max_yaw_rps: 0.3 },
          watchdog_ms: 100,
          max_duration_ms: 1000
        }
      },
      enforcement: { max_speed_mps: "enforcing", max_yaw_rps: "enforcing" },
      streams_granted: ["camera_front"],
      abort_triggers: ["operator_stop", "stream_silence"],
      capability: { verb: "follow", impl: "cap:follow-entity@0.3.2" },
      checks: [
        {
          name: "policy.approval",
          result: "pass",
          mode: "enforcing",
          details: { approval: { operator: "op_local" } }
        }
      ],
      issued_at: "2026-07-07T17:00:00.000Z",
      expires_at: "2026-07-07T17:02:00.000Z",
      signature: ""
    };
    return { ...unsigned, signature: signCanonicalJson(unsigned, privateKey) };
  };
  const authorization = makeAuthorization();
  const kernel = new SupervisorKernel({
    robotId: "go2",
    driver,
    trustedPublicKey: publicKey,
    clock
  });
  return { authorization, kernel, makeAuthorization };
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

async function close(server) {
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

async function request(url, { body, method = "GET" } = {}) {
  const response = await fetch(url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  return {
    body: await response.json(),
    status: response.status
  };
}

function assertPhysicalEventsHaveRunId(events) {
  const registry = JSON.parse(readFileSync(new URL("../../contracts/registries/event-types.json", import.meta.url), "utf8"));
  const physicalEventTypes = new Set(registry.values.filter((entry) => entry.physical_consequence).map((entry) => entry.name));
  const missingRunId = events.filter((event) => physicalEventTypes.has(event.event_type) && !event.run_id);
  assert.deepEqual(missingRunId, []);
}

async function opened(socket) {
  if (socket.readyState === WebSocket.OPEN) {
    return;
  }
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
}

async function onceMessage(socket) {
  return new Promise((resolve, reject) => {
    socket.addEventListener("message", (event) => resolve(String(event.data)), { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
}
