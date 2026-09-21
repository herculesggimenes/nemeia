import { createHash } from "node:crypto";
import type { JsonValue } from "./types.ts";

export function canonicalize(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child as JsonValue)]),
  );
}

export function canonicalJson(value: JsonValue): string {
  return JSON.stringify(canonicalize(value));
}

export function digestCanonical(value: JsonValue): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function asJsonObject(value: unknown): Record<string, JsonValue> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("expected a JSON object");
  }
  return value as Record<string, JsonValue>;
}
