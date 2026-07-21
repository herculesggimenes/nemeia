import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { signCanonicalJson } from "../../contracts/src/signing.ts";
import { MissionServer } from "../../mission-server/src/mission-server.ts";
import { KernelError } from "../src/kernel-errors.ts";
import { SimDriver } from "../src/sim-driver.ts";
import { SupervisorKernel } from "../src/supervisor-kernel.ts";

test("SupervisorKernel executes a Mission Server signed discrete Authorization once", () => {
  const fixture = makeIssuedAuthorization();
  const result = fixture.kernel.execute(fixture.authorization);

  assert.equal(result.state, "completed");
  assert.equal(result.authorization_id, fixture.authorization.id);
  assert.deepEqual(fixture.driver.appliedSetpoints()[0].setpoint, {
    vx_mps: 0.1,
    vy_mps: 0,
    yaw_rps: 0.05
  });
  assert.equal(fixture.driver.safeStateCommands().length, 1);
  assert.deepEqual(
    fixture.kernel.events().filter((event) => event.source.startsWith("kernel:")).map((event) => event.event_type),
    ["authorization.accepted", "authorization.active", "kernel.chunk_applied", "kernel.zero_command_sent", "authorization.completed"]
  );
  assert.equal(fixture.kernel.events().some((event) => event.event_type === "driver.setpoint_applied"), true);
  assert.equal(fixture.kernel.events().some((event) => event.event_type === "driver.safe_state_commanded"), true);
});

test("SupervisorKernel rejects replayed Authorization after first use", () => {
  const fixture = makeIssuedAuthorization();
  fixture.kernel.execute(fixture.authorization);

  assert.throws(
    () => fixture.kernel.execute(fixture.authorization),
    (error) => error instanceof KernelError && error.error_code === "AUTHZ_REPLAYED"
  );
});

test("SupervisorKernel stop is idempotent and blocks execution until cleared", () => {
  const fixture = makeIssuedAuthorization();

  assert.equal(fixture.kernel.stop().stop_state, true);
  assert.equal(fixture.kernel.stop().stop_state, true);
  assert.equal(fixture.driver.safeStateCommands().length, 2);
  assert.throws(
    () => fixture.kernel.execute(fixture.authorization),
    (error) => error instanceof KernelError && error.error_code === "STOP_STATE_ACTIVE"
  );

  fixture.kernel.clearStop();
  assert.equal(fixture.kernel.execute(fixture.authorization).state, "completed");
});

test("SupervisorKernel rejects expired, wrong-robot, and stale-status Authorizations", () => {
  const expired = makeDirectAuthorization({
    expires_at: "2026-07-07T16:59:00.000Z"
  });
  assert.throws(
    () => expired.kernel.execute(expired.authorization),
    (error) => error instanceof KernelError && error.error_code === "AUTHZ_EXPIRED"
  );

  const wrongRobot = makeDirectAuthorization({ robot_id: "yam" });
  assert.throws(
    () => wrongRobot.kernel.execute(wrongRobot.authorization),
    (error) => error instanceof KernelError && error.error_code === "AUTHZ_ROBOT_MISMATCH"
  );

  const stale = makeDirectAuthorization({ clockTime: "2026-07-07T17:00:01.000Z" });
  assert.throws(
    () => stale.kernel.execute(stale.authorization),
    (error) => error instanceof KernelError && error.error_code === "STALE_ROBOT_STATUS"
  );
});

test("SupervisorKernel rejects invalid signatures and driver hard-cap violations", () => {
  const fixture = makeIssuedAuthorization();
  assert.throws(
    () => fixture.kernel.execute({ ...fixture.authorization, robot_id: "go2-mutated" }),
    (error) => error instanceof KernelError && error.error_code === "AUTHZ_SIGNATURE_INVALID"
  );

  const hardCap = makeDirectAuthorization({
    setpoint: { vx_mps: 0.5, vy_mps: 0, yaw_rps: 0 }
  });
  assert.throws(
    () => hardCap.kernel.execute(hardCap.authorization),
    (error) => error instanceof KernelError && error.error_code === "AUTHZ_HARD_CAP_EXCEEDED"
  );
});

test("SupervisorKernel opens a stream channel and acks post-clamp chunks", () => {
  const fixture = makeStreamAuthorization({
    limits: { max_speed_mps: 0.12, max_yaw_rps: 0.2 }
  });
  const opened = fixture.kernel.execute(fixture.authorization);

  assert.equal(opened.state, "active");
  assert.equal(opened.chunk_channel, `chunks/${fixture.authorization.id}`);
  assert.deepEqual(fixture.kernel.submitChunk({
    auth_id: fixture.authorization.id,
    seq: 1,
    setpoint: { vx_mps: 0.2, vy_mps: -0.2, yaw_rps: 0.3 }
  }), { accepted: true, seq: 1 });

  const tick = fixture.kernel.tick();
  assert.equal(tick.state, "active");
  assert.deepEqual(tick.chunk_ack, {
    seq: 1,
    applied_setpoint: { vx_mps: 0.12, vy_mps: -0.12, yaw_rps: 0.2 }
  });
  assert.deepEqual(fixture.driver.appliedSetpoints().at(-1).setpoint, tick.chunk_ack.applied_setpoint);
  assert.deepEqual(fixture.kernel.events().at(-1).payload.applied_setpoint, tick.chunk_ack.applied_setpoint);
});

test("SupervisorKernel event stream includes driver events with supervisor seq and run context", () => {
  const fixture = makeStreamAuthorization();
  fixture.kernel.execute(fixture.authorization);
  fixture.kernel.submitChunk({
    auth_id: fixture.authorization.id,
    seq: 1,
    setpoint: { vx_mps: 0.1, vy_mps: 0, yaw_rps: 0 }
  });

  fixture.kernel.tick();

  const events = fixture.kernel.events();
  const driverEvent = events.find((event) => event.event_type === "driver.setpoint_applied");
  assert.ok(driverEvent);
  assert.equal(driverEvent.source, "driver:go2");
  assert.equal(driverEvent.mission_id, fixture.authorization.mission_id);
  assert.equal(driverEvent.run_id, fixture.authorization.run_id);
  assert.deepEqual(driverEvent.refs, [fixture.authorization.id]);
  assert.equal(typeof driverEvent.payload.driver_seq, "number");
  assert.equal(events.some((event) => event.event_type === "driver.connected"), false);
  assert.deepEqual(
    fixture.kernel.events({ after: driverEvent.seq - 1 }).map((event) => event.seq),
    events.filter((event) => event.seq > driverEvent.seq - 1).map((event) => event.seq)
  );
});

test("SupervisorKernel clamps only enforcing grant limits plus driver hard caps", () => {
  const fixture = makeStreamAuthorization({
    limits: { max_speed_mps: 0.12, max_yaw_rps: 0.2 },
    enforcement: { max_speed_mps: "advisory", max_yaw_rps: "enforcing" }
  });
  fixture.kernel.execute(fixture.authorization);
  fixture.kernel.submitChunk({
    auth_id: fixture.authorization.id,
    seq: 1,
    setpoint: { vx_mps: 0.2, vy_mps: -0.2, yaw_rps: 0.3 }
  });

  const tick = fixture.kernel.tick();

  assert.deepEqual(tick.chunk_ack.applied_setpoint, {
    vx_mps: 0.2,
    vy_mps: -0.15,
    yaw_rps: 0.2
  });
  assert.deepEqual(fixture.driver.appliedSetpoints().at(-1).setpoint, tick.chunk_ack.applied_setpoint);
});

test("SupervisorKernel validates ActionChunk auth, seq, and fields", () => {
  const fixture = makeStreamAuthorization();
  fixture.kernel.execute(fixture.authorization);

  assert.throws(
    () => fixture.kernel.submitChunk({ auth_id: "auth_wrong", seq: 1, setpoint: { vx_mps: 0 } }),
    (error) => error instanceof KernelError && error.error_code === "AUTHZ_CHUNK_MISMATCH"
  );
  assert.throws(
    () => fixture.kernel.submitChunk({ auth_id: fixture.authorization.id, seq: 1, setpoint: { nope: 0 } }),
    (error) => error instanceof KernelError && error.error_code === "CHUNK_MALFORMED"
  );
  fixture.kernel.submitChunk({ auth_id: fixture.authorization.id, seq: 1, setpoint: { vx_mps: 0 } });
  assert.throws(
    () => fixture.kernel.submitChunk({ auth_id: fixture.authorization.id, seq: 1, setpoint: { vx_mps: 0 } }),
    (error) => error instanceof KernelError && error.error_code === "CHUNK_SEQUENCE"
  );
});

test("SupervisorKernel watchdog commands safe state when stream chunks starve", () => {
  const fixture = makeStreamAuthorization({ watchdog_ms: 100 });
  fixture.kernel.execute(fixture.authorization);

  fixture.advanceMs(101);
  const tick = fixture.kernel.tick();

  assert.equal(tick.state, "aborted");
  assert.equal(tick.trigger, "stream_silence");
  assert.equal(fixture.driver.safeStateCommands().length, 1);
  assert.equal(fixture.kernel.status().kernel.active_authorization, null);
});

test("SupervisorKernel stop during active stream invalidates the authorization", () => {
  const fixture = makeStreamAuthorization();
  fixture.kernel.execute(fixture.authorization);
  fixture.kernel.submitChunk({ auth_id: fixture.authorization.id, seq: 1, setpoint: { vx_mps: 0.1 } });

  const stopped = fixture.kernel.stop();

  assert.equal(stopped.stop_state, true);
  assert.equal(fixture.kernel.status().kernel.active_authorization, null);
  assert.equal(fixture.driver.safeStateCommands().length, 1);
  assert.throws(
    () => fixture.kernel.submitChunk({ auth_id: fixture.authorization.id, seq: 2, setpoint: { vx_mps: 0.1 } }),
    (error) => error instanceof KernelError && error.error_code === "NO_ACTIVE_AUTHORIZATION"
  );
  assert.equal(fixture.kernel.events().some((event) => event.event_type === "authorization.stopped"), true);
  const stopStateEvent = fixture.kernel.events().find((event) => event.event_type === "kernel.stop_state_set");
  assert.equal(stopStateEvent.run_id, fixture.authorization.run_id);
  assert.equal(stopStateEvent.mission_id, fixture.authorization.mission_id);
  assert.deepEqual(stopStateEvent.refs, [fixture.authorization.id]);
});

test("SupervisorKernel commands safe state when upstream is lost during active authorization", () => {
  const fixture = makeStreamAuthorization();
  assert.equal(fixture.kernel.upstreamLost().state, "idle");
  fixture.kernel.execute(fixture.authorization);
  fixture.kernel.submitChunk({ auth_id: fixture.authorization.id, seq: 1, setpoint: { vx_mps: 0.1 } });

  const aborted = fixture.kernel.upstreamLost({ source: "mission-api:http-closed" });

  assert.equal(aborted.state, "aborted");
  assert.equal(aborted.trigger, "upstream_loss");
  assert.equal(fixture.driver.safeStateCommands().length, 1);
  assert.equal(fixture.kernel.status().kernel.active_authorization, null);
  assert.throws(
    () => fixture.kernel.submitChunk({ auth_id: fixture.authorization.id, seq: 2, setpoint: { vx_mps: 0.1 } }),
    (error) => error instanceof KernelError && error.error_code === "NO_ACTIVE_AUTHORIZATION"
  );
  const event = fixture.kernel.events().at(-1);
  assert.equal(event.event_type, "authorization.aborted");
  assert.equal(event.payload.trigger, "upstream_loss");
  assert.equal(event.payload.source, "mission-api:http-closed");
  assert.equal(event.run_id, fixture.authorization.run_id);
});

test("SupervisorKernel emits status samples at heartbeat cadence", () => {
  const fixture = makeStreamAuthorization();

  assert.equal(fixture.kernel.tick().state, "idle");
  assert.equal(fixture.kernel.events().filter((event) => event.event_type === "kernel.status_sample").length, 1);
  fixture.advanceMs(499);
  fixture.kernel.tick();
  assert.equal(fixture.kernel.events().filter((event) => event.event_type === "kernel.status_sample").length, 1);
  fixture.advanceMs(1);
  fixture.kernel.tick();
  assert.equal(fixture.kernel.events().filter((event) => event.event_type === "kernel.status_sample").length, 2);

  fixture.kernel.execute(fixture.authorization);
  fixture.advanceMs(500);
  fixture.kernel.tick();
  const sample = fixture.kernel.events().filter((event) => event.event_type === "kernel.status_sample").at(-1);
  assert.equal(sample.payload.robot_id, "go2");
  assert.equal(sample.payload.kernel.active_authorization, fixture.authorization.id);
  assert.equal(sample.payload.kernel.heartbeat_max_age_ms, 500);
});

function makeIssuedAuthorization() {
  const clock = () => new Date("2026-07-07T17:00:00.000Z");
  const server = new MissionServer({ clock });
  const mission = server.createMission({
    idempotencyKey: "mission",
    preset: { id: "preset_go2_bounded_move_v1", version: "1.0.0" },
    robot_ids: ["go2"]
  });
  const run = server.proposeRun({
    idempotencyKey: "run",
    mission_id: mission.id,
    robot_id: "go2",
    verb: "bounded_move",
    args: { x: 0.1, yaw: 0.05, duration_ms: 400 }
  });
  const { authorization } = server.approveRun({
    idempotencyKey: "approve",
    run_id: run.id,
    operator: "op_local"
  });
  const driver = new SimDriver({ clock });
  driver.connect();
  const kernel = new SupervisorKernel({
    robotId: "go2",
    driver,
    trustedPublicKey: server.publicKey,
    clock
  });
  return { authorization, driver, kernel, server };
}

function makeDirectAuthorization({
  robot_id = "go2",
  expires_at = "2026-07-07T17:02:00.000Z",
  setpoint = { vx_mps: 0.1, vy_mps: 0, yaw_rps: 0 },
  clockTime = "2026-07-07T17:00:00.000Z"
} = {}) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  let currentTime = "2026-07-07T17:00:00.000Z";
  const clock = () => new Date(currentTime);
  const driver = new SimDriver({ clock });
  driver.connect();
  currentTime = clockTime;
  const unsigned = {
    id: "auth_direct",
    schema_version: 1,
    robot_id,
    run_id: "run_direct",
    mission_id: "msn_direct",
    grant: {
      discrete: {
        type: "bounded_move",
        setpoint,
        duration_ms: 400
      }
    },
    enforcement: { max_speed_mps: "enforcing" },
    streams_granted: [],
    abort_triggers: ["operator_stop"],
    checks: [
      {
        name: "policy.approval",
        result: "pass",
        mode: "enforcing",
        details: { approval: { operator: "op_local" } }
      }
    ],
    issued_at: "2026-07-07T17:00:00.000Z",
    expires_at,
    signature: ""
  };
  const authorization = { ...unsigned, signature: signCanonicalJson(unsigned, privateKey) };
  const kernel = new SupervisorKernel({
    robotId: "go2",
    driver,
    trustedPublicKey: publicKey,
    clock,
    heartbeatMaxAgeMs: 500
  });
  return { authorization, driver, kernel };
}

function makeStreamAuthorization({
  limits = { max_speed_mps: 0.2, max_yaw_rps: 0.3 },
  enforcement = { max_speed_mps: "enforcing", max_yaw_rps: "enforcing" },
  watchdog_ms = 100,
  max_duration_ms = 1000
} = {}) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  let nowMs = Date.parse("2026-07-07T17:00:00.000Z");
  const clock = () => new Date(nowMs);
  const advanceMs = (ms) => {
    nowMs += ms;
  };
  const driver = new SimDriver({ clock });
  driver.connect();
  const unsigned = {
    id: "auth_stream",
    schema_version: 1,
    robot_id: "go2",
    run_id: "run_stream",
    mission_id: "msn_stream",
    grant: {
      stream: {
        action_space: "base_velocity_3d",
        limits,
        watchdog_ms,
        max_duration_ms
      }
    },
    enforcement,
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
  const authorization = { ...unsigned, signature: signCanonicalJson(unsigned, privateKey) };
  const kernel = new SupervisorKernel({
    robotId: "go2",
    driver,
    trustedPublicKey: publicKey,
    clock
  });
  return { authorization, driver, kernel, advanceMs };
}
