import { t, type Infer } from "spacetimedb/server";

export const Role = t.enum("Role", [
  "viewer",
  "world_operator",
  "agent",
  "perception",
  "controller",
  "admin",
]);
export type Role = Infer<typeof Role>;

export const Mode = t.enum("Mode", ["simulation", "physical"]);
export type Mode = Infer<typeof Mode>;

export const Vec3 = t.object("Vec3", {
  x: t.f64(),
  y: t.f64(),
  z: t.f64(),
});
export const Quaternion = t.object("Quaternion", {
  x: t.f64(),
  y: t.f64(),
  z: t.f64(),
  w: t.f64(),
});
export const Pose3 = t.object("Pose3", {
  positionM: Vec3,
  orientation: Quaternion,
});

export const FrameRef = t.object("FrameRef", {
  streamId: t.string(),
  sessionId: t.string(),
  sequence: t.u64(),
  capturedAt: t.timestamp(),
});

export const PackagePin = t.object("PackagePin", {
  name: t.string(),
  version: t.string(),
  sha256: t.string(),
});

export const ResourceRef = t.object("ResourceRef", {
  id: t.string(),
  schema: t.string(),
  sha256: t.string(),
  byteLength: t.u64(),
});
export type ResourceRef = Infer<typeof ResourceRef>;

export const Geometry = t.enum("GeometryValue", {
  boundingBox3D: t.object("BoundingBox3D", {
    frameId: t.string(),
    pose: Pose3,
    sizeM: Vec3,
  }),
  boundingBox2D: t.object("BoundingBox2D", {
    frame: FrameRef,
    centerX: t.f64(),
    centerY: t.f64(),
    width: t.f64(),
    height: t.f64(),
    angleRad: t.f64(),
  }),
  pointCloud: t.object("PointCloud", {
    frameId: t.string(),
    resource: ResourceRef,
  }),
  mesh: t.object("Mesh", {
    frameId: t.string(),
    pose: Pose3,
    resource: ResourceRef,
  }),
});
export type Geometry = Infer<typeof Geometry>;

export const Semantic = t.object("SemanticValue", {
  hypotheses: t.array(
    t.object("Hypothesis", {
      label: t.string(),
      score: t.f64(),
    })
  ),
});
export type Semantic = Infer<typeof Semantic>;

export const PoseSample = t.object("PoseSample", {
  observedAt: t.timestamp(),
  frameId: t.string(),
  value: Pose3,
});
export const GeometrySample = t.object("GeometrySample", {
  observedAt: t.timestamp(),
  value: Geometry,
});
export const SemanticSample = t.object("SemanticSample", {
  observedAt: t.timestamp(),
  frameId: t.option(t.string()),
  value: Semantic,
});
export const TransformSample = t.object("TransformSample", {
  parentFrameId: t.string(),
  childFrameId: t.string(),
  observedAt: t.timestamp(),
  pose: Pose3,
});

export const ObservationInput = t.object("ObservationInput", {
  id: t.string(),
  producerSession: t.string(),
  trackId: t.option(t.string()),
  entityId: t.option(t.string()),
  localMapId: t.string(),
  inputs: t.array(FrameRef),
  retained: t.array(ResourceRef),
  transforms: t.array(TransformSample),
  supersedes: t.array(t.string()),
  pose: t.option(PoseSample),
  geometry: t.option(GeometrySample),
  semantic: t.option(SemanticSample),
});
export type ObservationInput = Infer<typeof ObservationInput>;

export const SpatialFrameInput = t.object("SpatialFrameInput", {
  frameId: t.string(),
  sourceSession: t.string(),
  originEpoch: t.u64(),
  parentFrameId: t.option(t.string()),
});
export type SpatialFrameInput = Infer<typeof SpatialFrameInput>;

export const MapCheckpointInput = t.object("MapCheckpointInput", {
  mapId: t.string(),
  expectedRevision: t.u64(),
  rootFrameId: t.string(),
  manifest: ResourceRef,
  evidenceIndex: ResourceRef,
  estimatorState: t.option(ResourceRef),
  inputObservationIds: t.array(t.string()),
});
export type MapCheckpointInput = Infer<typeof MapCheckpointInput>;

export const AssignmentPin = t.object("AssignmentPin", {
  agentId: t.string(),
  revision: t.u64(),
});

export const MissionLink = t.object("MissionLink", {
  missionId: t.string(),
  objectiveId: t.string(),
  expectedRevision: t.u64(),
});

export const NavigateIntent = t.object("NavigateIntent", {
  mapId: t.string(),
  basisRevision: t.u64(),
  targetFrameId: t.string(),
  target: Pose3,
});

export const ApproachIntent = t.object("ApproachIntent", {
  targetId: t.string(),
  standoffM: t.f64(),
  expectedGeometryVersion: t.u64(),
});

export const ActionIntent = t.enum("ActionIntent", {
  navigate: NavigateIntent,
  approach: ApproachIntent,
});
export type ActionIntent = Infer<typeof ActionIntent>;

export const ActionBindingPolicy = t.object("ActionBindingPolicy", {
  executor: PackagePin,
  mode: Mode,
  maxEvidenceAgeMs: t.u32(),
  maxLinearMps: t.f64(),
  maxRunMs: t.u32(),
  toleranceM: t.f64(),
});

export const ExecutionState = t.enum("ExecutionState", [
  "accepted",
  "running",
  "cancelling",
  "succeeded",
  "cancelled",
  "failed",
]);

export const NavigateCompletion = t.object("NavigateCompletion", {
  unitObservationId: t.string(),
  localReceiptId: t.string(),
});
export type NavigateCompletion = Infer<typeof NavigateCompletion>;

export const ApproachCompletion = t.object("ApproachCompletion", {
  unitObservationId: t.string(),
  targetObservationId: t.string(),
  localReceiptId: t.string(),
  measuredDistanceM: t.f64(),
});
export type ApproachCompletion = Infer<typeof ApproachCompletion>;

export const ExecutionCompletion = t.enum("ExecutionCompletion", {
  navigate: NavigateCompletion,
  approach: ApproachCompletion,
});
export type ExecutionCompletion = Infer<typeof ExecutionCompletion>;

export const ExecutionResult = t.enum("ExecutionResult", {
  succeeded: t.object("ExecutionSucceeded", {
    completion: ExecutionCompletion,
  }),
  cancelled: t.object("ExecutionCancelled", {
    localReceiptId: t.string(),
  }),
  failed: t.object("ExecutionFailed", {
    code: t.string(),
    detail: t.string(),
    localReceiptId: t.option(t.string()),
  }),
});
export type ExecutionResult = Infer<typeof ExecutionResult>;

/**
 * A measured safety fact captured for this execution after its effect window.
 * Admission-time UnitControl.safeStateConfirmed is deliberately not a proof
 * of safe closure; reducers must persist a fresh, execution-associated fact.
 */
export const ExecutionSafetyProof = t.object("ExecutionSafetyProof", {
  executionId: t.string(),
  unitId: t.string(),
  controllerEpoch: t.u64(),
  observationId: t.string(),
  observedAt: t.timestamp(),
});
export type ExecutionSafetyProof = Infer<typeof ExecutionSafetyProof>;
