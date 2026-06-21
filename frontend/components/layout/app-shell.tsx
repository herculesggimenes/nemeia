"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { CircleStop } from "lucide-react";
import { initializeGo2Store, useGo2Store } from "../../lib/robots/unitree/go2-store";
import { Button } from "../ui/button";
import { NemeiaWorkbench } from "../workbench/nemeia-workbench";
import type { WorkbenchApi } from "../workbench/workbench-types";

function isSettingsPath(pathname: string) {
  return pathname === "/settings" || pathname.startsWith("/settings/");
}

export function AppShell({ children: _children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const settingsPage = isSettingsPath(pathname);
  const sendGo2Command = useGo2Store((state) => state.sendCommand);
  const workbenchRef = useRef<WorkbenchApi | null>(null);

  useEffect(() => {
    initializeGo2Store();
  }, []);

  return (
    <main className="grid h-screen min-h-0 grid-rows-[48px_minmax(0,1fr)] overflow-hidden bg-background text-foreground">
      <header className="flex min-w-0 items-center justify-between gap-3 border-b border-surface-3 bg-surface-1/95 px-3">
        <div className="flex min-w-0 items-center gap-2">
          <Image
            className="h-auto w-24"
            src="/assets/nemeia-logo-white.svg"
            alt="Nemeia"
            width={372}
            height={80}
            priority
          />
        </div>

        <div className="flex shrink-0 items-center gap-2">
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

      <section className="min-h-0 overflow-hidden nemeia-grid-bg">
        <NemeiaWorkbench ref={workbenchRef} activeRoute={settingsPage ? "settings" : "conversation"} />
      </section>
    </main>
  );
}
