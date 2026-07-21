import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { verifyCanonicalJson } from "../../contracts/src/signing.ts";
import { PolicyRegistry } from "../../policy/src/policy-registry.ts";
import { PresetPolicy } from "../../policy/src/preset-policy.ts";
import { SceneProjector } from "../../scene/src/scene-projector.ts";
import { EventLog } from "../src/event-log.ts";
import { MissionServer, MissionServerError } from "../src/mission-server.ts";
import { FileSigningKeyStore, SigningKeyStoreError } from "../src/signing-key-store.ts";

const fixedClock = () => new Date("2026-07-07T17:00:00.000Z");

test("EventLog read filters by event metadata and timestamp bounds", () => {
  const log = new EventLog({ clock: fixedClock });
  log.append({ source: "test", event_type: "mission.created", severity: 0, mission_id: "msn_a", robot_id: "go2" });
  log.append({ source: "test", event_type: "run.proposed", severity: 0, mission_id: "msn_a", run_id: "run_a", robot_id: "go2" });
  log.append({ source: "test", event_type: "run.proposed", severity: 0, mission_id: "msn_b", run_id: "run_b", robot_id: "go2_b" });
  log.append({ source: "test", event_type: "scene.observation", severity: 0, mission_id: "msn_a", payload: { theme: "entity.bound" } });

  assert.deepEqual(log.read({ event_types: ["run.proposed"], mission_id: "msn_a" }).items.map((event) => event.run_id), ["run_a"]);
  assert.deepEqual(log.read({ robot_id: "go2_b" }).items.map((event) => event.run_id), ["run_b"]);
  assert.deepEqual(log.read({ theme: "run.own" }).items.map((event) => event.run_id), ["run_a", "run_b"]);
  assert.deepEqual(log.read({ themes: ["entity.bound"] }).items.map((event) => event.event_type), ["scene.observation"]);
  assert.equal(log.read({ since: "2026-07-07T16:59:59.000Z", until: "2026-07-07T17:00:00.000Z" }).items.length, 4);
  assert.equal(log.read({ since: "2026-07-07T17:00:01.000Z" }).items.length, 0);
});

test("MissionServer creates an idempotent mission", () => {
  const server = new MissionServer({ clock: fixedClock });
  const first = server.createMission({
    idempotencyKey: "idem-mission",
    preset: { id: "preset_go2_follow_v1", version: "1.0.0" },
    robot_ids: ["go2"]
  });
  const second = server.createMission({
    idempotencyKey: "idem-mission",
    preset: { id: "different", version: "1.0.0" },
    robot_ids: ["go2"]
  });

  assert.equal(first.id, second.id);
  assert.equal(server.eventLog.read({ event_type: "mission.created" }).items.length, 1);
});

test("MissionServer refuses new runs and repeated completion after mission completion", () => {
  const server = new MissionServer({ clock: fixedClock });
  const mission = server.createMission({
    idempotencyKey: "mission",
    preset: { id: "preset_go2_follow_v1", version: "1.0.0" },
    robot_ids: ["go2"]
  });
  const completed = server.completeMission({
    idempotencyKey: "complete",
    mission_id: mission.id,
    result: { summary: "done" }
  });
  const replayed = server.completeMission({
    idempotencyKey: "complete",
    mission_id: mission.id,
    result: { summary: "ignored by idempotency" }
  });

  assert.equal(completed.state, "completed");
  assert.equal(replayed.completed_at, completed.completed_at);
  assert.throws(
    () =>
      server.proposeRun({
        idempotencyKey: "run_after_complete",
        mission_id: mission.id,
        robot_id: "go2",
        verb: "bounded_move",
        args: { x: 0.1 }
      }),
    (error) => error instanceof MissionServerError && error.error_code === "MISSION_NOT_ACTIVE" && error.details.state === "completed"
  );
  assert.throws(
    () => server.completeMission({ idempotencyKey: "complete_again", mission_id: mission.id, result: { summary: "again" } }),
    (error) => error instanceof MissionServerError && error.error_code === "MISSION_NOT_ACTIVE" && error.details.state === "completed"
  );
  assert.equal(server.eventLog.read({ event_type: "mission.completed" }).items.length, 1);
});

test("MissionServer proposes a run and persists rejected proposals", () => {
  const server = new MissionServer({ clock: fixedClock });
  const mission = server.createMission({
    idempotencyKey: "mission",
    preset: { id: "preset_go2_follow_v1", version: "1.0.0" },
    robot_ids: ["go2"]
  });
  const run = server.proposeRun({
    idempotencyKey: "run",
    mission_id: mission.id,
    robot_id: "go2",
    verb: "follow",
    args: { standoff_m: 1.5 },
    target: { entity_id: "ent_person_01", snapshot_id: "ssg_test", evidence_refs: ["artifact:crop"] }
  });
  const rejected = server.rejectRun({
    idempotencyKey: "reject",
    run_id: run.id,
    reason: "Operator declined."
  });

  assert.equal(run.state, "awaiting_approval");
  assert.equal(rejected.state, "rejected");
  assert.deepEqual(
    server.eventLog.read({ run_id: run.id }).items.map((event) => event.event_type),
    ["run.proposed", "run.awaiting_approval", "run.rejected"]
  );
});

test("MissionServer rejects proposals for robots outside the mission", () => {
  const server = new MissionServer({ clock: fixedClock });
  const mission = server.createMission({
    idempotencyKey: "mission",
    preset: { id: "preset_go2_follow_v1", version: "1.0.0" },
    robot_ids: ["go2"]
  });

  assert.throws(
    () =>
      server.proposeRun({
        idempotencyKey: "wrong-robot",
        mission_id: mission.id,
        robot_id: "go2_b",
        verb: "bounded_move",
        args: { x: 0.1 }
      }),
    (error) => error instanceof MissionServerError && error.error_code === "ROBOT_NOT_FOUND" && error.details.robot_id === "go2_b" && error.details.mission_id === mission.id
  );
  assert.equal(server.eventLog.read({ event_type: "run.proposed" }).items.length, 0);
});

test("MissionServer approval issues signed Authorization before dispatch", () => {
  const server = new MissionServer({ clock: fixedClock });
  const mission = server.createMission({
    idempotencyKey: "mission",
    preset: { id: "preset_go2_follow_v1", version: "1.0.0" },
    robot_ids: ["go2"]
  });
  const run = server.proposeRun({
    idempotencyKey: "run",
    mission_id: mission.id,
    robot_id: "go2",
    verb: "bounded_move",
    args: { x: 0.1, yaw: 0.05, duration_ms: 400 }
  });
  const { run: authorizedRun, authorization } = server.approveRun({
    idempotencyKey: "approve",
    run_id: run.id,
    operator: "op_local"
  });
  const repeated = server.approveRun({
    idempotencyKey: "approve",
    run_id: run.id,
    operator: "op_local"
  });

  assert.equal(authorizedRun.state, "authorized");
  assert.equal(repeated.authorization.id, authorization.id);
  assert.equal(verifyCanonicalJson(authorization, server.publicKey), true);

  const events = server.eventLog.read({ run_id: run.id }).items;
  const issuedIndex = events.findIndex((event) => event.event_type === "authorization.issued");
  const dispatchedIndex = events.findIndex((event) => event.event_type === "authorization.dispatched");
  assert.ok(issuedIndex >= 0);
  assert.ok(dispatchedIndex > issuedIndex);
  assert.equal(events[issuedIndex].refs[0], authorization.id);

  const replay = server.replayRun(run.id);
  assert.equal(replay.authorizations[0].id, authorization.id);
  assert.equal(replay.version_pins[`authorization:${authorization.id}`], authorization.signature);
});

test("MissionServer projects kernel authorization lifecycle events into run state", () => {
  const server = new MissionServer({ clock: fixedClock });
  const mission = server.createMission({
    idempotencyKey: "mission",
    preset: { id: "preset_go2_follow_v1", version: "1.0.0" },
    robot_ids: ["go2"]
  });
  const proposed = server.proposeRun({
    idempotencyKey: "run",
    mission_id: mission.id,
    robot_id: "go2",
    verb: "bounded_move",
    args: { x: 0.1, duration_ms: 400 }
  });
  const { authorization } = server.approveRun({ idempotencyKey: "approve", run_id: proposed.id });

  server.recordAuthorizationEvent(kernelEvent("authorization.accepted", authorization));
  assert.equal(server.getRun(proposed.id).state, "executing");

  server.recordAuthorizationEvent(kernelEvent("authorization.active", authorization));
  server.recordAuthorizationEvent(kernelEvent("authorization.completed", authorization, { reason: "done" }));

  const run = server.getRun(proposed.id);
  assert.equal(run.state, "completed");
  assert.equal(run.result.summary, "done");
  assert.deepEqual(
    server.eventLog.read({ run_id: proposed.id }).items.map((event) => event.event_type),
    [
      "run.proposed",
      "run.awaiting_approval",
      "run.authorized",
      "authorization.issued",
      "authorization.dispatched",
      "authorization.accepted",
      "run.executing",
      "authorization.active",
      "authorization.completed",
      "run.completed"
    ]
  );
});

test("MissionServer maps stopped authorizations to aborted runs", () => {
  const server = new MissionServer({ clock: fixedClock });
  const mission = server.createMission({
    idempotencyKey: "mission",
    preset: { id: "preset_go2_follow_v1", version: "1.0.0" },
    robot_ids: ["go2"]
  });
  const proposed = server.proposeRun({
    idempotencyKey: "run",
    mission_id: mission.id,
    robot_id: "go2",
    verb: "follow",
    args: { max_speed_mps: 0.12 }
  });
  const { authorization } = server.approveRun({ idempotencyKey: "approve", run_id: proposed.id });

  server.recordAuthorizationEvent(kernelEvent("authorization.accepted", authorization));
  server.recordAuthorizationEvent(kernelEvent("authorization.stopped", authorization, { trigger: "operator_stop" }, 1));

  const run = server.getRun(proposed.id);
  assert.equal(run.state, "aborted");
  assert.equal(run.result.observed.trigger, "operator_stop");
  assert.equal(server.eventLog.read({ run_id: proposed.id }).items.at(-1).event_type, "run.aborted");
});

test("MissionServer expires runs when approval arrives after the approval window", () => {
  let nowMs = Date.parse("2026-07-07T17:00:00.000Z");
  const clock = () => new Date(nowMs);
  const server = new MissionServer({ clock });
  const mission = server.createMission({
    idempotencyKey: "mission",
    preset: { id: "preset_go2_follow_v1", version: "1.0.0" },
    robot_ids: ["go2"]
  });
  const run = server.proposeRun({
    idempotencyKey: "run",
    mission_id: mission.id,
    robot_id: "go2",
    verb: "bounded_move",
    args: { x: 0.1 }
  });

  nowMs += 60_001;

  assert.throws(
    () => server.approveRun({ idempotencyKey: "approve", run_id: run.id, operator: "op_local" }),
    (error) => error instanceof MissionServerError && error.error_code === "APPROVAL_EXPIRED" && error.details.approval_expires_at === "2026-07-07T17:01:00.000Z"
  );
  assert.equal(server.getRun(run.id).state, "expired");
  assert.deepEqual(
    server.eventLog.read({ run_id: run.id }).items.map((event) => event.event_type),
    ["run.proposed", "run.awaiting_approval", "run.expired"]
  );
  assert.equal(server.eventLog.read({ run_id: run.id }).items.some((event) => event.event_type === "authorization.issued"), false);
});

test("MissionServer expires runs when rejection arrives after the approval window", () => {
  let nowMs = Date.parse("2026-07-07T17:00:00.000Z");
  const clock = () => new Date(nowMs);
  const server = new MissionServer({ clock });
  const mission = server.createMission({
    idempotencyKey: "mission",
    preset: { id: "preset_go2_follow_v1", version: "1.0.0" },
    robot_ids: ["go2"]
  });
  const run = server.proposeRun({
    idempotencyKey: "run",
    mission_id: mission.id,
    robot_id: "go2",
    verb: "bounded_move",
    args: { x: 0.1 }
  });

  nowMs += 60_001;

  assert.throws(
    () => server.rejectRun({ idempotencyKey: "reject", run_id: run.id, operator: "op_local", reason: "too late" }),
    (error) => error instanceof MissionServerError && error.error_code === "APPROVAL_EXPIRED" && error.details.approval_expires_at === "2026-07-07T17:01:00.000Z"
  );
  assert.equal(server.getRun(run.id).state, "expired");
  assert.deepEqual(
    server.eventLog.read({ run_id: run.id }).items.map((event) => event.event_type),
    ["run.proposed", "run.awaiting_approval", "run.expired"]
  );
});

test("MissionServer rejects operator decisions after a run leaves awaiting approval", () => {
  const server = new MissionServer({ clock: fixedClock });
  const mission = server.createMission({
    idempotencyKey: "mission",
    preset: { id: "preset_go2_follow_v1", version: "1.0.0" },
    robot_ids: ["go2"]
  });
  const run = server.proposeRun({
    idempotencyKey: "run",
    mission_id: mission.id,
    robot_id: "go2",
    verb: "bounded_move",
    args: { x: 0.1 }
  });

  server.approveRun({ idempotencyKey: "approve", run_id: run.id, operator: "op_local" });

  assert.throws(
    () => server.rejectRun({ idempotencyKey: "reject", run_id: run.id, operator: "op_local", reason: "changed mind" }),
    (error) => error instanceof MissionServerError && error.error_code === "RUN_NOT_AWAITING_APPROVAL"
  );
  assert.equal(server.getRun(run.id).state, "authorized");
});

test("MissionServer can use a persisted signing key store across restarts", () => {
  const dir = mkdtempSync(join(tmpdir(), "nemeia-signing-key-"));
  const path = join(dir, "mission-server-key.json");
  try {
    const eventLog = new EventLog({ clock: fixedClock });
    const firstStore = new FileSigningKeyStore({ path, clock: fixedClock, eventLog });
    const firstServer = new MissionServer({ clock: fixedClock, signingKeyStore: firstStore });
    const firstPublicKey = firstServer.publicKey.export({ type: "spki", format: "pem" });

    assert.equal(statSync(path).mode & 0o777, 0o600);

    const secondServer = new MissionServer({
      clock: fixedClock,
      signingKeyStore: new FileSigningKeyStore({ path, clock: fixedClock })
    });
    const secondPublicKey = secondServer.publicKey.export({ type: "spki", format: "pem" });

    assert.equal(secondPublicKey, firstPublicKey);
    assert.equal(eventLog.read({ event_type: "config.signing_key.rotated" }).items.length, 1);

    const mission = secondServer.createMission({
      idempotencyKey: "mission",
      preset: { id: "preset_go2_follow_v1", version: "1.0.0" },
      robot_ids: ["go2"]
    });
    const run = secondServer.proposeRun({
      idempotencyKey: "run",
      mission_id: mission.id,
      robot_id: "go2",
      verb: "bounded_move",
      args: { x: 0.1 }
    });
    const { authorization } = secondServer.approveRun({ idempotencyKey: "approve", run_id: run.id });

    assert.equal(verifyCanonicalJson(authorization, firstServer.publicKey), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("FileSigningKeyStore fails closed on group or world readable key files", () => {
  const dir = mkdtempSync(join(tmpdir(), "nemeia-signing-key-"));
  const path = join(dir, "mission-server-key.json");
  try {
    const store = new FileSigningKeyStore({ path, clock: fixedClock });
    store.current();
    chmodSync(path, 0o644);

    assert.throws(
      () => new FileSigningKeyStore({ path, clock: fixedClock }).current(),
      (error) =>
        error instanceof SigningKeyStoreError &&
        error.error_code === "SIGNING_KEY_STORE_PERMISSIONS" &&
        error.details.mode === "0o644" &&
        error.details.required === "0o600"
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("MissionServer issues stream Authorization for capability-backed verbs", () => {
  const server = new MissionServer({ clock: fixedClock });
  const mission = server.createMission({
    idempotencyKey: "mission",
    preset: { id: "preset_go2_follow_v1", version: "1.0.0" },
    robot_ids: ["go2"]
  });
  const run = server.proposeRun({
    idempotencyKey: "run",
    mission_id: mission.id,
    robot_id: "go2",
    verb: "follow",
    args: { max_speed_mps: 0.12, max_yaw_rps: 0.15, watchdog_ms: 80 },
    target: { entity_id: "ent_person_01", snapshot_id: "ssg_test", evidence_refs: ["artifact:crop"] }
  });
  const { authorization } = server.approveRun({
    idempotencyKey: "approve",
    run_id: run.id,
    operator: "op_local"
  });

  assert.equal(authorization.grant.stream.action_space, "base_velocity_3d");
  assert.equal(authorization.grant.stream.limits.max_speed_mps, 0.12);
  assert.deepEqual(authorization.capability, { verb: "follow", impl: "cap:follow-entity@0.1.0" });
  assert.deepEqual(authorization.streams_granted, ["camera_front"]);
  assert.deepEqual(authorization.target, { entity_id: "ent_person_01", snapshot_id: "ssg_test" });
  assert.equal(verifyCanonicalJson(authorization, server.publicKey), true);
});

test("MissionServer binds targeted runs through Scene projection when configured", () => {
  const { server, scene } = makeSceneBackedServer();
  scene.appendObservation({
    source: "perception:camera-detector@1.0.0",
    robot_id: "go2",
    mission_id: "msn_test",
    payload: { streams: ["camera_front"], labels: ["person"], confidence: 0.9, track_id: "person_01", artifact_refs: ["artifact:crop"] }
  });
  const mission = server.createMission({
    idempotencyKey: "mission",
    preset: { id: "preset_go2_follow_v1", version: "1.0.0" },
    robot_ids: ["go2"]
  });

  const run = server.proposeRun({
    idempotencyKey: "run",
    mission_id: mission.id,
    robot_id: "go2",
    verb: "follow",
    args: {},
    target: { entity_id: "ent_person_01" }
  });

  assert.deepEqual(run.target, {
    entity_id: "ent_person_01",
    snapshot_id: "ssg_1",
    evidence_refs: ["artifact:crop", "event:1"]
  });
});

test("MissionServer rejects targeted proposals when Scene binding fails", () => {
  const { server, scene } = makeSceneBackedServer();
  scene.appendObservation({
    source: "perception:camera-detector@1.0.0",
    robot_id: "go2",
    mission_id: "msn_test",
    payload: { streams: ["camera_front"], labels: ["person"], confidence: 0.6, track_id: "person_01" }
  });
  const mission = server.createMission({
    idempotencyKey: "mission",
    preset: { id: "preset_go2_follow_v1", version: "1.0.0" },
    robot_ids: ["go2"]
  });

  assert.throws(
    () =>
      server.proposeRun({
        idempotencyKey: "run",
        mission_id: mission.id,
        robot_id: "go2",
        verb: "follow",
        args: {},
        target: { entity_id: "ent_person_01" }
      }),
    (error) => error.error_code === "AFFORDANCE_LOW_CONFIDENCE"
  );
});

test("MissionServer rejects safety-relevant assertions on run proposals", () => {
  const server = new MissionServer({ clock: fixedClock });
  const mission = server.createMission({
    idempotencyKey: "mission",
    preset: { id: "preset_go2_follow_v1", version: "1.0.0" },
    robot_ids: ["go2"]
  });

  assert.throws(
    () =>
      server.proposeRun({
        idempotencyKey: "run-freshness",
        mission_id: mission.id,
        robot_id: "go2",
        verb: "follow",
        args: { scene_freshness_ms: 700 },
        target: { entity_id: "ent_person_01" }
      }),
    (error) => error instanceof MissionServerError && error.error_code === "UNKNOWN_FIELD_FORBIDDEN" && error.details.field === "args.scene_freshness_ms"
  );
  assert.throws(
    () =>
      server.proposeRun({
        idempotencyKey: "run-checks",
        mission_id: mission.id,
        robot_id: "go2",
        verb: "follow",
        args: {},
        checks: [{ name: "freshness.scene", result: "pass" }]
      }),
    (error) => error instanceof MissionServerError && error.error_code === "UNKNOWN_FIELD_FORBIDDEN" && error.details.field === "checks"
  );
});

test("MissionServer rejects malformed numeric proposal args before persisting runs", () => {
  const server = new MissionServer({ clock: fixedClock });
  const mission = server.createMission({
    idempotencyKey: "mission",
    preset: { id: "preset_go2_follow_v1", version: "1.0.0" },
    robot_ids: ["go2"]
  });

  assert.throws(
    () =>
      server.proposeRun({
        idempotencyKey: "bad-discrete-arg",
        mission_id: mission.id,
        robot_id: "go2",
        verb: "bounded_move",
        args: { x: "fast" }
      }),
    (error) => error instanceof MissionServerError && error.error_code === "ARG_OUT_OF_RANGE" && error.details.field === "args.x"
  );
  assert.throws(
    () =>
      server.proposeRun({
        idempotencyKey: "bad-stream-arg",
        mission_id: mission.id,
        robot_id: "go2",
        verb: "follow",
        args: { max_speed_mps: Number.POSITIVE_INFINITY }
      }),
    (error) => error instanceof MissionServerError && error.error_code === "ARG_OUT_OF_RANGE" && error.details.field === "args.max_speed_mps"
  );
  assert.throws(
    () =>
      server.proposeRun({
        idempotencyKey: "bad-duration",
        mission_id: mission.id,
        robot_id: "go2",
        verb: "bounded_move",
        args: { duration_ms: 0 }
      }),
    (error) => error instanceof MissionServerError && error.error_code === "ARG_OUT_OF_RANGE" && error.details.field === "args.duration_ms"
  );
  assert.throws(
    () =>
      server.proposeRun({
        idempotencyKey: "bad-speed-limit",
        mission_id: mission.id,
        robot_id: "go2",
        verb: "follow",
        args: { max_speed_mps: -0.1 }
      }),
    (error) => error instanceof MissionServerError && error.error_code === "ARG_OUT_OF_RANGE" && error.details.field === "args.max_speed_mps"
  );
  assert.throws(
    () =>
      server.proposeRun({
        idempotencyKey: "bad-yaw-limit",
        mission_id: mission.id,
        robot_id: "go2",
        verb: "follow",
        args: { max_yaw_rps: 0 }
      }),
    (error) => error instanceof MissionServerError && error.error_code === "ARG_OUT_OF_RANGE" && error.details.field === "args.max_yaw_rps"
  );
  assert.equal(server.eventLog.read({ event_type: "run.proposed" }).items.length, 0);
});

test("MissionServer rejects proposals that exceed driver or policy bounds before persisting runs", () => {
  const server = new MissionServer({ clock: fixedClock, driverManifest: driverManifest() });
  const mission = server.createMission({
    idempotencyKey: "mission",
    preset: { id: "preset_go2_follow_v1", version: "1.0.0" },
    robot_ids: ["go2"]
  });

  assert.throws(
    () =>
      server.proposeRun({
        idempotencyKey: "bad-discrete-bound",
        mission_id: mission.id,
        robot_id: "go2",
        verb: "bounded_move",
        args: { x: 0.3 }
      }),
    (error) => error instanceof MissionServerError && error.error_code === "COMMAND_BOUNDS_EXCEEDED" && error.details.field === "args.x"
  );
  assert.throws(
    () =>
      server.proposeRun({
        idempotencyKey: "bad-stream-bound",
        mission_id: mission.id,
        robot_id: "go2",
        verb: "follow",
        args: { max_yaw_rps: 0.4 }
      }),
    (error) => error instanceof MissionServerError && error.error_code === "COMMAND_BOUNDS_EXCEEDED" && error.details.field === "args.max_yaw_rps"
  );
  assert.equal(server.eventLog.read({ event_type: "run.proposed" }).items.length, 0);
});

test("MissionServer rejects policy-backed proposals that request wider limits than the matched rule", () => {
  const registry = new PolicyRegistry();
  registry.install({
    package: "cap:follow-entity@0.1.0",
    enabled: true,
    pinned: true,
    maturity: "experimental",
    gauntlet_report: "artifact:gauntlet",
    history: []
  });
  const preset = followPreset({ max_speed_mps: 0.11 });
  const policy = new PresetPolicy({ preset, registry });
  const server = new MissionServer({ clock: fixedClock, policy, driverManifest: driverManifest() });
  const mission = server.createMission({ idempotencyKey: "mission", preset, robot_ids: ["go2"] });

  assert.throws(
    () =>
      server.proposeRun({
        idempotencyKey: "bad-policy-bound",
        mission_id: mission.id,
        robot_id: "go2",
        verb: "follow",
        args: { max_speed_mps: 0.12 },
        proposed_by: "agent"
      }),
    (error) => error instanceof MissionServerError && error.error_code === "COMMAND_BOUNDS_EXCEEDED" && error.details.field === "args.max_speed_mps"
  );
  assert.equal(server.eventLog.read({ event_type: "run.proposed" }).items.length, 0);
});

test("MissionServer enforces policy match at proposal and live registry at approval", () => {
  const registry = new PolicyRegistry();
  registry.install({
    package: "cap:follow-entity@0.1.0",
    enabled: true,
    pinned: true,
    maturity: "trusted",
    gauntlet_report: "artifact:gauntlet",
    history: []
  });
  const policy = new PresetPolicy({ preset: followPreset({ min_capability_maturity: "trusted" }), registry });
  const server = new MissionServer({ clock: fixedClock, policy, driverManifest: driverManifest() });
  const mission = server.createMission({
    idempotencyKey: "mission",
    preset: followPreset({ min_capability_maturity: "trusted" }),
    robot_ids: ["go2"]
  });

  assert.throws(
    () =>
      server.proposeRun({
        idempotencyKey: "bad-run",
        mission_id: mission.id,
        robot_id: "go2",
        verb: "fold",
        args: {},
        proposed_by: "agent"
      }),
    (error) => error.error_code === "VERB_NOT_IN_POLICY"
  );

  const run = server.proposeRun({
    idempotencyKey: "run",
    mission_id: mission.id,
    robot_id: "go2",
    verb: "follow",
    args: {},
    proposed_by: "agent"
  });
  registry.revoke("cap:follow-entity@0.1.0");

  assert.throws(
    () => server.approveRun({ idempotencyKey: "approve", run_id: run.id }),
    (error) => error.error_code === "PACKAGE_REVOKED"
  );
});

test("MissionServer uses matched policy rule for stream grant fields", () => {
  const registry = new PolicyRegistry();
  registry.install({
    package: "cap:follow-entity@0.1.0",
    enabled: true,
    pinned: true,
    maturity: "experimental",
    gauntlet_report: "artifact:gauntlet",
    history: []
  });
  const preset = followPreset({ max_speed_mps: 0.11, streams: ["camera_front"], abort_triggers: ["operator_stop", "stream_silence"] });
  const policy = new PresetPolicy({ preset, registry });
  const server = new MissionServer({ clock: fixedClock, policy, driverManifest: driverManifest() });
  const mission = server.createMission({ idempotencyKey: "mission", preset, robot_ids: ["go2"] });
  const run = server.proposeRun({ idempotencyKey: "run", mission_id: mission.id, robot_id: "go2", verb: "follow", args: {}, proposed_by: "agent" });
  const { authorization } = server.approveRun({ idempotencyKey: "approve", run_id: run.id });

  assert.equal(authorization.grant.stream.limits.max_speed_mps, 0.11);
  assert.deepEqual(authorization.streams_granted, ["camera_front"]);
  assert.deepEqual(authorization.abort_triggers, ["operator_stop", "stream_silence"]);
  assert.deepEqual(authorization.capability, { verb: "follow", impl: "cap:follow-entity@0.1.0" });
});

test("MissionServer derives stream enforcement from driver observables", () => {
  const registry = new PolicyRegistry();
  registry.install({
    package: "cap:follow-entity@0.1.0",
    enabled: true,
    pinned: true,
    maturity: "experimental",
    gauntlet_report: "artifact:gauntlet",
    history: []
  });
  const preset = followPreset({ max_speed_mps: 0.11 });
  preset.rules[0].grant.limits.max_force_n = 12;
  const policy = new PresetPolicy({ preset, registry });
  const server = new MissionServer({ clock: fixedClock, policy, driverManifest: driverManifest() });
  const mission = server.createMission({ idempotencyKey: "mission", preset, robot_ids: ["go2"] });
  const run = server.proposeRun({ idempotencyKey: "run", mission_id: mission.id, robot_id: "go2", verb: "follow", args: {}, proposed_by: "agent" });
  const { authorization } = server.approveRun({ idempotencyKey: "approve", run_id: run.id });

  assert.deepEqual(authorization.enforcement, {
    max_speed_mps: "enforcing",
    max_yaw_rps: "enforcing",
    max_force_n: "advisory"
  });
  assert.equal(verifyCanonicalJson(authorization, server.publicKey), true);
});

test("MissionServer requires idempotency keys for mutating operations", () => {
  const server = new MissionServer({ clock: fixedClock });
  assert.throws(
    () => server.createMission({ preset: { id: "preset", version: "1.0.0" }, robot_ids: ["go2"] }),
    (error) => error instanceof MissionServerError && error.error_code === "IDEMPOTENCY_KEY_REQUIRED"
  );
});

test("FileSigningKeyStore fails closed on corrupt key records", () => {
  const dir = mkdtempSync(join(tmpdir(), "nemeia-signing-key-"));
  const path = join(dir, "mission-server-key.json");
  try {
    writeFileSync(path, "{\"schema_version\":1,\"algorithm\":\"ed25519\"}\n", "utf8");
    assert.throws(
      () => new FileSigningKeyStore({ path }).current(),
      (error) => error instanceof SigningKeyStoreError && error.error_code === "SIGNING_KEY_STORE_CORRUPT"
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeSceneBackedServer() {
  const eventLog = new EventLog({ clock: fixedClock });
  const scene = new SceneProjector({ eventLog, clock: fixedClock });
  const server = new MissionServer({ eventLog, scene, clock: fixedClock });
  return { server, scene };
}

function followPreset({
  min_capability_maturity = "experimental",
  max_speed_mps = 0.15,
  streams = ["camera_front"],
  abort_triggers = ["operator_stop", "stream_silence"]
} = {}) {
  return {
    id: "preset_go2_follow_v1",
    schema_version: 1,
    name: "go2-follow",
    version: "1.0.0",
    min_capability_maturity,
    provenance: {},
    signature: "ed25519:test",
    rules: [
      {
        verb: "follow",
        robots: ["go2"],
        principals: ["agent", "operator"],
        impl: { capability: "follow-entity", version: "0.1.0" },
        applies_to: ["trackable"],
        args: {},
        grant: {
          action_space: "base_velocity_3d",
          limits: { max_speed_mps, max_yaw_rps: 0.2 },
          watchdog_ms: 100,
          max_duration_ms: 120000
        },
        freshness: { robot_status_ms: 500, scene_ms: 700 },
        streams,
        network: "none",
        approval: { required: true, scope: "per_run" },
        abort_triggers
      }
    ]
  };
}

function driverManifest() {
  return {
    driver: "go2",
    version: "0.1.0",
    action_spaces: [{ name: "base_velocity_3d", kind: "continuous", hard_caps: { vx_mps: 0.25, yaw_rps: 0.35 }, observables: { velocity: "measured", force: "none" } }],
    native_actions: [],
    streams: [{ name: "camera_front", type: "rgb", hz: 30 }],
    safe_state: {
      kind: "hold_posture",
      balance_loop: "driver_maintained",
      max_entry_ms: 20,
      on_total_loss: { behavior: "vendor:damp", within_ms: 300 }
    }
  };
}

function kernelEvent(event_type, authorization, payload = {}, severity = 0) {
  return {
    schema_version: 1,
    source: `kernel:${authorization.robot_id}`,
    event_type,
    severity,
    robot_id: authorization.robot_id,
    mission_id: authorization.mission_id,
    run_id: authorization.run_id,
    refs: [authorization.id],
    payload: { authorization_id: authorization.id, ...payload }
  };
}
