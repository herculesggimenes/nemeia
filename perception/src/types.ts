import { createHash } from "node:crypto";
import type {
  NativeBoundingBox2D,
  NativeFrameRef,
  NativeObservationInput,
  NativePose3,
  NativeResourceRef,
  NativeTimestamp,
  NativeTransformSample,
} from "./world-types.ts";

export type ResourceRef = NativeResourceRef;
export type FrameRef = NativeFrameRef;
export type Pose3 = NativePose3;
export type TransformSample = NativeTransformSample;
export type ObservationInput = NativeObservationInput;
export type BoundingBox2D = NativeBoundingBox2D;
export type Timestamp = string;
export type WorldTimestamp = NativeTimestamp;

/** Converts source ISO strings only at the generated-world boundary. */
export interface WorldValueCodec {
  timestampFromIso(value: string): NativeTimestamp;
  timestampToIso(value: NativeTimestamp): string;
}

export interface ModelProvenance {
  name: string;
  version: string;
  sha256: string;
  promptProfile: string;
  runtime: string;
  inputSize: { width: number; height: number };
}

export interface PublishedObservation {
  input: ObservationInput;
  provenance: ModelProvenance;
  evidenceKind: "image_only" | "calibrated_partial_surface";
}

export interface ObservationReceipt {
  observationId: string;
  duplicate: boolean;
}

export interface ObservationPublisher {
  publish(observation: PublishedObservation): Promise<ObservationReceipt>;
}

export interface RecordedSample {
  unitId: string;
  producerId: string;
  streamId: string;
  sourceSessionId: string;
  spatialFrameId: string;
  sequence: bigint;
  capturedAt: Timestamp;
  receivedAt: Timestamp;
  clockErrorMs: number;
  schema: string;
  bytes: Uint8Array;
  fixtureKind: "recorded" | "synthetic";
}

export interface AcquiredFrame {
  unitId: string;
  producerId: string;
  streamId: string;
  sourceSessionId: string;
  spatialFrameId: string;
  sequence: bigint;
  capturedAt: Timestamp;
  receivedAt: Timestamp;
  clockErrorMs: number;
  schema: string;
  resource: ResourceRef;
  fixtureKind: "recorded" | "synthetic";
}

export interface ReplayIssue {
  key: string;
  code:
    | "invalid_timestamp"
    | "invalid_clock_error"
    | "unsupported_schema"
    | "unsupported_format"
    | "empty_bytes"
    | "conflicting_duplicate";
  detail: string;
}

export interface ReplayReport {
  fixtureKind: "recorded" | "synthetic";
  accepted: AcquiredFrame[];
  duplicateKeys: string[];
  issues: ReplayIssue[];
}

export const NATIVE_SCHEMAS = new Set([
  "sensor_msgs/Image",
  "sensor_msgs/CompressedImage",
  "sensor_msgs/PointCloud2",
  "nav_msgs/OccupancyGrid",
  "unitree/uslam/map_file_pub",
]);

export function sourceKey(sample: Pick<RecordedSample, "unitId" | "producerId" | "streamId" | "sourceSessionId" | "spatialFrameId" | "sequence">): string {
  return JSON.stringify([sample.unitId, sample.producerId, sample.streamId, sample.sourceSessionId, sample.spatialFrameId, sample.sequence.toString()]);
}

export function isTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value)) && value.includes("T") && value.endsWith("Z");
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function canonicalJson(value: unknown): string {
  const normalize = (entry: unknown): unknown => {
    if (typeof entry === "bigint") return entry.toString();
    if (entry instanceof Uint8Array) return Array.from(entry);
    if (Array.isArray(entry)) return entry.map(normalize);
    if (entry && typeof entry === "object") {
      return Object.fromEntries(
        Object.entries(entry as Record<string, unknown>)
          .filter(([, item]) => item !== undefined)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, item]) => [key, normalize(item)]),
      );
    }
    return entry;
  };
  return JSON.stringify(normalize(value));
}

export function assertFiniteNumber(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new Error(`${name}_must_be_finite`);
}
