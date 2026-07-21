import assert from "node:assert/strict";
import test from "node:test";
import { EventLog } from "../../mission-server/src/event-log.ts";
import { SceneError } from "../src/scene-errors.ts";
import { SceneProjector } from "../src/scene-projector.ts";

test("SceneProjector reduces observation events into compact entities", () => {
  const clock = () => new Date("2026-07-07T17:00:00.500Z");
  const eventLog = new EventLog({ clock: () => new Date("2026-07-07T17:00:00.000Z") });
  const scene = new SceneProjector({ eventLog, clock });
  scene.appendObservation({
    source: "perception:camera-detector@1.0.0",
    robot_id: "go2",
    mission_id: "msn_test",
    payload: {
      streams: ["camera_front"],
      labels: ["person"],
      confidence: 0.9,
      track_id: "person_01",
      geometry: { type: "bbox_2d", frame_id: "camera_front" },
      artifact_refs: ["artifact:frame_01"]
    }
  });

  const snapshot = scene.getScene();

  assert.equal(snapshot.scene_snapshot_id, "ssg_1");
  assert.equal(snapshot.entities[0].id, "ent_person_01");
  assert.equal(snapshot.entities[0].type, "core.person");
  assert.equal(snapshot.entities[0].freshness_ms, 500);
  assert.deepEqual(snapshot.entities[0].affordances.find((entry) => entry.name === "trackable"), {
    name: "trackable",
    confidence: 0.9
  });
});

test("SceneProjector skips constituent observations superseded by fusion refs", () => {
  const eventLog = new EventLog({
    clock: sequenceClock([
      "2026-07-07T17:00:00.000Z",
      "2026-07-07T17:00:00.010Z",
      "2026-07-07T17:00:00.020Z"
    ])
  });
  const scene = new SceneProjector({ eventLog, clock: () => new Date("2026-07-07T17:00:00.020Z") });
  const rgb = scene.appendObservation({
    source: "perception:rgb@1.0.0",
    robot_id: "go2",
    mission_id: "msn_test",
    payload: { streams: ["camera_front"], labels: ["person"], confidence: 0.7, track_id: "person_01" }
  });
  const lidar = scene.appendObservation({
    source: "perception:lidar@1.0.0",
    robot_id: "go2",
    mission_id: "msn_test",
    payload: { streams: ["lidar"], geometry: { type: "bbox_3d", frame_id: "map" } }
  });
  scene.appendObservation({
    source: "perception:fusion-rgb-lidar@1.0.0",
    robot_id: "go2",
    mission_id: "msn_test",
    refs: [rgb.seq, lidar.seq],
    payload: { streams: ["camera_front", "lidar"], labels: ["person"], confidence: 0.95, track_id: "person_01" }
  });

  const snapshot = scene.getScene();

  assert.equal(snapshot.entities.length, 1);
  assert.equal(snapshot.entities[0].last_observation_seq, 3);
  assert.equal(snapshot.entities[0].affordances[0].confidence, 0.95);
});

test("SceneProjector scene diffs classify added and changed entities", () => {
  const eventLog = new EventLog({
    clock: sequenceClock([
      "2026-07-07T17:00:00.000Z",
      "2026-07-07T17:00:00.010Z",
      "2026-07-07T17:00:00.020Z",
      "2026-07-07T17:00:00.030Z"
    ])
  });
  const scene = new SceneProjector({ eventLog, clock: () => new Date("2026-07-07T17:00:00.030Z") });
  scene.appendObservation({
    source: "perception:camera-detector@1.0.0",
    robot_id: "go2",
    mission_id: "msn_test",
    payload: { streams: ["camera_front"], labels: ["person"], confidence: 0.7, track_id: "person_01" }
  });
  scene.appendObservation({
    source: "perception:camera-detector@1.0.0",
    robot_id: "go2",
    mission_id: "msn_test",
    payload: { streams: ["camera_front"], labels: ["person"], confidence: 0.7, track_id: "person_01" }
  });
  scene.appendObservation({
    source: "perception:camera-detector@1.0.0",
    robot_id: "go2",
    mission_id: "msn_test",
    payload: { streams: ["camera_front"], labels: ["person"], confidence: 0.9, track_id: "person_01" }
  });
  scene.appendObservation({
    source: "perception:camera-detector@1.0.0",
    robot_id: "go2",
    mission_id: "msn_test",
    payload: { streams: ["camera_front"], labels: ["hoodie"], confidence: 0.8, track_id: "hoodie_01" }
  });

  const unchanged = scene.getSceneSince("ssg_1");
  const changed = scene.getSceneSince("ssg_2");

  assert.deepEqual(unchanged.added.map((entity) => entity.id), ["ent_hoodie_01"]);
  assert.deepEqual(unchanged.changed.map((entity) => entity.id), ["ent_person_01"]);
  assert.deepEqual(unchanged.removed, []);
  assert.deepEqual(changed.added.map((entity) => entity.id), ["ent_hoodie_01"]);
  assert.deepEqual(changed.changed.map((entity) => entity.id), ["ent_person_01"]);
  assert.deepEqual(changed.coalesced_counts, { observations: 2, relations: 0, tombstones: 0, entities: 2 });
});

test("SceneProjector applies explicit tombstones to remove entities from diffs", () => {
  const eventLog = new EventLog({
    clock: sequenceClock([
      "2026-07-07T17:00:00.000Z",
      "2026-07-07T17:00:00.010Z",
      "2026-07-07T17:00:00.020Z"
    ])
  });
  const scene = new SceneProjector({ eventLog, clock: () => new Date("2026-07-07T17:00:00.020Z") });
  scene.appendObservation({
    source: "perception:camera-detector@1.0.0",
    robot_id: "go2",
    mission_id: "msn_test",
    payload: { streams: ["camera_front"], labels: ["person"], confidence: 0.9, track_id: "person_01" }
  });
  scene.appendTombstone({
    source: "operator:local",
    robot_id: "go2",
    mission_id: "msn_test",
    entity_id: "ent_person_01",
    reason: "left frame"
  });

  const snapshot = scene.getScene();
  const diff = scene.getSceneSince("ssg_1");

  assert.deepEqual(snapshot.entities, []);
  assert.deepEqual(diff.added, []);
  assert.deepEqual(diff.changed, []);
  assert.deepEqual(diff.removed, [{ id: "ent_person_01", last_observation_seq: 1 }]);
  assert.deepEqual(diff.coalesced_counts, { observations: 0, relations: 0, tombstones: 1, entities: 1 });

  scene.appendObservation({
    source: "perception:camera-detector@1.0.0",
    robot_id: "go2",
    mission_id: "msn_test",
    payload: { streams: ["camera_front"], labels: ["person"], confidence: 0.8, track_id: "person_01" }
  });

  assert.deepEqual(scene.getScene().entities.map((entity) => entity.id), ["ent_person_01"]);
  assert.deepEqual(scene.getSceneSince("ssg_2").added.map((entity) => entity.id), ["ent_person_01"]);
});

test("SceneProjector projects relations with provenance and input freshness", () => {
  const eventLog = new EventLog({
    clock: sequenceClock([
      "2026-07-07T17:00:00.000Z",
      "2026-07-07T17:00:00.010Z",
      "2026-07-07T17:00:00.020Z",
      "2026-07-07T17:00:00.030Z"
    ])
  });
  const scene = new SceneProjector({ eventLog, clock: () => new Date("2026-07-07T17:00:00.030Z") });
  scene.appendObservation({
    source: "perception:camera-detector@1.0.0",
    robot_id: "go2",
    mission_id: "msn_test",
    payload: { streams: ["camera_front"], labels: ["person"], confidence: 0.9, track_id: "person_01" }
  });
  scene.appendObservation({
    source: "perception:camera-detector@1.0.0",
    robot_id: "go2",
    mission_id: "msn_test",
    payload: { streams: ["camera_front"], labels: ["hoodie"], confidence: 0.8, track_id: "hoodie_01" }
  });
  scene.appendRelation({
    source: "perception:spatial-relations@1.0.0",
    robot_id: "go2",
    mission_id: "msn_test",
    subject_id: "ent_person_01",
    relation: "visible_from",
    object_id: "ent_hoodie_01",
    provenance: "observed"
  });

  const snapshot = scene.getScene();
  assert.deepEqual(snapshot.relations, [
    {
      subject_id: "ent_person_01",
      relation: "visible_from",
      object_id: "ent_hoodie_01",
      provenance: "observed",
      freshness_ms: 30,
      evidence_refs: ["event:3"],
      last_relation_seq: 3
    }
  ]);
  assert.equal(scene.getSceneSince("ssg_2").coalesced_counts.relations, 1);

  scene.appendTombstone({
    source: "operator:local",
    robot_id: "go2",
    mission_id: "msn_test",
    entity_id: "ent_hoodie_01"
  });

  assert.deepEqual(scene.getScene().relations, []);
});

test("SceneProjector bind pins current snapshot and rejects stale or low-confidence entities", () => {
  const eventLog = new EventLog({ clock: () => new Date("2026-07-07T17:00:00.000Z") });
  const scene = new SceneProjector({ eventLog, clock: () => new Date("2026-07-07T17:00:00.500Z") });
  scene.appendObservation({
    source: "perception:camera-detector@1.0.0",
    robot_id: "go2",
    mission_id: "msn_test",
    payload: { streams: ["camera_front"], labels: ["person"], confidence: 0.8, track_id: "person_01", artifact_refs: ["artifact:crop"] }
  });

  assert.deepEqual(scene.bind({ verb: "follow", target: { entity_id: "ent_person_01" } }), {
    entity_id: "ent_person_01",
    snapshot_id: "ssg_1",
    evidence_refs: ["artifact:crop", "event:1"]
  });
  assert.throws(
    () => scene.bind({ verb: "follow", target: { entity_id: "ent_person_01" }, confidenceThreshold: 0.9 }),
    (error) => error instanceof SceneError && error.error_code === "AFFORDANCE_LOW_CONFIDENCE"
  );
  assert.throws(
    () => scene.bind({ verb: "follow", target: { entity_id: "ent_person_01" }, freshnessMaxMs: 100 }),
    (error) => error instanceof SceneError && error.error_code === "SCENE_STALE"
  );
});

test("SceneProjector rejects missing entities and verbs without affordance binding", () => {
  const eventLog = new EventLog({ clock: () => new Date("2026-07-07T17:00:00.000Z") });
  const scene = new SceneProjector({ eventLog, clock: () => new Date("2026-07-07T17:00:00.000Z") });
  scene.appendObservation({
    source: "perception:camera-detector@1.0.0",
    robot_id: "go2",
    mission_id: "msn_test",
    payload: { streams: ["camera_front"], labels: ["person"], confidence: 0.9, track_id: "person_01" }
  });

  assert.throws(
    () => scene.bind({ verb: "follow", target: { entity_id: "ent_missing" } }),
    (error) => error instanceof SceneError && error.error_code === "ENTITY_NOT_IN_SCENE"
  );
  assert.throws(
    () => scene.bind({ verb: "dance", target: { entity_id: "ent_person_01" } }),
    (error) => error instanceof SceneError && error.error_code === "VERB_NOT_APPLICABLE"
  );
});

function sequenceClock(values) {
  let index = 0;
  return () => new Date(values[Math.min(index++, values.length - 1)]);
}
