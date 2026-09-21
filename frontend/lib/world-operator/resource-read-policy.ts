export type ResourceReference = {
  id: string;
  schema: string;
  sha256: string;
  byteLength: string;
};

export type ResourceContext =
  | { kind: "observation"; observationId: string }
  | { kind: "map"; mapId: string; revision: string };

export type ResourceReadRequest = {
  context: ResourceContext;
  resource: ResourceReference;
  offset: number;
  length: number;
};

export const MAX_RESOURCE_READ_BYTES = 8 * 1024 * 1024;
const MAX_RESOURCE_BYTES = 256 * 1024 * 1024;
const MAX_U64 = 18_446_744_073_709_551_615n;
const RESOURCE_ID = /^[A-Za-z0-9_-]{1,256}$/u;
const CONTEXT_ID = /^[A-Za-z0-9._:-]{1,256}$/u;
const SCHEMA = /^[A-Za-z0-9][A-Za-z0-9._/@:+-]{0,255}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;

export class ResourceReadFailure extends Error {
  readonly status: number;
  readonly code: string;

  constructor(code: string, status: number) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export function parseResourceContext(value: unknown): ResourceContext {
  if (!isRecord(value) || typeof value.kind !== "string") {
    throw new ResourceReadFailure("invalid_resource_context", 400);
  }
  if (value.kind === "observation" && isBoundedContextId(value.observationId)) {
    return { kind: "observation", observationId: value.observationId };
  }
  if (value.kind === "map" && isBoundedContextId(value.mapId) && typeof value.revision === "string") {
    parseU64(value.revision, "invalid_map_revision");
    return { kind: "map", mapId: value.mapId, revision: value.revision };
  }
  throw new ResourceReadFailure("invalid_resource_context", 400);
}

export function parseResourceReadRequest(value: unknown): ResourceReadRequest {
  if (!isRecord(value)) { throw new ResourceReadFailure("invalid_resource_request", 400); }
  const context = parseResourceContext(value.context);
  const resource = parseResourceReference(value.resource);
  const offset = parseSafeInteger(value.offset, "invalid_resource_offset");
  const length = parseSafeInteger(value.length, "invalid_resource_length");
  if (offset < 0 || length <= 0 || length > MAX_RESOURCE_READ_BYTES) {
    throw new ResourceReadFailure("invalid_resource_range", 416);
  }
  if (BigInt(offset) + BigInt(length) > BigInt(resource.byteLength)) {
    throw new ResourceReadFailure("invalid_resource_range", 416);
  }
  return { context, length, offset, resource };
}

export function parseResourceReference(value: unknown): ResourceReference {
  if (!isRecord(value) || typeof value.id !== "string" || !RESOURCE_ID.test(value.id)) {
    throw new ResourceReadFailure("invalid_resource_reference", 400);
  }
  if (typeof value.schema !== "string" || !SCHEMA.test(value.schema)) {
    throw new ResourceReadFailure("invalid_resource_reference", 400);
  }
  if (typeof value.sha256 !== "string" || !SHA256.test(value.sha256)) {
    throw new ResourceReadFailure("invalid_resource_reference", 400);
  }
  const byteLength = parseU64(value.byteLength, "invalid_resource_reference");
  if (byteLength <= 0n || byteLength > BigInt(MAX_RESOURCE_BYTES)) {
    throw new ResourceReadFailure("invalid_resource_reference", 400);
  }
  return { byteLength: byteLength.toString(10), id: value.id, schema: value.schema, sha256: value.sha256 };
}

export function sameResource(left: ResourceReference, right: ResourceReference): boolean {
  return left.id === right.id
    && left.schema === right.schema
    && left.sha256 === right.sha256
    && left.byteLength === right.byteLength;
}

export function safeMimeType(schema: string): string {
  switch (schema) {
    case "image/png": return "image/png";
    case "image/jpeg": return "image/jpeg";
    case "image/webp": return "image/webp";
    case "text/x.pcd": return "text/plain; charset=utf-8";
    case "nemeia/native-map-manifest@1":
    case "nemeia/native-map-evidence-index@1": return "application/json";
    default: return "application/octet-stream";
  }
}

export function toResourceBoundary(value: ResourceReference): ResourceReference {
  return value;
}

function parseU64(value: unknown, code: string): bigint {
  if (typeof value !== "string" || !/^\d{1,20}$/u.test(value)) { throw new ResourceReadFailure(code, 400); }
  const parsed = BigInt(value);
  if (parsed > MAX_U64) { throw new ResourceReadFailure(code, 400); }
  return parsed;
}

function parseSafeInteger(value: unknown, code: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) { throw new ResourceReadFailure(code, 416); }
  return value;
}

function isBoundedContextId(value: unknown): value is string {
  return typeof value === "string" && CONTEXT_ID.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
