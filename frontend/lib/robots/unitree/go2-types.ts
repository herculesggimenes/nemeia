export type Go2Mode = "AP" | "STA-L";

export type Go2ConnectionState = "idle" | "testing" | "connecting" | "connected" | "failed" | "disconnected";

export type Go2ConnectionConfig = {
  robotId: string;
  ip: string;
  mode: Go2Mode;
};

export type Go2DataChannelMessage = {
  type: string;
  topic?: string;
  data?: unknown;
  info?: unknown;
};

export type Go2LidarFrame = {
  data: ArrayBuffer;
  resolution: number;
  origin: [number, number, number];
};

export type Go2Command =
  | { type: "emergency_stop" }
  | { type: "damp" }
  | { type: "balance_stand" }
  | { type: "stop_move" }
  | { type: "move"; vx: number; vy: number; yaw: number; durationMs: number };

export type Go2Callbacks = {
  onStateChange: (state: Go2ConnectionState) => void;
  onVideoTrack: (stream: MediaStream) => void;
  onMessage: (message: Go2DataChannelMessage) => void;
  onValidated: () => void;
};
