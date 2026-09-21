import {
  assertFiniteNumber,
  type BoundingBox2D,
  type ImageDetection,
  type ImageFrame,
  type Pose3,
  type ResourceRef,
} from "./association-types.ts";
import type { WorldValueCodec } from "./types.ts";

export interface CameraCalibration {
  cameraFrameId: string;
  rangeFrameId: string;
  intrinsicsDigest: string;
  distortionDigest: string;
  extrinsicsDigest: string;
  timeOffsetMs: number;
}

export interface PoseHistorySample {
  observedAt: string;
  frameId: string;
  pose: Pose3;
  uncertaintyMs: number;
}

export interface RangeSupportPoint {
  x: number;
  y: number;
  z: number;
  pixelX: number;
  pixelY: number;
  depthM: number;
}

export interface CalibratedAssociationInput {
  detection: ImageDetection;
  imageFrame: ImageFrame;
  rangeFrame: {
    streamId: string;
    sessionId: string;
    spatialFrameId: string;
    sequence: bigint;
    capturedAt: string;
    resource: ResourceRef;
  };
  calibration: CameraCalibration;
  poseHistory: PoseHistorySample[];
  supportPoints: RangeSupportPoint[];
  occluded: boolean;
  surfaceConsistent: boolean;
  supportResource: ResourceRef;
}

export interface AssociationPolicy {
  maxClockSkewMs: number;
  maxPoseAgeMs: number;
  minSupportingPoints: number;
  maxDepthResidualM: number;
}

export type AssociationFailureReason =
  | "missing_intrinsics"
  | "missing_distortion"
  | "missing_extrinsics"
  | "clock_skew"
  | "invalid_timing"
  | "pose_unavailable"
  | "pose_stale"
  | "frame_reset"
  | "occluded"
  | "insufficient_surface_support"
  | "inconsistent_surface"
  | "support_outside_detection"
  | "invalid_point";

export interface ImageOnlyFallback {
  qualified: false;
  evidenceKind: "image_only";
  reasons: readonly AssociationFailureReason[];
}

export interface QualifiedPartialSurface {
  qualified: true;
  evidenceKind: "calibrated_partial_surface";
  reasons: readonly [];
  geometry: {
    kind: "partial_surface";
    frameId: string;
    supportResource: ResourceRef;
    supportingPointCount: number;
    completeness: "partial";
  };
  provenance: {
    cameraFrameId: string;
    rangeFrameId: string;
    intrinsicsDigest: string;
    distortionDigest: string;
    extrinsicsDigest: string;
    poseObservedAt: string;
    rangeCapturedAt: string;
  };
}

export type AssociationResult = ImageOnlyFallback | QualifiedPartialSurface;

export function qualifyCalibratedAssociation(input: CalibratedAssociationInput, policy: AssociationPolicy): AssociationResult {
  const reasons: AssociationFailureReason[] = [];
  if (!input.calibration.intrinsicsDigest) reasons.push("missing_intrinsics");
  if (!input.calibration.distortionDigest) reasons.push("missing_distortion");
  if (!input.calibration.extrinsicsDigest) reasons.push("missing_extrinsics");
  const imageCapturedAt = Date.parse(input.imageFrame.capturedAt);
  const rangeCapturedAt = Date.parse(input.rangeFrame.capturedAt);
  if (!Number.isFinite(imageCapturedAt) || !Number.isFinite(rangeCapturedAt) || !Number.isFinite(input.calibration.timeOffsetMs)) {
    reasons.push("invalid_timing");
  } else if (Math.abs(imageCapturedAt - rangeCapturedAt + input.calibration.timeOffsetMs) > policy.maxClockSkewMs) {
    reasons.push("clock_skew");
  }
  if (input.imageFrame.spatialFrameId !== input.rangeFrame.spatialFrameId) reasons.push("frame_reset");
  if (input.occluded) reasons.push("occluded");
  if (input.supportPoints.length < policy.minSupportingPoints) reasons.push("insufficient_surface_support");
  if (!input.surfaceConsistent) reasons.push("inconsistent_surface");
  if (input.supportPoints.some((point) => point.pixelX < input.detection.box.xMin || point.pixelX > input.detection.box.xMax || point.pixelY < input.detection.box.yMin || point.pixelY > input.detection.box.yMax)) {
    reasons.push("support_outside_detection");
  }
  if (!input.supportResource.id || !input.supportResource.schema || input.supportResource.byteLength <= 0n) reasons.push("invalid_point");

  for (const point of input.supportPoints) {
    try {
      for (const [name, value] of Object.entries(point)) assertFiniteNumber(value, name);
      if (point.depthM <= 0) reasons.push("invalid_point");
    } catch {
      reasons.push("invalid_point");
    }
  }

  const pose = nearestPose(input.poseHistory, input.imageFrame.capturedAt, policy.maxPoseAgeMs);
  if (!pose) {
    reasons.push(input.poseHistory.length ? "pose_stale" : "pose_unavailable");
  } else if (pose.frameId !== input.imageFrame.spatialFrameId) {
    reasons.push("frame_reset");
  }
  const uniqueReasons = [...new Set(reasons)];
  if (uniqueReasons.length) return { qualified: false, evidenceKind: "image_only", reasons: uniqueReasons };

  return {
    qualified: true,
    evidenceKind: "calibrated_partial_surface",
    reasons: [],
    geometry: {
      kind: "partial_surface",
      frameId: input.rangeFrame.spatialFrameId,
      supportResource: input.supportResource,
      supportingPointCount: input.supportPoints.length,
      completeness: "partial",
    },
    provenance: {
      cameraFrameId: input.calibration.cameraFrameId,
      rangeFrameId: input.calibration.rangeFrameId,
      intrinsicsDigest: input.calibration.intrinsicsDigest,
      distortionDigest: input.calibration.distortionDigest,
      extrinsicsDigest: input.calibration.extrinsicsDigest,
      poseObservedAt: pose!.observedAt,
      rangeCapturedAt: input.rangeFrame.capturedAt,
    },
  };
}

function nearestPose(history: readonly PoseHistorySample[], capturedAt: string, maxAgeMs: number): PoseHistorySample | undefined {
  let nearest: PoseHistorySample | undefined;
  let distance = Number.POSITIVE_INFINITY;
  for (const sample of history) {
    const observedAt = Date.parse(sample.observedAt);
    const capturedAtMs = Date.parse(capturedAt);
    if (!Number.isFinite(observedAt) || !Number.isFinite(capturedAtMs)) continue;
    const candidateDistance = Math.abs(observedAt - capturedAtMs);
    if (candidateDistance < distance) {
      distance = candidateDistance;
      nearest = sample;
    }
  }
  return nearest && distance <= maxAgeMs && nearest.uncertaintyMs <= maxAgeMs ? nearest : undefined;
}

export function imageOnlyGeometry(frame: ImageFrame, detection: ImageDetection, codec: WorldValueCodec): BoundingBox2D {
  return {
    frame: {
      streamId: frame.streamId,
      sessionId: frame.sourceSessionId,
      sequence: frame.sequence,
      capturedAt: codec.timestampFromIso(frame.capturedAt),
    },
    centerX: (detection.box.xMin + detection.box.xMax) / 2,
    centerY: (detection.box.yMin + detection.box.yMax) / 2,
    width: detection.box.xMax - detection.box.xMin,
    height: detection.box.yMax - detection.box.yMin,
    angleRad: 0,
  };
}
