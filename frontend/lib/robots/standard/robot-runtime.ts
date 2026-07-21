"use client";

import { initializeGo2Store, useGo2Store } from "../unitree/go2-store";
import { GO2_MODE_ACTIONS, GO2_PRIMARY_ACTIONS, GO2_TRICK_ACTIONS } from "../unitree/go2-control-actions";
import type { Go2LidarFrame, Go2MotorState, Go2RobotPose } from "../unitree/go2-types";
import { installRuntimeCommandRecorder, recordRobotRuntimeCommand } from "./robot-runtime-recorder";
import type { RobotRuntimeCommand } from "./robot-runtime-recorder";

export type RobotConnectionState = "connected" | "connecting" | "disconnected" | "failed" | "idle" | "testing";
export type RobotConnectionMode = "AP" | "STA-L";

export type RobotConnectionConfig = {
  autoReconnect: boolean;
  ip: string;
  mode: RobotConnectionMode;
  robotId: string;
};

export type RobotRuntimeSnapshot = {
  audioFileCurrentTime: number;
  audioFileDuration: number;
  audioFileName: string | null;
  audioFileState: "failed" | "loading" | "off" | "paused" | "playing" | "ready";
  audioInputBytesSent: number | null;
  audioInputLastStatsAt: string | null;
  audioInputMode: "file" | "microphone" | "off";
  audioInputPacketsSent: number | null;
  audioInputSource: "file" | "microphone" | "none" | "priming";
  audioInputStreaming: boolean;
  audioInputTrackState: "detached" | "ended" | "live";
  audioInputVolume: number;
  audioStream: MediaStream | null;
  batteryPercent: number | null;
  batteryVoltage: number | null;
  cameraEnabled: boolean;
  config: RobotConnectionConfig;
  connectionState: RobotConnectionState;
  driverMode: string | null;
  emergencyStopped: boolean;
  lastError: string | null;
  lastEvent: string | null;
  lidarEnabled: boolean;
  lidarFrame: Go2LidarFrame | null;
  lidarFrameCount: number;
  lidarLastFrameBytes: number | null;
  lidarState: string | null;
  microphoneEnabled: boolean;
  microphonePermissionState: "denied" | "granted" | "requesting" | "unknown" | "unavailable";
  microphoneState: "enabled" | "failed" | "off" | "requesting";
  motorState: Go2MotorState[] | null;
  robotAudioError: string | null;
  robotAudioState: "checking" | "failed" | "idle" | "playing" | "ready" | "uploading";
  robotPose: Go2RobotPose | null;
  robotPoseMessageCount: number;
  robotPoseParseFailureCount: number;
  runtimePending: {
    audioInput: boolean;
    camera: boolean;
    lidar: boolean;
    obstacleAvoidance: boolean;
    speaker: boolean;
  };
  obstacleAvoidanceEnabled: boolean;
  speakerEnabled: boolean;
  videoStream: MediaStream | null;
};

export type RobotControllerState = {
  keys?: number;
  lx: number;
  ly: number;
  rx: number;
  ry: number;
};

export type { RobotRuntimeCommand };

export type RobotNativeAction = {
  apiId: number;
  label: string;
  modeLabel?: string;
  parameter?: string;
  priority?: boolean;
  role?: "mode";
};

export const ROBOT_PRIMARY_ACTIONS: RobotNativeAction[] = GO2_PRIMARY_ACTIONS.map(toRobotAction);
export const ROBOT_MODE_ACTIONS: RobotNativeAction[] = GO2_MODE_ACTIONS.map(toRobotAction);
export const ROBOT_NATIVE_ACTIONS: RobotNativeAction[] = GO2_TRICK_ACTIONS.map(toRobotAction);

export function initializeRobotRuntime(): void {
  initializeGo2Store();
  installRuntimeCommandRecorder();
}

export function useRobotRuntime(): RobotRuntimeSnapshot & {
  connect: () => Promise<void>;
  connectWithConfig: (config: RobotConnectionConfig) => Promise<void>;
  disconnect: () => void;
  enterDampState: () => void;
  enterStandState: () => void;
  emergencyStop: () => void;
  sendControllerState: (state: RobotControllerState) => void;
  sendNativeAction: (action: RobotNativeAction) => void;
  setAudioFileInput: (file: File | null) => Promise<void>;
  setAudioFilePlayback: (action: "pause" | "play" | "restart" | "stop") => Promise<void>;
  setAudioInputVolume: (volume: number) => void;
  setCameraEnabled: (enabled: boolean) => Promise<void>;
  setConfig: (config: RobotConnectionConfig) => void;
  setLidarEnabled: (enabled: boolean) => Promise<void>;
  setObstacleAvoidance: (enabled: boolean) => void;
  setObstacleAvoidanceEnabled: (enabled: boolean) => Promise<void>;
  setSpeakerEnabled: (enabled: boolean) => Promise<void>;
  stopMotion: () => void;
  testConnection: (config?: RobotConnectionConfig) => Promise<void>;
} {
  const audioFileCurrentTime = useGo2Store((state) => state.audioFileCurrentTime);
  const audioFileDuration = useGo2Store((state) => state.audioFileDuration);
  const audioFileName = useGo2Store((state) => state.audioFileName);
  const audioFileState = useGo2Store((state) => state.audioFileState);
  const audioInputBytesSent = useGo2Store((state) => state.audioInputBytesSent);
  const audioInputLastStatsAt = useGo2Store((state) => state.audioInputLastStatsAt);
  const audioInputMode = useGo2Store((state) => state.audioInputMode);
  const audioInputPacketsSent = useGo2Store((state) => state.audioInputPacketsSent);
  const audioInputSource = useGo2Store((state) => state.audioInputSource);
  const audioInputStreaming = useGo2Store((state) => state.audioInputStreaming);
  const audioInputTrackState = useGo2Store((state) => state.audioInputTrackState);
  const audioInputVolume = useGo2Store((state) => state.audioInputVolume);
  const audioStream = useGo2Store((state) => state.audioStream);
  const batteryPercent = useGo2Store((state) => state.batteryPercent);
  const batteryVoltage = useGo2Store((state) => state.batteryVoltage);
  const cameraEnabled = useGo2Store((state) => state.cameraEnabled);
  const config = useGo2Store((state) => state.config);
  const connectionState = useGo2Store((state) => state.connectionState);
  const driverMode = useGo2Store((state) => state.currentSportMode);
  const emergencyStopped = useGo2Store((state) => state.emergencyStopped);
  const lastError = useGo2Store((state) => state.lastError);
  const lastEvent = useGo2Store((state) => state.lastEvent);
  const lidarEnabled = useGo2Store((state) => state.lidarEnabled);
  const lidarFrame = useGo2Store((state) => state.lidarFrame);
  const lidarFrameCount = useGo2Store((state) => state.lidarFrameCount);
  const lidarLastFrameBytes = useGo2Store((state) => state.lidarLastFrameBytes);
  const lidarState = useGo2Store((state) => state.lidarState);
  const microphoneEnabled = useGo2Store((state) => state.microphoneEnabled);
  const microphonePermissionState = useGo2Store((state) => state.microphonePermissionState);
  const microphoneState = useGo2Store((state) => state.microphoneState);
  const motorState = useGo2Store((state) => state.motorState);
  const obstacleAvoidanceEnabled = useGo2Store((state) => state.obstacleAvoidanceEnabled);
  const robotAudioError = useGo2Store((state) => state.robotAudioError);
  const robotAudioState = useGo2Store((state) => state.robotAudioState);
  const robotPose = useGo2Store((state) => state.robotPose);
  const robotPoseMessageCount = useGo2Store((state) => state.robotPoseMessageCount);
  const robotPoseParseFailureCount = useGo2Store((state) => state.robotPoseParseFailureCount);
  const runtimeTogglePending = useGo2Store((state) => state.runtimeTogglePending);
  const speakerEnabled = useGo2Store((state) => state.speakerEnabled);
  const videoStream = useGo2Store((state) => state.videoStream);
  const connect = useGo2Store((state) => state.connect);
  const disconnect = useGo2Store((state) => state.disconnect);
  const sendCommand = useGo2Store((state) => state.sendCommand);
  const setAudioFileInput = useGo2Store((state) => state.setAudioFileInput);
  const setAudioFilePlayback = useGo2Store((state) => state.setAudioFilePlayback);
  const setAudioInputVolume = useGo2Store((state) => state.setAudioInputVolume);
  const setCameraEnabled = useGo2Store((state) => state.setCameraEnabled);
  const setConfig = useGo2Store((state) => state.setConfig);
  const setLidarEnabled = useGo2Store((state) => state.setLidarEnabled);
  const setObstacleAvoidanceEnabled = useGo2Store((state) => state.setObstacleAvoidanceEnabled);
  const setSpeakerEnabled = useGo2Store((state) => state.setSpeakerEnabled);
  const testConnection = useGo2Store((state) => state.testConnection);

  return {
    audioFileCurrentTime,
    audioFileDuration,
    audioFileName,
    audioFileState,
    audioInputBytesSent,
    audioInputLastStatsAt,
    audioInputMode,
    audioInputPacketsSent,
    audioInputSource,
    audioInputStreaming,
    audioInputTrackState,
    audioInputVolume,
    audioStream,
    batteryPercent,
    batteryVoltage,
    cameraEnabled,
    config,
    connectionState,
    connect,
    connectWithConfig: connect,
    disconnect,
    driverMode,
    enterDampState: () => {
      recordRobotRuntimeCommand({ kind: "native_action", label: "Damp", role: "safe_state" });
      sendCommand({ type: "damp" });
    },
    enterStandState: () => {
      recordRobotRuntimeCommand({ kind: "native_action", label: "Stand" });
      sendCommand({ type: "balance_stand" });
    },
    emergencyStop: () => {
      recordRobotRuntimeCommand({ kind: "native_action", label: "Emergency Stop", role: "stop" });
      sendCommand({ type: "emergency_stop" });
    },
    emergencyStopped,
    lastError: standardizeRobotText(lastError),
    lastEvent: standardizeRobotText(lastEvent),
    lidarEnabled,
    lidarFrame,
    lidarFrameCount,
    lidarLastFrameBytes,
    lidarState,
    microphoneEnabled,
    microphonePermissionState,
    microphoneState,
    motorState,
    obstacleAvoidanceEnabled,
    robotAudioError: standardizeRobotText(robotAudioError),
    robotAudioState,
    robotPose,
    robotPoseMessageCount,
    robotPoseParseFailureCount,
    runtimePending: {
      audioInput: Boolean(runtimeTogglePending.audioInput),
      camera: Boolean(runtimeTogglePending.camera),
      lidar: Boolean(runtimeTogglePending.lidar),
      obstacleAvoidance: Boolean(runtimeTogglePending.obstacleAvoidance),
      speaker: Boolean(runtimeTogglePending.speaker)
    },
    sendControllerState: (state) => {
      recordRobotRuntimeCommand({ kind: "controller_state", state });
      sendCommand({ type: "joystick", ...state });
    },
    sendNativeAction: (action) => {
      recordRobotRuntimeCommand({
        kind: "native_action",
        label: action.label,
        modeLabel: action.modeLabel,
        role: action.role
      });
      sendCommand({
        type: "sport_request",
        apiId: action.apiId,
        label: action.label,
        modeLabel: action.modeLabel,
        parameter: action.parameter,
        priority: action.priority
      });
    },
    setAudioFileInput,
    setAudioFilePlayback,
    setAudioInputVolume,
    setCameraEnabled: (enabled) => {
      recordRobotRuntimeCommand({ enabled, kind: "stream_toggle", stream: "camera" });
      return setCameraEnabled(enabled);
    },
    setConfig,
    setLidarEnabled: (enabled) => {
      recordRobotRuntimeCommand({ enabled, kind: "stream_toggle", stream: "lidar" });
      return setLidarEnabled(enabled);
    },
    setObstacleAvoidance: (enabled) => {
      recordRobotRuntimeCommand({ enabled, kind: "obstacle_avoidance" });
      sendCommand({ type: "obstacle_avoidance", enabled });
    },
    setObstacleAvoidanceEnabled,
    setSpeakerEnabled: (enabled) => {
      recordRobotRuntimeCommand({ enabled, kind: "stream_toggle", stream: "speaker" });
      return setSpeakerEnabled(enabled);
    },
    speakerEnabled,
    stopMotion: () => {
      recordRobotRuntimeCommand({ kind: "native_action", label: "Stop", role: "stop" });
      sendCommand({ type: "stop_move" });
    },
    testConnection,
    videoStream
  };
}

export function standardizeRobotText(value: string | null): string | null {
  if (!value) {
    return value;
  }
  return [
    ["Go2 AudioHub", "Robot audio service"],
    ["Go2", "Robot"],
    ["Unitree", "driver adapter"],
    ["AudioHub", "audio service"]
  ].reduce((text, [source, replacement]) => text.split(source).join(replacement), value);
}

function toRobotAction(action: { apiId: number; danger?: boolean; kind?: "mode"; label: string; parameter?: string }): RobotNativeAction {
  return {
    apiId: action.apiId,
    label: action.label,
    modeLabel: action.kind === "mode" ? action.label : undefined,
    parameter: action.parameter,
    priority: action.danger,
    role: action.kind
  };
}
