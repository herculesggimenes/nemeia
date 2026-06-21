"use client";

import { PointerEvent as ReactPointerEvent, type CSSProperties, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CircleStop, Folder, Gamepad2, MessagesSquare, PanelBottom, PanelRight, Plus, RefreshCw, Route, Settings, Video, Volume2, Waves } from "lucide-react";
import { artifacts } from "../../lib/mock-data";
import type { Artifact } from "../../types/nemeia";
import { UnitreeCameraView } from "../unitree/unitree-camera-view";
import { Go2ConnectionConfigPanel } from "../unitree/go2-connection-config-panel";
import { UnitreeAudioView } from "../unitree/unitree-audio-view";
import { UnitreeControlPane } from "../unitree/unitree-control-pane";
import { UnitreePointCloudView } from "../unitree/unitree-point-cloud-view";
import { ArtifactWorkspace } from "../artifacts/artifact-workspace";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger
} from "../ui/sidebar";
import { Button } from "../ui/button";
import { initializeGo2Store, useGo2Store } from "../../lib/robots/unitree/go2-store";
import { FileTree, type FileTreeNode } from "../navigation/file-tree";

function isSettingsPath(pathname: string) {
  return pathname === "/settings" || pathname.startsWith("/settings/");
}

function statusTone(status: "connected" | "waiting" | "failed") {
  if (status === "connected") {
    return "bg-green";
  }

  return "bg-danger";
}

function statusLabel(status: "connected" | "waiting" | "failed") {
  if (status === "connected") {
    return "online";
  }

  if (status === "failed") {
    return "failed";
  }

  return "waiting";
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const settingsPage = isSettingsPath(pathname);
  const go2AudioStream = useGo2Store((state) => state.audioStream);
  const go2BatteryPercent = useGo2Store((state) => state.batteryPercent);
  const go2CameraEnabled = useGo2Store((state) => state.cameraEnabled);
  const go2ConnectionState = useGo2Store((state) => state.connectionState);
  const go2VideoStream = useGo2Store((state) => state.videoStream);
  const go2LidarEnabled = useGo2Store((state) => state.lidarEnabled);
  const go2LidarFrameCount = useGo2Store((state) => state.lidarFrameCount);
  const go2LidarLastFrameBytes = useGo2Store((state) => state.lidarLastFrameBytes);
  const go2LidarFrame = useGo2Store((state) => state.lidarFrame);
  const go2LidarState = useGo2Store((state) => state.lidarState);
  const go2RobotPose = useGo2Store((state) => state.robotPose);
  const go2RobotPoseMessageCount = useGo2Store((state) => state.robotPoseMessageCount);
  const go2RobotPoseParseFailureCount = useGo2Store((state) => state.robotPoseParseFailureCount);
  const go2MotorState = useGo2Store((state) => state.motorState);
  const go2LastError = useGo2Store((state) => state.lastError);
  const go2SpeakerEnabled = useGo2Store((state) => state.speakerEnabled);
  const connectGo2 = useGo2Store((state) => state.connect);
  const sendGo2Command = useGo2Store((state) => state.sendCommand);
  const [activeArtifactId, setActiveArtifactId] = useState<Artifact["id"]>(artifacts[0].id);
  const [openArtifactIds, setOpenArtifactIds] = useState<Artifact["id"][]>([artifacts[0].id, artifacts[1].id]);
  const [artifactWidth, setArtifactWidth] = useState(520);
  const [artifactDrawerOpen, setArtifactDrawerOpen] = useState(true);
  const [controlPaneOpen, setControlPaneOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(212);

  const activeArtifact = useMemo(
    () => artifacts.find((artifact) => artifact.id === activeArtifactId) ?? artifacts[0],
    [activeArtifactId]
  );
  const go2TreeNodes = useMemo<FileTreeNode[]>(
    () => {
      const status = go2ConnectionState === "connected" ? "connected" : go2ConnectionState === "failed" ? "failed" : "waiting";
      const reconnectable = go2ConnectionState !== "connected" && go2ConnectionState !== "connecting" && go2ConnectionState !== "testing";

      return [
        {
          id: `go2 ${status}`,
          label: "Go2",
          ariaLabel: `go2 ${status}`,
          detail:
            go2ConnectionState === "failed"
              ? go2LastError ?? "Connection failed"
              : go2BatteryPercent === null
                ? go2ConnectionState
                : `${go2ConnectionState} · ${go2BatteryPercent}%`,
          statusLabel: statusLabel(status),
          statusTone: statusTone(status),
          actionIcon: reconnectable ? RefreshCw : undefined,
          actionId: reconnectable ? "go2 reconnect" : undefined,
          actionLabel: reconnectable ? "Reconnect Go2" : undefined,
          settingsId: "go2 config",
          settingsLabel: "Go2 settings",
          icon: Folder,
          children: [
            {
              id: "go2 front camera",
              label: "Front camera",
              ariaLabel: "go2 front camera",
              detail: !go2CameraEnabled ? "off" : go2VideoStream ? "streaming" : go2ConnectionState === "connected" ? "waiting for video" : "waiting for Go2",
              statusTone: statusTone(go2CameraEnabled && go2VideoStream ? "connected" : "failed"),
              settingsId: "go2 front camera config",
              settingsLabel: "Front camera settings",
              icon: Video
            },
            {
              id: "go2 lidar",
              label: "LiDAR / SLAM",
              ariaLabel: "go2 lidar",
              detail: !go2LidarEnabled ? "off" : go2LidarFrameCount > 0 ? `${go2LidarFrameCount} frames` : go2ConnectionState === "connected" ? "waiting for frame" : "waiting for Go2",
              statusTone: statusTone(go2LidarEnabled && go2LidarFrameCount > 0 ? "connected" : "failed"),
              settingsId: "go2 lidar config",
              settingsLabel: "LiDAR settings",
              icon: Waves
            },
            {
              id: "go2 control",
              label: "Control",
              ariaLabel: "go2 control",
              detail: go2ConnectionState === "connected" ? "ready" : "locked",
              statusTone: statusTone(go2ConnectionState === "connected" ? "connected" : "failed"),
              settingsId: "go2 control config",
              settingsLabel: "Control settings",
              icon: Gamepad2
            },
            {
              id: "go2 speaker",
              label: "Speaker",
              ariaLabel: "go2 speaker",
              detail: !go2SpeakerEnabled ? "off" : go2AudioStream ? "streaming" : go2ConnectionState === "connected" ? "waiting for audio" : "waiting for Go2",
              statusTone: statusTone(go2SpeakerEnabled && go2AudioStream ? "connected" : "failed"),
              settingsId: "go2 speaker config",
              settingsLabel: "Speaker settings",
              icon: Volume2
            }
          ]
        }
      ];
    },
    [go2AudioStream, go2BatteryPercent, go2CameraEnabled, go2ConnectionState, go2LastError, go2LidarEnabled, go2LidarFrameCount, go2SpeakerEnabled, go2VideoStream]
  );

  useEffect(() => {
    initializeGo2Store();
  }, []);

  const openArtifact = (id: Artifact["id"] | undefined) => {
    if (!id) {
      return;
    }

    setOpenArtifactIds((current) => (current.includes(id) ? current : [...current, id]));
    setActiveArtifactId(id);
    setArtifactDrawerOpen(true);
  };

  const closeArtifact = (id: Artifact["id"]) => {
    setOpenArtifactIds((current) => {
      const next = current.filter((artifactId) => artifactId !== id);
      if (activeArtifactId === id) {
        setActiveArtifactId(next[next.length - 1] ?? artifacts[0].id);
      }
      return next.length > 0 ? next : [artifacts[0].id];
    });
  };

  const startArtifactResize = (event: ReactPointerEvent<HTMLElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = artifactWidth;

    const onMove = (moveEvent: PointerEvent) => {
      const nextWidth = startWidth + startX - moveEvent.clientX;
      setArtifactWidth(Math.min(Math.max(nextWidth, 360), 840));
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const startSidebarResize = (event: ReactPointerEvent<HTMLElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth;

    const onMove = (moveEvent: PointerEvent) => {
      const nextWidth = startWidth + moveEvent.clientX - startX;
      setSidebarWidth(Math.min(Math.max(nextWidth, 176), 320));
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <SidebarProvider className="h-screen overflow-hidden bg-sidebar text-sidebar-foreground" style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}>
      <Sidebar className="relative border-sidebar-border" collapsible="icon">
        <SidebarHeader className="border-b border-sidebar-border">
          <div className="flex h-9 items-center gap-2">
            <SidebarTrigger />
            <Image
              className="h-auto w-24 group-data-[collapsible=icon]:hidden"
              src="/assets/nemeia-logo-white.svg"
              alt="Nemeia"
              width={372}
              height={80}
              priority
            />
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={!settingsPage}>
                    <Link href="/">
                      <MessagesSquare />
                      <span>Conversation</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={settingsPage}>
                    <Link href="/settings">
                      <Settings />
                      <span>Settings</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarGroup className="group-data-[collapsible=icon]:hidden">
            <SidebarGroupContent>
              <div className="mb-2 px-2 text-[11px] font-bold uppercase tracking-wide text-muted">Modules</div>
              <FileTree
                activeId={
                  activeArtifactId === "go2_config"
                    ? "go2 config"
                    : activeArtifactId === "camera_front"
                      ? "go2 front camera"
                      : activeArtifactId === "camera_front_config"
                        ? "go2 front camera"
                        : activeArtifactId === "point_cloud"
                          ? "go2 lidar"
                          : activeArtifactId === "lidar_config"
                            ? "go2 lidar"
                            : activeArtifactId === "speaker"
                              ? "go2 speaker"
                            : activeArtifactId === "speaker_config"
                              ? "go2 speaker"
                              : activeArtifactId === "control_config"
                                ? "go2 control"
                                : controlPaneOpen
                                  ? "go2 control"
                                  : null
                }
                ariaLabel="Modules"
                nodes={go2TreeNodes}
                onAction={(id) => {
                  if (id === "go2 reconnect") {
                    void connectGo2();
                  }
                }}
                testId="modules-tree"
                onSelect={(id) => {
                  if (id === "go2 front camera") {
                    openArtifact("camera_front");
                  }
                  if (id === "go2 lidar") {
                    openArtifact("point_cloud");
                  }
                  if (id === "go2 control") {
                    setControlPaneOpen(true);
                  }
                  if (id === "go2 speaker") {
                    openArtifact("speaker");
                  }
                }}
                onOpenSettings={(id) => {
                  if (id === "go2 front camera config") {
                    openArtifact("camera_front_config");
                    return;
                  }
                  if (id === "go2 lidar config") {
                    openArtifact("lidar_config");
                    return;
                  }
                  if (id === "go2 control config") {
                    openArtifact("control_config");
                    return;
                  }
                  if (id === "go2 speaker config") {
                    openArtifact("speaker_config");
                    return;
                  }
                  if (id === "go2 config") {
                    openArtifact("go2_config");
                  }
                }}
              />
              <Button
                className="mt-2 w-full justify-start gap-2 px-2 text-xs"
                variant="ghost"
                size="sm"
                aria-label="Add module"
                onClick={() => openArtifact("add_component")}
              >
                <Plus size={14} />
                <span>Add module</span>
              </Button>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <Button
          className="absolute top-0 right-0 bottom-0 z-20 m-0 h-auto w-2 cursor-col-resize border-0 bg-transparent p-0 touch-none after:absolute after:top-0 after:right-0 after:bottom-0 after:w-px after:bg-transparent hover:after:bg-primary group-data-[collapsible=icon]:hidden"
          onPointerDown={startSidebarResize}
          variant="ghost"
          aria-label="Resize sidebar"
        />
      </Sidebar>

      <SidebarInset className="grid h-screen min-w-0 grid-rows-[48px_minmax(0,1fr)_auto] overflow-hidden nemeia-grid-bg">
        <header className="flex min-w-0 items-center justify-end gap-2 border-b border-surface-3 bg-surface-1/80 px-[18px]">
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {!settingsPage ? (
              <>
                <Button
                  className="size-8"
                  size="icon"
                  variant={artifactDrawerOpen ? "activeTab" : "outline"}
                  onClick={() => setArtifactDrawerOpen((value) => !value)}
                  aria-label={artifactDrawerOpen ? "Hide artifact pane" : "Show artifact pane"}
                >
                  <PanelRight size={15} />
                </Button>
                <Button
                  className="size-8"
                  size="icon"
                  variant={controlPaneOpen ? "activeTab" : "outline"}
                  onClick={() => setControlPaneOpen((value) => !value)}
                  aria-label={controlPaneOpen ? "Hide control pane" : "Show control pane"}
                >
                  <PanelBottom size={15} />
                </Button>
              </>
            ) : null}
            <Button
              className="h-9 gap-2 px-3 text-sm font-bold"
              variant="destructive"
              onClick={() => sendGo2Command({ type: "emergency_stop" })}
            >
              <CircleStop size={18} />
              Emergency Stop
            </Button>
          </div>
        </header>
        <div className="min-h-0 overflow-hidden">{children}</div>
        {!settingsPage ? <UnitreeControlPane open={controlPaneOpen} onOpenChange={setControlPaneOpen} /> : null}
      </SidebarInset>

      {!settingsPage && artifactDrawerOpen ? (
        <aside
          className="relative grid h-screen min-w-0 grid-rows-[1fr] overflow-hidden border-l border-surface-3 bg-surface-1"
          data-testid="artifact-drawer"
          style={{ width: `${artifactWidth}px` }}
        >
          <Button
            className="absolute top-0 bottom-0 left-0 z-20 m-0 h-auto w-2.5 cursor-col-resize border-0 bg-transparent p-0 touch-none after:absolute after:top-0 after:bottom-0 after:left-0 after:w-px after:bg-transparent hover:after:bg-primary"
            onPointerDown={startArtifactResize}
            variant="ghost"
            aria-label="Resize artifact pane"
          />
          <ArtifactWorkspace
            activeArtifactId={activeArtifactId}
            artifacts={artifacts}
            onCloseArtifact={closeArtifact}
            onOpenArtifact={openArtifact}
            openArtifactIds={openArtifactIds}
          >
            <div className="min-h-0 min-w-0 overflow-hidden">
              {activeArtifact.type === "camera" ? (
                <UnitreeCameraView connectionState={go2ConnectionState} enabled={go2CameraEnabled} stream={go2VideoStream} />
              ) : null}

              {activeArtifact.type === "point_cloud" ? (
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
              ) : null}

              {activeArtifact.type === "audio" ? (
                <UnitreeAudioView
                  audioStream={go2AudioStream}
                  connectionState={go2ConnectionState}
                  enabled={go2SpeakerEnabled}
                />
              ) : null}

              {activeArtifact.type === "artifact" ? (
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
              ) : null}

              {activeArtifact.type === "config" ? (
                activeArtifact.id === "go2_config" ? (
                  <Go2ConnectionConfigPanel />
                ) : activeArtifact.id === "add_component" ? (
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
                ) : (
                  <div className="min-h-0 overflow-auto p-4">
                    <div className="grid gap-3 rounded-md border border-surface-3 bg-surface-1 p-4">
                      <h2 className="text-base font-bold text-foreground">{activeArtifact.title}</h2>
                      <p className="text-sm text-muted">{activeArtifact.description}</p>
                      <div className="rounded-md border border-surface-3 bg-surface-2 p-3 text-xs text-muted">
                        Component-specific settings will be wired to the app server config schema.
                      </div>
                    </div>
                  </div>
                )
              ) : null}
            </div>
          </ArtifactWorkspace>
        </aside>
      ) : null}
    </SidebarProvider>
  );
}
