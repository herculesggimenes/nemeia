"use client";

import { Activity, Bot, Folder, Gamepad2, MessageSquare, Plus, RefreshCw, Video, Volume2, Waves } from "lucide-react";
import { useMemo } from "react";
import { useGo2Store } from "../../lib/robots/unitree/go2-store";
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
  const go2AudioStream = useGo2Store((state) => state.audioStream);
  const go2BatteryPercent = useGo2Store((state) => state.batteryPercent);
  const go2CameraEnabled = useGo2Store((state) => state.cameraEnabled);
  const go2ConnectionState = useGo2Store((state) => state.connectionState);
  const go2LastError = useGo2Store((state) => state.lastError);
  const go2LidarEnabled = useGo2Store((state) => state.lidarEnabled);
  const go2LidarFrameCount = useGo2Store((state) => state.lidarFrameCount);
  const go2SpeakerEnabled = useGo2Store((state) => state.speakerEnabled);
  const go2VideoStream = useGo2Store((state) => state.videoStream);
  const connectGo2 = useGo2Store((state) => state.connect);
  const moduleTreeNodes = useMemo<FileTreeNode[]>(() => {
    const go2Status = connectionStatus(go2ConnectionState);
    const go2Connected = go2ConnectionState === "connected";
    const reconnectable = go2ConnectionState !== "connected" && go2ConnectionState !== "connecting" && go2ConnectionState !== "testing";

    return [
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
        label: "Go2",
        ariaLabel: `go2 ${go2Status}`,
        detail:
          go2ConnectionState === "failed"
            ? go2LastError ?? "Connection failed"
            : withBattery(go2Status, go2BatteryPercent),
        actionIcon: reconnectable ? RefreshCw : undefined,
        actionId: reconnectable ? "go2 reconnect" : undefined,
        actionLabel: reconnectable ? "Reconnect Go2" : undefined,
        settingsId: "go2.config",
        settingsLabel: "Go2 settings",
        icon: Folder,
        children: [
          {
            id: "go2.front_camera",
            label: "Front camera",
            ariaLabel: "go2 front camera",
            detail: streamStatus({ connected: go2Connected, enabled: go2CameraEnabled, streaming: Boolean(go2VideoStream) }),
            settingsId: "go2.front_camera.config",
            settingsLabel: "Front camera settings",
            icon: Video
          },
          {
            id: "go2.point_cloud",
            label: "LiDAR / SLAM",
            ariaLabel: "go2 lidar",
            detail: streamStatus({ connected: go2Connected, enabled: go2LidarEnabled, streaming: go2LidarFrameCount > 0 }),
            settingsId: "go2.lidar.config",
            settingsLabel: "LiDAR settings",
            icon: Waves
          },
          {
            id: "go2.control",
            label: "Control",
            ariaLabel: "go2 control",
            detail: go2Connected ? "ready" : "locked",
            settingsId: "go2.control.config",
            settingsLabel: "Control settings",
            icon: Gamepad2
          },
          {
            id: "go2.speaker",
            label: "Speaker",
            ariaLabel: "go2 speaker",
            detail: streamStatus({ connected: go2Connected, enabled: go2SpeakerEnabled, streaming: Boolean(go2AudioStream) }),
            settingsId: "go2.speaker.config",
            settingsLabel: "Speaker settings",
            icon: Volume2
          },
          {
            id: "go2.stats",
            label: "Stats",
            ariaLabel: "go2 stats",
            detail: go2Connected ? "telemetry" : "offline",
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
  }, [go2AudioStream, go2BatteryPercent, go2CameraEnabled, go2ConnectionState, go2LastError, go2LidarEnabled, go2LidarFrameCount, go2SpeakerEnabled, go2VideoStream]);

  return (
    <section className="grid h-full min-h-0 bg-sidebar text-sidebar-foreground" data-testid="modules-panel">
      <div className="min-h-0 overflow-auto">
        <FileTree
          className="p-1"
          ariaLabel="Modules"
          nodes={moduleTreeNodes}
          onAction={(id) => {
            if (id === "go2 reconnect") {
              void connectGo2();
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
