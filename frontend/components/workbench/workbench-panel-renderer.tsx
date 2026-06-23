"use client";

import type { IDockviewPanelProps } from "dockview";
import { Plus, Route } from "lucide-react";
import { artifacts } from "../../lib/mock-data";
import { useGo2Store } from "../../lib/robots/unitree/go2-store";
import { Button } from "../ui/button";
import { SettingsPage } from "../settings-page";
import { ConversationPage } from "../thread/conversation-page";
import { Go2ConnectionConfigPanel } from "../unitree/go2-connection-config-panel";
import { UnitreeAudioView } from "../unitree/unitree-audio-view";
import { UnitreeCameraView } from "../unitree/unitree-camera-view";
import { UnitreeControlPanelContent } from "../unitree/unitree-control-pane";
import { UnitreeGo2StatsView } from "../unitree/unitree-go2-stats-view";
import { UnitreePointCloudView } from "../unitree/unitree-point-cloud-view";
import { ModuleTreePanel } from "./module-tree-panel";
import { getPanelDescriptor } from "./workbench-registry";
import type { WorkbenchPanelParams } from "./workbench-types";
import { useWorkbenchActions } from "./workbench-context";

type RendererProps = IDockviewPanelProps<WorkbenchPanelParams>;

function GeneratedRouteNote() {
  return (
    <div className="grid gap-3 p-6 text-sm text-foreground">
      <Route size={22} />
      <h2 className="text-xl font-extrabold">Generated route note</h2>
      <p className="max-w-prose leading-6 text-muted">
        Avoid direct approach. Use a left arc around floor_cable, re-check mask alignment, then stop 0.8m
        from red_backpack.
      </p>
      <code className="rounded-md border border-surface-3 bg-surface-0 px-3 py-2 font-mono text-xs text-primary">
        nemeiactl plan preview --target obj_backpack --avoid obj_cable
      </code>
    </div>
  );
}

function GenericConfigPanel({ artifactId }: { artifactId?: string }) {
  const artifact = artifacts.find((candidate) => candidate.id === artifactId);

  if (artifact?.id === "go2_config") {
    return <Go2ConnectionConfigPanel />;
  }

  if (artifact?.id === "add_component") {
    return (
      <div className="min-h-0 overflow-auto p-4">
        <div className="grid gap-3 rounded-md border border-surface-3 bg-surface-1 p-4">
          <h2 className="text-base font-bold text-foreground">Add module</h2>
          <p className="text-sm text-muted">Register another robot, sensor, or actuator module.</p>
          {["Camera", "LiDAR / SLAM", "Speaker", "Robot arm with camera"].map((template) => (
            <Button className="justify-start gap-2" key={template} variant="outline">
              <Plus size={15} />
              {template}
            </Button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-0 overflow-auto p-4">
      <div className="grid gap-3 rounded-md border border-surface-3 bg-surface-1 p-4">
        <h2 className="text-base font-bold text-foreground">{artifact?.title ?? "Module Config"}</h2>
        <p className="text-sm text-muted">{artifact?.description ?? "Module-specific settings."}</p>
        <div className="rounded-md border border-surface-3 bg-surface-2 p-3 text-xs text-muted">
          Component-specific settings will be wired to the app server config schema.
        </div>
      </div>
    </div>
  );
}

export function WorkbenchPanelRenderer({ params }: RendererProps) {
  const { openPanel } = useWorkbenchActions();
  const descriptor = getPanelDescriptor(params.panelId);
  const go2AudioStream = useGo2Store((state) => state.audioStream);
  const go2CameraEnabled = useGo2Store((state) => state.cameraEnabled);
  const go2ConnectionState = useGo2Store((state) => state.connectionState);
  const go2LidarEnabled = useGo2Store((state) => state.lidarEnabled);
  const go2LidarFrameCount = useGo2Store((state) => state.lidarFrameCount);
  const go2LidarFrame = useGo2Store((state) => state.lidarFrame);
  const go2LidarLastFrameBytes = useGo2Store((state) => state.lidarLastFrameBytes);
  const go2LidarState = useGo2Store((state) => state.lidarState);
  const go2MotorState = useGo2Store((state) => state.motorState);
  const go2RobotPose = useGo2Store((state) => state.robotPose);
  const go2RobotPoseMessageCount = useGo2Store((state) => state.robotPoseMessageCount);
  const go2RobotPoseParseFailureCount = useGo2Store((state) => state.robotPoseParseFailureCount);
  const go2SpeakerEnabled = useGo2Store((state) => state.speakerEnabled);
  const go2VideoStream = useGo2Store((state) => state.videoStream);

  if (!descriptor) {
    return <div className="p-4 text-sm text-danger">Unknown panel: {params.panelId}</div>;
  }

  if (descriptor.kind === "modules") {
    return <ModuleTreePanel openPanel={openPanel} />;
  }

  if (descriptor.kind === "conversation") {
    return <ConversationPage />;
  }

  if (descriptor.kind === "settings") {
    return <SettingsPage />;
  }

  if (descriptor.kind === "camera") {
    return <UnitreeCameraView connectionState={go2ConnectionState} enabled={go2CameraEnabled} stream={go2VideoStream} />;
  }

  if (descriptor.kind === "point_cloud") {
    return (
      <UnitreePointCloudView
        connectionState={go2ConnectionState}
        enabled={go2LidarEnabled}
        frameCount={go2LidarFrameCount}
        frame={go2LidarFrame}
        lastFrameBytes={go2LidarLastFrameBytes}
        lidarState={go2LidarState}
        robotPose={go2RobotPose}
        robotPoseMessageCount={go2RobotPoseMessageCount}
        robotPoseParseFailureCount={go2RobotPoseParseFailureCount}
        motorState={go2MotorState}
      />
    );
  }

  if (descriptor.kind === "audio") {
    return <UnitreeAudioView audioStream={go2AudioStream} connectionState={go2ConnectionState} enabled={go2SpeakerEnabled} />;
  }

  if (descriptor.kind === "control") {
    return <UnitreeControlPanelContent />;
  }

  if (descriptor.kind === "stats") {
    return <UnitreeGo2StatsView />;
  }

  if (descriptor.kind === "generated_artifact") {
    return <GeneratedRouteNote />;
  }

  return <GenericConfigPanel artifactId={params.artifactId} />;
}
