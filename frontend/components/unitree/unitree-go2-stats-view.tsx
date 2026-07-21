"use client";

import type { ComponentType } from "react";
import { Activity, Battery, Gauge, Radio, Volume2, Waves } from "lucide-react";
import { useRobotRuntime } from "../../lib/robots/standard/robot-runtime";
import { cn } from "../../lib/utils";

type StatCardProps = {
  detail: string;
  icon: ComponentType<{ className?: string; size?: number }>;
  label: string;
  tone?: "danger" | "normal" | "success" | "warning";
  value: string;
};

function formatBoolean(value: boolean): string {
  return value ? "on" : "off";
}

function formatNullable(value: number | string | null | undefined, fallback = "none"): string {
  return value === null || value === undefined || value === "" ? fallback : String(value);
}

function formatBytes(value: number | null): string {
  if (value === null) {
    return "none";
  }

  if (value < 1024) {
    return `${value} B`;
  }

  return `${(value / 1024).toFixed(1)} KB`;
}

function formatPose(pose: { x: number; y: number; z: number; yaw: number } | null): string {
  if (!pose) {
    return "none";
  }

  return `x ${pose.x.toFixed(2)}, y ${pose.y.toFixed(2)}, yaw ${pose.yaw.toFixed(2)}`;
}

function StatCard({ detail, icon: Icon, label, tone = "normal", value }: StatCardProps) {
  return (
    <div className="grid gap-3 rounded-md border border-surface-3 bg-surface-1 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="grid min-w-0 gap-1">
          <span className="text-[10px] font-bold uppercase tracking-wide text-muted">{label}</span>
          <strong
            className={cn(
              "truncate text-lg text-foreground",
              tone === "danger" ? "text-danger" : null,
              tone === "success" ? "text-green" : null,
              tone === "warning" ? "text-primary" : null
            )}
          >
            {value}
          </strong>
        </div>
        <div className="grid size-9 shrink-0 place-items-center rounded-md bg-surface-3 text-primary">
          <Icon size={18} />
        </div>
      </div>
      <p className="min-h-8 text-xs leading-5 text-muted">{detail}</p>
    </div>
  );
}

function DataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[150px_minmax(0,1fr)] gap-3 border-t border-surface-3 px-3 py-2 first:border-t-0">
      <span className="text-xs font-semibold text-muted">{label}</span>
      <span className="min-w-0 break-words font-mono text-xs text-foreground">{value}</span>
    </div>
  );
}

function JsonBlock({ title, value }: { title: string; value: unknown }) {
  return (
    <section className="grid gap-2 rounded-md border border-surface-3 bg-surface-1 p-3">
      <h3 className="text-xs font-bold uppercase tracking-wide text-muted">{title}</h3>
      <pre className="max-h-64 overflow-auto rounded-md border border-surface-3 bg-surface-0 p-3 text-xs leading-5 text-foreground">
        {JSON.stringify(value, null, 2)}
      </pre>
    </section>
  );
}

export function UnitreeGo2StatsView() {
  const robotRuntime = useRobotRuntime();
  const connected = robotRuntime.connectionState === "connected";
  const telemetry = {
    connection: {
      state: robotRuntime.connectionState,
      lastEvent: robotRuntime.lastEvent,
      lastError: robotRuntime.lastError,
      emergencyStopped: robotRuntime.emergencyStopped,
      config: {
        ...robotRuntime.config,
        robotId: "robot_01"
      }
    },
    robot: {
      batteryPercent: robotRuntime.batteryPercent,
      batteryVoltage: robotRuntime.batteryVoltage,
      currentSportMode: robotRuntime.driverMode,
      obstacleAvoidanceEnabled: robotRuntime.obstacleAvoidanceEnabled,
      runtimeTogglePending: robotRuntime.runtimePending
    },
    streams: {
      cameraEnabled: robotRuntime.cameraEnabled,
      hasVideoStream: Boolean(robotRuntime.videoStream),
      lidarEnabled: robotRuntime.lidarEnabled,
      lidarFrameCount: robotRuntime.lidarFrameCount,
      lidarLastFrameBytes: robotRuntime.lidarLastFrameBytes,
      lidarState: robotRuntime.lidarState,
      speakerEnabled: robotRuntime.speakerEnabled,
      hasAudioStream: Boolean(robotRuntime.audioStream)
    },
    audioInput: {
      audioFileCurrentTime: robotRuntime.audioFileCurrentTime,
      audioFileDuration: robotRuntime.audioFileDuration,
      audioFileName: robotRuntime.audioFileName,
      audioFileState: robotRuntime.audioFileState,
      audioInputBytesSent: robotRuntime.audioInputBytesSent,
      audioInputLastStatsAt: robotRuntime.audioInputLastStatsAt,
      audioInputMode: robotRuntime.audioInputMode,
      audioInputPacketsSent: robotRuntime.audioInputPacketsSent,
      audioInputSource: robotRuntime.audioInputSource,
      audioInputStreaming: robotRuntime.audioInputStreaming,
      audioInputTrackState: robotRuntime.audioInputTrackState,
      audioInputVolume: robotRuntime.audioInputVolume,
      robotAudioError: robotRuntime.robotAudioError,
      robotAudioState: robotRuntime.robotAudioState
    },
    pose: {
      robotPose: robotRuntime.robotPose,
      robotPoseMessageCount: robotRuntime.robotPoseMessageCount,
      robotPoseParseFailureCount: robotRuntime.robotPoseParseFailureCount
    },
    motors: {
      count: robotRuntime.motorState?.length ?? 0,
      motorState: robotRuntime.motorState
    },
    microphone: {
      microphoneEnabled: robotRuntime.microphoneEnabled,
      microphonePermissionState: robotRuntime.microphonePermissionState,
      microphoneState: robotRuntime.microphoneState
    }
  };

  return (
    <div className="h-full min-h-0 overflow-auto bg-surface-0 p-4" data-testid="go2-stats-panel">
      <div className="grid gap-4">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-extrabold text-foreground">Robot Stats</h2>
            <p className="text-sm text-muted">Full telemetry snapshot from the standard robot runtime.</p>
          </div>
          <span
            className={cn(
              "shrink-0 rounded-md border px-2 py-1 text-[10px] font-bold uppercase tracking-wide",
              connected ? "border-green/40 bg-green/10 text-green" : "border-danger/40 bg-danger/10 text-danger"
            )}
          >
            {robotRuntime.connectionState}
          </span>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <StatCard
            detail={robotRuntime.lastEvent ?? "No runtime event recorded yet."}
            icon={Radio}
            label="Connection"
            tone={connected ? "success" : robotRuntime.connectionState === "failed" ? "danger" : "warning"}
            value={robotRuntime.connectionState}
          />
          <StatCard
            detail={`Voltage ${formatNullable(robotRuntime.batteryVoltage, "unknown")}`}
            icon={Battery}
            label="Battery"
            tone={robotRuntime.batteryPercent !== null && robotRuntime.batteryPercent < 20 ? "danger" : "normal"}
            value={robotRuntime.batteryPercent === null ? "unknown" : `${robotRuntime.batteryPercent}%`}
          />
          <StatCard
            detail="Current driver mode reported by the robot or last mode command sent."
            icon={Gauge}
            label="Mode"
            value={robotRuntime.driverMode ?? "unknown"}
          />
          <StatCard
            detail={`${robotRuntime.lidarFrameCount} frames received, latest ${formatBytes(robotRuntime.lidarLastFrameBytes)}`}
            icon={Waves}
            label="LiDAR"
            tone={robotRuntime.lidarEnabled ? "success" : "warning"}
            value={formatBoolean(robotRuntime.lidarEnabled)}
          />
          <StatCard
            detail={`${formatNullable(robotRuntime.audioInputPacketsSent, "0")} packets, ${formatBytes(robotRuntime.audioInputBytesSent)} sent`}
            icon={Volume2}
            label="Robot Audio"
            tone={robotRuntime.robotAudioState === "failed" ? "danger" : "normal"}
            value={robotRuntime.robotAudioState}
          />
          <StatCard
            detail={`${robotRuntime.motorState?.length ?? 0}/12 joints available`}
            icon={Activity}
            label="Motors"
            tone={robotRuntime.motorState && robotRuntime.motorState.length >= 12 ? "success" : "warning"}
            value={robotRuntime.motorState ? "live" : "none"}
          />
        </div>

        <section className="rounded-md border border-surface-3 bg-surface-1">
          <DataRow label="Robot pose" value={formatPose(robotRuntime.robotPose)} />
          <DataRow label="Pose messages" value={`${robotRuntime.robotPoseMessageCount}`} />
          <DataRow label="Pose parse failures" value={`${robotRuntime.robotPoseParseFailureCount}`} />
          <DataRow label="Camera stream" value={`${formatBoolean(robotRuntime.cameraEnabled)} · media ${robotRuntime.videoStream ? "attached" : "missing"}`} />
          <DataRow label="Speaker stream" value={`${formatBoolean(robotRuntime.speakerEnabled)} · media ${robotRuntime.audioStream ? "attached" : "missing"}`} />
          <DataRow label="Obstacle avoidance" value={formatBoolean(robotRuntime.obstacleAvoidanceEnabled)} />
          <DataRow label="Emergency stop" value={formatBoolean(robotRuntime.emergencyStopped)} />
          <DataRow label="Last error" value={robotRuntime.lastError ?? "none"} />
        </section>

        <JsonBlock title="Normalized telemetry" value={telemetry} />
      </div>
    </div>
  );
}
