import type {
  BoundingBox2D as NativeBoundingBox2D,
  GeometryValue as NativeGeometry,
  ObservationInput as NativeObservationInput,
  ResourceRef as NativeResourceRef,
} from "../../world-client/src/generated/types.ts";

export type { NativeGeometry, NativeObservationInput, NativeResourceRef };

export type NativeFrameRef = NativeObservationInput["inputs"][number];
export type NativeTransformSample = NativeObservationInput["transforms"][number];
export type NativePose3 = NonNullable<NativeObservationInput["pose"]>["value"];
export type NativeTimestamp = NativeFrameRef["capturedAt"];
export type { NativeBoundingBox2D };

export interface ResourceRefJson {
  readonly id: string;
  readonly schema: string;
  readonly sha256: string;
  readonly byteLength: string;
}

export function encodeResourceRefJson(resource: NativeResourceRef): ResourceRefJson {
  return Object.freeze({
    id: resource.id,
    schema: resource.schema,
    sha256: resource.sha256,
    byteLength: resource.byteLength.toString(10),
  });
}

export function decodeResourceRefJson(value: unknown): NativeResourceRef {
  if (!value || typeof value !== "object") throw new Error("resource_ref_json_object_required");
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.id !== "string" || typeof candidate.schema !== "string" || typeof candidate.sha256 !== "string" || typeof candidate.byteLength !== "string") {
    throw new Error("resource_ref_json_shape_invalid");
  }
  if (!/^\d+$/.test(candidate.byteLength) || candidate.byteLength === "0") throw new Error("resource_ref_byte_length_invalid");
  if (!/^[a-f0-9]{64}$/i.test(candidate.sha256)) throw new Error("resource_ref_sha256_invalid");
  return {
    id: candidate.id,
    schema: candidate.schema,
    sha256: candidate.sha256,
    byteLength: BigInt(candidate.byteLength),
  } as NativeResourceRef;
}

export function toSafeByteLength(value: bigint | string | number): number {
  const numeric = typeof value === "bigint" ? value : typeof value === "string" ? BigInt(value) : value;
  if (typeof numeric === "number") {
    if (!Number.isSafeInteger(numeric) || numeric <= 0) throw new Error("resource_byte_length_not_safe");
    return numeric;
  }
  if (numeric <= 0n || numeric > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("resource_byte_length_not_safe");
  return Number(numeric);
}
