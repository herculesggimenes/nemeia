import assert from "node:assert/strict";
import test from "node:test";
import type { CurrentWorldSnapshot } from "../../../world-client/src/index.ts";
import type { OperatorEvent } from "../../types/operator.ts";
import { projectionFromSnapshot } from "../../lib/world-operator/generated-projection.ts";
import { resultLabel } from "../../lib/world-operator/execution-result.ts";
import { operatorStateTone, reviewStatusLabel } from "../../lib/world-operator/state-presentation.ts";
import { EMPTY_HISTORY, MAX_FEEDBACK_EVENTS, mergeFeedbackPage, readFeedbackThrough } from "../../lib/world-operator/feedback-history.ts";

const event = (sequence: number, subjectId = "mission-a"): OperatorEvent => ({
  id: `event-${sequence}`, subjectId, sequence: String(sequence), kind: "mission.finding_rejected",
  detail: `rejection ${sequence}`, recordedAt: "2026-09-20T12:00:00Z",
});

const makeObjective = (id: string, dependsOn: string[] = [], optional = false) => ({
  id, dependsOn, optional, description: id, criterion: { tag: "Located", value: { description: id } },
});

test("operator state colors distinguish healthy auth, stale caution, cancellation and failures", () => {
  assert.equal(operatorStateTone("authenticated"), "healthy");
  assert.equal(operatorStateTone("stale"), "warning");
  assert.equal(operatorStateTone("cancelled"), "neutral");
  assert.equal(operatorStateTone("unknown"), "neutral");
  assert.equal(operatorStateTone("failed"), "error");
});

test("review copy requests a decision only for an active pending candidate", () => {
  assert.equal(reviewStatusLabel("active", 1, 0), "operator decision required");
  assert.equal(reviewStatusLabel("active", 0, 0), "no pending review");
  assert.equal(reviewStatusLabel("succeeded", 0, 1), "reviewed evidence");
  assert.equal(reviewStatusLabel("succeeded", 1, 1), "reviewed evidence");
  assert.equal(reviewStatusLabel("cancelled", 1, 0), "no pending review");
});

test("feedback pages preserve previous rejections, deduplicate and isolate missions", () => {
  const first = mergeFeedbackPage(EMPTY_HISTORY, { events: [event(1)], nextSequence: "1", historyGap: false }, "mission-a");
  const second = mergeFeedbackPage(first, { events: [event(1), event(2), event(3, "mission-b")], nextSequence: "3", historyGap: false }, "mission-a");
  assert.deepEqual(second.events.map((row) => row.id), ["event-1", "event-2"]);
  assert.deepEqual(mergeFeedbackPage(second, { events: [], nextSequence: "3", historyGap: false }, "mission-a"), second);
  assert.equal(first.events.length, 1);
  const bounded = mergeFeedbackPage(second, {
    events: Array.from({ length: MAX_FEEDBACK_EVENTS + 10 }, (_, index) => event(index + 4)),
    nextSequence: "200", historyGap: false,
  }, "mission-a");
  assert.equal(bounded.events.length, MAX_FEEDBACK_EVENTS);
  assert.equal(bounded.historyGap, true);
});

test("bounded feedback catch-up follows the watermark and reports a skipped interval", async () => {
  const cursors: string[] = [];
  const history = await readFeedbackThrough(async (_missionId, cursor) => {
    cursors.push(cursor);
    return cursor === "9872"
      ? { events: [event(9999), event(10000)], nextSequence: "10000", historyGap: false }
      : { events: [], nextSequence: cursor, historyGap: false };
  }, "mission-a", EMPTY_HISTORY, "10000", () => false);
  assert.deepEqual(cursors, ["0", "9872"]);
  assert.deepEqual(history.events.map((row) => row.id), ["event-9999", "event-10000"]);
  assert.equal(history.historyGap, true);
});

test("Navigate completion cites Unit pose only; Approach includes measured target evidence", () => {
  const navigate = resultLabel({ tag: "Succeeded", value: { completion: { tag: "Navigate", value: { unitObservationId: "pose-1", localReceiptId: "receipt-1" } } } });
  assert.match(navigate!, /Unit pose pose-1/);
  assert.doesNotMatch(navigate!, /target|distance|undefined/);
  assert.match(resultLabel({ tag: "Succeeded", value: { completion: { tag: "Approach", value: {
    unitObservationId: "pose-1", targetObservationId: "target-1", localReceiptId: "receipt-2", measuredDistanceM: 0.5,
  } } } })!, /0.50 m measured.*target target-1/);
});

test("native mission projection derives dependency readiness from accepted World progress", () => {
  const snapshot = {
    ...emptySnapshot(),
    assignedMissions: [{
      id: "mission-a", revision: 2n, state: { tag: "Active" },
      spec: { description: "native mission", objectives: [
        makeObjective("accepted"), makeObjective("next", ["accepted"]),
        makeObjective("blocked", ["accepted", "missing"]), makeObjective("optional", [], true),
        makeObjective("optional-dependent", ["optional"]),
      ] },
    }],
    relevantMissionObjectiveProgress: [{
      missionId: "mission-a", objectiveId: "accepted", evidence: { tag: "Observation", value: { observationId: "observation-a" } },
    }],
  } as unknown as CurrentWorldSnapshot;
  assert.deepEqual(projectionFromSnapshot(snapshot).missions[0].objectives.map((objective) => [objective.id, objective.state]), [
    ["accepted", "accepted"], ["next", "ready"], ["blocked", "blocked"], ["optional", "ready"], ["optional-dependent", "ready"],
  ]);
});

test("pixel geometry is separate from metric position; pose frame stays attached to its coordinates", () => {
  const snapshot = emptySnapshot();
  const time = { toISOString: () => "2026-09-20T12:00:00Z" };
  const geometry = { key: "g", entityId: "object", frameId: "image-frame", observedAt: time, observationId: "observation", version: 1n,
    value: { tag: "BoundingBox2D", value: { centerX: 200, centerY: 100, width: 20, height: 40, angleRad: 0,
      frame: { streamId: "camera", sessionId: "capture", sequence: 1n, capturedAt: time } } } };
  const imageOnly = projectionFromSnapshot({ ...snapshot, relevantGeometry: [geometry] } as unknown as CurrentWorldSnapshot);
  assert.equal(imageOnly.evidence[0].position, null);
  assert.equal(imageOnly.evidence[0].imageBox?.centerX, 200);
  assert.equal(imageOnly.evidence[0].geometryKind, "image");
  const measured = projectionFromSnapshot({ ...snapshot, relevantGeometry: [geometry], relevantPoses: [{
    key: "p", entityId: "object", frameId: "metric-frame", observedAt: time, observationId: "observation", version: 1n,
    value: { positionM: { x: 1, y: 2, z: 3 }, orientation: { x: 0, y: 0, z: 0, w: 1 } },
  }] } as unknown as CurrentWorldSnapshot, "native-identity");
  assert.equal(measured.evidence[0].frameId, "metric-frame");
  assert.equal(measured.operatorIdentity, "native-identity");
});

function emptySnapshot(): CurrentWorldSnapshot {
  return {
    readiness: [], addressedMessages: [], assignedMissions: [], relevantActionBindings: [], relevantAgents: [], relevantEntities: [],
    relevantExecutions: [], relevantGeometry: [], relevantLocalMaps: [], relevantMissionAgents: [], relevantMissionObjectiveProgress: [],
    relevantPoses: [], relevantSemantic: [], relevantUnitAssignments: [], relevantUnitControls: [], relevantFeedbackWatermarks: [],
  };
}
