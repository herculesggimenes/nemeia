import assert from "node:assert/strict";
import test from "node:test";
import { AttentionInbox } from "../../attention/src/attention-inbox.ts";
import { signCanonicalJson } from "../../contracts/src/signing.ts";
import { EventLog } from "../../mission-server/src/event-log.ts";
import { ReplayError } from "../src/replay-errors.ts";
import { ReplayBuilder } from "../src/replay-builder.ts";
import { generateKeyPairSync } from "node:crypto";

test("ReplayBuilder reconstructs run events in seq order and joins Authorizations", () => {
  const eventLog = new EventLog({ clock: fixedClock });
  const authorization = signedAuthorization();
  eventLog.append({ source: "mission-server", event_type: "run.proposed", severity: 0, mission_id: "msn_test", run_id: "run_test", payload: { verb: "follow" } });
  eventLog.append({
    source: "mission-server",
    event_type: "authorization.issued",
    severity: 0,
    mission_id: "msn_test",
    run_id: "run_test",
    refs: [authorization.id],
    payload: { authorization_id: authorization.id, artifact_refs: ["artifact:crop"] }
  });
  eventLog.append({ source: "kernel:go2", event_type: "authorization.completed", severity: 0, mission_id: "msn_test", run_id: "run_test", refs: [authorization.id], payload: {} });

  const replay = new ReplayBuilder({
    eventLog,
    getAuthorization: (id) => (id === authorization.id ? authorization : null),
    versionPins: { preset: "preset_go2_follow_v1@1.0.0" }
  }).buildRunReplay("run_test");

  assert.deepEqual(replay.events.map((event) => event.seq), [1, 2, 3]);
  assert.deepEqual(replay.authorization_ids, [authorization.id]);
  assert.equal(replay.authorizations[0].signature, authorization.signature);
  assert.equal(replay.version_pins.preset, "preset_go2_follow_v1@1.0.0");
  assert.equal(replay.version_pins.capability, "cap:follow-entity@0.1.0");
  assert.deepEqual(replay.artifacts, ["artifact:crop"]);
});

test("ReplayBuilder includes persisted Attention digest bytes from seam records", () => {
  const eventLog = new EventLog({ clock: fixedClock });
  const inbox = new AttentionInbox({
    eventLog,
    contract: {
      mission_id: "msn_test",
      principal: "agent",
      state_filter: ["run.own"],
      wake_predicate_cel: "false",
      budget: { max_pending: 50 },
      digest_version: 1,
      predicate_env_version: 1
    },
    clock: fixedClock
  });
  eventLog.append({ source: "mission-server", event_type: "run.rejected", severity: 0, mission_id: "msn_test", run_id: "run_test", payload: { summary: "Rejected." } });
  const drained = inbox.drain({ cause: "scheduled" });
  eventLog.append({ source: "mission-server", event_type: "run.completed", severity: 0, mission_id: "msn_test", run_id: "run_test", payload: { summary: "Done." } });

  const replay = new ReplayBuilder({
    eventLog,
    getDigestBytes: (digestRef) => inbox.replayDigest(digestRef)
  }).buildRunReplay("run_test");

  assert.equal(replay.attention_digests.length, 1);
  assert.equal(replay.attention_digests[0].digest_ref, drained.digest_ref);
  assert.equal(replay.attention_digests[0].bytes, drained.bytes);
});

test("ReplayBuilder builds mission reports from log counts", () => {
  const eventLog = new EventLog({ clock: fixedClock });
  eventLog.append({ source: "mission-server", event_type: "run.proposed", severity: 0, mission_id: "msn_test", run_id: "run_a", payload: {} });
  eventLog.append({ source: "mission-server", event_type: "authorization.issued", severity: 0, mission_id: "msn_test", run_id: "run_a", payload: { authorization_id: "auth_a" } });
  eventLog.append({ source: "kernel:go2", event_type: "authorization.aborted", severity: 1, mission_id: "msn_test", run_id: "run_a", payload: {} });
  eventLog.append({ source: "operator:op", event_type: "run.rejected", severity: 0, mission_id: "msn_test", run_id: "run_b", payload: {} });
  eventLog.append({ source: "operator:op", event_type: "anomaly.opened", severity: 1, mission_id: "msn_test", payload: { anomaly: { id: "anm_open" } } });
  eventLog.append({ source: "operator:op", event_type: "anomaly.opened", severity: 1, mission_id: "msn_test", payload: { anomaly: { id: "anm_closed" } } });
  eventLog.append({ source: "operator:op", event_type: "anomaly.closed", severity: 1, mission_id: "msn_test", payload: { anomaly_id: "anm_closed" } });

  const report = new ReplayBuilder({ eventLog }).buildMissionReport("msn_test");

  assert.deepEqual(report.counts, {
    events: 7,
    runs: 2,
    authorizations_issued: 1,
    completed_runs: 0,
    rejected_runs: 1,
    aborted_runs: 1,
    stops: 0,
    warnings: 4,
    critical: 0,
    anomalies_opened: 2,
    anomalies_closed: 1,
    anomalies_open: 1
  });
  assert.deepEqual(report.run_ids, ["run_a", "run_b"]);
});

test("ReplayBuilder fails closed when referenced Authorization is missing", () => {
  const eventLog = new EventLog({ clock: fixedClock });
  eventLog.append({
    source: "mission-server",
    event_type: "authorization.issued",
    severity: 0,
    mission_id: "msn_test",
    run_id: "run_test",
    payload: { authorization_id: "auth_missing" }
  });

  assert.throws(
    () => new ReplayBuilder({ eventLog }).buildRunReplay("run_test"),
    (error) => error instanceof ReplayError && error.error_code === "AUTHORIZATION_MISSING"
  );
});

function fixedClock() {
  return new Date("2026-07-07T17:00:00.000Z");
}

function signedAuthorization() {
  const { privateKey } = generateKeyPairSync("ed25519");
  const unsigned = {
    id: "auth_test",
    schema_version: 1,
    robot_id: "go2",
    run_id: "run_test",
    mission_id: "msn_test",
    grant: {
      stream: {
        action_space: "base_velocity_3d",
        limits: { max_speed_mps: 0.1 },
        watchdog_ms: 100,
        max_duration_ms: 1000
      }
    },
    enforcement: { max_speed_mps: "enforcing" },
    streams_granted: ["camera_front"],
    abort_triggers: ["operator_stop"],
    capability: { verb: "follow", impl: "cap:follow-entity@0.1.0" },
    checks: [{ name: "policy.approval", result: "pass", mode: "enforcing", details: {} }],
    issued_at: "2026-07-07T17:00:00.000Z",
    expires_at: "2026-07-07T17:01:00.000Z",
    signature: ""
  };
  return { ...unsigned, signature: signCanonicalJson(unsigned, privateKey) };
}
