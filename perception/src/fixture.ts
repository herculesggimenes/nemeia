import type { SemanticValue } from "../../world-client/src/generated/types.ts";
import {
  SYNTHETIC_PCD_ASCII,
  SYNTHETIC_PNG_1X1,
} from "./native-format.ts";
import type { NativeMapProduct } from "./map-publisher.ts";
import type { RecordedSample, Timestamp } from "./types.ts";
import { sha256Hex } from "./types.ts";

/**
 * Input shape consumed by the existing loopback adapter's
 * ingestStandardSyntheticFixture seam. It is deliberately a fixture seed,
 * not a second world ObservationInput contract; the adapter constructs the
 * generated client input after acquisition returns retained ResourceRefs.
 */
export interface SyntheticObservationSeed {
  readonly id: string;
  readonly localMapId: string;
  readonly trackId: string;
  readonly entityId?: string;
  readonly observedAt: Timestamp;
  readonly semantic: {
    readonly observedAt: Timestamp;
    readonly frameId: string;
    readonly value: SemanticValue;
  };
}

export interface SyntheticStandardFixture {
  readonly fixtureKind: "synthetic";
  readonly unitId: string;
  readonly producerId: string;
  /** The authenticated perception member session used by the world reducer. */
  readonly producerSession: string;
  /** The source session carried by these minimal samples. */
  readonly sourceSessionId: string;
  readonly localMapId: string;
  readonly mapId: string;
  readonly spatialFrameId: string;
  readonly samples: readonly RecordedSample[];
  readonly observation: SyntheticObservationSeed;
  readonly mapProduct: NativeMapProduct;
}

export interface SyntheticStandardFixtureOptions {
  readonly unitId?: string;
  readonly producerId?: string;
  readonly producerSession?: string;
  readonly sourceSessionId?: string;
  readonly localMapId?: string;
  readonly mapId?: string;
  readonly spatialFrameId?: string;
  readonly capturedAt?: Timestamp;
  readonly receivedAt?: Timestamp;
  readonly mapCapturedAt?: Timestamp;
}

/**
 * Returns a small, standards-based fixture for the actual acquisition and map
 * publisher adapters. The default producer/source session is intentionally the
 * same because the current loopback adapter binds its authenticated member
 * session from the first sample; callers testing a separate source session can
 * override sourceSessionId and adapt that one loopback boundary explicitly.
 */
export function createSyntheticStandardFixture(options: SyntheticStandardFixtureOptions = {}): SyntheticStandardFixture {
  const unitId = options.unitId ?? "entity-go2-001";
  const producerId = options.producerId ?? "replay-camera-001";
  const producerSession = options.producerSession ?? "replay-camera-001";
  const sourceSessionId = options.sourceSessionId ?? producerSession;
  const localMapId = options.localMapId ?? "local-map-go2-001";
  const mapId = options.mapId ?? localMapId;
  const spatialFrameId = options.spatialFrameId ?? "frame-go2-local-001";
  const capturedAt = options.capturedAt ?? "2026-09-20T12:00:01.000Z";
  const receivedAt = options.receivedAt ?? "2026-09-20T12:00:01.010Z";
  const mapCapturedAt = options.mapCapturedAt ?? "2026-09-20T12:00:02.000Z";
  const observationId = "observation-synthetic-standard-001";
  const semanticValue: SemanticValue = {
    hypotheses: [{ label: "synthetic-fixture", score: 1 }],
  };
  const sampleBytes = new Uint8Array(SYNTHETIC_PNG_1X1);
  const pcdBytes = new TextEncoder().encode(SYNTHETIC_PCD_ASCII);
  const samples: readonly RecordedSample[] = [{
    unitId,
    producerId,
    streamId: "camera_front",
    sourceSessionId,
    spatialFrameId,
    sequence: 1n,
    capturedAt,
    receivedAt,
    clockErrorMs: 10,
    schema: "image/png",
    bytes: sampleBytes,
    fixtureKind: "synthetic",
  }];
  const observation: SyntheticObservationSeed = {
    id: observationId,
    localMapId,
    trackId: "track-synthetic-standard-001",
    observedAt: capturedAt,
    semantic: {
      observedAt: capturedAt,
      frameId: spatialFrameId,
      value: semanticValue,
    },
  };
  const mapProduct: NativeMapProduct = {
    unitId,
    mapId,
    spatialFrameId,
    expectedHeadRevision: 0n,
    acquiredFrom: capturedAt,
    acquiredThrough: mapCapturedAt,
    inputCoverage: [{
      streamId: "lidar_map_fixture",
      sessionId: sourceSessionId,
      firstSequence: 1n,
      lastSequence: 1n,
    }],
    inputObservationIds: [observationId],
    layers: [{
      kind: "point_cloud",
      schema: "text/x.pcd",
      frameId: spatialFrameId,
      capturedAt: mapCapturedAt,
      bytes: pcdBytes,
      metadata: { format: "PCD v0.7", points: 2, fixture: "synthetic" },
    }],
    fixtureKind: "synthetic",
    producer: {
      name: "nemeia-perception",
      version: "synthetic-standard-fixture-1",
      sha256: sha256Hex(new TextEncoder().encode("nemeia-perception@synthetic-standard-fixture-1")),
    },
  };
  return Object.freeze({
    fixtureKind: "synthetic" as const,
    unitId,
    producerId,
    producerSession,
    sourceSessionId,
    localMapId,
    mapId,
    spatialFrameId,
    samples,
    observation,
    mapProduct,
  });
}
