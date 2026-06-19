"use client";

import { PointerEvent as ReactPointerEvent, type CSSProperties, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CircleStop, Folder, Gamepad2, MessagesSquare, Route, Settings, Video, Waves } from "lucide-react";
import { artifacts, robots } from "../../lib/mock-data";
import type { Artifact } from "../../types/nemeia";
import { UnitreeCameraView } from "../unitree/unitree-camera-view";
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
import { cn } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent } from "../ui/card";
import { initializeGo2Store, useGo2Store } from "../../lib/robots/unitree/go2-store";
import { FileTree, type FileTreeNode } from "../navigation/file-tree";

function isSettingsPath(pathname: string) {
  return pathname === "/settings" || pathname.startsWith("/settings/");
}

function statusTone(status: "connected" | "waiting" | "failed") {
  if (status === "connected") {
    return "bg-green";
  }

  if (status === "failed") {
    return "bg-danger";
  }

  return "bg-muted";
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
  const robot = robots[0];
  const settingsPage = isSettingsPath(pathname);
  const go2ConnectionState = useGo2Store((state) => state.connectionState);
  const go2VideoStream = useGo2Store((state) => state.videoStream);
  const go2LidarFrameCount = useGo2Store((state) => state.lidarFrameCount);
  const go2LidarLastFrameBytes = useGo2Store((state) => state.lidarLastFrameBytes);
  const go2LidarFrame = useGo2Store((state) => state.lidarFrame);
  const go2LidarState = useGo2Store((state) => state.lidarState);
  const go2LastEvent = useGo2Store((state) => state.lastEvent);
  const go2LastError = useGo2Store((state) => state.lastError);
  const sendGo2Command = useGo2Store((state) => state.sendCommand);
  const [activeArtifactId, setActiveArtifactId] = useState<Artifact["id"]>(artifacts[0].id);
  const [openArtifactIds, setOpenArtifactIds] = useState<Artifact["id"][]>([artifacts[0].id, artifacts[1].id]);
  const [artifactWidth, setArtifactWidth] = useState(520);
  const [sidebarWidth, setSidebarWidth] = useState(212);

  const activeArtifact = useMemo(
    () => artifacts.find((artifact) => artifact.id === activeArtifactId) ?? artifacts[0],
    [activeArtifactId]
  );
  const go2TreeNodes = useMemo<FileTreeNode[]>(
    () => {
      const status = go2ConnectionState === "connected" ? "connected" : go2ConnectionState === "failed" ? "failed" : "waiting";

      return [
        {
          id: `systems go2 ${status}`,
          label: "systems/go2",
          ariaLabel: `systems go2 ${status}`,
          detail: go2ConnectionState === "failed" ? go2LastError ?? "Connection failed" : go2ConnectionState,
          statusLabel: statusLabel(status),
          statusTone: statusTone(status),
          icon: Folder,
          children: [
          {
            id: "go2 front camera waiting",
            label: "Front camera",
            ariaLabel: "go2 front camera waiting",
            detail: go2VideoStream ? "streaming" : go2ConnectionState === "connected" ? "waiting for video" : "waiting for Go2",
            statusTone: statusTone(go2VideoStream ? "connected" : "waiting"),
            icon: Video
          },
          {
            id: "go2 lidar waiting",
            label: "LiDAR / SLAM",
            ariaLabel: "go2 lidar waiting",
            detail: go2LidarFrameCount > 0 ? `${go2LidarFrameCount} frames` : go2ConnectionState === "connected" ? "waiting for frame" : "waiting for Go2",
            statusTone: statusTone(go2LidarFrameCount > 0 ? "connected" : "waiting"),
            icon: Waves
          },
          {
            id: "go2 control waiting",
            label: "Control",
            ariaLabel: "go2 control waiting",
            detail: go2ConnectionState === "connected" ? "ready" : "locked",
            statusTone: statusTone(go2ConnectionState === "connected" ? "connected" : "waiting"),
            icon: Gamepad2
          }
          ]
        }
      ];
    },
    [go2ConnectionState, go2LastError, go2LidarFrameCount, go2VideoStream]
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
              <div className="mb-2 px-2 text-[11px] font-bold uppercase tracking-wide text-muted">Systems</div>
              <FileTree
                activeId={
                  activeArtifactId === "camera_front"
                    ? "go2 front camera waiting"
                    : activeArtifactId === "point_cloud"
                      ? "go2 lidar waiting"
                      : activeArtifactId === "controller"
                        ? "go2 control waiting"
                        : null
                }
                ariaLabel="Connected systems"
                nodes={go2TreeNodes}
                testId="connected-systems"
                onSelect={(id) => {
                  if (id.startsWith("go2 front camera")) {
                    openArtifact("camera_front");
                  }
                  if (id.startsWith("go2 lidar")) {
                    openArtifact("point_cloud");
                  }
                  if (id.startsWith("go2 control")) {
                    openArtifact("controller");
                  }
                }}
              />
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

      <SidebarInset className="grid h-screen min-w-0 grid-rows-[48px_1fr] overflow-hidden nemeia-grid-bg">
        <header className="flex min-w-0 items-center justify-end gap-4 border-b border-surface-3 bg-surface-1/80 px-[18px]">
          <div className="flex shrink-0 items-center gap-2.5">
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
        {children}
      </SidebarInset>

      {!settingsPage ? (
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
                <UnitreeCameraView connectionState={go2ConnectionState} stream={go2VideoStream} />
              ) : null}

              {activeArtifact.type === "point_cloud" ? (
                <UnitreePointCloudView
                  connectionState={go2ConnectionState}
                  frameCount={go2LidarFrameCount}
                  frame={go2LidarFrame}
                  lastFrameBytes={go2LidarLastFrameBytes}
                  lidarState={go2LidarState}
                />
              ) : null}

              {activeArtifact.type === "control" ? (
                <div className="grid gap-3 p-4">
                  <Card className="flex items-center gap-3 p-3">
                    <Badge className="grid size-9 place-items-center rounded-md p-0 text-sm font-extrabold">
                      G2
                    </Badge>
                    <div>
                      <strong className="block text-sm text-foreground">{robot.name}</strong>
                      <span className="block text-xs text-muted">{robot.mode}</span>
                    </div>
                  </Card>
                  <CardContent as="dl" className="grid gap-2 rounded-lg border border-surface-3 bg-surface-2 p-3 text-xs">
                    <div className="flex items-center justify-between gap-3">
                      <dt>Connection</dt>
                      <dd className="font-bold text-foreground">{go2ConnectionState === "idle" ? robot.connection : go2ConnectionState}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt>Battery</dt>
                      <dd className="font-bold text-foreground">{robot.battery}%</dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt>Heartbeat</dt>
                      <dd className="font-bold text-foreground">{robot.lastHeartbeatMs}ms</dd>
                    </div>
                  </CardContent>
                  {go2LastEvent || go2LastError ? (
                    <CardContent className="grid gap-1 rounded-lg border border-surface-3 bg-surface-2 p-3 text-xs">
                      {go2LastEvent ? <p className="text-muted">{go2LastEvent}</p> : null}
                      {go2LastError ? <p className="text-danger">{go2LastError}</p> : null}
                    </CardContent>
                  ) : null}
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      className="h-8 text-xs font-bold"
                      variant="outline"
                      onClick={() => sendGo2Command({ type: "balance_stand" })}
                    >
                      Stand
                    </Button>
                    <Button
                      className="h-8 text-xs font-bold"
                      variant="outline"
                      onClick={() => sendGo2Command({ type: "damp" })}
                    >
                      Damp
                    </Button>
                    <Button
                      className={cn("h-8 text-xs font-bold", "border-danger/50 text-danger")}
                      variant="outline"
                      onClick={() => sendGo2Command({ type: "stop_move" })}
                    >
                      Stop
                    </Button>
                    <Button
                      className="h-8 text-xs font-bold"
                      variant="outline"
                      onClick={() => sendGo2Command({ type: "move", vx: 0, vy: 0, yaw: 0.3, durationMs: 350 })}
                    >
                      Turn left
                    </Button>
                  </div>
                </div>
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
            </div>
          </ArtifactWorkspace>
        </aside>
      ) : null}
    </SidebarProvider>
  );
}
