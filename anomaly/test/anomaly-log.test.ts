import assert from "node:assert/strict";
import test from "node:test";
import { EventLog } from "../../mission-server/src/event-log.ts";
import { AnomalyError } from "../src/anomaly-errors.ts";
import { AnomalyLog } from "../src/anomaly-log.ts";

test("AnomalyLog opens anomalies as log-backed records", () => {
  const eventLog = new EventLog({ clock: fixedClock });
  const anomalies = new AnomalyLog({ eventLog });

  const { anomaly, event } = anomalies.open({
    id: "anm_test",
    severity: "warning",
    mission_id: "msn_test",
    run_id: "run_test",
    capability: "cap:follow-entity@0.1.0",
    driver: "go2@0.1.0",
    expected: "Robot stops within 300 ms.",
    observed: "Robot stopped within 290 ms.",
    evidence_refs: ["artifact:replay_run_test"],
    owner: "op_local",
    closure_criteria: "Review replay."
  });

  assert.equal(anomaly.status, "open");
  assert.equal(event.event_type, "anomaly.opened");
  assert.equal(event.timestamp, "2026-07-07T17:00:00.000Z");
  assert.deepEqual(event.refs, ["anm_test", "artifact:replay_run_test"]);
  assert.deepEqual(anomalies.get("anm_test"), anomaly);
});

test("AnomalyLog reconstructs assignment, update, and close transitions from events", () => {
  const anomalies = new AnomalyLog({ eventLog: new EventLog({ clock: fixedClock }) });
  anomalies.open({
    id: "anm_test",
    severity: "safety",
    mission_id: "msn_test",
    expected: "No contact.",
    observed: "Unexpected contact.",
    evidence_refs: ["artifact:first"],
    closure_criteria: "Corrective action merged."
  });

  anomalies.assign({ anomaly_id: "anm_test", owner: "op_2" });
  anomalies.update({
    anomaly_id: "anm_test",
    patch: {
      suspected_cause: "Stale scene.",
      evidence_refs: ["artifact:second"]
    }
  });
  const { anomaly } = anomalies.close({
    anomaly_id: "anm_test",
    resolution: "Scene freshness check tightened.",
    evidence_refs: ["artifact:fix"]
  });

  assert.equal(anomaly.status, "closed");
  assert.equal(anomaly.owner, "op_2");
  assert.equal(anomaly.suspected_cause, "Stale scene.");
  assert.deepEqual(anomaly.evidence_refs, ["artifact:first", "artifact:second", "artifact:fix"]);
});

test("AnomalyLog reports open safety anomalies and blocks guarded operations", () => {
  const anomalies = new AnomalyLog({ eventLog: new EventLog({ clock: fixedClock }) });
  anomalies.open({
    id: "anm_info",
    severity: "info",
    mission_id: "msn_test",
    expected: "Expected.",
    observed: "Observed.",
    evidence_refs: []
  });
  anomalies.open({
    id: "anm_safety",
    severity: "safety",
    mission_id: "msn_test",
    capability: "cap:follow-entity@0.1.0",
    expected: "Expected.",
    observed: "Observed.",
    evidence_refs: []
  });

  assert.deepEqual(anomalies.openSafetyAnomalies().map((anomaly) => anomaly.id), ["anm_safety"]);
  assert.throws(
    () => anomalies.assertNoOpenSafetyAnomalies({ capability: "cap:follow-entity@0.1.0" }),
    (error) => error instanceof AnomalyError && error.error_code === "SAFETY_ANOMALY_OPEN"
  );

  anomalies.close({ anomaly_id: "anm_safety" });
  assert.equal(anomalies.assertNoOpenSafetyAnomalies({ capability: "cap:follow-entity@0.1.0" }), true);
});

test("AnomalyLog refuses invalid and closed-record transitions", () => {
  const anomalies = new AnomalyLog({ eventLog: new EventLog({ clock: fixedClock }) });

  assert.throws(
    () => anomalies.open({ severity: "warning", mission_id: "msn_test", expected: "x", observed: "y", evidence_refs: "bad" }),
    (error) => error instanceof AnomalyError && error.error_code === "INVALID_ANOMALY"
  );

  anomalies.open({
    id: "anm_test",
    severity: "warning",
    mission_id: "msn_test",
    expected: "Expected.",
    observed: "Observed.",
    evidence_refs: []
  });
  anomalies.close({ anomaly_id: "anm_test" });

  assert.throws(
    () => anomalies.assign({ anomaly_id: "anm_test", owner: "op_2" }),
    (error) => error instanceof AnomalyError && error.error_code === "ANOMALY_CLOSED"
  );
});

function fixedClock() {
  return new Date("2026-07-07T17:00:00.000Z");
}
