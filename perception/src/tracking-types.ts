import type { FrameRef, ModelProvenance, ObservationPublisher, ResourceRef } from "./types.ts";
import { sha256Hex } from "./types.ts";

export interface ImageFrame {
  unitId: string;
  producerId: string;
  streamId: string;
  sourceSessionId: string;
  spatialFrameId: string;
  sequence: bigint;
  capturedAt: string;
  receivedAt: string;
  width: number;
  height: number;
  resource: ResourceRef;
  fixtureKind: "recorded" | "synthetic";
}

export interface ImageDetection {
  label: string;
  confidence: number;
  box: { xMin: number; yMin: number; xMax: number; yMax: number };
}

export { sha256Hex };
export type { FrameRef, ModelProvenance, ObservationPublisher };
