import { t, type Infer } from "spacetimedb";

// region geometry
export const Vec3 = t.object("Vec3", {
  x: t.f64(), // finite x, meters when used for positions or dimensions
  y: t.f64(), // finite y
  z: t.f64(), // finite z
});
export const Quaternion = t.object("Quaternion", {
  x: t.f64(), y: t.f64(), z: t.f64(), w: t.f64(), // unit quaternion, ROS [x,y,z,w] order
});
export const Pose3 = t.object("Pose3", {
  positionM: Vec3, // translation in the containing coordinate frame
  orientation: Quaternion, // unit rotation; reject invalid norms
});
export const FrameRef = t.object("FrameRef", {
  streamId: t.string(), // camera, LiDAR or another sensor stream
  sessionId: t.string(), // changes when the stream restarts
  sequence: t.u64(), // sample number within the stream session
  capturedAt: t.timestamp(), // acquisition time mapped to the world clock
});
export const ResourceRef = t.object("ResourceRef", {
  id: t.string(), // immutable stored bytes; not a URL or live stream
  schema: t.string(), // exact encoding/version, e.g. sensor_msgs/PointCloud2
  sha256: t.string(), // digest of retained bytes; storage confirms persistence first
});
export const Geometry = t.enum("Geometry", {
  boundingBox3D: t.object("BoundingBox3D", {
    frameId: t.string(), pose: Pose3, sizeM: Vec3, // center pose and full positive dimensions
  }),
  boundingBox2D: t.object("BoundingBox2D", {
    frame: FrameRef, // exact image, not the world map
    centerX: t.f64(), centerY: t.f64(), // pixels
    width: t.f64(), height: t.f64(), angleRad: t.f64(), // full extents and rotation
  }),
  pointCloud: t.object("PointCloud", {
    frameId: t.string(), resource: ResourceRef, // cloud bytes stay outside the live database
  }),
  mesh: t.object("Mesh", {
    frameId: t.string(), pose: Pose3, resource: ResourceRef, // vertices and topology in retained bytes
  }),
}); // SDK unions use { tag, value }; these four names remain Nemeia's geometry tags
export type Geometry = Infer<typeof Geometry>;
// endregion

// region evidence
export const PackagePin = t.object("PackagePin", {
  name: t.string(), version: t.string(), sha256: t.string(), // immutable producing/executing code
});
export const Semantic = t.object("Semantic", {
  hypotheses: t.array(t.object("Hypothesis", {
    label: t.string(), score: t.f64(), // model score in [0,1], not physical capability
  })),
});
export const PoseSample = t.object("PoseSample", {
  observedAt: t.timestamp(), frameId: t.string(), value: Pose3, // acquisition time, not database arrival
});
export const GeometrySample = t.object("GeometrySample", {
  observedAt: t.timestamp(), value: Geometry, // independent geometry timestamp
});
export const SemanticSample = t.object("SemanticSample", {
  observedAt: t.timestamp(), value: Semantic, // a new label does not refresh geometry
});
export const TransformSample = t.object("TransformSample", {
  parentFrameId: t.string(), childFrameId: t.string(), // transform maps child coordinates into parent
  observedAt: t.timestamp(), pose: Pose3, // exact acquisition-time transform, not the latest one
});
export const ObservationInput = t.object("ObservationInput", {
  id: t.string(), // UUID; identical retries are no-ops, changed payloads are conflicts
  producerSession: t.string(), // must match the authenticated member's current producer session
  trackId: t.option(t.string()), // scoped to identity + producer session; never a label
  entityId: t.option(t.string()), // trusted association hint; reducer checks allowed entity/facet ownership
  inputs: t.array(FrameRef), // evidence references do not promise recorded bytes
  retained: t.array(ResourceRef), // only resources already durably stored
  transforms: t.array(TransformSample), // coordinate conversions used by this observation
  supersedes: t.array(t.string()), // validated predecessor observation IDs for fusion provenance
  pose: t.option(PoseSample), // omitted facet leaves the current component unchanged
  geometry: t.option(GeometrySample), // at least one of pose, geometry, semantic must be present
  semantic: t.option(SemanticSample), // each supplied facet has its own freshness and ownership checks
});
export type ObservationInput = Infer<typeof ObservationInput>;
// endregion

// region action
export const MissionLink = t.object("MissionLink", {
  missionId: t.string(), objectiveId: t.string(), // mission and ready approached objective this attempt advances
  expectedRevision: t.u64(), // admission and claim reject a closing, terminal or changed mission
});
export const ApproachRequest = t.object("ApproachRequest", {
  executionId: t.string(), // caller-generated UUID; both attempt identity and retry key
  unitId: t.string(), // controllable entity chosen by an agent; never a separate robot identity
  assignment: t.option(t.object("AssignmentPin", {
    agentId: t.string(), revision: t.u64(), // verify caller mapping, current Unit grant, allowed action and expiry at admission AND claim
  })), // required for agents; absent only on the explicit World Master intervention path
  targetId: t.string(), // existing entity with usable 3D geometry
  standoffM: t.f64(), // positive ground-plane distance to target center; not obstacle clearance
  expectedGeometryVersion: t.u64(), // reject if the selected target changed since the client read it
  acceptBy: t.timestamp(), // short acceptance deadline; not a physical motion deadline
  mission: t.option(MissionLink), // required for agents; absent only for an audited standalone World Master intervention
});
export type ApproachRequest = Infer<typeof ApproachRequest>;
export const ExecutionState = t.enum("ExecutionState", [
  "accepted", "running", "cancelling", "succeeded", "cancelled", "failed",
]); // terminal states are immutable; running means claimed, not proof of motion
export const Completion = t.enum("Completion", {
  succeeded: t.object("ApproachResult", {
    distanceM: t.f64(), // measured distance, checked against unit/target observations
    unitObservationId: t.string(), targetObservationId: t.string(), // exact final measurements
    localReceiptId: t.string(), // durable controller receipt confirming safe closure
  }),
  cancelled: t.object("Cancelled", { localReceiptId: t.string() }), // safe state confirmed
  failed: t.object("Failed", {
    code: t.string(), detail: t.string(), // e.g. stale_evidence, watchdog, outcome_unknown
    localReceiptId: t.option(t.string()), // absent when the physical outcome cannot be established
  }),
});
export type Completion = Infer<typeof Completion>;
export const Role = t.enum("Role", ["viewer", "world_master", "agent", "perception", "controller", "admin"]); // admin provisions; World Master governs missions; neither overrides local safety
export const Mode = t.enum("Mode", ["simulation", "physical"]);
// endregion
