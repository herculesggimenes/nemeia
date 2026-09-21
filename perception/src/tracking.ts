import { sha256Hex, type FrameRef, type ImageFrame, type ImageDetection, type ModelProvenance, type ObservationPublisher } from "./tracking-types.ts";
import { isTimestamp, type BoundingBox2D, type PublishedObservation, type WorldValueCodec } from "./types.ts";

export type QueueDisposition = "started" | "queued" | "replaced";

export interface FrameProcessor<T, R> {
  (frame: T): Promise<R> | R;
}

/** One latest pending frame, with bounded in-flight processing. */
export class LatestFrameQueue<T> {
  readonly #maxInFlight: number;
  readonly #onError: (error: unknown, frame: T) => void;
  #inFlight = 0;
  #pending?: { frame: T; process: FrameProcessor<T, unknown> };
  #idleWaiters: Array<() => void> = [];

  constructor(options: { maxInFlight?: number; onError?: (error: unknown, frame: T) => void } = {}) {
    this.#maxInFlight = options.maxInFlight ?? 1;
    if (!Number.isInteger(this.#maxInFlight) || this.#maxInFlight < 1) throw new Error("max_in_flight_must_be_positive");
    this.#onError = options.onError ?? (() => undefined);
  }

  get inFlight(): number {
    return this.#inFlight;
  }

  get hasPending(): boolean {
    return this.#pending !== undefined;
  }

  submit<R>(frame: T, process: FrameProcessor<T, R>): QueueDisposition {
    if (this.#inFlight < this.#maxInFlight) {
      this.#inFlight += 1;
      void this.#run(frame, process as FrameProcessor<T, unknown>);
      return "started";
    }
    const replaced = this.#pending !== undefined;
    this.#pending = { frame, process: process as FrameProcessor<T, unknown> };
    return replaced ? "replaced" : "queued";
  }

  async drain(): Promise<void> {
    if (this.#inFlight === 0 && !this.#pending) return;
    await new Promise<void>((resolve) => this.#idleWaiters.push(resolve));
  }

  async #run(frame: T, process: FrameProcessor<T, unknown>): Promise<void> {
    try {
      await process(frame);
    } catch (error) {
      this.#onError(error, frame);
    } finally {
      this.#inFlight -= 1;
      if (this.#pending && this.#inFlight < this.#maxInFlight) {
        const next = this.#pending;
        this.#pending = undefined;
        this.#inFlight += 1;
        void this.#run(next.frame, next.process);
      }
      if (this.#inFlight === 0 && !this.#pending) {
        const waiters = this.#idleWaiters.splice(0);
        for (const resolve of waiters) resolve();
      }
    }
  }
}

export interface TrackerState {
  trackId: string;
  label: string;
  box: ImageDetection["box"];
  lastObservationId?: string;
}

export class ImageTracker {
  readonly #sessionId: string;
  readonly #iouThreshold: number;
  #nextTrackNumber = 1;
  #tracks: TrackerState[] = [];

  constructor(sessionId: string, iouThreshold = 0.2) {
    this.#sessionId = sessionId;
    this.#iouThreshold = iouThreshold;
  }

  track(frame: ImageFrame, detections: readonly ImageDetection[]): Array<{ detection: ImageDetection; trackId: string; supersedes?: string }> {
    const ordered = [...detections].sort((left, right) => {
      const label = left.label.localeCompare(right.label);
      if (label !== 0) return label;
      return left.box.xMin - right.box.xMin || left.box.yMin - right.box.yMin || left.box.xMax - right.box.xMax || left.box.yMax - right.box.yMax;
    });
    const used = new Set<string>();
    const nextTracks: TrackerState[] = [];
    const output: Array<{ detection: ImageDetection; trackId: string; supersedes?: string }> = [];
    for (const detection of ordered) {
      let match: TrackerState | undefined;
      let matchIou = this.#iouThreshold;
      for (const candidate of this.#tracks) {
        if (candidate.label !== detection.label || used.has(candidate.trackId)) continue;
        const candidateIou = iou(candidate.box, detection.box);
        if (candidateIou >= matchIou) {
          match = candidate;
          matchIou = candidateIou;
        }
      }
      const trackId = match?.trackId ?? `track:${this.#sessionId}:${this.#nextTrackNumber++}`;
      used.add(trackId);
      const observationId = imageObservationId(this.#sessionId, frame, trackId);
      output.push({ detection, trackId, supersedes: match?.lastObservationId });
      nextTracks.push({ trackId, label: detection.label, box: detection.box, lastObservationId: observationId });
    }
    this.#tracks = nextTracks;
    return output;
  }
}

export interface ImageIngressOptions {
  producerSession: string;
  producerId: string;
  localMapId: string;
  worldCodec: WorldValueCodec;
  detector: (frame: ImageFrame) => Promise<readonly ImageDetection[]> | readonly ImageDetection[];
  observationPublisher: ObservationPublisher;
  provenance: ModelProvenance;
  maxInFlight?: number;
}

export interface ImageIngressError {
  frame: ImageFrame;
  error: unknown;
}

export class ImagePerceptionIngress {
  readonly #options: ImageIngressOptions;
  readonly #queues = new Map<string, LatestFrameQueue<ImageFrame>>();
  readonly #trackers = new Map<string, { sourceSessionId: string; tracker: ImageTracker }>();
  readonly #lastPublishedSequence = new Map<string, bigint>();
  readonly #published: PublishedObservation[] = [];
  readonly #errors: ImageIngressError[] = [];

  constructor(options: ImageIngressOptions) {
    if (!options.producerSession || !options.producerId || !options.localMapId) throw new Error("producer_scope_required");
    this.#options = options;
  }

  submit(frame: ImageFrame): QueueDisposition {
    const namespace = sourceNamespace(frame);
    let queue = this.#queues.get(namespace);
    if (!queue) {
      queue = new LatestFrameQueue<ImageFrame>({
        maxInFlight: this.#options.maxInFlight,
        onError: (error, failedFrame) => this.#errors.push({ frame: failedFrame, error }),
      });
      this.#queues.set(namespace, queue);
    }
    return queue.submit(frame, (nextFrame) => this.#infer(nextFrame));
  }

  async drain(): Promise<void> {
    await Promise.all([...this.#queues.values()].map((queue) => queue.drain()));
  }

  get published(): readonly PublishedObservation[] {
    return this.#published;
  }

  get errors(): readonly ImageIngressError[] {
    return this.#errors;
  }

  async #infer(frame: ImageFrame): Promise<void> {
    validateFrame(frame);
    const namespace = sourceNamespace(frame);
    const detections = await this.#options.detector(frame);
    validateDetections(detections, frame);
    const last = this.#lastPublishedSequence.get(namespace);
    if (last !== undefined && frame.sequence <= last) return;
    // Reserve the newest source sequence before awaiting publication. A slower
    // completion must not become a fresh measurement merely because its world
    // call returns later than a newer frame.
    this.#lastPublishedSequence.set(namespace, frame.sequence);

    let trackerRecord = this.#trackers.get(namespace);
    if (!trackerRecord || trackerRecord.sourceSessionId !== frame.sourceSessionId) {
      const trackerSession = `${this.#options.producerId}:${frame.unitId}:${this.#options.producerSession}:${frame.streamId}:${frame.sourceSessionId}:${frame.spatialFrameId}`;
      trackerRecord = { sourceSessionId: frame.sourceSessionId, tracker: new ImageTracker(trackerSession) };
      this.#trackers.set(namespace, trackerRecord);
    }

    const tracked = trackerRecord.tracker.track(frame, detections);
    for (const match of tracked) {
      const input: PublishedObservation = {
        input: {
          id: imageObservationId(`${this.#options.producerId}:${frame.unitId}:${this.#options.producerSession}:${frame.streamId}:${frame.sourceSessionId}:${frame.spatialFrameId}`, frame, match.trackId),
          producerSession: this.#options.producerSession,
          trackId: match.trackId,
          entityId: undefined,
          localMapId: this.#options.localMapId,
          inputs: [{
            streamId: frame.streamId,
            sessionId: frame.sourceSessionId,
            sequence: frame.sequence,
            capturedAt: this.#options.worldCodec.timestampFromIso(frame.capturedAt),
          }],
          retained: [frame.resource],
          transforms: [],
          supersedes: match.supersedes ? [match.supersedes] : [],
          pose: undefined,
          geometry: {
            observedAt: this.#options.worldCodec.timestampFromIso(frame.capturedAt),
            value: { tag: "BoundingBox2D", value: toBoundingBox2D(frame, match.detection.box, this.#options.worldCodec) },
          },
          semantic: {
            observedAt: this.#options.worldCodec.timestampFromIso(frame.capturedAt),
            frameId: frame.spatialFrameId,
            value: { hypotheses: [{ label: match.detection.label, score: match.detection.confidence }] },
          },
        },
        provenance: this.#options.provenance,
        evidenceKind: "image_only",
      };
      await this.#options.observationPublisher.publish(input);
      this.#published.push(input);
    }
  }
}

function toBoundingBox2D(frame: ImageFrame, box: ImageDetection["box"], codec: WorldValueCodec): BoundingBox2D {
  return {
    frame: { streamId: frame.streamId, sessionId: frame.sourceSessionId, sequence: frame.sequence, capturedAt: codec.timestampFromIso(frame.capturedAt) },
    centerX: (box.xMin + box.xMax) / 2,
    centerY: (box.yMin + box.yMax) / 2,
    width: box.xMax - box.xMin,
    height: box.yMax - box.yMin,
    angleRad: 0,
  };
}

function iou(left: ImageDetection["box"], right: ImageDetection["box"]): number {
  const xMin = Math.max(left.xMin, right.xMin);
  const yMin = Math.max(left.yMin, right.yMin);
  const xMax = Math.min(left.xMax, right.xMax);
  const yMax = Math.min(left.yMax, right.yMax);
  const intersection = Math.max(0, xMax - xMin) * Math.max(0, yMax - yMin);
  const leftArea = Math.max(0, left.xMax - left.xMin) * Math.max(0, left.yMax - left.yMin);
  const rightArea = Math.max(0, right.xMax - right.xMin) * Math.max(0, right.yMax - right.yMin);
  return intersection / Math.max(1e-9, leftArea + rightArea - intersection);
}

function imageObservationId(session: string, frame: ImageFrame, trackId: string): string {
  return `observation:${sha256Hex(new TextEncoder().encode(`${session}|${frame.unitId}|${frame.producerId}|${frame.streamId}|${frame.sourceSessionId}|${frame.sequence}|${trackId}`)).slice(0, 32)}`;
}

function sourceNamespace(frame: ImageFrame): string {
  return JSON.stringify([frame.unitId, frame.producerId, frame.streamId, frame.sourceSessionId, frame.spatialFrameId]);
}

function validateFrame(frame: ImageFrame): void {
  if (!frame.unitId || !frame.producerId || !frame.streamId || !frame.sourceSessionId || !frame.spatialFrameId || typeof frame.sequence !== "bigint" || frame.sequence < 0n) throw new Error("image_frame_identity_invalid");
  if (!isTimestamp(frame.capturedAt) || !isTimestamp(frame.receivedAt)) throw new Error("image_frame_timestamp_invalid");
  if (!frame.resource.id || !frame.resource.schema || !/^[a-f0-9]{64}$/iu.test(frame.resource.sha256) || typeof frame.resource.byteLength !== "bigint" || frame.resource.byteLength <= 0n) throw new Error("image_frame_resource_invalid");
  if (!Number.isSafeInteger(frame.width) || frame.width <= 0 || !Number.isSafeInteger(frame.height) || frame.height <= 0) throw new Error("image_frame_dimensions_invalid");
}

function validateDetections(detections: readonly ImageDetection[], frame: ImageFrame): void {
  for (const detection of detections) {
    if (!detection.label || !Number.isFinite(detection.confidence) || detection.confidence < 0 || detection.confidence > 1) throw new Error("invalid_detection");
    const { xMin, yMin, xMax, yMax } = detection.box;
    if (![xMin, yMin, xMax, yMax].every(Number.isFinite) || xMin < 0 || yMin < 0 || xMax <= xMin || yMax <= yMin || xMax > frame.width || yMax > frame.height) throw new Error("invalid_detection_box");
  }
}

// Kept separate from the implementation file so test fixtures can use these
// shapes without importing any model runtime or provider package.
export type { FrameRef, ImageDetection, ImageFrame } from "./tracking-types.ts";
