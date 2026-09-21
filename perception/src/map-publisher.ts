import type { MapCheckpointInput } from "../../world-client/src/generated/types.ts";
import type { CommitMapCheckpointParams } from "../../world-client/src/generated/types/reducers.ts";
import type { DbConnection } from "../../world-client/src/generated/index.ts";
import type { RetainedResourceGateway } from "./resource-adapter.ts";
import {
  NATIVE_SCHEMAS,
  canonicalJson,
  isTimestamp,
  sha256Hex,
  type ResourceRef,
  type Timestamp,
} from "./types.ts";
import { SUPPORTED_SYNTHETIC_SCHEMAS, validateSupportedNativeFormat } from "./native-format.ts";

export const NATIVE_MAP_MANIFEST_SCHEMA = "nemeia/native-map-manifest@1";
export const NATIVE_MAP_EVIDENCE_INDEX_SCHEMA = "nemeia/native-map-evidence-index@1";

export type NativeMapLayerKind = "point_cloud" | "occupancy_grid" | "mapper_export";

export interface NativeMapLayerInput {
  kind: NativeMapLayerKind;
  schema: string;
  frameId: string;
  capturedAt: Timestamp;
  bytes: Uint8Array;
  metadata: Readonly<Record<string, string | number | boolean>>;
}

export interface MapInputCoverage {
  streamId: string;
  sessionId: string;
  firstSequence: bigint;
  lastSequence: bigint;
}

export interface NativeMapProduct {
  unitId: string;
  mapId: string;
  spatialFrameId: string;
  expectedHeadRevision?: bigint;
  acquiredFrom: Timestamp;
  acquiredThrough: Timestamp;
  inputCoverage: MapInputCoverage[];
  inputObservationIds: string[];
  layers: NativeMapLayerInput[];
  fixtureKind: "recorded" | "synthetic";
  producer: { name: string; version: string; sha256: string };
}

export interface MapCheckpointCommitResult {
  revision?: bigint;
  duplicate: boolean;
}

/** World-client adapter around the selected native commit_map_checkpoint call. */
export interface MapCheckpointPort {
  commitMapCheckpoint(params: CommitMapCheckpointParams): Promise<MapCheckpointCommitResult | void>;
}

/** Thin generated-client adapter; the connection supplies the authenticated member. */
export class GeneratedMapCheckpointPort implements MapCheckpointPort {
  readonly #connection: Pick<DbConnection, "reducers">;

  constructor(connection: Pick<DbConnection, "reducers">) {
    this.#connection = connection;
  }

  commitMapCheckpoint(params: CommitMapCheckpointParams): Promise<void> {
    return this.#connection.reducers.commitMapCheckpoint(params);
  }
}

export interface PublishedNativeMap {
  checkpoint: MapCheckpointInput;
  layerResources: ResourceRef[];
  manifestResource: ResourceRef;
  evidenceIndexResource: ResourceRef;
  receipt: MapCheckpointCommitResult;
}

/**
 * Persists native mapper outputs and delegates the atomic head/CAS operation
 * to the world-owned checkpoint port. It never decodes or synthesizes SLAM.
 */
export class NativeMapPublisher {
  readonly #resourceGateway: RetainedResourceGateway;
  readonly #checkpointPort: MapCheckpointPort;

  constructor(options: { resourceGateway: RetainedResourceGateway; checkpointPort: MapCheckpointPort }) {
    this.#resourceGateway = options.resourceGateway;
    this.#checkpointPort = options.checkpointPort;
  }

  async publish(product: NativeMapProduct): Promise<PublishedNativeMap> {
    validateProduct(product);
    const layerResources: ResourceRef[] = [];
    const layerManifest: Array<{ kind: NativeMapLayerKind; schema: string; frameId: string; capturedAt: Timestamp; resource: ResourceRef; metadata: Readonly<Record<string, string | number | boolean>> }> = [];

    for (const [index, layer] of product.layers.entries()) {
      const resource = await this.#resourceGateway.publish(
        layer.bytes,
        layer.schema,
        `map-layer:${product.unitId}:${product.mapId}:${product.spatialFrameId}:${index}`,
      );
      layerResources.push(resource);
      layerManifest.push({ kind: layer.kind, schema: layer.schema, frameId: layer.frameId, capturedAt: layer.capturedAt, resource, metadata: layer.metadata });
    }

    const manifestBytes = new TextEncoder().encode(canonicalJson({
      schema: NATIVE_MAP_MANIFEST_SCHEMA,
      unitId: product.unitId,
      mapId: product.mapId,
      rootFrameId: product.spatialFrameId,
      acquiredFrom: product.acquiredFrom,
      acquiredThrough: product.acquiredThrough,
      parentRevision: product.expectedHeadRevision,
      layers: layerManifest,
      producer: product.producer,
      fixtureKind: product.fixtureKind,
    }));
    const manifestResource = await this.#resourceGateway.publish(manifestBytes, NATIVE_MAP_MANIFEST_SCHEMA, `map-manifest:${product.unitId}:${product.mapId}:${sha256Hex(manifestBytes)}`);

    const evidenceIndexBytes = new TextEncoder().encode(canonicalJson({
      schema: NATIVE_MAP_EVIDENCE_INDEX_SCHEMA,
      mapId: product.mapId,
      rootFrameId: product.spatialFrameId,
      inputCoverage: product.inputCoverage,
      inputObservationIds: product.inputObservationIds,
    }));
    const evidenceIndexResource = await this.#resourceGateway.publish(evidenceIndexBytes, NATIVE_MAP_EVIDENCE_INDEX_SCHEMA, `map-evidence:${product.unitId}:${product.mapId}:${sha256Hex(evidenceIndexBytes)}`);

    // The gateway's grouped commit is the closure gate: it re-reads every
    // retained object and verifies its immutable digest/length before the
    // world reducer sees any checkpoint reference. Do not use the bounded UI
    // reader here; large map layers must remain publishable.
    await this.#resourceGateway.commit([...layerResources, manifestResource, evidenceIndexResource]);
    const checkpoint: MapCheckpointInput = {
      mapId: product.mapId,
      expectedRevision: product.expectedHeadRevision ?? 0n,
      rootFrameId: product.spatialFrameId,
      manifest: manifestResource,
      evidenceIndex: evidenceIndexResource,
      estimatorState: undefined,
      inputObservationIds: [...product.inputObservationIds],
    };
    const rawReceipt = await this.#checkpointPort.commitMapCheckpoint({ input: checkpoint });
    const receipt: MapCheckpointCommitResult = rawReceipt ?? { duplicate: false };
    return { checkpoint, layerResources, manifestResource, evidenceIndexResource, receipt };
  }
}

function validateProduct(product: NativeMapProduct): void {
  if (!product.unitId || !product.mapId || !product.spatialFrameId) throw new Error("map_identity_required");
  if (!isTimestamp(product.acquiredFrom) || !isTimestamp(product.acquiredThrough)) throw new Error("map_timestamps_required");
  if (Date.parse(product.acquiredFrom) > Date.parse(product.acquiredThrough)) throw new Error("map_time_range_invalid");
  if (!product.layers.length) throw new Error("native_map_layer_required");
  if (!product.inputCoverage.length) throw new Error("map_input_coverage_required");
  for (const coverage of product.inputCoverage) {
    if (!coverage.streamId || !coverage.sessionId || coverage.firstSequence < 0n || coverage.lastSequence < coverage.firstSequence) {
      throw new Error("map_input_coverage_invalid");
    }
  }
  for (const observationId of product.inputObservationIds) if (!observationId) throw new Error("map_observation_id_invalid");
  for (const layer of product.layers) {
    const expectedSchema = product.fixtureKind === "synthetic"
      ? layer.kind === "point_cloud" ? "text/x.pcd" : layer.kind === "occupancy_grid" ? "application/json" : ""
      : layer.kind === "point_cloud" ? "sensor_msgs/PointCloud2" : layer.kind === "occupancy_grid" ? "nav_msgs/OccupancyGrid" : "unitree/uslam/map_file_pub";
    const schemaSet = product.fixtureKind === "synthetic" ? SUPPORTED_SYNTHETIC_SCHEMAS : NATIVE_SCHEMAS;
    if (!expectedSchema || layer.schema !== expectedSchema || !schemaSet.has(layer.schema)) throw new Error(`unsupported_native_map_schema:${layer.schema}`);
    if (!isTimestamp(layer.capturedAt)) throw new Error("map_layer_timestamp_required");
    if (!layer.frameId || layer.frameId !== product.spatialFrameId || !(layer.bytes instanceof Uint8Array) || layer.bytes.byteLength === 0) throw new Error("native_map_layer_invalid");
    try {
      validateSupportedNativeFormat(layer.bytes, layer.schema, product.fixtureKind);
    } catch (error) {
      throw new Error(error instanceof Error ? `unsupported_native_map_format:${error.message}` : "unsupported_native_map_format");
    }
    for (const value of Object.values(layer.metadata)) {
      if (typeof value === "number" && !Number.isFinite(value)) throw new Error("map_metadata_must_be_finite");
    }
  }
  if (!product.producer.name || !product.producer.version || !product.producer.sha256) throw new Error("map_producer_pin_required");
}
