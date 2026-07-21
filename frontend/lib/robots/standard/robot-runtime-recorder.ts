"use client";

import type { RobotControllerState } from "./robot-runtime";

export type RobotRuntimeCommand =
  | {
      at: string;
      kind: "controller_state";
      seq: number;
      state: RobotControllerState;
    }
  | {
      at: string;
      enabled: boolean;
      kind: "obstacle_avoidance" | "stream_toggle";
      seq: number;
      stream?: "camera" | "lidar" | "speaker";
    }
  | {
      at: string;
      kind: "native_action";
      label: string;
      modeLabel?: string;
      role?: "mode" | "safe_state" | "stop";
      seq: number;
    };

export type RobotRuntimeCommandInput =
  | {
      kind: "controller_state";
      state: RobotControllerState;
    }
  | {
      enabled: boolean;
      kind: "obstacle_avoidance" | "stream_toggle";
      stream?: "camera" | "lidar" | "speaker";
    }
  | {
      kind: "native_action";
      label: string;
      modeLabel?: string;
      role?: "mode" | "safe_state" | "stop";
    };

declare global {
  interface Window {
    nemeiaRobotRuntimeCommands?: RobotRuntimeCommand[];
    nemeiaRobotRuntimeResetCommands?: () => void;
  }
}

let runtimeCommandSeq = 0;

export function installRuntimeCommandRecorder(): void {
  if (typeof window === "undefined") {
    return;
  }

  window.nemeiaRobotRuntimeCommands ??= [];
  window.nemeiaRobotRuntimeResetCommands = () => {
    runtimeCommandSeq = 0;
    window.nemeiaRobotRuntimeCommands = [];
  };
}

export function recordRobotRuntimeCommand(command: RobotRuntimeCommandInput): void {
  if (typeof window === "undefined") {
    return;
  }

  installRuntimeCommandRecorder();
  const nextCommand = {
    ...command,
    at: new Date().toISOString(),
    seq: ++runtimeCommandSeq
  } as RobotRuntimeCommand;
  window.nemeiaRobotRuntimeCommands?.push(nextCommand);
}
