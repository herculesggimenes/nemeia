"use client";

import { PointerEvent as ReactPointerEvent, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CircleStop, MessagesSquare, Route, Settings } from "lucide-react";
import { artifacts, robots, sceneObjects } from "../lib/mock-data";
import type { Artifact } from "../lib/types";
import { UnitreeCameraView } from "../features/unitree/unitree-camera-view";
import { UnitreePointCloudView } from "../features/unitree/unitree-point-cloud-view";
import { ExtendArtifactWorkspace } from "../features/extend/extend-artifact-workspace";
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
} from "../components/ui/sidebar";

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

      <SidebarInset className="appMain">
        <header className="topbar">
          <div className="topbarStatus">
            <button className="stopButton">
              <CircleStop size={18} />
              Emergency Stop
            </button>
          </div>
        </header>
        {children}
      </SidebarInset>

      {!settingsPage ? (
        <aside className="artifactDrawer" style={{ width: `${artifactWidth}px` }}>
          <button
            className="artifactResizeHandle"
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
            <div className="artifactSurface">
              {activeArtifact.type === "camera" ? <UnitreeCameraView objects={sceneObjects} /> : null}

              {activeArtifact.type === "point_cloud" ? <UnitreePointCloudView objects={sceneObjects} /> : null}

              {activeArtifact.type === "control" ? (
                <div className="controlMock">
                  <div className="robotCard compact">
                    <div className="robotGlyph">G2</div>
                    <div>
                      <strong>{robot.name}</strong>
                      <span>{robot.mode}</span>
                    </div>
                  </div>
                  <dl className="metrics compact">
                    <div>
                      <dt>Connection</dt>
                      <dd>{robot.connection}</dd>
                    </div>
                    <div>
                      <dt>Battery</dt>
                      <dd>{robot.battery}%</dd>
                    </div>
                    <div>
                      <dt>Heartbeat</dt>
                      <dd>{robot.lastHeartbeatMs}ms</dd>
                    </div>
                  </dl>
                  <div className="controlGrid">
                    <button>Stand</button>
                    <button>Damp</button>
                    <button>Stop</button>
                    <button>Turn left</button>
                  </div>
                </div>
              ) : null}

              {activeArtifact.type === "artifact" ? (
                <div className="agentArtifact">
                  <Route size={22} />
                  <h2>Generated route note</h2>
                  <p>
                    Avoid direct approach. Use a left arc around floor_cable, re-check mask alignment, then stop 0.8m
                    from red_backpack.
                  </p>
                  <code>nemeiactl plan preview --target obj_backpack --avoid obj_cable</code>
                </div>
              ) : null}
            </div>
          </ExtendArtifactWorkspace>
        </aside>
      ) : null}
    </SidebarProvider>
  );
}
