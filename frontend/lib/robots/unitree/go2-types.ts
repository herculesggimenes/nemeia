export type Go2Mode = "AP" | "STA-L";

export type Go2ConnectionState = "idle" | "testing" | "connecting" | "connected" | "failed" | "disconnected";

export type Go2ConnectionConfig = {
  autoReconnect: boolean;
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

export type Go2RobotPose = {
  x: number;
  y: number;
  z: number;
  yaw: number;
};

export type Go2MotorState = {
  q: number;
};

export type Go2AudioInputStats = {
  bytesSent: number;
  packetsSent: number;
  source: "file" | "microphone" | "none" | "priming";
  streaming: boolean;
  trackState: "detached" | "ended" | "live";
};

export type Go2Command =
  | { type: "emergency_stop" }
  | { type: "damp" }
  | { type: "balance_stand" }
  | { type: "stop_move" }
  | { type: "obstacle_avoidance"; enabled: boolean }
  | { type: "joystick"; lx: number; ly: number; rx: number; ry: number; keys?: number }
  | { type: "sport_request"; apiId: number; parameter?: string; priority?: boolean; label: string; modeLabel?: string }
  | { type: "move"; vx: number; vy: number; yaw: number; durationMs: number };

export type Go2Callbacks = {
  onAudioInputStats: (stats: Go2AudioInputStats) => void;
  onStateChange: (state: Go2ConnectionState) => void;
  onAudioTrack: (stream: MediaStream) => void;
  onVideoTrack: (stream: MediaStream) => void;
  onMessage: (message: Go2DataChannelMessage) => void;
  onValidated: () => void;
};
