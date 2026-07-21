"use client";

import { Activity, Bot, Boxes, Folder, Gamepad2, MessageSquare, Plus, RefreshCw, Video, Volume2, Waves } from "lucide-react";
import { useMemo } from "react";
import { useRobotRuntime } from "../../lib/robots/standard/robot-runtime";
import { FileTree, type FileTreeNode } from "../navigation/file-tree";

type Props = {
  openPanel: (panelId: string) => void;
};

type ModuleStatus = "error" | "locked" | "offline" | "online" | "ready" | "streaming" | "waiting";

function withBattery(status: ModuleStatus, batteryPercent: number | null) {
  return batteryPercent === null ? status : `${status} · ${batteryPercent}%`;
}

function connectionStatus(connectionState: string): ModuleStatus {
  if (connectionState === "connected") {
    return "online";
  }

  if (connectionState === "failed") {
    return "error";
  }

  return "offline";
}

function streamStatus(options: { connected: boolean; enabled: boolean; streaming: boolean }): ModuleStatus {
  if (!options.enabled) {
    return "offline";
  }

  if (options.streaming) {
    return "streaming";
  }

  return options.connected ? "waiting" : "offline";
}

export function ModuleTreePanel({ openPanel }: Props) {
  const robotRuntime = useRobotRuntime();
  const moduleTreeNodes = useMemo<FileTreeNode[]>(() => {
    const robotStatus = connectionStatus(robotRuntime.connectionState);
    const robotConnected = robotRuntime.connectionState === "connected";
    const reconnectable = robotRuntime.connectionState !== "connected" && robotRuntime.connectionState !== "connecting" && robotRuntime.connectionState !== "testing";

    return [
      {
        id: "world.main",
        label: "World",
        ariaLabel: "world entities and interactions",
        detail: robotConnected ? "live · 2 entities" : "2 entities · waiting",
        icon: Boxes
      },
      {
        id: "atena",
        label: "Atena",
        ariaLabel: "atena agent",
        detail: "online",
        icon: Bot,
        settingsId: "atena.runtime_config",
        settingsLabel: "Atena settings",
        children: [
          {
            id: "conversation.main",
            label: "Chat",
            ariaLabel: "atena chat",
            detail: "ready",
            icon: MessageSquare
          }
        ]
      },
      {
        id: "go2",
        label: "Robot",
        ariaLabel: `robot ${robotStatus}`,
        detail:
          robotRuntime.connectionState === "failed"
            ? robotRuntime.lastError ?? "Connection failed"
            : withBattery(robotStatus, robotRuntime.batteryPercent),
        actionIcon: reconnectable ? RefreshCw : undefined,
        actionId: reconnectable ? "go2 reconnect" : undefined,
        actionLabel: reconnectable ? "Reconnect robot" : undefined,
        settingsId: "go2.config",
        settingsLabel: "Robot settings",
        icon: Folder,
        children: [
          {
            id: "go2.front_camera",
            label: "Front camera",
            ariaLabel: "robot front camera",
            detail: streamStatus({ connected: robotConnected, enabled: robotRuntime.cameraEnabled, streaming: Boolean(robotRuntime.videoStream) }),
            settingsId: "go2.front_camera.config",
            settingsLabel: "Front camera settings",
            icon: Video
          },
          {
            id: "go2.point_cloud",
            label: "LiDAR / SLAM",
            ariaLabel: "robot lidar",
            detail: streamStatus({ connected: robotConnected, enabled: robotRuntime.lidarEnabled, streaming: robotRuntime.lidarFrameCount > 0 }),
            settingsId: "go2.lidar.config",
            settingsLabel: "LiDAR settings",
            icon: Waves
          },
          {
            id: "go2.control",
            label: "Control",
            ariaLabel: "robot control",
            detail: robotConnected ? "ready" : "locked",
            settingsId: "go2.control.config",
            settingsLabel: "Control settings",
            icon: Gamepad2
          },
          {
            id: "go2.speaker",
            label: "Speaker",
            ariaLabel: "robot speaker",
            detail: streamStatus({ connected: robotConnected, enabled: robotRuntime.speakerEnabled, streaming: Boolean(robotRuntime.audioStream) }),
            settingsId: "go2.speaker.config",
            settingsLabel: "Speaker settings",
            icon: Volume2
          },
          {
            id: "go2.stats",
            label: "Stats",
            ariaLabel: "robot stats",
            detail: robotConnected ? "telemetry" : "offline",
            icon: Activity
          }
        ]
      },
      {
        id: "module.add",
        label: "Add module",
        ariaLabel: "add module",
        detail: "register robot or sensor",
        icon: Plus
      }
    ];
  }, [robotRuntime]);

  return (
    <section className="grid h-full min-h-0 bg-sidebar text-sidebar-foreground" data-testid="modules-panel">
      <div className="min-h-0 overflow-auto">
        <FileTree
          className="p-1"
          ariaLabel="Modules"
          nodes={moduleTreeNodes}
          onAction={(id) => {
            if (id === "go2 reconnect") {
              void robotRuntime.connect();
            }
          }}
          onOpenSettings={openPanel}
          onSelect={openPanel}
          testId="modules-tree"
        />
      </div>
    </section>
  );
}
