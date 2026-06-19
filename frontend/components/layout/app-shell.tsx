"use client";

import { PointerEvent as ReactPointerEvent, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CircleStop, MessagesSquare, Route, Settings } from "lucide-react";
import { artifacts, robots, sceneObjects } from "../../lib/mock-data";
import type { Artifact } from "../../types/nemeia";
import { UnitreeCameraView } from "../unitree/unitree-camera-view";
import { UnitreePointCloudView } from "../unitree/unitree-point-cloud-view";
import { ExtendArtifactWorkspace } from "../extend/extend-artifact-workspace";
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

function isSettingsPath(pathname: string) {
  return pathname === "/settings" || pathname.startsWith("/settings/");
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const robot = robots[0];
  const settingsPage = isSettingsPath(pathname);
  const [activeArtifactId, setActiveArtifactId] = useState<Artifact["id"]>(artifacts[0].id);
  const [openArtifactIds, setOpenArtifactIds] = useState<Artifact["id"][]>([artifacts[0].id, artifacts[1].id]);
  const [artifactWidth, setArtifactWidth] = useState(520);

  const activeArtifact = useMemo(
    () => artifacts.find((artifact) => artifact.id === activeArtifactId) ?? artifacts[0],
    [activeArtifactId]
  );

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

  return (
    <SidebarProvider className="h-screen overflow-hidden bg-sidebar text-sidebar-foreground">
      <Sidebar className="border-sidebar-border" collapsible="icon">
        <SidebarHeader className="border-b border-sidebar-border">
          <div className="flex h-9 items-center gap-2">
            <SidebarTrigger />
            <Image
              className="h-auto w-32 group-data-[collapsible=icon]:hidden"
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
        </SidebarContent>
      </Sidebar>

      <SidebarInset className="grid h-screen min-w-0 grid-rows-[48px_1fr] overflow-hidden nemeia-grid-bg">
        <header className="flex min-w-0 items-center justify-end gap-4 border-b border-surface-3 bg-surface-1/80 px-[18px]">
          <div className="flex shrink-0 items-center gap-2.5">
            <button className="inline-flex h-9 items-center gap-2 rounded-md border border-red-300/35 bg-red-600 px-3 text-sm font-bold text-white shadow-sm hover:bg-red-500">
              <CircleStop size={18} />
              Emergency Stop
            </button>
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
          <button
            className="absolute top-0 bottom-0 left-0 z-20 m-0 w-2.5 cursor-col-resize border-0 bg-transparent p-0 touch-none after:absolute after:top-0 after:bottom-0 after:left-0 after:w-px after:bg-transparent hover:after:bg-primary"
            onPointerDown={startArtifactResize}
            type="button"
            aria-label="Resize artifact pane"
          />
          <ExtendArtifactWorkspace
            activeArtifactId={activeArtifactId}
            artifacts={artifacts}
            onCloseArtifact={closeArtifact}
            onOpenArtifact={openArtifact}
            openArtifactIds={openArtifactIds}
          >
            <div className="min-h-0 min-w-0 overflow-hidden">
              {activeArtifact.type === "camera" ? <UnitreeCameraView objects={sceneObjects} /> : null}

              {activeArtifact.type === "point_cloud" ? <UnitreePointCloudView objects={sceneObjects} /> : null}

              {activeArtifact.type === "control" ? (
                <div className="grid gap-3 p-4">
                  <div className="flex items-center gap-3 rounded-lg border border-surface-3 bg-surface-2 p-3">
                    <div className="grid size-9 place-items-center rounded-md bg-primary text-sm font-extrabold text-surface-0">
                      G2
                    </div>
                    <div>
                      <strong className="block text-sm text-foreground">{robot.name}</strong>
                      <span className="block text-xs text-muted">{robot.mode}</span>
                    </div>
                  </div>
                  <dl className="grid gap-2 rounded-lg border border-surface-3 bg-surface-2 p-3 text-xs">
                    <div className="flex items-center justify-between gap-3">
                      <dt>Connection</dt>
                      <dd className="font-bold text-foreground">{robot.connection}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt>Battery</dt>
                      <dd className="font-bold text-foreground">{robot.battery}%</dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt>Heartbeat</dt>
                      <dd className="font-bold text-foreground">{robot.lastHeartbeatMs}ms</dd>
                    </div>
                  </dl>
                  <div className="grid grid-cols-2 gap-2">
                    {["Stand", "Damp", "Stop", "Turn left"].map((label) => (
                      <button
                        className={cn(
                          "h-8 rounded-md border border-surface-3 bg-surface-2 text-xs font-bold text-foreground hover:bg-surface-3",
                          label === "Stop" ? "border-danger/50 text-danger" : null
                        )}
                        key={label}
                        type="button"
                      >
                        {label}
                      </button>
                    ))}
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
          </ExtendArtifactWorkspace>
        </aside>
      ) : null}
    </SidebarProvider>
  );
}
