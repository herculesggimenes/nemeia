import { Identity, Timestamp } from "spacetimedb";
import type { ResourceRef } from "./generated/types";

export type ResourceReferenceJson = Omit<ResourceRef, "byteLength"> & {
  byteLength: string;
};

function normalize(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === "bigint") return value.toString(10);
  if (value instanceof Timestamp) return value.toISOString();
  if (value instanceof Identity) return value.toHexString();
  if (value instanceof Date) return value.toISOString();
  if (value !== null && typeof value === "object") {
    if (seen.has(value)) throw new TypeError("cannot canonicalize cyclic JSON");
    seen.add(value);
    try {
      if (Array.isArray(value)) return value.map((item) => normalize(item, seen));
      return Object.fromEntries(
        Object.entries(value)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, nested]) => [key, normalize(nested, seen)])
      );
    } finally {
      seen.delete(value);
    }
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new TypeError("cannot canonicalize non-finite number");
  }
  return value;
}

/** Canonical lossless JSON: bigint is encoded as a decimal string. */
export function canonicalJson(value: unknown): string {
  const encoded = JSON.stringify(normalize(value, new WeakSet<object>()));
  if (encoded === undefined) throw new TypeError("cannot canonicalize undefined");
  return encoded;
}

export function parseCanonicalJson(value: string): unknown;
export function parseCanonicalJson<T>(value: string, validate: (value: unknown) => value is T): T;
export function parseCanonicalJson<T>(value: string, validate?: (value: unknown) => value is T): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch (error) {
    throw new TypeError("invalid_canonical_json", { cause: error });
  }
  if (validate && !validate(parsed)) throw new TypeError("invalid_canonical_json_value");
  return parsed;
}

export function resourceRefToJson(value: ResourceRef): ResourceReferenceJson {
  validateResourceRef(value);
  return {
    id: value.id,
    schema: value.schema,
    sha256: value.sha256,
    byteLength: value.byteLength.toString(10),
  };
}

export function resourceRefFromJson(value: unknown): ResourceRef {
  if (value === null || typeof value !== "object") throw new TypeError("invalid_resource_reference");
  const record = value as Record<string, unknown>;
  if (
    typeof record.id !== "string" ||
    typeof record.schema !== "string" ||
    typeof record.sha256 !== "string" ||
    typeof record.byteLength !== "string" ||
    !/^\d+$/.test(record.byteLength)
  ) throw new TypeError("invalid_resource_reference");
  let byteLength: bigint;
  try {
    byteLength = BigInt(record.byteLength);
  } catch (error) {
    throw new TypeError("invalid_resource_reference", { cause: error });
  }
  const result: ResourceRef = { id: record.id, schema: record.schema, sha256: record.sha256, byteLength };
  validateResourceRef(result);
  return result;
}

export function validateResourceRef(value: ResourceRef): void {
  const maxU64 = (1n << 64n) - 1n;
  if (
    value.id.length === 0 ||
    value.schema.length === 0 ||
    !/^[a-f0-9]{64}$/i.test(value.sha256) ||
    value.byteLength <= 0n ||
    value.byteLength > maxU64
  ) throw new TypeError("invalid_resource_reference");
}
