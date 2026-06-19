"use client";

import { create } from "zustand";
import { connectGo2Local, testGo2Connection } from "./go2-connection";
import { normalizeGo2Ip } from "./go2-config";
import { validationResponse } from "./go2-crypto";
import { GO2_DATA_CHANNEL_TYPE, GO2_SPORT_CMD, GO2_TOPIC } from "./go2-topics";
import type { Go2Command, Go2ConnectionConfig, Go2ConnectionState, Go2LidarFrame } from "./go2-types";
import type { Go2WebRtcConnection } from "./go2-webrtc";

const DEFAULT_CONFIG: Go2ConnectionConfig = {
  robotId: "go2",
  ip: "192.168.12.1",
  mode: "AP"
};

const CONFIG_STORAGE_KEY = "nemeia.go2.config";

type Go2Store = {
  config: Go2ConnectionConfig;
  connectionState: Go2ConnectionState;
  videoStream: MediaStream | null;
  lidarFrameCount: number;
  lidarLastFrameBytes: number | null;
  lidarFrame: Go2LidarFrame | null;
  lidarState: string | null;
  lastError: string | null;
  lastEvent: string | null;
  emergencyStopped: boolean;
  setConfig: (config: Go2ConnectionConfig) => void;
  testConnection: (configOverride?: Go2ConnectionConfig) => Promise<void>;
  connect: (configOverride?: Go2ConnectionConfig) => Promise<void>;
  disconnect: () => void;
  sendCommand: (command: Go2Command) => void;
};

let connection: Go2WebRtcConnection | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let zeroMoveTimer: ReturnType<typeof setTimeout> | null = null;

function padDatePart(value: number): string {
  return value.toString().padStart(2, "0");
}

function loadConfig(): Go2ConnectionConfig {
  if (typeof window === "undefined") {
    return DEFAULT_CONFIG;
  }

  const raw = window.localStorage.getItem(CONFIG_STORAGE_KEY);
  if (!raw) {
    return DEFAULT_CONFIG;
  }

  try {
    const parsed = { ...DEFAULT_CONFIG, ...(JSON.parse(raw) as Partial<Go2ConnectionConfig>) };
    return { ...parsed, ip: normalizeGo2Ip(parsed.ip) };
  } catch {
    return DEFAULT_CONFIG;
  }
}

function persistConfig(config: Go2ConnectionConfig): void {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
  }
}

function formatHeartbeatTime(date: Date): string {
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())} ${padDatePart(date.getHours())}:${padDatePart(date.getMinutes())}:${padDatePart(date.getSeconds())}`;
}

function startHeartbeat(): void {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    if (!connection) {
      return;
    }

    const now = new Date();
    connection.send({
      type: GO2_DATA_CHANNEL_TYPE.HEARTBEAT,
      topic: "",
      data: {
        timeInStr: formatHeartbeatTime(now),
        timeInNum: Math.floor(now.getTime() / 1000)
      }
    });
  }, 2000);
}

function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function publishRequest(topic: string, apiId: number, parameter = "{}", priority = false): void {
  connection?.send({
    type: GO2_DATA_CHANNEL_TYPE.REQUEST,
    topic,
    data: {
      header: {
        identity: {
          id: Math.floor(Math.random() * 2147483647),
          api_id: apiId
        },
        ...(priority ? { policy: { priority: 1 } } : {})
      },
      parameter,
      binary: []
    }
  });
}

function publishMove(vx: number, vy: number, yaw: number): void {
  connection?.send({
    type: GO2_DATA_CHANNEL_TYPE.MSG,
    topic: GO2_TOPIC.WIRELESS_CONTROLLER,
    data: {
      lx: vy,
      ly: vx,
      rx: yaw,
      ry: 0,
      keys: 0
    }
  });
}

function zeroMove(): void {
  publishMove(0, 0, 0);
}

function bounded(value: number, max: number): number {
  return Math.min(Math.max(value, -max), max);
}

function messageText(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (raw.includes("HTTP 429")) {
    return "Robot busy: another WebRTC client is already connected. Disconnect other Nemeia/Unitree sessions, wait about 5 seconds, then retry.";
  }
  return raw;
}

function enableRobotStreams(): void {
  startHeartbeat();
  connection?.send({ type: GO2_DATA_CHANNEL_TYPE.VID, topic: "", data: "on" });
  connection?.send({ type: GO2_DATA_CHANNEL_TYPE.AUD, topic: "", data: "on" });
  for (const topic of [GO2_TOPIC.LOW_STATE, GO2_TOPIC.SPORT_MODE_STATE, GO2_TOPIC.ROBOT_ODOM, GO2_TOPIC.LIDAR_ARRAY, GO2_TOPIC.LIDAR_STATE]) {
    connection?.send({ type: GO2_DATA_CHANNEL_TYPE.SUBSCRIBE, topic });
  }
  for (let i = 0; i < 5; i += 1) {
    setTimeout(() => {
      connection?.send({ type: GO2_DATA_CHANNEL_TYPE.MSG, topic: GO2_TOPIC.LIDAR_SWITCH, data: "ON" });
    }, i * 100);
  }
}

function dataByteLength(data: unknown): number | null {
  if (data instanceof ArrayBuffer) {
    return data.byteLength;
  }

  if (data && typeof data === "object" && "data" in data && (data as { data?: unknown }).data instanceof ArrayBuffer) {
    return (data as { data: ArrayBuffer }).data.byteLength;
  }

  return null;
}

function normalizeLidarFrame(data: unknown): Go2LidarFrame | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const record = data as Record<string, unknown>;
  const rawData = record.data;
  const frameData = rawData instanceof ArrayBuffer ? rawData : null;
  if (!frameData) {
    return null;
  }

  const originValue = record.origin;
  const origin =
    Array.isArray(originValue) && originValue.length >= 3
      ? ([Number(originValue[0]) || 0, Number(originValue[1]) || 0, Number(originValue[2]) || 0] as [number, number, number])
      : ([0, 0, 0] as [number, number, number]);

  return {
    data: frameData.slice(0),
    resolution: Number(record.resolution) || 0.1,
    origin
  };
}

export const useGo2Store = create<Go2Store>((set, get) => ({
  config: DEFAULT_CONFIG,
  connectionState: "idle",
  videoStream: null,
  lidarFrameCount: 0,
  lidarLastFrameBytes: null,
  lidarFrame: null,
  lidarState: null,
  lastError: null,
  lastEvent: null,
  emergencyStopped: false,
  setConfig: (config) => {
    const normalizedConfig = { ...config, ip: normalizeGo2Ip(config.ip) };
    persistConfig(normalizedConfig);
    set({ config: normalizedConfig });
  },
  testConnection: async (configOverride) => {
    const config = { ...(configOverride ?? get().config), ip: normalizeGo2Ip((configOverride ?? get().config).ip) };
    if (configOverride) {
      persistConfig(config);
      set({ config });
    }
    set({ connectionState: "testing", lastError: null, lastEvent: `Testing ${config.ip}` });
    try {
      const method = await testGo2Connection(config);
      set({ connectionState: "idle", lastEvent: `Go2 responded with ${method} signaling` });
    } catch (error) {
      set({ connectionState: "failed", lastError: messageText(error), lastEvent: "Go2 test failed" });
    }
  },
  connect: async (configOverride) => {
    const config = { ...(configOverride ?? get().config), ip: normalizeGo2Ip((configOverride ?? get().config).ip) };
    if (configOverride) {
      persistConfig(config);
      set({ config });
    }
    connection?.close();
    stopHeartbeat();
    set({
      connectionState: "connecting",
      lidarFrameCount: 0,
      lidarLastFrameBytes: null,
      lidarFrame: null,
      lidarState: null,
      lastError: null,
      lastEvent: `Connecting to ${config.ip}`
    });

    try {
      connection = await connectGo2Local(config, {
        onStateChange: (connectionState) => set({ connectionState }),
        onVideoTrack: (videoStream) => set({ videoStream, lastEvent: "Camera stream attached" }),
        onValidated: () => {
          enableRobotStreams();
          set({ lastEvent: "Go2 validated; streams enabled" });
        },
        onMessage: (message) => {
          if (message.type === GO2_DATA_CHANNEL_TYPE.VALIDATION) {
            if (message.data === "Validation Ok.") {
              enableRobotStreams();
              set({ lastEvent: "Go2 validation accepted; streams enabled" });
              return;
            }
            if (typeof message.data === "string") {
              connection?.send({
                type: GO2_DATA_CHANNEL_TYPE.VALIDATION,
                topic: "",
                data: validationResponse(message.data)
              });
              set({ lastEvent: "Go2 validation response sent" });
            }
            return;
          }

          if (message.type === GO2_DATA_CHANNEL_TYPE.ERR) {
            set({ lastEvent: "Go2 data channel error event" });
            return;
          }

          if (message.topic === GO2_TOPIC.LIDAR_ARRAY) {
            const frame = normalizeLidarFrame(message.data);
            const byteLength = dataByteLength(message.data);
            set((state) => ({
              lidarFrameCount: state.lidarFrameCount + 1,
              lidarLastFrameBytes: byteLength,
              lidarFrame: frame,
              lastEvent: byteLength ? `LiDAR frame received (${byteLength} bytes)` : "LiDAR frame received"
            }));
            return;
          }

          if (message.topic === GO2_TOPIC.LIDAR_STATE) {
            set({ lidarState: JSON.stringify(message.data), lastEvent: "LiDAR state updated" });
          }
        }
      });
    } catch (error) {
      connection = null;
      stopHeartbeat();
      set({ connectionState: "failed", lastError: messageText(error), lastEvent: "Go2 connection failed" });
    }
  },
  disconnect: () => {
    connection?.close();
    connection = null;
    stopHeartbeat();
    set({
      connectionState: "disconnected",
      videoStream: null,
      lidarFrameCount: 0,
      lidarLastFrameBytes: null,
      lidarFrame: null,
      lidarState: null,
      lastEvent: "Go2 disconnected"
    });
  },
  sendCommand: (command) => {
    if (!connection) {
      set({ lastError: "Go2 is not connected" });
      return;
    }

    if (command.type === "emergency_stop") {
      zeroMove();
      publishRequest(GO2_TOPIC.SPORT_MOD, GO2_SPORT_CMD.StopMove, "{}", true);
      publishRequest(GO2_TOPIC.SPORT_MOD, GO2_SPORT_CMD.Damp, "{}", true);
      set({ emergencyStopped: true, lastEvent: "Emergency stop sent" });
      return;
    }

    if (get().emergencyStopped && command.type !== "damp" && command.type !== "stop_move") {
      set({ lastError: "Emergency stop is active; movement commands are blocked" });
      return;
    }

    if (command.type === "damp") {
      zeroMove();
      publishRequest(GO2_TOPIC.SPORT_MOD, GO2_SPORT_CMD.Damp, "{}", true);
      set({ lastEvent: "Damp sent" });
      return;
    }

    if (command.type === "balance_stand") {
      publishRequest(GO2_TOPIC.SPORT_MOD, GO2_SPORT_CMD.BalanceStand, "{}", false);
      set({ emergencyStopped: false, lastEvent: "Balance stand sent" });
      return;
    }

    if (command.type === "stop_move") {
      zeroMove();
      publishRequest(GO2_TOPIC.SPORT_MOD, GO2_SPORT_CMD.StopMove, "{}", true);
      set({ lastEvent: "Stop move sent" });
      return;
    }

    const durationMs = Math.min(Math.max(command.durationMs, 50), 1000);
    publishMove(bounded(command.vx, 0.35), bounded(command.vy, 0.2), bounded(command.yaw, 0.5));
    if (zeroMoveTimer) {
      clearTimeout(zeroMoveTimer);
    }
    zeroMoveTimer = setTimeout(zeroMove, durationMs);
    set({ lastEvent: `Bounded move sent for ${durationMs}ms` });
  }
}));

export function initializeGo2Store(): void {
  useGo2Store.setState({ config: loadConfig() });
}
