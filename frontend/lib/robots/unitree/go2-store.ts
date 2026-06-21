"use client";

import { create } from "zustand";
import { uploadAndPlayGo2AudioFile } from "./go2-audio-webrtc";
import { connectGo2Local, testGo2Connection } from "./go2-connection";
import { normalizeGo2Ip } from "./go2-config";
import { validationResponse } from "./go2-crypto";
import { GO2_DATA_CHANNEL_TYPE, GO2_SPORT_CMD, GO2_TOPIC } from "./go2-topics";
import type { Go2Command, Go2ConnectionConfig, Go2ConnectionState, Go2LidarFrame, Go2MotorState, Go2RobotPose } from "./go2-types";
import type { Go2WebRtcConnection } from "./go2-webrtc";

const DEFAULT_CONFIG: Go2ConnectionConfig = {
  autoReconnect: false,
  robotId: "go2",
  ip: "192.168.12.1",
  mode: "AP"
};

const CONFIG_STORAGE_KEY = "nemeia.go2.config";
const RUNTIME_SETTINGS_STORAGE_KEY = "nemeia.go2.runtime-settings";

type Go2RuntimeToggle = "audioInput" | "camera" | "lidar" | "microphone" | "obstacleAvoidance" | "speaker";

type Go2RuntimeSettings = {
  audioInputVolume: number;
  cameraEnabled: boolean;
  lidarEnabled: boolean;
  obstacleAvoidanceEnabled: boolean;
  speakerEnabled: boolean;
};

const DEFAULT_RUNTIME_SETTINGS: Go2RuntimeSettings = {
  audioInputVolume: 80,
  cameraEnabled: true,
  lidarEnabled: true,
  obstacleAvoidanceEnabled: false,
  speakerEnabled: true
};

type Go2RobotAudioState = "checking" | "failed" | "idle" | "playing" | "ready" | "uploading";

type Go2Store = {
  config: Go2ConnectionConfig;
  connectionState: Go2ConnectionState;
  audioFileCurrentTime: number;
  audioFileDuration: number;
  audioFileName: string | null;
  audioFileState: "off" | "loading" | "playing" | "paused" | "ready" | "failed";
  audioInputBytesSent: number;
  audioInputLastStatsAt: string | null;
  audioInputMode: "off" | "microphone" | "file";
  audioInputPacketsSent: number;
  audioInputSource: "file" | "microphone" | "none" | "priming";
  audioInputStreaming: boolean;
  audioInputTrackState: "detached" | "ended" | "live";
  audioInputVolume: number;
  robotAudioError: string | null;
  robotAudioState: Go2RobotAudioState;
  audioStream: MediaStream | null;
  batteryPercent: number | null;
  batteryVoltage: number | null;
  cameraEnabled: boolean;
  microphoneEnabled: boolean;
  microphonePermissionState: "unknown" | "requesting" | "granted" | "denied" | "unavailable";
  microphoneState: "off" | "requesting" | "enabled" | "failed";
  videoStream: MediaStream | null;
  lidarEnabled: boolean;
  obstacleAvoidanceEnabled: boolean;
  runtimeTogglePending: Partial<Record<Go2RuntimeToggle, boolean>>;
  speakerEnabled: boolean;
  currentSportMode: string | null;
  lidarFrameCount: number;
  lidarLastFrameBytes: number | null;
  lidarFrame: Go2LidarFrame | null;
  lidarState: string | null;
  robotPose: Go2RobotPose | null;
  robotPoseMessageCount: number;
  robotPoseParseFailureCount: number;
  motorState: Go2MotorState[] | null;
  lastError: string | null;
  lastEvent: string | null;
  emergencyStopped: boolean;
  setConfig: (config: Go2ConnectionConfig) => void;
  testConnection: (configOverride?: Go2ConnectionConfig) => Promise<void>;
  connect: (configOverride?: Go2ConnectionConfig) => Promise<void>;
  disconnect: () => void;
  requestMicrophonePermission: () => Promise<void>;
  sendCommand: (command: Go2Command) => void;
  setCameraEnabled: (enabled: boolean) => Promise<void>;
  setLidarEnabled: (enabled: boolean) => Promise<void>;
  setObstacleAvoidanceEnabled: (enabled: boolean) => Promise<void>;
  setSpeakerEnabled: (enabled: boolean) => Promise<void>;
  setAudioFileInput: (file: File | null) => Promise<void>;
  setAudioFileTime: (seconds: number) => void;
  setAudioFilePlayback: (action: "play" | "pause" | "restart" | "stop") => Promise<void>;
  setAudioInputVolume: (volume: number) => void;
  setMicrophoneEnabled: (enabled: boolean) => Promise<void>;
};

let connection: Go2WebRtcConnection | null = null;
let audioFileSourceFile: File | null = null;
let audioPlaybackToken = 0;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let reconnectAttempt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let manualDisconnect = false;
let zeroMoveTimer: ReturnType<typeof setTimeout> | null = null;
const audioRequestResolvers = new Map<number, (value: unknown) => void>();

function commandRoundTripDelay(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 180);
  });
}

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

function loadRuntimeSettings(): Go2RuntimeSettings {
  if (typeof window === "undefined") {
    return DEFAULT_RUNTIME_SETTINGS;
  }

  const raw = window.localStorage.getItem(RUNTIME_SETTINGS_STORAGE_KEY);
  if (!raw) {
    return DEFAULT_RUNTIME_SETTINGS;
  }

  try {
    return { ...DEFAULT_RUNTIME_SETTINGS, ...(JSON.parse(raw) as Partial<Go2RuntimeSettings>) };
  } catch {
    return DEFAULT_RUNTIME_SETTINGS;
  }
}

function persistRuntimeSettings(settings: Go2RuntimeSettings): void {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(RUNTIME_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  }
}

function currentRuntimeSettings(overrides: Partial<Go2RuntimeSettings> = {}): Go2RuntimeSettings {
  const state = useGo2Store.getState();
  return {
    audioInputVolume: state.audioInputVolume,
    cameraEnabled: state.cameraEnabled,
    lidarEnabled: state.lidarEnabled,
    obstacleAvoidanceEnabled: state.obstacleAvoidanceEnabled,
    speakerEnabled: state.speakerEnabled,
    ...overrides
  };
}

function clearReconnectTimer(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function stopAudioFileInput(): void {
  audioFileSourceFile = null;
}

function reconnectDelayMs(): number {
  return Math.min(30_000, 1000 * 2 ** reconnectAttempt);
}

function scheduleReconnect(reason: string): void {
  const store = useGo2Store.getState();
  if (manualDisconnect || !store.config.autoReconnect || reconnectTimer) {
    return;
  }

  const delayMs = reconnectDelayMs();
  reconnectAttempt += 1;
  useGo2Store.setState({ lastEvent: `${reason}; reconnecting in ${Math.round(delayMs / 1000)}s` });
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (manualDisconnect || !useGo2Store.getState().config.autoReconnect) {
      return;
    }
    void useGo2Store.getState().connect();
  }, delayMs);
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

function publishRequest(topic: string, apiId: number, parameter = "{}", priority = false): number | null {
  if (!connection) {
    return null;
  }

  const id = Math.floor(Math.random() * 2147483647);
  connection.send({
    type: GO2_DATA_CHANNEL_TYPE.REQUEST,
    topic,
    data: {
      header: {
        identity: {
          id,
          api_id: apiId
        },
        ...(priority ? { policy: { priority: 1 } } : {})
      },
      parameter,
      binary: []
    }
  });
  return id;
}

function publishAudioRequest(apiId: number, parameter = "{}"): Promise<unknown> {
  return new Promise((resolve) => {
    const id = publishRequest(GO2_TOPIC.AUDIOHUB, apiId, parameter, false);
    if (id === null) {
      resolve(null);
      return;
    }

    let settled = false;
    const settle = (value: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(value);
    };
    const timer = setTimeout(() => {
      audioRequestResolvers.delete(id);
      settle(null);
    }, 10_000);
    audioRequestResolvers.set(id, (value) => {
      clearTimeout(timer);
      settle(value);
    });
  });
}

function resolveAudioRequest(data: unknown): boolean {
  if (!data || typeof data !== "object") {
    return false;
  }

  const envelope = data as { data?: unknown; header?: { identity?: { id?: unknown } } };
  const id = Number(envelope.header?.identity?.id);
  if (!Number.isFinite(id)) {
    return false;
  }

  const resolver = audioRequestResolvers.get(id);
  if (!resolver) {
    return false;
  }

  audioRequestResolvers.delete(id);
  resolver(envelope.data);
  return true;
}

function publishMove(vx: number, vy: number, yaw: number): void {
  publishJoystick(vy, vx, yaw, 0, 0);
}

function publishJoystick(lx: number, ly: number, rx: number, ry: number, keys = 0): void {
  connection?.send({
    type: GO2_DATA_CHANNEL_TYPE.MSG,
    topic: GO2_TOPIC.WIRELESS_CONTROLLER,
    data: {
      lx,
      ly,
      rx,
      ry,
      keys
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

function audiohubErrorText(error: unknown): string {
  const text = messageText(error);
  if (text.includes("did not appear in the robot audio list")) {
    return `${text} Check that the Go2 is connected through WebRTC and AudioHub is accepting uploads.`;
  }

  return text;
}

function microphoneErrorText(error: unknown): string {
  if (error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError")) {
    return "Microphone permission denied.";
  }

  if (error instanceof DOMException && error.name === "NotFoundError") {
    return "No microphone device was found by the browser.";
  }

  return messageText(error);
}

async function requestBrowserMicrophone(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Microphone access is unavailable.");
  }

  return navigator.mediaDevices.getUserMedia({ audio: true, video: false });
}

function enableRobotStreams(): void {
  if (!connection) {
    return;
  }

  const { cameraEnabled, lidarEnabled, obstacleAvoidanceEnabled, speakerEnabled } = useGo2Store.getState();
  startHeartbeat();
  connection.send({ type: GO2_DATA_CHANNEL_TYPE.VID, topic: "", data: cameraEnabled ? "on" : "off" });
  connection.send({ type: GO2_DATA_CHANNEL_TYPE.AUD, topic: "", data: speakerEnabled ? "on" : "off" });
  for (const topic of [
    GO2_TOPIC.LOW_STATE,
    GO2_TOPIC.SPORT_MODE_STATE,
    GO2_TOPIC.ROBOT_ODOM,
    GO2_TOPIC.USLAM_ODOM,
    GO2_TOPIC.USLAM_LOC_ODOM,
    GO2_TOPIC.LIDAR_ARRAY,
    GO2_TOPIC.LIDAR_STATE
  ]) {
    connection.send({ type: GO2_DATA_CHANNEL_TYPE.SUBSCRIBE, topic });
  }
  publishLidarSwitch(lidarEnabled);
  publishRequest(GO2_TOPIC.OBSTACLES_AVOID, 1001, JSON.stringify({ enable: obstacleAvoidanceEnabled }), false);
  if (speakerEnabled) {
    void connection.primeAudioInput();
  }
}

function publishCameraSwitch(enabled: boolean): void {
  connection?.send({ type: GO2_DATA_CHANNEL_TYPE.VID, topic: "", data: enabled ? "on" : "off" });
}

function publishSpeakerSwitch(enabled: boolean): void {
  connection?.send({ type: GO2_DATA_CHANNEL_TYPE.AUD, topic: "", data: enabled ? "on" : "off" });
}

function publishLidarSwitch(enabled: boolean): void {
  const state = enabled ? "ON" : "OFF";
  const repeatCount = enabled ? 5 : 1;
  for (let i = 0; i < repeatCount; i += 1) {
    setTimeout(() => {
      connection?.send({ type: GO2_DATA_CHANNEL_TYPE.MSG, topic: GO2_TOPIC.LIDAR_SWITCH, data: state });
    }, i * 100);
  }
}

function setRuntimeTogglePending(toggle: Go2RuntimeToggle, pending: boolean): void {
  useGo2Store.setState((state) => ({
    runtimeTogglePending: {
      ...state.runtimeTogglePending,
      [toggle]: pending
    }
  }));
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

function boundedBatteryPercent(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

function normalizeLowStateBattery(data: unknown): { batteryPercent?: number; batteryVoltage?: number } | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const record = data as Record<string, unknown>;
  const bmsState = record.bms_state;
  const battery: { batteryPercent?: number; batteryVoltage?: number } = {};

  if (bmsState && typeof bmsState === "object") {
    const bms = bmsState as Record<string, unknown>;
    if (typeof bms.soc === "number" && Number.isFinite(bms.soc)) {
      battery.batteryPercent = boundedBatteryPercent(bms.soc);
    }
  }

  if (typeof record.power_v === "number" && Number.isFinite(record.power_v)) {
    battery.batteryVoltage = record.power_v;
  }

  return battery.batteryPercent === undefined && battery.batteryVoltage === undefined ? null : battery;
}

function normalizeLowStateMotors(data: unknown): Go2MotorState[] | null {
  if (!data || typeof data !== "object") {
    return null;
  }

  const record = data as Record<string, unknown>;
  const motors = record.motor_state ?? record.motorState;
  if (!Array.isArray(motors)) {
    return null;
  }

  const normalized = motors
    .map((motor) => {
      if (!motor || typeof motor !== "object") {
        return null;
      }
      const q = Number((motor as Record<string, unknown>).q);
      return Number.isFinite(q) ? { q } : null;
    })
    .filter((motor): motor is Go2MotorState => motor !== null);

  return normalized.length >= 12 ? normalized.slice(0, 12) : null;
}

function normalizeSportMode(data: unknown): string | null {
  if (typeof data === "string") {
    const trimmed = data.trim();
    if (!trimmed) {
      return null;
    }

    try {
      return normalizeSportMode(JSON.parse(trimmed) as unknown) ?? trimmed;
    } catch {
      return trimmed;
    }
  }

  if (!data || typeof data !== "object") {
    return null;
  }

  const record = data as Record<string, unknown>;
  const directLabel = record.modeName ?? record.mode_name ?? record.gaitName ?? record.gait_name ?? record.name;
  if (typeof directLabel === "string" && directLabel.trim()) {
    return directLabel.trim();
  }

  const mode = record.mode ?? record.sportMode ?? record.sport_mode;
  const gait = record.gaitType ?? record.gait_type ?? record.gait;
  const parts: string[] = [];
  if (typeof mode === "number" && Number.isFinite(mode)) {
    parts.push(`mode ${mode}`);
  } else if (typeof mode === "string" && mode.trim()) {
    parts.push(mode.trim());
  }
  if (typeof gait === "number" && Number.isFinite(gait)) {
    parts.push(`gait ${gait}`);
  } else if (typeof gait === "string" && gait.trim()) {
    parts.push(gait.trim());
  }

  return parts.length > 0 ? parts.join(" · ") : null;
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

function unwrapRobotPosePayload(data: unknown): unknown {
  let current = data;
  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof current === "string") {
      try {
        current = JSON.parse(current) as unknown;
        continue;
      } catch {
        return current;
      }
    }

    if (current && typeof current === "object" && "data" in current) {
      current = (current as { data?: unknown }).data;
      continue;
    }

    break;
  }

  return current;
}

function vectorRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function normalizeRobotPose(data: unknown): Go2RobotPose | null {
  const payload = vectorRecord(unwrapRobotPosePayload(data));
  if (!payload) {
    return null;
  }

  const nestedPose = vectorRecord(vectorRecord(payload.pose)?.pose);
  const directPose = vectorRecord(payload.pose);
  const pose = nestedPose ?? directPose ?? payload;
  const position = vectorRecord(pose.position) ?? vectorRecord(payload.position);
  const orientation = vectorRecord(pose.orientation) ?? vectorRecord(payload.orientation);

  const x = Number(position?.x ?? payload.x);
  const y = Number(position?.y ?? payload.y);
  const z = Number(position?.z ?? payload.z ?? 0);
  const qx = Number(orientation?.x ?? payload.qx ?? payload.ox ?? 0);
  const qy = Number(orientation?.y ?? payload.qy ?? payload.oy ?? 0);
  const qz = Number(orientation?.z ?? payload.qz ?? payload.oz ?? 0);
  const qw = Number(orientation?.w ?? payload.qw ?? payload.ow ?? 1);
  if (![x, y, z, qx, qy, qz, qw].every(Number.isFinite)) {
    return null;
  }

  return {
    x,
    y,
    z,
    yaw: Math.atan2(2 * (qw * qz + qx * qy), 1 - 2 * (qy * qy + qz * qz))
  };
}

export const useGo2Store = create<Go2Store>((set, get) => ({
  config: DEFAULT_CONFIG,
  connectionState: "idle",
  audioFileCurrentTime: 0,
  audioFileDuration: 0,
  audioFileName: null,
  audioFileState: "off",
  audioInputBytesSent: 0,
  audioInputLastStatsAt: null,
  audioInputMode: "off",
  audioInputPacketsSent: 0,
  audioInputSource: "none",
  audioInputStreaming: false,
  audioInputTrackState: "detached",
  audioInputVolume: 80,
  robotAudioError: null,
  robotAudioState: "idle",
  audioStream: null,
  batteryPercent: null,
  batteryVoltage: null,
  cameraEnabled: true,
  microphoneEnabled: false,
  microphonePermissionState: "unknown",
  microphoneState: "off",
  videoStream: null,
  lidarEnabled: true,
  obstacleAvoidanceEnabled: false,
  runtimeTogglePending: {},
  speakerEnabled: true,
  currentSportMode: null,
  lidarFrameCount: 0,
  lidarLastFrameBytes: null,
  lidarFrame: null,
  lidarState: null,
  robotPose: null,
  robotPoseMessageCount: 0,
  robotPoseParseFailureCount: 0,
  motorState: null,
  lastError: null,
  lastEvent: null,
  emergencyStopped: false,
  setConfig: (config) => {
    const normalizedConfig = { ...config, ip: normalizeGo2Ip(config.ip) };
    persistConfig(normalizedConfig);
    set({ config: normalizedConfig });
    if (!normalizedConfig.autoReconnect) {
      clearReconnectTimer();
      reconnectAttempt = 0;
    }
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
    clearReconnectTimer();
    manualDisconnect = false;
    if (connection) {
      manualDisconnect = true;
      connection.close();
      manualDisconnect = false;
    }
    stopHeartbeat();
    set({
      connectionState: "connecting",
      audioFileCurrentTime: 0,
      audioFileDuration: 0,
      audioFileName: null,
      audioFileState: "off",
      audioInputBytesSent: 0,
      audioInputLastStatsAt: null,
      audioInputMode: "off",
      audioInputPacketsSent: 0,
      audioInputSource: "none",
      audioInputStreaming: false,
      audioInputTrackState: "detached",
      audioInputVolume: get().audioInputVolume,
      robotAudioError: null,
      robotAudioState: "checking",
      audioStream: null,
      batteryPercent: null,
      batteryVoltage: null,
      microphoneEnabled: false,
      microphoneState: "off",
      runtimeTogglePending: {},
      currentSportMode: null,
      lidarFrameCount: 0,
      lidarLastFrameBytes: null,
      lidarFrame: null,
      lidarState: null,
      robotPose: null,
      robotPoseMessageCount: 0,
      robotPoseParseFailureCount: 0,
      motorState: null,
      lastError: null,
      lastEvent: `Connecting to ${config.ip}`
    });

    try {
      connection = await connectGo2Local(config, {
        onAudioInputStats: (stats) => {
          set({
            audioInputBytesSent: stats.bytesSent,
            audioInputLastStatsAt: new Date().toISOString(),
            audioInputPacketsSent: stats.packetsSent,
            audioInputSource: stats.source,
            audioInputStreaming: stats.streaming,
            audioInputTrackState: stats.trackState
          });
        },
        onStateChange: (connectionState) => {
          set({ connectionState });
          if (connectionState === "connected") {
            reconnectAttempt = 0;
            clearReconnectTimer();
            enableRobotStreams();
            set({ robotAudioError: null, robotAudioState: get().audioFileName ? "ready" : "idle" });
            set({ lastEvent: "Go2 connected; streams enabled" });
            return;
          }
          if (connectionState === "failed" || connectionState === "disconnected") {
            stopHeartbeat();
            set({
              audioInputBytesSent: 0,
              audioInputLastStatsAt: null,
              audioInputPacketsSent: 0,
              audioInputSource: "none",
              audioInputStreaming: false,
              audioInputTrackState: "detached",
              audioStream: null,
              robotAudioError: null,
              robotAudioState: "idle",
              microphoneEnabled: false,
              microphoneState: "off",
              videoStream: null
            });
            scheduleReconnect(`Go2 ${connectionState}`);
          }
        },
        onAudioTrack: (audioStream) => set({ audioStream, lastEvent: "Speaker stream attached" }),
        onVideoTrack: (videoStream) => set({ videoStream, lastEvent: "Camera stream attached" }),
        onValidated: () => {
          enableRobotStreams();
          set({ lastEvent: "Go2 validated; streams enabled" });
        },
        onMessage: (message) => {
          if (message.topic === GO2_TOPIC.AUDIOHUB_RESPONSE) {
            resolveAudioRequest(message.data);
            return;
          }

          if (message.topic === GO2_TOPIC.AUDIOHUB_PLAYER_STATE) {
            set({ lastEvent: "Go2 AudioHub player state updated" });
            return;
          }

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
            if (!get().lidarEnabled) {
              return;
            }
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

          if (message.topic === GO2_TOPIC.LOW_STATE) {
            const battery = normalizeLowStateBattery(message.data);
            const motorState = normalizeLowStateMotors(message.data);
            if (battery) {
              set({
                ...battery,
                ...(motorState ? { motorState } : {}),
                lastEvent:
                  battery.batteryPercent === undefined
                    ? "Go2 low state updated"
                    : `Go2 battery ${battery.batteryPercent}%`
              });
            } else if (motorState) {
              set({ motorState, lastEvent: "Go2 motor state updated" });
            }
            return;
          }

          if (message.topic === GO2_TOPIC.SPORT_MODE_STATE) {
            const currentSportMode = normalizeSportMode(message.data);
            set({ currentSportMode, lastEvent: currentSportMode ? `Go2 mode ${currentSportMode}` : "Go2 sport mode updated" });
            return;
          }

          if (message.topic === GO2_TOPIC.LIDAR_STATE) {
            if (!get().lidarEnabled) {
              return;
            }
            set({ lidarState: JSON.stringify(message.data), lastEvent: "LiDAR state updated" });
            return;
          }

          if (message.topic === GO2_TOPIC.ROBOT_ODOM || message.topic === GO2_TOPIC.USLAM_ODOM || message.topic === GO2_TOPIC.USLAM_LOC_ODOM) {
            const robotPose = normalizeRobotPose(message.data);
            if (robotPose) {
              set((state) => ({ robotPose, robotPoseMessageCount: state.robotPoseMessageCount + 1, lastEvent: "Go2 pose updated" }));
            } else {
              set((state) => ({ robotPoseMessageCount: state.robotPoseMessageCount + 1, robotPoseParseFailureCount: state.robotPoseParseFailureCount + 1 }));
            }
            return;
          }
        }
      }, (nextConnection) => {
        connection = nextConnection;
      });
      if (get().connectionState === "connected") {
        enableRobotStreams();
        set({ robotAudioError: null, robotAudioState: get().audioFileName ? "ready" : "idle" });
        set({ lastEvent: "Go2 connected; streams enabled" });
      }
    } catch (error) {
      connection = null;
      stopHeartbeat();
      set({ connectionState: "failed", lastError: messageText(error), lastEvent: "Go2 connection failed" });
      scheduleReconnect("Go2 connection failed");
    }
  },
  disconnect: () => {
    manualDisconnect = true;
    clearReconnectTimer();
    reconnectAttempt = 0;
    audioRequestResolvers.clear();
    stopAudioFileInput();
    connection?.close();
    connection = null;
    stopHeartbeat();
    manualDisconnect = false;
    set({
      connectionState: "disconnected",
      audioFileCurrentTime: 0,
      audioFileDuration: 0,
      audioFileName: null,
      audioFileState: "off",
      audioInputBytesSent: 0,
      audioInputLastStatsAt: null,
      audioInputMode: "off",
      audioInputPacketsSent: 0,
      audioInputSource: "none",
      audioInputStreaming: false,
      audioInputTrackState: "detached",
      audioInputVolume: get().audioInputVolume,
      robotAudioError: null,
      robotAudioState: "idle",
      audioStream: null,
      batteryPercent: null,
      batteryVoltage: null,
      microphoneEnabled: false,
      microphoneState: "off",
      runtimeTogglePending: {},
      currentSportMode: null,
      videoStream: null,
      lidarFrameCount: 0,
      lidarLastFrameBytes: null,
      lidarFrame: null,
      lidarState: null,
      robotPose: null,
      robotPoseMessageCount: 0,
      robotPoseParseFailureCount: 0,
      motorState: null,
      lastEvent: "Go2 disconnected"
    });
  },
  requestMicrophonePermission: async () => {
    set({ lastError: null, microphonePermissionState: "requesting" });
    try {
      const stream = await requestBrowserMicrophone();
      stream.getTracks().forEach((track) => track.stop());
      set({ lastEvent: "Microphone permission granted", microphonePermissionState: "granted" });
    } catch (error) {
      const unavailable = !(navigator.mediaDevices?.getUserMedia);
      set({
        lastError: microphoneErrorText(error),
        microphonePermissionState: unavailable ? "unavailable" : "denied",
        lastEvent: "Microphone permission failed"
      });
    }
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

    if (get().emergencyStopped && command.type !== "damp" && command.type !== "stop_move" && command.type !== "obstacle_avoidance") {
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

    if (command.type === "obstacle_avoidance") {
      publishRequest(GO2_TOPIC.OBSTACLES_AVOID, 1001, JSON.stringify({ enable: command.enabled }), false);
      persistRuntimeSettings(currentRuntimeSettings({ obstacleAvoidanceEnabled: command.enabled }));
      set({ obstacleAvoidanceEnabled: command.enabled, lastEvent: `Obstacle avoidance ${command.enabled ? "enabled" : "disabled"}` });
      return;
    }

    if (command.type === "joystick") {
      publishJoystick(
        bounded(command.lx, 1),
        bounded(command.ly, 1),
        bounded(command.rx, 1),
        bounded(command.ry, 1),
        Math.max(0, Math.floor(command.keys ?? 0))
      );
      set({ lastEvent: "Joystick frame sent" });
      return;
    }

    if (command.type === "sport_request") {
      publishRequest(GO2_TOPIC.SPORT_MOD, command.apiId, command.parameter ?? "{}", Boolean(command.priority));
      set({
        currentSportMode: command.modeLabel ?? get().currentSportMode,
        lastEvent: `${command.label} sent`
      });
      return;
    }

    const durationMs = Math.min(Math.max(command.durationMs, 50), 1000);
    publishMove(bounded(command.vx, 0.35), bounded(command.vy, 0.2), bounded(command.yaw, 0.5));
    if (zeroMoveTimer) {
      clearTimeout(zeroMoveTimer);
    }
    zeroMoveTimer = setTimeout(zeroMove, durationMs);
    set({ lastEvent: `Bounded move sent for ${durationMs}ms` });
  },
  setCameraEnabled: async (enabled) => {
    if (get().connectionState !== "connected") {
      set({ lastError: "Go2 is not connected" });
      return;
    }

    setRuntimeTogglePending("camera", true);
    publishCameraSwitch(enabled);
    await commandRoundTripDelay();
    persistRuntimeSettings(currentRuntimeSettings({ cameraEnabled: enabled }));
    set({
      cameraEnabled: enabled,
      runtimeTogglePending: { ...get().runtimeTogglePending, camera: false },
      lastEvent: `Front camera stream ${enabled ? "enabled" : "disabled"}`
    });
  },
  setLidarEnabled: async (enabled) => {
    if (get().connectionState !== "connected") {
      set({ lastError: "Go2 is not connected" });
      return;
    }

    setRuntimeTogglePending("lidar", true);
    publishLidarSwitch(enabled);
    await commandRoundTripDelay();
    persistRuntimeSettings(currentRuntimeSettings({ lidarEnabled: enabled }));
    set({
      lidarEnabled: enabled,
      lidarFrame: enabled ? get().lidarFrame : null,
      lidarFrameCount: enabled ? get().lidarFrameCount : 0,
      lidarLastFrameBytes: enabled ? get().lidarLastFrameBytes : null,
      lidarState: enabled ? get().lidarState : null,
      runtimeTogglePending: { ...get().runtimeTogglePending, lidar: false },
      lastEvent: `LiDAR stream ${enabled ? "enabled" : "disabled"}`
    });
  },
  setObstacleAvoidanceEnabled: async (enabled) => {
    if (get().connectionState !== "connected") {
      set({ lastError: "Go2 is not connected" });
      return;
    }

    setRuntimeTogglePending("obstacleAvoidance", true);
    publishRequest(GO2_TOPIC.OBSTACLES_AVOID, 1001, JSON.stringify({ enable: enabled }), false);
    await commandRoundTripDelay();
    persistRuntimeSettings(currentRuntimeSettings({ obstacleAvoidanceEnabled: enabled }));
    set({
      obstacleAvoidanceEnabled: enabled,
      runtimeTogglePending: { ...get().runtimeTogglePending, obstacleAvoidance: false },
      lastEvent: `Obstacle avoidance ${enabled ? "enabled" : "disabled"}`
    });
  },
  setSpeakerEnabled: async (enabled) => {
    if (get().connectionState !== "connected") {
      set({ lastError: "Go2 is not connected" });
      return;
    }

    setRuntimeTogglePending("speaker", true);
    publishSpeakerSwitch(enabled);
    await commandRoundTripDelay();
    persistRuntimeSettings(currentRuntimeSettings({ speakerEnabled: enabled }));
    set({
      speakerEnabled: enabled,
      audioStream: enabled ? get().audioStream : null,
      runtimeTogglePending: { ...get().runtimeTogglePending, speaker: false },
      lastEvent: `Speaker stream ${enabled ? "enabled" : "disabled"}`
    });
  },
  setAudioFileInput: async (file) => {
    stopAudioFileInput();
    if (!connection) {
      set({ audioFileCurrentTime: 0, audioFileDuration: 0, audioFileName: null, audioFileState: "off", audioInputMode: "off", lastError: "Go2 is not connected" });
      return;
    }

    setRuntimeTogglePending("audioInput", true);
    if (!file) {
      await commandRoundTripDelay();
      set({
        audioFileCurrentTime: 0,
        audioFileDuration: 0,
        audioFileName: null,
        audioFileState: "off",
        audioInputMode: "off",
        robotAudioState: "idle",
        runtimeTogglePending: { ...get().runtimeTogglePending, audioInput: false },
        lastEvent: "Audio file detached"
      });
      return;
    }

    audioFileSourceFile = file;
    set({
      audioFileCurrentTime: 0,
      audioFileDuration: 0,
      audioFileName: file.name,
      audioFileState: "ready",
      audioInputMode: "file",
      microphoneEnabled: false,
      microphoneState: "off",
      lastError: null,
      robotAudioError: null,
      robotAudioState: "ready",
      runtimeTogglePending: { ...get().runtimeTogglePending, audioInput: false },
      lastEvent: `${file.name} staged for Go2 playback`
    });
  },
  setAudioFileTime: (seconds) => {
    set({ audioFileCurrentTime: Math.max(0, seconds) });
  },
  setAudioFilePlayback: async (action) => {
    if (!connection) {
      set({ lastError: "Go2 is not connected" });
      return;
    }

    if (action === "stop") {
      if (get().audioFileState !== "playing" && get().audioFileState !== "paused" && get().audioFileState !== "ready" && get().audioFileState !== "loading") {
        return;
      }

      setRuntimeTogglePending("audioInput", true);
      audioPlaybackToken += 1;
      stopAudioFileInput();
      void publishAudioRequest(1003, "{}");
      await commandRoundTripDelay();
      set({
        audioFileCurrentTime: 0,
        audioFileDuration: 0,
        audioFileName: null,
        audioFileState: "off",
        audioInputMode: "off",
        robotAudioState: "idle",
        runtimeTogglePending: { ...get().runtimeTogglePending, audioInput: false },
        lastEvent: "Audio file stopped"
      });
      return;
    }

    if (!get().audioFileName) {
      set({ audioFileCurrentTime: 0, audioFileDuration: 0, audioFileState: "off", audioInputMode: "off", lastError: "No audio file is loaded" });
      return;
    }

    if (action === "pause") {
      audioPlaybackToken += 1;
      await publishAudioRequest(1003, "{}");
      set({ audioFileState: "paused", robotAudioState: "ready", lastEvent: "Go2 AudioHub stop sent" });
      return;
    }

    try {
      if (action === "play" || action === "restart") {
        if (!audioFileSourceFile) {
          set({ lastError: "Choose the audio file again to play it on Go2." });
          return;
        }

        setRuntimeTogglePending("audioInput", true);
        set({
          audioFileState: "loading",
          audioInputMode: "file",
          robotAudioState: "uploading",
          lastEvent: `${action === "restart" ? "Resubmitting" : "Submitting"} ${get().audioFileName ?? "audio file"} to Go2 AudioHub`
        });
        const result = await uploadAndPlayGo2AudioFile(audioFileSourceFile, {
          publishAudioRequest,
          onProgress: (progress) => {
            set({ lastEvent: `Uploading audio to Go2 AudioHub ${progress}%` });
          }
        });
        set({
          audioFileDuration: result.durationSeconds,
          audioFileState: "playing",
          robotAudioError: null,
          robotAudioState: "playing",
          runtimeTogglePending: { ...get().runtimeTogglePending, audioInput: false },
          lastError: null,
          lastEvent: `Go2 AudioHub playing ${result.name}`
        });
        const playbackToken = audioPlaybackToken + 1;
        audioPlaybackToken = playbackToken;
        setTimeout(() => {
          const state = useGo2Store.getState();
          if (audioPlaybackToken === playbackToken && state.audioFileState === "playing" && state.robotAudioState === "playing") {
            void publishAudioRequest(1003, JSON.stringify({ unique_id: result.uniqueId }));
            useGo2Store.setState({ audioFileState: "ready", robotAudioState: "ready", lastEvent: "Go2 AudioHub playback finished" });
          }
        }, Math.max(500, result.durationSeconds * 1000 + 500));
        return;
      }
    } catch (error) {
      const errorText = audiohubErrorText(error);
      set({
        audioFileState: "failed",
        audioInputMode: "file",
        robotAudioError: errorText,
        robotAudioState: "failed",
        runtimeTogglePending: { ...get().runtimeTogglePending, audioInput: false },
        lastError: errorText,
        lastEvent: "Go2 AudioHub playback failed"
      });
    }
  },
  setAudioInputVolume: (volume) => {
    const nextVolume = Math.min(Math.max(Math.round(volume), 0), 100);
    persistRuntimeSettings(currentRuntimeSettings({ audioInputVolume: nextVolume }));
    connection?.setAudioInputVolume(nextVolume / 100);
    if (connection) {
      const robotVolume = Math.max(0, Math.min(10, Math.round(nextVolume / 10)));
      publishRequest(GO2_TOPIC.VUI, 1003, JSON.stringify({ volume: robotVolume }));
    }
    set({ audioInputVolume: nextVolume, lastEvent: `Robot audio volume ${nextVolume}%` });
  },
  setMicrophoneEnabled: async (enabled) => {
    if (!connection) {
      set({ lastError: "Go2 is not connected", microphoneEnabled: false, microphoneState: "off" });
      return;
    }

    stopAudioFileInput();
    setRuntimeTogglePending("microphone", true);
    set({ lastError: null, microphoneState: enabled ? "requesting" : "off" });
    try {
      connection.setAudioInputVolume(get().audioInputVolume / 100);
      await connection.setMicrophoneEnabled(enabled);
      set({
        audioFileName: null,
        audioFileState: "off",
        audioInputMode: enabled ? "microphone" : "off",
        microphoneEnabled: enabled,
        microphonePermissionState: enabled ? "granted" : get().microphonePermissionState,
        microphoneState: enabled ? "enabled" : "off",
        runtimeTogglePending: { ...get().runtimeTogglePending, microphone: false },
        lastEvent: enabled ? "Microphone attached" : "Microphone detached"
      });
    } catch (error) {
      const permissionDenied = error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError");
      set({
        lastError: microphoneErrorText(error),
        microphoneEnabled: false,
        microphonePermissionState: permissionDenied ? "denied" : get().microphonePermissionState,
        microphoneState: "failed",
        runtimeTogglePending: { ...get().runtimeTogglePending, microphone: false },
        lastEvent: "Microphone failed"
      });
    }
  }
}));

export function initializeGo2Store(): void {
  useGo2Store.setState({ config: loadConfig(), ...loadRuntimeSettings() });
}
