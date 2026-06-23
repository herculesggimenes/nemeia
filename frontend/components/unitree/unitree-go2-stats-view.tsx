"use client";

import type { ComponentType } from "react";
import { Activity, Battery, Gauge, Radio, Volume2, Waves } from "lucide-react";
import { useGo2Store } from "../../lib/robots/unitree/go2-store";
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
  const state = useGo2Store();
  const connected = state.connectionState === "connected";
  const telemetry = {
    connection: {
      state: state.connectionState,
      lastEvent: state.lastEvent,
      lastError: state.lastError,
      emergencyStopped: state.emergencyStopped,
      config: state.config
    },
    robot: {
      batteryPercent: state.batteryPercent,
      batteryVoltage: state.batteryVoltage,
      currentSportMode: state.currentSportMode,
      obstacleAvoidanceEnabled: state.obstacleAvoidanceEnabled,
      runtimeTogglePending: state.runtimeTogglePending
    },
    streams: {
      cameraEnabled: state.cameraEnabled,
      hasVideoStream: Boolean(state.videoStream),
      lidarEnabled: state.lidarEnabled,
      lidarFrameCount: state.lidarFrameCount,
      lidarLastFrameBytes: state.lidarLastFrameBytes,
      lidarState: state.lidarState,
      speakerEnabled: state.speakerEnabled,
      hasAudioStream: Boolean(state.audioStream)
    },
    audioInput: {
      audioFileCurrentTime: state.audioFileCurrentTime,
      audioFileDuration: state.audioFileDuration,
      audioFileName: state.audioFileName,
      audioFileState: state.audioFileState,
      audioInputBytesSent: state.audioInputBytesSent,
      audioInputLastStatsAt: state.audioInputLastStatsAt,
      audioInputMode: state.audioInputMode,
      audioInputPacketsSent: state.audioInputPacketsSent,
      audioInputSource: state.audioInputSource,
      audioInputStreaming: state.audioInputStreaming,
      audioInputTrackState: state.audioInputTrackState,
      audioInputVolume: state.audioInputVolume,
      robotAudioError: state.robotAudioError,
      robotAudioState: state.robotAudioState
    },
    pose: {
      robotPose: state.robotPose,
      robotPoseMessageCount: state.robotPoseMessageCount,
      robotPoseParseFailureCount: state.robotPoseParseFailureCount
    },
    motors: {
      count: state.motorState?.length ?? 0,
      motorState: state.motorState
    },
    microphone: {
      microphoneEnabled: state.microphoneEnabled,
      microphonePermissionState: state.microphonePermissionState,
      microphoneState: state.microphoneState
    }
  };

  return (
    <div className="h-full min-h-0 overflow-auto bg-surface-0 p-4" data-testid="go2-stats-panel">
      <div className="grid gap-4">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-extrabold text-foreground">Go2 Stats</h2>
            <p className="text-sm text-muted">Full telemetry snapshot from the current Go2 runtime store.</p>
          </div>
          <span
            className={cn(
              "shrink-0 rounded-md border px-2 py-1 text-[10px] font-bold uppercase tracking-wide",
              connected ? "border-green/40 bg-green/10 text-green" : "border-danger/40 bg-danger/10 text-danger"
            )}
          >
            {state.connectionState}
          </span>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <StatCard
            detail={state.lastEvent ?? "No runtime event recorded yet."}
            icon={Radio}
            label="Connection"
            tone={connected ? "success" : state.connectionState === "failed" ? "danger" : "warning"}
            value={state.connectionState}
          />
          <StatCard
            detail={`Voltage ${formatNullable(state.batteryVoltage, "unknown")}`}
            icon={Battery}
            label="Battery"
            tone={state.batteryPercent !== null && state.batteryPercent < 20 ? "danger" : "normal"}
            value={state.batteryPercent === null ? "unknown" : `${state.batteryPercent}%`}
          />
          <StatCard
            detail="Current sport mode reported by Go2 or last mode command sent."
            icon={Gauge}
            label="Mode"
            value={state.currentSportMode ?? "unknown"}
          />
          <StatCard
            detail={`${state.lidarFrameCount} frames received, latest ${formatBytes(state.lidarLastFrameBytes)}`}
            icon={Waves}
            label="LiDAR"
            tone={state.lidarEnabled ? "success" : "warning"}
            value={formatBoolean(state.lidarEnabled)}
          />
          <StatCard
            detail={`${state.audioInputPacketsSent} packets, ${formatBytes(state.audioInputBytesSent)} sent`}
            icon={Volume2}
            label="Robot Audio"
            tone={state.robotAudioState === "failed" ? "danger" : "normal"}
            value={state.robotAudioState}
          />
          <StatCard
            detail={`${state.motorState?.length ?? 0}/12 joints available`}
            icon={Activity}
            label="Motors"
            tone={state.motorState && state.motorState.length >= 12 ? "success" : "warning"}
            value={state.motorState ? "live" : "none"}
          />
        </div>

        <section className="rounded-md border border-surface-3 bg-surface-1">
          <DataRow label="Robot pose" value={formatPose(state.robotPose)} />
          <DataRow label="Pose messages" value={`${state.robotPoseMessageCount}`} />
          <DataRow label="Pose parse failures" value={`${state.robotPoseParseFailureCount}`} />
          <DataRow label="Camera stream" value={`${formatBoolean(state.cameraEnabled)} · media ${state.videoStream ? "attached" : "missing"}`} />
          <DataRow label="Speaker stream" value={`${formatBoolean(state.speakerEnabled)} · media ${state.audioStream ? "attached" : "missing"}`} />
          <DataRow label="Obstacle avoidance" value={formatBoolean(state.obstacleAvoidanceEnabled)} />
          <DataRow label="Emergency stop" value={formatBoolean(state.emergencyStopped)} />
          <DataRow label="Last error" value={state.lastError ?? "none"} />
        </section>

        <JsonBlock title="Normalized telemetry" value={telemetry} />
      </div>
    </div>
  );
}
