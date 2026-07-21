import assert from "node:assert/strict";
import test from "node:test";
import { EventLog } from "../../mission-server/src/event-log.ts";
import { SceneProjector } from "../../scene/src/scene-projector.ts";
import { Precise2dPhysicsAdapter, WorldTwinBuilder, clearanceCheck, clearanceGraduationEvidence, worldRef } from "../src/world-twin.ts";
import { WorldTwinError } from "../src/world-twin-errors.ts";

test("worldRef is the deterministic content hash of the tuple", () => {
  const left = {
    scene_snapshot_id: "ssg_1",
    ontology_version: 1,
    label_map_version: 1,
    builder_version: 1,
    engine_version: "box3d-0.1.0",
    inflation_policy: "conf_linear_v1",
    seed: 42
  };
  const right = {
    seed: 42,
    inflation_policy: "conf_linear_v1",
    engine_version: "box3d-0.1.0",
    builder_version: 1,
    label_map_version: 1,
    ontology_version: 1,
    scene_snapshot_id: "ssg_1"
  };

  assert.equal(worldRef(left), worldRef(right));
  assert.match(worldRef(left), /^sha256:[0-9a-f]{64}$/);
});

test("WorldTwinBuilder derives stable bodies from Scene geometry", () => {
  const scene = sceneWithGeometry();
  const snapshot = scene.getScene();
  const world = new WorldTwinBuilder().build(snapshot);
  const rebuilt = new WorldTwinBuilder().build(snapshot);

  assert.equal(world.world_ref, rebuilt.world_ref);
  assert.deepEqual(
    world.bodies.map((body) => ({ entity_id: body.entity_id, physical_schema: body.physical_schema, aabb: body.aabb })),
    [
      {
        entity_id: "ent_box_01",
        physical_schema: "rigid",
        aabb: { min_x: 1.4, min_y: -0.1, max_x: 1.6, max_y: 0.1 }
      },
      {
        entity_id: "ent_hoodie_01",
        physical_schema: "deformable",
        aabb: { min_x: 0.7, min_y: -0.15, max_x: 0.9, max_y: 0.15 }
      }
    ]
  );
});

test("WorldTwinBuilder supports a precise 2D adapter for pose capsule clearance", () => {
  const snapshot = sceneWithPoseCapsule().getScene();
  const reference = new WorldTwinBuilder().build(snapshot);
  const precise = new WorldTwinBuilder({ physicsAdapter: new Precise2dPhysicsAdapter() }).build(snapshot);

  assert.equal(reference.tuple.engine_version, "box3d-0.1.0");
  assert.equal(precise.tuple.engine_version, "precise2d-0.1.0");
  assert.equal(precise.physics_adapter.fidelity, "deterministic-capsule");
  assert.notEqual(reference.world_ref, precise.world_ref);
  assert.deepEqual(precise.bodies[0].shape, "circle");
  assert.deepEqual(precise.bodies[0].circle, { x: 0.5, y: 0.5, radius: 0.1 });

  const referenceCheck = clearanceCheck({
    world: reference,
    sweep: { start_m: [0.5, 0], end_m: [0.5, 1], radius_m: 0.05 },
    min_clearance_m: 0.05
  });
  const preciseCheck = clearanceCheck({
    world: precise,
    sweep: { start_m: [0.5, 0], end_m: [0.5, 1], radius_m: 0.05 },
    min_clearance_m: 0.05
  });

  assert.equal(referenceCheck.details.violations[0].clearance_m, -0.1);
  assert.equal(preciseCheck.details.violations[0].clearance_m, -0.15);
});

test("sim.clearance fails advisory for deformable classes and enforcing for rigid classes", () => {
  const world = new WorldTwinBuilder().build(sceneWithGeometry().getScene());

  const advisory = clearanceCheck({
    world,
    sweep: { start_m: [0, 0], end_m: [1, 0], radius_m: 0.1 },
    min_clearance_m: 0.05,
    mode_by_physical_schema: { rigid: "enforcing", deformable: "advisory" }
  });

  assert.equal(advisory.name, "sim.clearance");
  assert.equal(advisory.result, "fail");
  assert.equal(advisory.mode, "advisory");
  assert.deepEqual(advisory.details.violations.map((entry) => entry.entity_id), ["ent_hoodie_01"]);

  const enforcing = clearanceCheck({
    world,
    sweep: { start_m: [0, 0], end_m: [2, 0], radius_m: 0.1 },
    min_clearance_m: 0.05,
    mode_by_physical_schema: { rigid: "enforcing", deformable: "advisory" }
  });

  assert.equal(enforcing.result, "fail");
  assert.equal(enforcing.mode, "enforcing");
  assert.deepEqual(enforcing.details.violations.map((entry) => entry.entity_id), ["ent_box_01", "ent_hoodie_01"]);
});

test("sim.clearance passes with enforcing mode when enforcing classes are configured", () => {
  const world = new WorldTwinBuilder().build(sceneWithGeometry().getScene());

  const check = clearanceCheck({
    world,
    sweep: { start_m: [-1, 1], end_m: [0, 1], radius_m: 0.1 },
    min_clearance_m: 0.05,
    mode_by_physical_schema: { rigid: "enforcing", deformable: "advisory" }
  });

  assert.equal(check.result, "pass");
  assert.equal(check.mode, "enforcing");
  assert.equal(check.details.world_ref, world.world_ref);
});

test("sim.clearance graduation evidence produces per-schema enforcement modes", () => {
  const world = new WorldTwinBuilder().build(sceneWithGeometry().getScene());
  const passingRigidSweeps = [
    { center_m: [1.5, 0.8], size_m: [0.2, 0.2] },
    { center_m: [1.5, 1.0], size_m: [0.2, 0.2] },
    { center_m: [1.5, 1.2], size_m: [0.2, 0.2] }
  ].map((sweep, index) => ({
    ...clearanceCheck({
      world: {
        ...world,
        bodies: world.bodies.filter((body) => body.physical_schema === "rigid")
      },
      sweep,
      min_clearance_m: 0.05
    }),
    details: {
      ...clearanceCheck({
        world: {
          ...world,
          bodies: world.bodies.filter((body) => body.physical_schema === "rigid")
        },
        sweep,
        min_clearance_m: 0.05
      }).details,
      evidence_ref: `artifact:rigid_clearance_${index + 1}`
    }
  }));
  const deformableFailure = clearanceCheck({
    world: {
      ...world,
      bodies: world.bodies.filter((body) => body.physical_schema === "deformable")
    },
    sweep: { start_m: [0, 0], end_m: [1, 0], radius_m: 0.1 },
    min_clearance_m: 0.05
  });
  const evidence = clearanceGraduationEvidence({
    checks: [...passingRigidSweeps, { ...deformableFailure, details: { ...deformableFailure.details, evidence_ref: "artifact:deformable_failure" } }],
    min_passes: 3
  });

  assert.equal(evidence.name, "sim.clearance.graduation");
  assert.deepEqual(evidence.mode_by_physical_schema, { deformable: "advisory", rigid: "enforcing" });
  assert.deepEqual(evidence.rows.find((row) => row.physical_schema === "rigid"), {
    physical_schema: "rigid",
    min_passes: 3,
    passes: 3,
    failures: 0,
    evidence_refs: ["artifact:rigid_clearance_1", "artifact:rigid_clearance_2", "artifact:rigid_clearance_3"],
    graduated: true,
    mode: "enforcing"
  });
  assert.equal(evidence.rows.find((row) => row.physical_schema === "deformable").mode, "advisory");

  const check = clearanceCheck({
    world,
    sweep: { start_m: [0, 0], end_m: [2, 0], radius_m: 0.1 },
    min_clearance_m: 0.05,
    mode_by_physical_schema: evidence.mode_by_physical_schema
  });
  assert.equal(check.mode, "enforcing");
});

test("WorldTwinBuilder rejects missing snapshots and malformed sweeps", () => {
  assert.throws(
    () => new WorldTwinBuilder().build(null),
    (error) => error instanceof WorldTwinError && error.error_code === "SCENE_SNAPSHOT_REQUIRED"
  );

  assert.throws(
    () => clearanceCheck({ world: { world_ref: "sha256:test", bodies: [] }, sweep: {} }),
    (error) => error instanceof WorldTwinError && error.error_code === "SWEEP_UNSUPPORTED"
  );
  assert.throws(
    () => clearanceGraduationEvidence({ checks: null }),
    (error) => error instanceof WorldTwinError && error.error_code === "GRADUATION_EVIDENCE_REQUIRED"
  );
});

function sceneWithGeometry() {
  const eventLog = new EventLog({ clock: sequenceClock(["2026-07-07T17:00:00.000Z", "2026-07-07T17:00:00.010Z"]) });
  const scene = new SceneProjector({ eventLog, clock: () => new Date("2026-07-07T17:00:00.020Z") });
  scene.appendObservation({
    source: "perception:fusion-rgb-lidar@1.0.0",
    robot_id: "go2",
    mission_id: "msn_test",
    payload: {
      streams: ["camera_front", "lidar"],
      labels: ["hoodie"],
      confidence: 0.9,
      track_id: "hoodie_01",
      geometry: { type: "bbox_3d", frame_id: "map", center_m: [0.8, 0, 0.2], size_m: [0.2, 0.3, 0.4] }
    }
  });
  scene.appendObservation({
    source: "perception:fusion-rgb-lidar@1.0.0",
    robot_id: "go2",
    mission_id: "msn_test",
    payload: {
      streams: ["camera_front", "lidar"],
      labels: ["obstacle"],
      confidence: 0.95,
      track_id: "box_01",
      geometry: { type: "bbox_3d", frame_id: "map", center_m: [1.5, 0, 0.2], size_m: [0.2, 0.2, 0.4] }
    }
  });
  return scene;
}

function sceneWithPoseCapsule() {
  const eventLog = new EventLog({ clock: () => new Date("2026-07-07T17:00:00.000Z") });
  const scene = new SceneProjector({ eventLog, clock: () => new Date("2026-07-07T17:00:00.020Z") });
  scene.appendObservation({
    source: "perception:pose@1.0.0",
    robot_id: "go2",
    mission_id: "msn_test",
    payload: {
      streams: ["camera_front"],
      labels: ["person"],
      confidence: 0.9,
      track_id: "person_01",
      geometry: { type: "pose_3d", frame_id: "map", position_m: [0.5, 0.5, 0], radius_m: 0.1 }
    }
  });
  return scene;
}

function sequenceClock(values) {
  let index = 0;
  return () => new Date(values[Math.min(index++, values.length - 1)]);
}
