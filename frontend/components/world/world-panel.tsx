"use client";

import {
  Bot,
  Box,
  Boxes,
  Camera,
  CircleStop,
  Gamepad2,
  Headphones,
  Map as MapIcon,
  RadioTower
} from "lucide-react";
import { useState } from "react";
import { projectRobotWorld, type WorldActionView, type WorldComponentView, type WorldEntityView } from "../../lib/world/robot-world-model";
import { useRobotRuntime } from "../../lib/robots/standard/robot-runtime";
import { Button } from "../ui/button";
import { UnitreePointCloudView } from "../unitree/unitree-point-cloud-view";
import { useWorkbenchActions } from "../workbench/workbench-context";

const actionIcons = {
  connect: RadioTower,
  control: Gamepad2,
  listen: Headphones,
  map: MapIcon,
  observe: Camera,
  stop: CircleStop
};

export function WorldPanel() {
  const robot = useRobotRuntime();
  const { openPanel } = useWorkbenchActions();
  const [mapFaceCount, setMapFaceCount] = useState(0);
  const [selectedEntityId, setSelectedEntityId] = useState("world_local");
  const world = projectRobotWorld(robot, mapFaceCount);
  const selectedEntity = world.entities.find((entity) => entity.id === selectedEntityId) ?? world.entities[0];

  const runAction = (action: WorldActionView) => {
    if (!action.available) {
      return;
    }
    if (action.id === "connect") {
      void robot.connect();
    }
    if (action.id === "observe") {
      if (!robot.cameraEnabled) {
        void robot.setCameraEnabled(true);
      }
      openPanel("go2.front_camera");
    }
    if (action.id === "map" && !robot.lidarEnabled) {
      void robot.setLidarEnabled(true);
    }
    if (action.id === "listen") {
      if (!robot.speakerEnabled) {
        void robot.setSpeakerEnabled(true);
      }
      openPanel("go2.speaker");
    }
    if (action.id === "control") {
      openPanel("go2.control");
    }
    if (action.id === "stop") {
      robot.stopMotion();
    }
  };

  return (
    <section className="grid h-full min-h-0 grid-rows-[auto_1fr] bg-surface-0 text-foreground" data-testid="world-panel">
      <header className="flex items-center justify-between gap-4 border-b border-surface-3 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <Boxes className="shrink-0 text-primary" size={17} />
          <div className="min-w-0">
            <h2 className="text-sm font-bold">World</h2>
            <p className="truncate text-[11px] text-muted">Live spatial state</p>
          </div>
        </div>
        <div className="flex shrink-0 gap-4 text-right">
          <WorldCount label="entities" value={world.entities.length} />
          <WorldCount label="relations" value={world.relationships.length} />
        </div>
      </header>

      <div className="grid min-h-0 grid-cols-[minmax(260px,1fr)_280px] overflow-hidden">
        <div className="relative min-h-0 border-r border-surface-3" data-testid="world-spatial-viewport">
          <UnitreePointCloudView
            connectionState={robot.connectionState}
            enabled={robot.lidarEnabled}
            frame={robot.lidarFrame}
            frameCount={robot.lidarFrameCount}
            lastFrameBytes={robot.lidarLastFrameBytes}
            lidarState={robot.lidarState}
            motorState={robot.motorState}
            onGeometryStats={({ faceCount }) => setMapFaceCount(faceCount)}
            robotPose={robot.robotPose}
            robotPoseMessageCount={robot.robotPoseMessageCount}
            robotPoseParseFailureCount={robot.robotPoseParseFailureCount}
          />
          <div className="pointer-events-none absolute bottom-3 left-3 right-3 flex flex-wrap items-center gap-2 text-[10px]">
            <WorldSignal active={robot.connectionState === "connected"} label="world link" />
            <WorldSignal active={robot.lidarFrameCount > 0} label={`${robot.lidarFrameCount.toLocaleString()} frames`} />
            <WorldSignal active={mapFaceCount > 0} label={mapFaceCount > 0 ? `${mapFaceCount.toLocaleString()} faces` : "geometry pending"} />
            <WorldSignal active={false} label="semantics pending" />
          </div>
        </div>

        <aside className="min-h-0 overflow-auto bg-surface-1" data-testid="world-inspector">
          <PanelSection label="Scene">
            <div className="grid gap-1.5">
              {world.entities.map((entity) => (
                <EntityButton entity={entity} key={entity.id} onSelect={setSelectedEntityId} selected={entity.id === selectedEntity.id} />
              ))}
            </div>
          </PanelSection>

          <PanelSection label="Components">
            <div className="mb-2 min-w-0">
              <div className="truncate text-xs font-bold">{selectedEntity.label}</div>
              <div className="mt-0.5 truncate font-mono text-[10px] text-muted">{selectedEntity.id} · {selectedEntity.type}</div>
            </div>
            <div className="divide-y divide-surface-3 border-y border-surface-3">
              {selectedEntity.components.map((component) => <ComponentRow component={component} key={component.id} />)}
            </div>
          </PanelSection>

          <PanelSection label="Relationships">
            <div className="grid gap-1.5">
              {world.relationships.length > 0 ? world.relationships.map((relationship) => (
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1 border border-surface-3 bg-surface-0 px-2 py-1.5 font-mono text-[9px]" key={`${relationship.subjectId}:${relationship.predicate}:${relationship.objectId}`}>
                  <span className="truncate">{relationship.subjectId}</span>
                  <span className="text-primary">{relationship.predicate}</span>
                  <span className="truncate text-right">{relationship.objectId}</span>
                </div>
              )) : <div className="border border-dashed border-surface-3 px-2 py-3 text-center text-[10px] text-muted">No live relationships</div>}
            </div>
          </PanelSection>

          <PanelSection label="Interactions">
            <div className="grid grid-cols-2 gap-1.5">
              {world.actions.map((action) => {
                const Icon = actionIcons[action.id];
                return (
                  <Button
                    className="group grid h-16 min-w-0 grid-cols-[auto_1fr] items-start gap-2 whitespace-normal px-2 py-2 text-left disabled:cursor-not-allowed disabled:opacity-40"
                    disabled={!action.available}
                    key={action.id}
                    onClick={() => runAction(action)}
                    title={action.available ? action.description : action.reason ?? undefined}
                    variant="outline"
                  >
                    <Icon className={action.id === "stop" ? "text-danger" : "text-primary"} size={14} />
                    <span className="min-w-0">
                      <strong className="block truncate text-[11px]">{action.label}</strong>
                      <span className="mt-1 block line-clamp-2 text-[9px] leading-3 text-muted">{action.available ? action.description : action.reason}</span>
                    </span>
                  </Button>
                );
              })}
            </div>
          </PanelSection>
        </aside>
      </div>
    </section>
  );
}

function WorldCount({ label, value }: { label: string; value: number }) {
  return <div><div className="text-xs font-bold">{value}</div><div className="text-[9px] uppercase text-muted">{label}</div></div>;
}

function WorldSignal({ active, label }: { active: boolean; label: string }) {
  return <span className="flex items-center gap-1 border border-surface-3 bg-surface-0/90 px-2 py-1 text-muted"><span className={`size-1.5 rounded-full ${active ? "bg-green" : "bg-surface-5"}`} />{label}</span>;
}

function PanelSection({ children, label }: { children: React.ReactNode; label: string }) {
  return <section className="border-b border-surface-3 p-3"><h3 className="mb-2 text-[9px] font-bold uppercase text-muted">{label}</h3>{children}</section>;
}

function EntityButton({ entity, onSelect, selected }: { entity: WorldEntityView; onSelect: (id: string) => void; selected: boolean }) {
  const Icon = entity.type === "core.robot" ? Bot : Box;
  const activeComponents = entity.components.filter((component) => component.state === "active").length;
  return (
    <Button
      className={`grid h-auto min-h-12 w-full grid-cols-[auto_1fr_auto] items-center justify-normal gap-2 whitespace-normal px-2 text-left ${selected ? "border-primary bg-primary/10" : "border-surface-3 bg-surface-0 hover:bg-surface-2"}`}
      onClick={() => onSelect(entity.id)}
      type="button"
      variant="outline"
    >
      <Icon className={selected ? "text-primary" : "text-muted"} size={14} />
      <span className="min-w-0"><strong className="block truncate text-[11px]">{entity.label}</strong><span className="block truncate font-mono text-[9px] text-muted">{entity.type}</span></span>
      <span className="text-[9px] text-muted">{activeComponents}/{entity.components.length}</span>
    </Button>
  );
}

function ComponentRow({ component }: { component: WorldComponentView }) {
  const tone = component.state === "active" ? "bg-green" : component.state === "available" ? "bg-primary" : component.state === "unknown" ? "bg-secondary" : "bg-surface-5";
  return (
    <div className="grid grid-cols-[8px_1fr] gap-x-2 gap-y-0.5 py-1.5 text-[10px]">
      <span className={`mt-1 size-1.5 rounded-full ${tone}`} />
      <span className="min-w-0"><strong className="block truncate font-medium">{component.label}</strong><span className="block truncate text-[9px] text-muted">{component.detail}</span></span>
    </div>
  );
}
