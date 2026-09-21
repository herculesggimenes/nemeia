import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
// The generated client resolves this pinned SDK from world-client/node_modules;
// perception's package intentionally does not add a second SDK dependency.
// @ts-expect-error The pinned SDK's .mjs entry has no colocated declaration.
import { BinaryReader, BinaryWriter } from "../../world-client/node_modules/spacetimedb/dist/index.mjs";
import { ObservationInput as GeneratedObservationInput } from "../../world-client/src/generated/types.ts";
import type { MapCheckpointInput, ObservationInput } from "../../world-client/src/generated/types.ts";
import type { CommitMapCheckpointParams } from "../../world-client/src/generated/types/reducers.ts";
import { RecordedAcquisitionAdapter } from "../src/acquisition.ts";
import { qualifyCalibratedAssociation, imageOnlyGeometry } from "../src/association.ts";
import { NativeMapPublisher, type MapCheckpointPort } from "../src/map-publisher.ts";
import { ImagePerceptionIngress } from "../src/tracking.ts";
import { WorldObservationPublisher } from "../src/world-publisher.ts";
import { ResourceGatewayAdapter } from "../src/resource-adapter.ts";
import { createSyntheticStandardFixture } from "../src/fixture.ts";
import { ResourceAuthorizationError, ResourceGateway } from "../../world-resources/src/index.ts";
import {
  type ImageDetection,
  type ImageFrame,
  type ModelProvenance,
  type NativeMapProduct,
  type ObservationPublisher,
  type PublishedObservation,
  type RecordedSample,
  type ResourceRef,
  type RetainedResourceGateway,
  type WorldTimestamp,
  decodeResourceRefJson,
  encodeResourceRefJson,
  SYNTHETIC_OCCUPANCY_GRID_JSON,
  SYNTHETIC_PCD_ASCII,
  SYNTHETIC_PNG_1X1,
  SYNTHETIC_PNG_1X1_RGB,
  sourceKey,
  sha256Hex,
} from "../src/index.ts";

test("synthetic replay preserves source session, frame, acquisition time, receive time, and deduplicates retry", async () => {
  const resourceStore = new MemoryResourceGateway();
  const adapter = new RecordedAcquisitionAdapter({ resourceGateway: resourceStore, maxClockErrorMs: 25 });
  const samples: RecordedSample[] = [
    sample({
      streamId: "camera_front",
      schema: "image/png",
      sequence: 2n,
      capturedAt: "2026-09-20T12:00:02.000Z",
      receivedAt: "2026-09-20T12:00:02.040Z",
      bytes: nativeBytes("image/png", "image-2"),
    }),
    sample({
      streamId: "camera_front",
      schema: "image/png",
      sequence: 1n,
      capturedAt: "2026-09-20T12:00:01.000Z",
      receivedAt: "2026-09-20T12:00:01.080Z",
      bytes: nativeBytes("image/png", "image-1"),
    }),
    sample({
      streamId: "camera_front",
      schema: "image/png",
      sequence: 1n,
      capturedAt: "2026-09-20T12:00:01.000Z",
      receivedAt: "2026-09-20T12:00:01.080Z",
      bytes: nativeBytes("image/png", "image-1"),
    }),
    sample({ streamId: "camera_front", sequence: 3n, schema: "unsupported/Image", bytes: bytes("bad") }),
    sample({ streamId: "camera_front", sequence: 2n, schema: "image/png", bytes: nativeBytes("image/png", "different") }),
    sample({ streamId: "lidar", sequence: 7n, schema: "text/x.pcd", bytes: nativeBytes("text/x.pcd", "cloud-7"), receivedAt: "2026-09-20T12:00:01.020Z" }),
  ];

  const report = await adapter.replay(samples);
  assert.equal(report.fixtureKind, "synthetic", "the fixture is synthetic, not a Go2 recording");
  assert.deepEqual(report.accepted.map((frame) => [frame.streamId, frame.sequence]), [["lidar", 7n], ["camera_front", 1n], ["camera_front", 2n]]);
  assert.deepEqual(report.accepted[1], {
    unitId: "go2-synthetic",
    producerId: "producer-a",
    streamId: "camera_front",
    sourceSessionId: "camera-session-a",
    spatialFrameId: "frame-origin-a",
    sequence: 1n,
    capturedAt: "2026-09-20T12:00:01.000Z",
    receivedAt: "2026-09-20T12:00:01.080Z",
    clockErrorMs: 3,
    schema: "image/png",
      resource: {
      id: `resource:${sha256Hex(nativeBytes("image/png", "image-1")).slice(0, 16)}-1`,
      schema: "image/png",
      sha256: sha256Hex(nativeBytes("image/png", "image-1")),
      byteLength: BigInt(nativeBytes("image/png", "image-1").byteLength),
    },
    fixtureKind: "synthetic",
  });
  assert.equal(report.duplicateKeys.length, 1);
  assert.match(report.issues.map((issue) => issue.code).join(","), /unsupported_schema/);
  assert.match(report.issues.map((issue) => issue.code).join(","), /conflicting_duplicate/);
  assert.equal(resourceStore.publishCalls, 3, "replay did not persist duplicate source evidence twice");
  assert.equal(resourceStore.commitCalls, 1, "all replay bytes commit through the grouped reference closure");
});

test("replay rejects clock uncertainty and keeps omitted source sequences omitted", async () => {
  const adapter = new RecordedAcquisitionAdapter({ resourceGateway: new MemoryResourceGateway(), maxClockErrorMs: 10 });
  const report = await adapter.replay([
    sample({ sequence: 1n, clockErrorMs: 11 }),
    sample({ sequence: 3n, clockErrorMs: 0 }),
  ]);
  assert.deepEqual(report.accepted.map((frame) => frame.sequence), [3n]);
  assert.equal(report.issues[0]?.code, "invalid_clock_error");
});

test("replay rejects arbitrary bytes and falsely recorded labels before retaining authoritative evidence", async () => {
  const adapter = new RecordedAcquisitionAdapter({ resourceGateway: new MemoryResourceGateway(), maxClockErrorMs: 10 });
  const report = await adapter.replay([
    sample({ bytes: bytes("looks-like-an-image"), fixtureKind: "synthetic" }),
    sample({ sequence: 2n, fixtureKind: "recorded", bytes: bytes("not-a-qualified-recording") }),
  ]);
  assert.deepEqual(report.accepted, []);
  assert.equal(report.issues.length, 2);
  assert.ok(report.issues.every((issue) => issue.code === "unsupported_format"));
});

test("exported standard fixture is accepted by acquisition and map publisher adapters", async () => {
  const fixture = createSyntheticStandardFixture({
    producerSession: "fixture-producer-session",
    sourceSessionId: "fixture-producer-session",
    capturedAt: "2026-09-20T12:01:01.000Z",
    receivedAt: "2026-09-20T12:01:01.010Z",
    mapCapturedAt: "2026-09-20T12:01:02.000Z",
  });
  const resourceStore = new MemoryResourceGateway();
  const replay = await new RecordedAcquisitionAdapter({ resourceGateway: resourceStore, maxClockErrorMs: 50 }).replay(fixture.samples);
  assert.equal(replay.fixtureKind, "synthetic");
  assert.equal(replay.accepted[0]?.schema, "image/png");
  const published = await new NativeMapPublisher({
    resourceGateway: resourceStore,
    checkpointPort: new MemoryCheckpointStore(),
  }).publish(fixture.mapProduct);
  assert.equal(published.layerResources[0]?.schema, "text/x.pcd");
  assert.equal(published.checkpoint.mapId, fixture.localMapId);
});

test("resource JSON codec preserves native u64 byte counts without lossy numbers", () => {
  const resource = { id: "resource-large", schema: "sensor_msgs/PointCloud2", sha256: "b".repeat(64), byteLength: 9007199254740993n } as ResourceRef;
  const json = encodeResourceRefJson(resource);
  assert.equal(json.byteLength, "9007199254740993");
  assert.equal(decodeResourceRefJson(json).byteLength, resource.byteLength);
  assert.throws(() => decodeResourceRefJson({ ...json, byteLength: 3 }), /resource_ref_json_shape_invalid/);
});

test("source and tracker namespaces prevent cross-Unit same-session collisions", async () => {
  const first = sample({ unitId: "unit-a", producerId: "producer-a", sequence: 9n });
  const second = sample({ unitId: "unit-b", producerId: "producer-a", sequence: 9n, bytes: nativeBytes("image/png", "other-unit") });
  assert.notEqual(sourceKey(first), sourceKey(second));
  const replay = await new RecordedAcquisitionAdapter({ resourceGateway: new MemoryResourceGateway(), maxClockErrorMs: 10 }).replay([first, second]);
  assert.equal(replay.accepted.length, 2, "same stream/session/sequence on distinct Units is not a duplicate");
  assert.equal(replay.issues.some((issue) => issue.code === "conflicting_duplicate"), false);

  const frameReset = sample({ sequence: 9n, spatialFrameId: "frame-origin-reset", bytes: nativeBytes("image/png", "other-frame") });
  const resetReplay = await new RecordedAcquisitionAdapter({ resourceGateway: new MemoryResourceGateway(), maxClockErrorMs: 10 }).replay([sample({ sequence: 9n }), frameReset]);
  assert.equal(resetReplay.accepted.length, 2, "a frame reset does not collide with the prior origin's source identity");

  const tracks: string[] = [];
  const ingress = new ImagePerceptionIngress({
    producerSession: "session-shared-by-fixture",
    producerId: "producer-a",
    localMapId: "map-synthetic",
    worldCodec: timestampCodec,
    provenance: modelProvenance(),
    observationPublisher: { publish: async (observation) => { tracks.push(observation.input.trackId ?? ""); return { observationId: observation.input.id, duplicate: false }; } },
    detector: () => [detection("backpack", 0.9, 10, 10, 30, 30)],
  });
  ingress.submit(imageFrame(30n, { unitId: "unit-a" }));
  ingress.submit(imageFrame(30n, { unitId: "unit-b" }));
  await ingress.drain();
  assert.equal(new Set(tracks).size, 2, "image association is not label-only across Units");
});

test("native map publisher stores opaque native layers before world-owned CAS commit", async () => {
  const resourceStore = new MemoryResourceGateway();
  const checkpointStore = new MemoryCheckpointStore();
  const publisher = new NativeMapPublisher({ resourceGateway: resourceStore, checkpointPort: checkpointStore });
  const product = nativeProduct();

  const published = await publisher.publish(product);
  assert.equal(published.checkpoint.rootFrameId, "frame-origin-a");
  assert.equal(published.layerResources.length, 2);
  assert.equal(published.layerResources[0]?.schema, "text/x.pcd");
  assert.equal(published.layerResources[1]?.schema, "application/json");
  assert.equal(published.receipt.revision, 1n);
  assert.equal(published.receipt.duplicate, false);
  assert.equal(resourceStore.commitCalls, 1, "map references commit only after all native bytes and indexes are retained");
  assert.equal(published.layerResources[0]?.byteLength, BigInt(nativeBytes("text/x.pcd", "native-cloud").byteLength));
  assert.equal(published.checkpoint.manifest.id.includes("native-cloud"), false, "checkpoint contains refs, not native bytes");

  const retry = await publisher.publish(product);
  assert.equal(retry.receipt.duplicate, true);
  assert.equal(retry.receipt.revision, 1n);
});

test("map bytes remain retained when checkpoint CAS fails, with no successful dangling head", async () => {
  const resourceStore = new MemoryResourceGateway();
  const checkpointStore = new MemoryCheckpointStore();
  const publisher = new NativeMapPublisher({ resourceGateway: resourceStore, checkpointPort: checkpointStore });
  await publisher.publish(nativeProduct());
  const conflicting = { ...nativeProduct(), expectedHeadRevision: 0n, acquiredThrough: "2026-09-20T12:00:09.000Z", inputObservationIds: ["observation-different"] };
  await assert.rejects(() => publisher.publish(conflicting), /head_revision_conflict/);
  assert.equal((await checkpointStore.readHead({ unitId: "go2-synthetic", mapId: "map-synthetic" }))?.revision, 1n);
  assert.ok(resourceStore.publishCalls >= 4, "retained native bytes are not rolled back by a failed CAS");
});

test("latest-frame queue bounds pending work and image ingress publishes image-only 2D evidence", async () => {
  const gates = new Map<bigint, { resolve: (detections: readonly ImageDetection[]) => void }>();
  const published: PublishedObservation[] = [];
  const publisher: ObservationPublisher = { publish: async (observation) => { published.push(observation); return { observationId: observation.input.id, duplicate: false }; } };
  const ingress = new ImagePerceptionIngress({
    producerSession: "detector-worker-session-a",
    producerId: "producer-a",
    localMapId: "map-synthetic",
    worldCodec: timestampCodec,
    provenance: modelProvenance(),
    observationPublisher: publisher,
    detector: (frame) => new Promise<readonly ImageDetection[]>((resolve) => gates.set(frame.sequence, { resolve })),
  });
  const frame1 = imageFrame(1n);
  const frame2 = imageFrame(2n);
  const frame3 = imageFrame(3n);
  assert.equal(ingress.submit(frame1), "started");
  assert.equal(ingress.submit(frame2), "queued");
  assert.equal(ingress.submit(frame3), "replaced");
  gates.get(1n)?.resolve([detection("backpack", 0.91, 10, 10, 40, 40)]);
  await flush();
  gates.get(3n)?.resolve([detection("backpack", 0.92, 12, 10, 42, 40)]);
  await ingress.drain();

  assert.deepEqual(published.map((entry) => entry.input.inputs[0]?.sequence), [1n, 3n]);
  assert.ok(published.every((entry) => entry.evidenceKind === "image_only"));
  assert.ok(published.every((entry) => entry.input.geometry?.value.tag === "BoundingBox2D"));
  assert.notEqual(published[0]?.input.geometry?.value.tag, "BoundingBox3D", "image-only output cannot claim a 3D box");
  assert.deepEqual(published[0]?.provenance, modelProvenance());
  assert.equal(published[0]?.input.localMapId, "map-synthetic");
});

test("native world port receives the enrolled producer session and configured local map", async () => {
  const received: ObservationInput[] = [];
  const publisher = new WorldObservationPublisher({
    producerSession: "detector-worker-session-world",
    localMapId: "map-synthetic",
    port: { ingestObservation: async ({ input }) => { received.push(input); } },
  });
  const ingress = new ImagePerceptionIngress({
    producerSession: "detector-worker-session-world",
    producerId: "producer-world",
    localMapId: "map-synthetic",
    worldCodec: timestampCodec,
    provenance: modelProvenance(),
    observationPublisher: publisher,
    detector: () => [detection("backpack", 0.9, 10, 10, 30, 30)],
  });
  ingress.submit(imageFrame(21n));
  await ingress.drain();
  assert.equal(received.length, 1);
  assert.equal(received[0]?.producerSession, "detector-worker-session-world");
  assert.equal(received[0]?.localMapId, "map-synthetic");
  assert.equal(typeof received[0]?.inputs[0]?.sequence, "bigint");
});

test("world observation seam serializes generated client union tags, not server source tags", async () => {
  const received: ObservationInput[] = [];
  const publisher = new WorldObservationPublisher({
    producerSession: "generated-client-session",
    localMapId: "map-synthetic",
    port: { ingestObservation: async ({ input }) => { received.push(input); } },
  });
  const ingress = new ImagePerceptionIngress({
    producerSession: "generated-client-session",
    producerId: "generated-client-producer",
    localMapId: "map-synthetic",
    worldCodec: timestampCodec,
    provenance: modelProvenance(),
    observationPublisher: publisher,
    detector: () => [detection("backpack", 0.9, 10, 10, 30, 30)],
  });
  ingress.submit(imageFrame(22n));
  await ingress.drain();
  const input = received[0];
  assert.ok(input);
  const writer = new BinaryWriter(512);
  GeneratedObservationInput.serialize(writer, input);
  const roundTrip = GeneratedObservationInput.deserialize(new BinaryReader(writer.getBuffer()));
  assert.equal(roundTrip.geometry?.value.tag, "BoundingBox2D");
  assert.equal(roundTrip.entityId, undefined, "generated optional entityId survives the client codec");
  assert.equal(roundTrip.pose, undefined, "generated optional pose survives the client codec");
  const serverShaped = {
    ...input,
    geometry: input.geometry ? {
      ...input.geometry,
      value: { ...input.geometry.value, tag: "boundingBox2D" },
    } : undefined,
  } as unknown as ObservationInput;
  assert.throws(() => GeneratedObservationInput.serialize(new BinaryWriter(512), serverShaped), /unknown tag/iu);
});

test("source restart keeps the retained map/frame while an origin reset uses a distinct frame identity", async () => {
  const published: PublishedObservation[] = [];
  const ingress = new ImagePerceptionIngress({
    producerSession: "detector-worker-session-restarted",
    producerId: "producer-reset",
    localMapId: "map-retained",
    worldCodec: timestampCodec,
    provenance: modelProvenance(),
    observationPublisher: { publish: async (observation) => { published.push(observation); return { observationId: observation.input.id, duplicate: false }; } },
    detector: () => [detection("backpack", 0.9, 10, 10, 30, 30)],
  });

  // Adapter restart: source session and sequence reset, but the qualified
  // coordinate origin and retained local map remain unchanged.
  ingress.submit(imageFrame(10n, { sourceSessionId: "camera-session-before-restart", spatialFrameId: "frame-origin-retained" }));
  await ingress.drain();
  ingress.submit(imageFrame(1n, { sourceSessionId: "camera-session-after-restart", spatialFrameId: "frame-origin-retained" }));
  await ingress.drain();

  assert.deepEqual(published.map((entry) => entry.input.inputs[0]?.sequence), [10n, 1n]);
  assert.deepEqual(published.map((entry) => entry.input.localMapId), ["map-retained", "map-retained"]);
  assert.deepEqual(published.map((entry) => entry.input.semantic?.frameId), ["frame-origin-retained", "frame-origin-retained"]);
  assert.notEqual(published[0]?.input.trackId, published[1]?.input.trackId, "source restart starts a new tracker session");

  // Coordinate-origin reset: a new pipeline instance publishes against a new
  // map/frame pair; perception never deletes the old map.
  const resetPublished: PublishedObservation[] = [];
  const resetIngress = new ImagePerceptionIngress({
    producerSession: "detector-worker-session-restarted",
    producerId: "producer-reset",
    localMapId: "map-after-origin-reset",
    worldCodec: timestampCodec,
    provenance: modelProvenance(),
    observationPublisher: { publish: async (observation) => { resetPublished.push(observation); return { observationId: observation.input.id, duplicate: false }; } },
    detector: () => [detection("backpack", 0.9, 10, 10, 30, 30)],
  });
  resetIngress.submit(imageFrame(1n, { sourceSessionId: "camera-session-after-restart", spatialFrameId: "frame-origin-reset" }));
  await resetIngress.drain();
  assert.equal(resetPublished[0]?.input.localMapId, "map-after-origin-reset");
  assert.equal(resetPublished[0]?.input.semantic?.frameId, "frame-origin-reset");
});

test("resource adapter uses producer publishBytes, grouped host commit, and readonly bounded reader", async () => {
  const root = await mkdtemp(join(tmpdir(), "nemeia-perception-resource-"));
  const credential = bytes("perception-test-credential");
  const committed: unknown[] = [];
  const gateway = await ResourceGateway.open({
    root,
    bindings: [{
      bindingId: "perception-binding",
      producerId: "producer-a",
      producerSession: "detector-worker-session-a",
      unitId: "go2-synthetic",
      package: { name: "nemeia-perception", version: "0.2.1", sha256: "a".repeat(64) },
      credential,
      allowedSchemas: ["image/png"],
      referenceCommitAdapter: { commitPublishedReferences: async (request) => { committed.push(request); } },
    }],
  });
  try {
    const session = gateway.authenticateWorker({ bindingId: "perception-binding", credential });
    let reachableId: string | undefined;
    const reader = gateway.createReader({ authorizeRead: ({ resource }) => resource.id === reachableId });
    const adapter = new ResourceGatewayAdapter({ gateway, session, reader });
    const payload = new Uint8Array(SYNTHETIC_PNG_1X1);
    const resource = await adapter.publish(payload, "image/png", "source:go2-synthetic:1");
    const unrelated = await adapter.publish(payload, "image/png", "source:go2-synthetic:unrelated");
    reachableId = resource.id;
    assert.equal(resource.byteLength, BigInt(payload.byteLength));
    assert.equal(committed.length, 0, "publishBytes does not commit a world reference by itself");
    await adapter.commit([resource]);
    assert.equal(committed.length, 1);
    assert.equal((committed[0] as { resources: [{ byteLength: string }] }).resources[0].byteLength, String(payload.byteLength));
    assert.deepEqual(await adapter.read(resource), payload);
    await assert.rejects(adapter.read(unrelated), ResourceAuthorizationError);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("late completion is rejected as stale and tracker keeps same-label objects separate", async () => {
  const gates = new Map<bigint, { resolve: (detections: readonly ImageDetection[]) => void }>();
  const published: PublishedObservation[] = [];
  const ingress = new ImagePerceptionIngress({
    producerSession: "detector-worker-session-b",
    producerId: "producer-b",
    localMapId: "map-synthetic",
    worldCodec: timestampCodec,
    maxInFlight: 2,
    provenance: modelProvenance(),
    observationPublisher: { publish: async (observation) => { published.push(observation); return { observationId: observation.input.id, duplicate: false }; } },
    detector: (frame) => new Promise<readonly ImageDetection[]>((resolve) => gates.set(frame.sequence, { resolve })),
  });
  ingress.submit(imageFrame(10n));
  ingress.submit(imageFrame(11n));
  gates.get(11n)?.resolve([
    detection("backpack", 0.9, 10, 10, 30, 30),
    detection("backpack", 0.88, 60, 10, 80, 30),
  ]);
  await flush();
  gates.get(10n)?.resolve([detection("backpack", 0.95, 10, 10, 30, 30)]);
  await ingress.drain();
  assert.deepEqual(published.map((entry) => entry.input.inputs[0]?.sequence), [11n, 11n]);
  assert.equal(new Set(published.map((entry) => entry.input.trackId)).size, 2, "same-label candidates remain distinct");

  const restartPublished: PublishedObservation[] = [];
  const restarted = new ImagePerceptionIngress({
    producerSession: "detector-worker-session-c-restarted",
    producerId: "producer-b",
    localMapId: "map-synthetic",
    worldCodec: timestampCodec,
    provenance: modelProvenance(),
    observationPublisher: { publish: async (observation) => { restartPublished.push(observation); return { observationId: observation.input.id, duplicate: false }; } },
    detector: () => [detection("backpack", 0.9, 10, 10, 30, 30)],
  });
  restarted.submit(imageFrame(11n));
  await restarted.drain();
  assert.notEqual(restartPublished[0]?.input.trackId, published[0]?.input.trackId, "worker restart starts a new tracker session");
});

test("calibrated association qualifies only supported partial surface and fails closed to image-only", () => {
  const input = {
    detection: detection("backpack", 0.94, 10, 10, 40, 40),
    imageFrame: imageFrame(20n),
    rangeFrame: {
      streamId: "lidar",
      sessionId: "lidar-session-a",
      spatialFrameId: "frame-origin-a",
      sequence: 5n,
      capturedAt: "2026-09-20T12:00:20.002Z",
      resource: ref("text/x.pcd", "range-support"),
    },
    calibration: {
      cameraFrameId: "camera_optical",
      rangeFrameId: "lidar",
      intrinsicsDigest: "intrinsics-digest",
      distortionDigest: "distortion-digest",
      extrinsicsDigest: "extrinsics-digest",
      timeOffsetMs: 0,
    },
    poseHistory: [{
      observedAt: "2026-09-20T12:00:20.001Z",
      frameId: "frame-origin-a",
      pose: identityPose(),
      uncertaintyMs: 2,
    }],
    supportPoints: [
      { x: 1, y: 2, z: 3, pixelX: 20, pixelY: 20, depthM: 3 },
      { x: 1.1, y: 2, z: 3, pixelX: 22, pixelY: 20, depthM: 3 },
    ],
    occluded: false,
    surfaceConsistent: true,
    supportResource: ref("text/x.pcd", "range-support"),
  };
  const policy = { maxClockSkewMs: 10, maxPoseAgeMs: 50, minSupportingPoints: 2, maxDepthResidualM: 0.2 };
  const qualified = qualifyCalibratedAssociation(input, policy);
  assert.equal(qualified.qualified, true);
  if (qualified.qualified) {
    assert.equal(qualified.geometry.kind, "partial_surface");
    assert.equal(qualified.geometry.completeness, "partial");
    assert.equal("boundingBox3D" in qualified.geometry, false);
  }

  const failed = qualifyCalibratedAssociation({ ...input, occluded: true, rangeFrame: { ...input.rangeFrame, capturedAt: "2026-09-20T12:00:20.100Z" } }, policy);
  assert.equal(failed.qualified, false);
  if (!failed.qualified) assert.deepEqual(new Set(failed.reasons), new Set(["clock_skew", "occluded"]));
  const reset = qualifyCalibratedAssociation({ ...input, rangeFrame: { ...input.rangeFrame, spatialFrameId: "frame-origin-reset" } }, policy);
  assert.equal(reset.qualified, false);
  if (!reset.qualified) assert.ok(reset.reasons.includes("frame_reset"));
  const labelOnly = qualifyCalibratedAssociation({ ...input, supportPoints: [] }, policy);
  assert.equal(labelOnly.qualified, false);
  if (!labelOnly.qualified) assert.ok(labelOnly.reasons.includes("insufficient_surface_support"));
  const stalePose = qualifyCalibratedAssociation({ ...input, poseHistory: [{ ...input.poseHistory[0]!, observedAt: "2026-09-20T12:00:19.000Z" }] }, policy);
  assert.equal(stalePose.qualified, false);
  if (!stalePose.qualified) assert.ok(stalePose.reasons.includes("pose_stale"));
  const box = imageOnlyGeometry(input.imageFrame, input.detection, timestampCodec);
  assert.equal(box.width, 30);
  assert.equal(box.height, 30);
});

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function nativeBytes(schema: string, value: string): Uint8Array {
  if (schema === "image/png") return new Uint8Array(value === "different" ? SYNTHETIC_PNG_1X1_RGB : SYNTHETIC_PNG_1X1);
  if (schema === "text/x.pcd") return new TextEncoder().encode(SYNTHETIC_PCD_ASCII);
  if (schema === "application/json") return new TextEncoder().encode(SYNTHETIC_OCCUPANCY_GRID_JSON);
  throw new Error(`unsupported_test_fixture_schema:${schema}`);
}

function sample(overrides: Partial<RecordedSample> = {}): RecordedSample {
  return {
    unitId: "go2-synthetic",
    producerId: "producer-a",
    streamId: "camera_front",
    sourceSessionId: "camera-session-a",
    spatialFrameId: "frame-origin-a",
    sequence: 1n,
    capturedAt: "2026-09-20T12:00:01.000Z",
    receivedAt: "2026-09-20T12:00:01.010Z",
    clockErrorMs: 3,
    schema: "image/png",
    bytes: nativeBytes("image/png", "image-1"),
    fixtureKind: "synthetic",
    ...overrides,
  };
}

function ref(schema: string, value: string): ResourceRef {
  const payload = bytes(value);
  return { id: `resource:${sha256Hex(payload).slice(0, 16)}`, schema, sha256: sha256Hex(payload), byteLength: BigInt(payload.byteLength) } as ResourceRef;
}

function nativeProduct(): NativeMapProduct {
  return {
    unitId: "go2-synthetic",
    mapId: "map-synthetic",
    spatialFrameId: "frame-origin-a",
    expectedHeadRevision: 0n,
    acquiredFrom: "2026-09-20T12:00:01.000Z",
    acquiredThrough: "2026-09-20T12:00:08.000Z",
    inputCoverage: [{ streamId: "lidar", sessionId: "lidar-session-a", firstSequence: 1n, lastSequence: 8n }],
    inputObservationIds: ["observation-1"],
    layers: [
      { kind: "point_cloud", schema: "text/x.pcd", frameId: "frame-origin-a", capturedAt: "2026-09-20T12:00:08.000Z", bytes: nativeBytes("text/x.pcd", "native-cloud"), metadata: { isDense: false, fieldsVersion: "synthetic-v1" } },
      { kind: "occupancy_grid", schema: "application/json", frameId: "frame-origin-a", capturedAt: "2026-09-20T12:00:08.000Z", bytes: nativeBytes("application/json", "native-grid-with-unknown-cells"), metadata: { unknownValue: -1, resolutionM: 0.05 } },
    ],
    fixtureKind: "synthetic",
    producer: { name: "synthetic-native-map-fixture", version: "1", sha256: "fixture-producer-digest" },
  };
}

function imageFrame(sequence: bigint, overrides: Partial<ImageFrame> = {}): ImageFrame {
  return {
    unitId: "go2-synthetic",
    producerId: "producer-a",
    streamId: "camera_front",
    sourceSessionId: "camera-session-a",
    spatialFrameId: "frame-origin-a",
    sequence,
    capturedAt: `2026-09-20T12:00:${String(Number(sequence)).padStart(2, "0")}.000Z`,
    receivedAt: `2026-09-20T12:00:${String(Number(sequence)).padStart(2, "0")}.010Z`,
    width: 640,
    height: 480,
    resource: ref("image/png", `image-${sequence}`),
    fixtureKind: "synthetic",
    ...overrides,
  };
}

function detection(label: string, confidence: number, xMin: number, yMin: number, xMax: number, yMax: number): ImageDetection {
  return { label, confidence, box: { xMin, yMin, xMax, yMax } };
}

function modelProvenance(): ModelProvenance {
  return { name: "synthetic-detector", version: "fixture-1", sha256: "model-digest", promptProfile: "blue-backpack", runtime: "offline-test", inputSize: { width: 640, height: 480 } };
}

const timestampCodec = {
  timestampFromIso: (value: string) => ({ __timestamp_micros_since_unix_epoch__: BigInt(Date.parse(value)) * 1000n }) as WorldTimestamp,
  timestampToIso: (value: WorldTimestamp) => new Date(Number(value.__timestamp_micros_since_unix_epoch__ / 1000n)).toISOString(),
};

function identityPose() {
  return { positionM: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } };
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

class MemoryResourceGateway implements RetainedResourceGateway {
  readonly entries = new Map<string, { ref: ResourceRef; bytes: Uint8Array }>();
  readonly idempotency = new Map<string, ResourceRef>();
  publishCalls = 0;
  commitCalls = 0;

  async publish(inputBytes: Uint8Array, schema: string, idempotencyKey: string): Promise<ResourceRef> {
    const existing = this.idempotency.get(idempotencyKey);
    if (existing) return existing;
    const digest = sha256Hex(inputBytes);
    const ref: ResourceRef = { id: `resource:${digest.slice(0, 16)}-${this.publishCalls}`, schema, sha256: digest, byteLength: BigInt(inputBytes.byteLength) } as ResourceRef;
    this.idempotency.set(idempotencyKey, ref);
    this.entries.set(ref.id, { ref, bytes: new Uint8Array(inputBytes) });
    this.publishCalls += 1;
    return ref;
  }

  async read(ref: ResourceRef): Promise<Uint8Array> {
    const entry = this.entries.get(ref.id);
    if (!entry) throw new Error("resource_missing");
    return new Uint8Array(entry.bytes);
  }

  async commit(resources: readonly ResourceRef[]): Promise<void> {
    assert.ok(resources.length > 0);
    assert.equal(new Set(resources.map((resource) => resource.id)).size, resources.length);
    for (const resource of resources) {
      const entry = this.entries.get(resource.id);
      assert.ok(entry);
      assert.equal(BigInt(entry.bytes.byteLength), resource.byteLength);
      assert.equal(sha256Hex(entry.bytes), resource.sha256);
    }
    this.commitCalls += 1;
  }
}

class MemoryCheckpointStore implements MapCheckpointPort {
  readonly commits: MapCheckpointInput[] = [];
  readonly heads = new Map<string, { revision: bigint; manifestDigest: string }>();
  readonly manifests = new Map<string, { revision: bigint; manifestDigest: string }>();

  async commitMapCheckpoint({ input }: CommitMapCheckpointParams) {
    const existing = this.manifests.get(input.manifest.sha256);
    if (existing) return { ...existing, duplicate: true };
    const key = input.mapId;
    const head = this.heads.get(key);
    if ((head?.revision ?? 0n) !== input.expectedRevision) throw new Error("head_revision_conflict");
    const revision = (head?.revision ?? 0n) + 1n;
    const receipt = { revision, duplicate: false };
    this.commits.push(input);
    this.manifests.set(input.manifest.sha256, { revision, manifestDigest: input.manifest.sha256 });
    this.heads.set(key, { revision, manifestDigest: input.manifest.sha256 });
    return receipt;
  }

  async readHead(input: { unitId: string; mapId: string }) {
    void input.unitId;
    return this.heads.get(input.mapId);
  }
}
