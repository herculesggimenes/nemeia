import {
  NATIVE_SCHEMAS,
  type AcquiredFrame,
  type RecordedSample,
  type ReplayIssue,
  type ReplayReport,
  sha256Hex,
  sourceKey,
  isTimestamp,
} from "./types.ts";
import type { RetainedResourceGateway } from "./resource-adapter.ts";
import { SUPPORTED_SYNTHETIC_SCHEMAS, validateSupportedNativeFormat } from "./native-format.ts";

export interface RecordedAcquisitionOptions {
  resourceGateway: RetainedResourceGateway;
  maxClockErrorMs: number;
}

interface ValidatedSample {
  sample: RecordedSample;
  key: string;
  sha256: string;
  ordinal: number;
}

/**
 * Replays recorded source messages without a transport, robot, or mapper.
 * Arrival ordering is derived from recorded receive times; source sequence
 * and acquisition times are never rewritten during replay.
 */
export class RecordedAcquisitionAdapter {
  readonly #resourceGateway: RetainedResourceGateway;
  readonly #maxClockErrorMs: number;

  constructor(options: RecordedAcquisitionOptions) {
    if (!Number.isFinite(options.maxClockErrorMs) || options.maxClockErrorMs < 0) {
      throw new Error("max_clock_error_must_be_non_negative");
    }
    this.#resourceGateway = options.resourceGateway;
    this.#maxClockErrorMs = options.maxClockErrorMs;
  }

  async replay(samples: readonly RecordedSample[]): Promise<ReplayReport> {
    const issues: ReplayIssue[] = [];
    const byKey = new Map<string, ValidatedSample>();
    const duplicateKeys: string[] = [];

    for (const [ordinal, sample] of samples.entries()) {
      const key = sourceKey(sample);
      const validation = this.#validate(sample, key);
      if (validation) {
        issues.push(validation);
        continue;
      }

      const sha256 = sha256Hex(sample.bytes);
      const existing = byKey.get(key);
      if (existing) {
        if (existing.sha256 !== sha256 || existing.sample.schema !== sample.schema) {
          issues.push({
            key,
            code: "conflicting_duplicate",
            detail: "same source session, spatial frame, and sequence carried different bytes or schema",
          });
        } else {
          duplicateKeys.push(key);
        }
        continue;
      }
      byKey.set(key, { sample, key, sha256, ordinal });
    }

    const ordered = [...byKey.values()].sort((left, right) => {
      const received = Date.parse(left.sample.receivedAt) - Date.parse(right.sample.receivedAt);
      if (received !== 0) return received;
      const stream = left.sample.streamId.localeCompare(right.sample.streamId);
      if (stream !== 0) return stream;
      const session = left.sample.sourceSessionId.localeCompare(right.sample.sourceSessionId);
      if (session !== 0) return session;
      const sequence = left.sample.sequence < right.sample.sequence ? -1 : left.sample.sequence > right.sample.sequence ? 1 : 0;
      return sequence || left.ordinal - right.ordinal;
    });

    const accepted: AcquiredFrame[] = [];
    for (const entry of ordered) {
      const sample = entry.sample;
      const bytes = new Uint8Array(sample.bytes);
      const resource = await this.#resourceGateway.publish(bytes, sample.schema, `acquisition:${entry.key}`);
      accepted.push({
        unitId: sample.unitId,
        producerId: sample.producerId,
        streamId: sample.streamId,
        sourceSessionId: sample.sourceSessionId,
        spatialFrameId: sample.spatialFrameId,
        sequence: sample.sequence,
        capturedAt: sample.capturedAt,
        receivedAt: sample.receivedAt,
        clockErrorMs: sample.clockErrorMs,
        schema: sample.schema,
        resource,
        fixtureKind: sample.fixtureKind,
      });
    }
    if (accepted.length) await this.#resourceGateway.commit(accepted.map((frame) => frame.resource));

    const fixtureKinds = new Set(samples.map((sample) => sample.fixtureKind));
    const fixtureKind: "recorded" | "synthetic" = fixtureKinds.size === 1 && fixtureKinds.has("recorded") ? "recorded" : "synthetic";
    return { fixtureKind, accepted, duplicateKeys, issues };
  }

  #validate(sample: RecordedSample, key: string): ReplayIssue | undefined {
    if (!isTimestamp(sample.capturedAt) || !isTimestamp(sample.receivedAt)) {
      return { key, code: "invalid_timestamp", detail: "capturedAt and receivedAt must be UTC timestamps" };
    }
    if (!Number.isFinite(sample.clockErrorMs) || sample.clockErrorMs < 0 || sample.clockErrorMs > this.#maxClockErrorMs) {
      return { key, code: "invalid_clock_error", detail: `clock error exceeds ${this.#maxClockErrorMs}ms policy` };
    }
    if (!NATIVE_SCHEMAS.has(sample.schema) && !SUPPORTED_SYNTHETIC_SCHEMAS.has(sample.schema)) {
      return { key, code: "unsupported_schema", detail: sample.schema };
    }
    if (!(sample.bytes instanceof Uint8Array) || sample.bytes.byteLength === 0) {
      return { key, code: "empty_bytes", detail: "native source bytes are required" };
    }
    try {
      validateSupportedNativeFormat(sample.bytes, sample.schema, sample.fixtureKind);
    } catch (error) {
      return { key, code: "unsupported_format", detail: error instanceof Error ? error.message : "native fixture format is not qualified" };
    }
    if (!sample.unitId || !sample.producerId || !sample.streamId || !sample.sourceSessionId || !sample.spatialFrameId || sample.sequence < 0n) {
      return { key, code: "invalid_timestamp", detail: "source identity and sequence are invalid" };
    }
    return undefined;
  }
}
