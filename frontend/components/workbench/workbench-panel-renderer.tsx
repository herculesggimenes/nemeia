"use client";

import type { IDockviewPanelProps } from "dockview";
import { Plus, Route } from "lucide-react";
import { artifacts } from "../../lib/mock-data";
import { useRobotRuntime } from "../../lib/robots/standard/robot-runtime";
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
import { MissionCockpitPanel } from "../mission/mission-cockpit-panel";
import { getPanelDescriptor } from "./workbench-registry";
import type { WorkbenchPanelParams } from "./workbench-types";
import { useWorkbenchActions } from "./workbench-context";
import { WorldPanel } from "../world/world-panel";

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
  const robotRuntime = useRobotRuntime();

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

  if (descriptor.kind === "world") {
    return <WorldPanel />;
  }

  if (descriptor.kind === "camera") {
    return <UnitreeCameraView connectionState={robotRuntime.connectionState} enabled={robotRuntime.cameraEnabled} stream={robotRuntime.videoStream} />;
  }

  if (descriptor.kind === "point_cloud") {
    return (
      <UnitreePointCloudView
        connectionState={robotRuntime.connectionState}
        enabled={robotRuntime.lidarEnabled}
        frameCount={robotRuntime.lidarFrameCount}
        frame={robotRuntime.lidarFrame}
        lastFrameBytes={robotRuntime.lidarLastFrameBytes}
        lidarState={robotRuntime.lidarState}
        robotPose={robotRuntime.robotPose}
        robotPoseMessageCount={robotRuntime.robotPoseMessageCount}
        robotPoseParseFailureCount={robotRuntime.robotPoseParseFailureCount}
        motorState={robotRuntime.motorState}
      />
    );
  }

  if (descriptor.kind === "audio") {
    return <UnitreeAudioView audioStream={robotRuntime.audioStream} connectionState={robotRuntime.connectionState} enabled={robotRuntime.speakerEnabled} />;
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

  if (descriptor.kind === "mission") {
    return <MissionCockpitPanel />;
  }

  return <GenericConfigPanel artifactId={params.artifactId} />;
}
