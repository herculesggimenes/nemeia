import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createMissionHttpServer } from "../../mission-api/src/http-server.ts";
import { MissionApi } from "../../mission-api/src/mission-api.ts";
import { EventLog } from "../../mission-server/src/event-log.ts";
import { MissionServer } from "../../mission-server/src/mission-server.ts";
import { SceneProjector } from "../../scene/src/scene-projector.ts";
import { createSupervisorHttpServer } from "../../supervisor/src/http-server.ts";
import { SimDriver } from "../../supervisor/src/sim-driver.ts";
import { SupervisorKernel } from "../../supervisor/src/supervisor-kernel.ts";
import { NemeiaCtl, parseArgv } from "../src/nemeiactl.ts";

test("parseArgv accepts flags with inline and separated values", () => {
  assert.deepEqual(parseArgv(["robot", "move", "go2", "--x=0.1", "--yaw", "0.05", "--approve"]), {
    group: "robot",
    verb: "move",
    positionals: ["go2"],
    flags: {
      x: "0.1",
      yaw: "0.05",
      approve: true
    }
  });
});

test("health returns compact JSON byte-equivalent to Mission API body", async () => {
  const cli = NemeiaCtl.withSim();
  const result = await cli.run(["health", "--json", "--turn-id", "turn_1"]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.body.components.mission_server, "ok");
  assert.deepEqual(result.body.components.robots, ["go2"]);
  assert.equal(result.body.principal, "agent");
  assert.deepEqual(JSON.parse(result.stdout), result.body);
});

test("health can read Mission API over HTTP", async () => {
  const api = MissionApi.withSim({ clock: fixedClock });
  const server = createMissionHttpServer({ api });
  const apiUrl = await listen(server);
  try {
    const cli = new NemeiaCtl();
    const result = await cli.run(["health", "--json", "--turn-id", "turn_http"], { NEMEIA_API_URL: apiUrl });
    const direct = await api.handle({ method: "GET", path: "/health", headers: { authorization: "Bearer agent-token" } });
    const events = await api.handle({ method: "GET", path: "/events", headers: { authorization: "Bearer agent-token" } });

    assert.equal(result.exitCode, 0);
    assert.deepEqual(result.body, direct.body);
    assert.deepEqual(result.body.components.robots, ["go2"]);
    const toolCall = events.body.items.find((event) => event.event_type === "tool.call");
    assert.ok(toolCall);
    assert.deepEqual(toolCall.payload.argv, ["health", "--json", "--turn-id", "turn_http"]);
    assert.equal(toolCall.payload.principal, "agent");
    assert.equal(toolCall.payload.turn_id, "turn_http");
  } finally {
    await close(server);
  }
});

test("robot status reads Supervisor status", async () => {
  const cli = NemeiaCtl.withSim();
  const result = await cli.run(["robot", "status", "go2", "--json"]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.body.robot_id, "go2");
  assert.equal(result.body.kernel.stop_state, false);
});

test("robot stop routes directly to Supervisor and persists event", async () => {
  const cli = NemeiaCtl.withSim();
  const stop = await cli.run(["robot", "stop", "go2", "--json"]);
  const status = await cli.run(["robot", "status", "go2", "--json"]);
  const cleared = await cli.run(["robot", "clear-stop", "go2", "--json"]);

  assert.equal(stop.exitCode, 0);
  assert.equal(stop.body.stop_state, true);
  assert.equal(status.body.kernel.stop_state, true);
  assert.match(stop.body.event_id, /^evt_/);
  assert.equal(cleared.exitCode, 0);
  assert.equal(cleared.body.stop_state, false);
});

test("robot stop uses configured direct Supervisor fallback when Mission API is unreachable", async () => {
  const eventLog = new EventLog({ clock: fixedClock });
  const { supervisor } = simSupervisor();
  const server = createSupervisorHttpServer({ kernel: supervisor });
  const supervisorUrl = await listen(server);
  try {
    const cli = new NemeiaCtl({ apiUrl: "http://127.0.0.1:1", eventLog, supervisorUrl });
    const result = await cli.run(["robot", "stop", "go2", "--json", "--turn-id", "turn_fallback"]);
    const events = eventLog.all();
    const fallback = events.find((event) => event.event_type === "robot.stop_via_fallback");

    assert.equal(result.exitCode, 0);
    assert.equal(result.body.stop_state, true);
    assert.equal(result.body.fallback, "supervisor");
    assert.equal(result.body.robot_id, "go2");
    assert.ok(fallback);
    assert.equal(fallback.robot_id, "go2");
    assert.equal(fallback.payload.principal, "agent");
    assert.equal(fallback.payload.supervisor_url, supervisorUrl);
    assert.equal(fallback.payload.event_name, "stop_via_fallback");
    assert.deepEqual(events.map((event) => event.event_type), ["tool.call", "robot.stop_via_fallback"]);
  } finally {
    await close(server);
  }
});

test("CLI fallback event and transport errors are registered NEM values", () => {
  const events = registryValues("../../contracts/registries/event-types.json", "name");
  const errors = registryValues("../../contracts/registries/error-codes.json", "code");

  assert.equal(events.has("robot.stop_via_fallback"), true);
  for (const code of ["API_RESPONSE_INVALID", "API_UNREACHABLE", "SUPERVISOR_UNREACHABLE"]) {
    assert.equal(errors.has(code), true, `${code} should be registered`);
  }
});

test("robot move is non-interactive and awaits approval by default", async () => {
  const cli = NemeiaCtl.withSim();
  const result = await cli.run(["robot", "move", "go2", "--x", "0.1", "--duration-ms", "25", "--json"]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.body.state, "awaiting_approval");
  assert.equal(result.body.verb, "bounded_move");
});

test("robot move validates against local sim driver bounds before approval", async () => {
  const cli = NemeiaCtl.withSim();
  const result = await cli.run(["robot", "move", "go2", "--x", "0.5", "--duration-ms", "25", "--json"]);

  assert.equal(result.exitCode, 4);
  assert.equal(result.body.error_code, "COMMAND_BOUNDS_EXCEEDED");
});

test("robot move with approval returns the Mission API approval body", async () => {
  const cli = NemeiaCtl.withSim();
  const result = await cli.run(["robot", "move", "go2", "--x", "0.1", "--y", "0", "--yaw", "0", "--duration-ms", "25", "--approve", "--json"]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.body.run.state, "completed");
  assert.equal(result.body.execution.state, "completed");
  assert.equal(result.body.authorization.grant.discrete.type, "bounded_move");
  assert.equal(result.body.authorization.grant.discrete.setpoint.vx_mps, 0.1);
});

test("robot action damp uses native discrete grant through Mission API approval", async () => {
  const cli = NemeiaCtl.withSim();
  const result = await cli.run(["robot", "action", "go2", "damp", "--approve", "--json"]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.body.run.state, "completed");
  assert.equal(result.body.authorization.grant.discrete.type, "native:damp");
});

test("unknown robot returns structured error and invalid exit code", async () => {
  const cli = NemeiaCtl.withSim();
  const result = await cli.run(["robot", "status", "missing", "--json"]);

  assert.equal(result.exitCode, 4);
  assert.equal(result.body.error_code, "ROBOT_NOT_FOUND");
});

test("anomaly create, list, and close are log-backed CLI commands", async () => {
  const cli = NemeiaCtl.withSim();
  const created = await cli.run([
    "anomaly",
    "create",
    "--mission",
    "msn_test",
    "--severity",
    "safety",
    "--expected",
    "No unsafe contact.",
    "--observed",
    "Unexpected contact.",
    "--evidence-ref",
    "artifact:replay",
    "--closure-criteria",
    "Corrective action reviewed.",
    "--json"
  ]);

  assert.equal(created.exitCode, 0);
  assert.equal(created.body.status, "open");
  assert.equal(created.body.severity, "safety");

  const listedOpen = await cli.run(["anomaly", "list", "--status", "open", "--json"]);
  assert.deepEqual(listedOpen.body.items.map((anomaly) => anomaly.id), [created.body.id]);

  const closed = await cli.run(["anomaly", "close", created.body.id, "--resolution", "Reviewed.", "--evidence-ref", "artifact:fix", "--json"]);
  assert.equal(closed.exitCode, 0);
  assert.equal(closed.body.status, "closed");
  assert.deepEqual(closed.body.evidence_refs, ["artifact:replay", "artifact:fix"]);

  const listedClosed = await cli.run(["anomaly", "list", "--status", "closed", "--json"]);
  assert.deepEqual(listedClosed.body.items.map((anomaly) => anomaly.id), [created.body.id]);
});

test("run get, approve, reject, and replay route through Mission API", async () => {
  const api = MissionApi.withSim({ clock: fixedClock });
  const cli = new NemeiaCtl({ api });
  const mission = await api.handle({
    method: "POST",
    path: "/missions",
    headers: { authorization: "Bearer operator-token", "idempotency-key": "idem_cli_run_mission" },
    body: { preset: "cli.test", robot_ids: ["go2"] }
  });
  const proposed = await api.handle({
    method: "POST",
    path: "/runs",
    headers: { authorization: "Bearer agent-token", "idempotency-key": "idem_cli_run" },
    body: { mission_id: mission.body.id, robot_id: "go2", verb: "bounded_move", args: { x: 0.1 } }
  });
  const toReject = await api.handle({
    method: "POST",
    path: "/runs",
    headers: { authorization: "Bearer agent-token", "idempotency-key": "idem_cli_reject" },
    body: { mission_id: mission.body.id, robot_id: "go2", verb: "bounded_move", args: { x: 0.2 } }
  });

  const read = await cli.run(["run", "get", proposed.body.id, "--json"]);
  const apiRead = await api.handle({ method: "GET", path: `/runs/${proposed.body.id}`, headers: { authorization: "Bearer agent-token" } });
  const approved = await cli.run(["run", "approve", proposed.body.id, "--reason", "ok", "--json"]);
  const replay = await cli.run(["run", "replay", proposed.body.id, "--json"]);
  const rejected = await cli.run(["run", "reject", toReject.body.id, "--reason", "no", "--json"]);

  assert.equal(read.exitCode, 0);
  assert.deepEqual(read.body, apiRead.body);
  assert.deepEqual(JSON.parse(read.stdout), apiRead.body);
  assert.equal(approved.body.run.state, "completed");
  assert.equal(approved.body.execution.state, "completed");
  assert.equal(approved.body.authorization.run_id, proposed.body.id);
  assert.equal(replay.body.run_id, proposed.body.id);
  assert.equal(rejected.body.state, "rejected");
});

test("entity get routes through Mission API", async () => {
  const { api, cli } = cliWithObservedEntity();

  const entity = await cli.run(["entity", "get", "ent_person_01", "--json"]);
  const apiEntity = await api.handle({
    method: "GET",
    path: "/entities/ent_person_01",
    headers: { authorization: "Bearer agent-token" }
  });

  assert.equal(entity.exitCode, 0);
  assert.deepEqual(entity.body, apiEntity.body);
  assert.deepEqual(JSON.parse(entity.stdout), apiEntity.body);
});

test("CLI output body matches Mission API response body for an equivalent request", async () => {
  const api = MissionApi.withSim({ clock: fixedClock });
  const cli = new NemeiaCtl({ api });

  const cliResult = await cli.run(["robot", "status", "go2", "--json"]);
  const apiResponse = await api.handle({
    method: "GET",
    path: "/robots/go2/status",
    headers: { authorization: "Bearer agent-token" }
  });

  assert.equal(cliResult.exitCode, 0);
  assert.deepEqual(cliResult.body, apiResponse.body);
  assert.deepEqual(JSON.parse(cliResult.stdout), apiResponse.body);
});

test("CLI emits byte-equivalent compact JSON for implemented API-backed commands", async () => {
  const { api, cli } = cliWithRecordingSim();

  await assertCliBytesEqualLastApiBody(cli, api, ["health", "--json"]);
  await assertCliBytesEqualLastApiBody(cli, api, ["robot", "list", "--json"]);
  await assertCliBytesEqualLastApiBody(cli, api, ["robot", "status", "go2", "--json"]);
  await assertCliBytesEqualLastApiBody(cli, api, ["robot", "stop", "go2", "--json"]);
  await assertCliBytesEqualLastApiBody(cli, api, ["robot", "clear-stop", "go2", "--json"]);
  await assertCliBytesEqualLastApiBody(cli, api, ["scene", "get", "--json"]);
  await assertCliBytesEqualLastApiBody(cli, api, ["scene", "refresh", "--json"]);
  await assertCliBytesEqualLastApiBody(cli, api, ["events", "tail", "--limit", "2", "--json"]);

  const mission = await createMissionForCli(api.inner);
  await assertCliBytesEqualLastApiBody(cli, api, ["mission", "get", mission.body.id, "--json"]);
  const proposed = await api.inner.handle({
    method: "POST",
    path: "/runs",
    headers: { authorization: "Bearer agent-token", "idempotency-key": "idem_cli_equiv_run" },
    body: { mission_id: mission.body.id, robot_id: "go2", verb: "bounded_move", args: { x: 0.1 } }
  });
  await assertCliBytesEqualLastApiBody(cli, api, ["run", "get", proposed.body.id, "--json"]);
  await assertCliBytesEqualLastApiBody(cli, api, ["run", "approve", proposed.body.id, "--reason", "ok", "--json"]);
  await assertCliBytesEqualLastApiBody(cli, api, ["run", "replay", proposed.body.id, "--json"]);
  await assertCliBytesEqualLastApiBody(cli, api, ["replay", "command", proposed.body.id, "--json"]);
  await assertCliBytesEqualLastApiBody(cli, api, ["events", "tail", "--run-id", proposed.body.id, "--event-types", "run.proposed,authorization.issued", "--theme", "run.own", "--json"]);

  const toReject = await api.inner.handle({
    method: "POST",
    path: "/runs",
    headers: { authorization: "Bearer agent-token", "idempotency-key": "idem_cli_equiv_reject" },
    body: { mission_id: mission.body.id, robot_id: "go2", verb: "bounded_move", args: { x: 0.2 } }
  });
  await assertCliBytesEqualLastApiBody(cli, api, ["run", "reject", toReject.body.id, "--reason", "no", "--json"]);

  await assertCliBytesEqualLastApiBody(cli, api, [
    "anomaly",
    "create",
    "--mission",
    mission.body.id,
    "--severity",
    "warning",
    "--expected",
    "No drift.",
    "--observed",
    "Pose drift.",
    "--evidence-ref",
    "artifact:pose",
    "--json"
  ]);
  const anomalyId = api.last.body.id;
  await assertCliBytesEqualLastApiBody(cli, api, ["anomaly", "list", "--status", "open", "--json"]);
  await assertCliBytesEqualLastApiBody(cli, api, ["anomaly", "close", anomalyId, "--resolution", "Reviewed.", "--json"]);

  await assertCliBytesEqualLastApiBody(cli, api, ["robot", "move", "go2", "--mission", mission.body.id, "--x", "0.1", "--duration-ms", "25", "--json"]);
  await assertCliBytesEqualLastApiBody(cli, api, ["robot", "action", "go2", "damp", "--mission", mission.body.id, "--json"]);
});

test("CLI emits compact JSON for synthetic mission rule command", async () => {
  const cli = NemeiaCtl.withSim();
  const result = await cli.run(["mission", "rule", "get", "--json"]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, `${JSON.stringify({ rules: [] })}\n`);
});

function fixedClock() {
  return new Date("2026-07-07T17:00:00.000Z");
}

async function assertCliBytesEqualLastApiBody(cli, api, argv) {
  api.clear();
  const result = await cli.run(argv);

  assert.equal(result.exitCode, 0, `${argv.join(" ")} should succeed`);
  assert.ok(api.last, `${argv.join(" ")} should call Mission API`);
  assert.deepEqual(result.body, api.last.body);
  assert.equal(result.stdout, `${JSON.stringify(api.last.body)}\n`);
}

function cliWithRecordingSim() {
  const eventLog = new EventLog({ clock: fixedClock });
  const scene = new SceneProjector({ eventLog, clock: fixedClock });
  const driver = new SimDriver({ robotId: "go2", clock: fixedClock });
  driver.connect();
  const missionServer = new MissionServer({ eventLog, scene, driverManifest: driver.manifest(), clock: fixedClock });
  const supervisor = new SupervisorKernel({
    robotId: "go2",
    driver,
    trustedPublicKey: missionServer.publicKey,
    clock: fixedClock
  });
  scene.appendObservation({
    source: "perception:camera-detector@1.0.0",
    robot_id: "go2",
    mission_id: "msn_test",
    payload: {
      streams: ["camera_front"],
      labels: ["person"],
      confidence: 0.9,
      track_id: "person_01",
      artifact_refs: ["artifact:frame_01"]
    }
  });
  const inner = new MissionApi({
    eventLog,
    missionServer,
    scene,
    supervisors: new Map([["go2", supervisor]]),
    drivers: new Map([["go2", driver]]),
    clock: fixedClock
  });
  const api = new RecordingApi(inner);
  return { api, cli: new NemeiaCtl({ api, eventLog }) };
}

function simSupervisor() {
  const eventLog = new EventLog({ clock: fixedClock });
  const scene = new SceneProjector({ eventLog, clock: fixedClock });
  const driver = new SimDriver({ robotId: "go2", clock: fixedClock });
  driver.connect();
  const missionServer = new MissionServer({ eventLog, scene, driverManifest: driver.manifest(), clock: fixedClock });
  const supervisor = new SupervisorKernel({
    robotId: "go2",
    driver,
    trustedPublicKey: missionServer.publicKey,
    clock: fixedClock
  });
  return { driver, supervisor };
}

async function createMissionForCli(api) {
  return api.handle({
    method: "POST",
    path: "/missions",
    headers: { authorization: "Bearer operator-token", "idempotency-key": `idem_cli_equiv_mission_${Date.now()}` },
    body: { preset: "cli.equiv", robot_ids: ["go2"] }
  });
}

class RecordingApi {
  constructor(inner) {
    this.inner = inner;
    this.last = null;
  }

  async handle(request) {
    const response = await this.inner.handle(request);
    this.last = structuredClone(response);
    return response;
  }

  clear() {
    this.last = null;
  }
}

function cliWithObservedEntity() {
  const eventLog = new EventLog({ clock: fixedClock });
  const scene = new SceneProjector({ eventLog, clock: fixedClock });
  const driver = new SimDriver({ robotId: "go2", clock: fixedClock });
  driver.connect();
  const missionServer = new MissionServer({ eventLog, scene, driverManifest: driver.manifest(), clock: fixedClock });
  const supervisor = new SupervisorKernel({
    robotId: "go2",
    driver,
    trustedPublicKey: missionServer.publicKey,
    clock: fixedClock
  });
  scene.appendObservation({
    source: "perception:camera-detector@1.0.0",
    robot_id: "go2",
    mission_id: "msn_test",
    payload: {
      streams: ["camera_front"],
      labels: ["person"],
      confidence: 0.9,
      track_id: "person_01",
      artifact_refs: ["artifact:frame_01"]
    }
  });
  const api = new MissionApi({
    eventLog,
    missionServer,
    scene,
    supervisors: new Map([["go2", supervisor]]),
    drivers: new Map([["go2", driver]]),
    clock: fixedClock
  });
  return { api, cli: new NemeiaCtl({ api, eventLog }) };
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function registryValues(path, key) {
  const registry = JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
  return new Set(registry.values.map((entry) => entry[key]));
}
