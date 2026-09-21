import { DbConnection, type WorldConnection } from "@nemeia/world-client/src/index.ts";
import { ResourceGateway } from "@nemeia/world-resources";
import {
  MAX_RESOURCE_READ_BYTES,
  parseResourceContext,
  parseResourceReadRequest,
  parseResourceReference,
  sameResource,
  safeMimeType,
  toResourceBoundary,
  ResourceReadFailure as ReadFailure,
  type ResourceContext,
  type ResourceReference
} from "../world-operator/resource-read-policy";
export { assertRequestBodySize, readJsonBody } from "./resource-body";

const MAP_MANIFEST_SCHEMA = "nemeia/native-map-manifest@1";
const MAX_MANIFEST_LAYERS = 1_024;

export type AuthorizedResourceBytes = {
  bytes: Uint8Array;
  contentType: string;
  length: number;
  offset: number;
  totalLength: number;
};

export function bearerToken(authorization: string | null): string {
  const match = authorization?.match(/^Bearer ([^\s]+)$/u);
  if (!match || match[1].length > 8_192) { throw new ReadFailure("operator_token_required", 401); }
  return match[1];
}

export function parseContextBody(value: unknown): ResourceContext {
  if (!isRecord(value)) { throw new ReadFailure("invalid_resource_context", 400); }
  return parseResourceContext(value.context);
}

export async function listAuthorizedResourceReferences(token: string, context: ResourceContext): Promise<ResourceReference[]> {
  return withCallerConnection(token, async (connection, config) => {
    const direct = await readCommittedReferences(connection, context);
    const gateway = await openGateway(config.resourceRoot);
    return expandMapReferences(gateway, direct);
  });
}

export async function readAuthorizedResource(token: string, input: unknown): Promise<AuthorizedResourceBytes> {
  const request = parseResourceReadRequest(input);
  return withCallerConnection(token, async (connection, config) => {
    const direct = await readCommittedReferences(connection, request.context);
    const gateway = await openGateway(config.resourceRoot);
    const authorized = await expandMapReferences(gateway, direct);
    const reference = authorized.find((candidate) => sameResource(candidate, request.resource));
    if (!reference) { throw new ReadFailure("resource_not_authorized", 404); }

    const totalLength = Number(reference.byteLength);
    if (!Number.isSafeInteger(totalLength) || request.offset + request.length > totalLength) {
      throw new ReadFailure("invalid_resource_range", 416);
    }
    const reader = gateway.createReader({
      authorizeRead: (read) => sameResource(read.resource, reference)
        && read.offset === request.offset
        && read.length === request.length,
    });
    const bytes = await gateway.read(reader, toResourceBoundary(reference), {
      length: request.length,
      offset: request.offset,
    });
    return {
      bytes,
      contentType: safeMimeType(reference.schema),
      length: request.length,
      offset: request.offset,
      totalLength,
    };
  });
}

async function readCommittedReferences(connection: WorldConnection, context: ResourceContext): Promise<ResourceReference[]> {
  try {
    if (context.kind === "observation") {
      const observation = await connection.procedures.readObservationDetail({ observationId: context.observationId });
      if (!observation) { throw new ReadFailure("resource_context_not_found", 404); }
      return observation.input.retained.map(toReference);
    }

    const revision = BigInt(context.revision);
    const page = await connection.procedures.readMapHistory({
      afterRevision: revision > 0n ? revision - 1n : 0n,
      limit: 2,
      mapId: context.mapId,
    });
    const checkpoint = page.rows.find((row) => row.mapId === context.mapId && row.revision === revision);
    if (!checkpoint) { throw new ReadFailure("resource_context_not_found", 404); }
    return [checkpoint.manifest, checkpoint.evidenceIndex, checkpoint.estimatorState]
      .filter((value): value is NonNullable<typeof value> => value !== undefined)
      .map(toReference);
  } catch (error) {
    if (error instanceof ReadFailure) { throw error; }
    throw new ReadFailure("world_context_not_authorized", 403);
  }
}

async function expandMapReferences(gateway: ResourceGateway, direct: ResourceReference[]): Promise<ResourceReference[]> {
  const manifest = direct.find((reference) => reference.schema === MAP_MANIFEST_SCHEMA);
  if (!manifest) { return uniqueReferences(direct); }
  const manifestLength = Number(manifest.byteLength);
  if (!Number.isSafeInteger(manifestLength) || manifestLength > MAX_RESOURCE_READ_BYTES) { return uniqueReferences(direct); }

  const reader = gateway.createReader({
    authorizeRead: (read) => sameResource(read.resource, manifest) && read.offset === 0 && read.length === manifestLength,
  });
  const bytes = await gateway.read(reader, toResourceBoundary(manifest), { length: manifestLength, offset: 0 });
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new ReadFailure("resource_manifest_invalid", 502);
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.layers)) { return uniqueReferences(direct); }
  const nested = parsed.layers.slice(0, MAX_MANIFEST_LAYERS).flatMap((layer) => {
    if (!isRecord(layer)) { return []; }
    try {
      return [parseResourceReference(layer.resource)];
    } catch {
      return [];
    }
  });
  return uniqueReferences([...direct, ...nested]);
}

async function openGateway(resourceRoot: string): Promise<ResourceGateway> {
  try {
    return await ResourceGateway.open({ bindings: [], root: resourceRoot });
  } catch {
    throw new ReadFailure("resource_gateway_unavailable", 503);
  }
}

async function withCallerConnection<T>(token: string, operation: (connection: WorldConnection, config: ServerConfig) => Promise<T>): Promise<T> {
  const config = serverConfig();
  let connection: WorldConnection | undefined;
  let connected = false;
  const ready = new Promise<WorldConnection>((resolve, reject) => {
    try {
      connection = DbConnection.builder()
        .withUri(config.worldUri)
        .withDatabaseName(config.databaseName)
        .withConfirmedReads(true)
        .withToken(token)
        .onConnect((value) => {
          connected = true;
          resolve(value);
        })
        .onConnectError(() => reject(new ReadFailure("world_auth_failed", 401)))
        .onDisconnect((_context, error) => {
          if (!connected) { reject(new ReadFailure(error ? "world_auth_failed" : "world_disconnected", 401)); }
        })
        .build();
    } catch {
      reject(new ReadFailure("world_auth_failed", 401));
    }
  });

  try {
    return await operation(await ready, config);
  } catch (error) {
    if (error instanceof ReadFailure) { throw error; }
    throw new ReadFailure("world_read_failed", 403);
  } finally {
    connection?.disconnect();
  }
}

function serverConfig(): ServerConfig {
  const worldUri = process.env.NEMEIA_SPACETIMEDB_URI;
  const databaseName = process.env.NEMEIA_SPACETIMEDB_DATABASE;
  const resourceRoot = process.env.NEMEIA_WORLD_RESOURCE_ROOT;
  if (!worldUri || !databaseName || !resourceRoot || !isLoopbackUri(worldUri)) {
    throw new ReadFailure("resource_transport_unconfigured", 503);
  }
  return { databaseName, resourceRoot, worldUri };
}

function isLoopbackUri(value: string): boolean {
  try {
    return new Set(["127.0.0.1", "::1", "localhost"]).has(new URL(value).hostname);
  } catch {
    return false;
  }
}

function toReference(value: { id: string; schema: string; sha256: string; byteLength: bigint }): ResourceReference {
  return {
    byteLength: value.byteLength.toString(10),
    id: value.id,
    schema: value.schema,
    sha256: value.sha256,
  };
}

function uniqueReferences(values: ResourceReference[]): ResourceReference[] {
  const unique: ResourceReference[] = [];
  for (const value of values) {
    if (!unique.some((candidate) => sameResource(candidate, value))) { unique.push(value); }
  }
  return unique;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type ServerConfig = { databaseName: string; resourceRoot: string; worldUri: string };
