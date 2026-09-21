import { createHash } from "node:crypto";

export const BACKPACK_FIXTURE_VERSION = "2026-09-19-recorded-v1";

const resourceRef = Object.freeze({
  id: "resource-image-blue-backpack-001",
  schema: "nemeia.image/rgb8@1",
  sha256: "1111111111111111111111111111111111111111111111111111111111111111",
  // JSON projection of the native u64; bounded IO converts this at the edge.
  byteLength: "4096"
});

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function createSimulationClock({ epochMs = 0 } = {}) {
  let nowMs = epochMs;
  return {
    now: () => nowMs,
    advance: ms => {
      if (!Number.isSafeInteger(ms) || ms < 0) throw new Error("simulation clock advances must be non-negative safe integers");
      nowMs += ms;
      return nowMs;
    }
  };
}

export function createBackpackFixture() {
  const fixture = {
    fixtureVersion: BACKPACK_FIXTURE_VERSION,
    simulationClock: { epochMs: 0, reviewAtMs: 35_000 },
    mission: {
      id: "mission-find-blue-backpack-001",
      description: "Find the blue backpack and report its evidenced local position.",
      objectiveId: "objective-locate-blue-backpack-001"
    },
    unit: { id: "entity-go2-001", assignmentRevision: "1" },
    frame: { id: "frame-go2-local-001", sourceSessionId: "replay-camera-001" },
    resourceRef,
    firstObservation: {
      id: "observation-backpack-001",
      entityId: "entity-blue-backpack-001",
      sourceSessionId: "replay-camera-001",
      sourceTrackId: "track-camera-001",
      recordedAcquisitionAt: "2026-09-19T12:00:45.000Z",
      semantic: { label: "backpack", color: "blue", confidence: 0.97 },
      evidence: [resourceRef]
    },
    mapCheckpoint: {
      id: "map-revision-go2-001",
      frameId: "frame-go2-local-001",
      revision: "1",
      manifestDigest: "2222222222222222222222222222222222222222222222222222222222222222",
      recordedAcquisitionAt: "2026-09-19T12:00:40.000Z",
      evidence: [resourceRef]
    },
    secondObservation: {
      id: "observation-backpack-002",
      entityId: "entity-blue-backpack-001",
      sourceSessionId: "replay-camera-001",
      sourceTrackId: "track-camera-001",
      recordedAcquisitionAt: "2026-09-19T12:01:10.000Z",
      semantic: { label: "backpack", color: "blue", confidence: 0.99 },
      evidence: [resourceRef]
    }
  };
  return Object.freeze({ ...fixture, fixtureDigest: createHash("sha256").update(stableJson(fixture)).digest("hex") });
}

export function assertRecordedAcquisitionPreserved(before, after) {
  if (before.recordedAcquisitionAt !== after.recordedAcquisitionAt) {
    throw new Error("recorded acquisition time changed during context or database processing");
  }
  return true;
}
