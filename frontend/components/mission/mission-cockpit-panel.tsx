"use client";

import { useCallback, useMemo } from "react";
import {
  Activity,
  Bot,
  Camera,
  Clock3,
  Gamepad2,
  Headphones,
  ListChecks,
  Map,
  MessageSquareText,
  RadioTower,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  Square
} from "lucide-react";
import { useMissionCockpit } from "../../lib/mission-api/cockpit";
import { useRobotRuntime } from "../../lib/robots/standard/robot-runtime";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Progress } from "../ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { useWorkbenchActions } from "../workbench/workbench-context";
import { AnomalyCard, ApprovalCard, Metric, OperatorLane, RefList, ReplayPanel } from "./mission-cockpit-cards";

export function MissionCockpitPanel() {
  const { openPanel } = useWorkbenchActions();
  const cockpit = useMissionCockpit();
  const {
    batteryPercent,
    connectionState,
    driverMode,
    emergencyStopped,
    lastError,
    lastEvent
  } = useRobotRuntime();
  const pendingRuns = cockpit.data?.pendingRuns ?? [];
  const activeRun = pendingRuns[0] ?? cockpit.data?.runs[0];
  const completedReplay = cockpit.data?.completedReplay;
  const sceneObjects = cockpit.data?.sceneObjects ?? [];
  const anomalies = cockpit.data?.anomalies ?? [];
  const attention = cockpit.data?.attention ?? { digestVersion: "none", maxSeverity: "none", pendingCount: 0 };
  const stopState = Boolean(cockpit.data?.robotStatus.stopState);
  const battery = batteryPercent ?? 82;

  const stopRobot = useCallback(() => {
    void cockpit.stopRobot();
  }, [cockpit]);
  const clearStop = useCallback(() => {
    void cockpit.clearStop();
  }, [cockpit]);
  const streamRows = useMemo(() => [
    { icon: Camera, label: "camera_front", value: "NEM-5 stream", panel: "go2.front_camera" },
    { icon: Map, label: "lidar_slam", value: "Scene + Twin input", panel: "go2.point_cloud" },
    { icon: Headphones, label: "speaker/microphone", value: "Operator media", panel: "go2.speaker" }
  ], []);
  const controlRows = useMemo(() => [
    { icon: Gamepad2, label: "manual setpoint", value: "Driver SPI", panel: "go2.control" },
    { icon: Square, label: "set stop state", value: stopState ? "stop state set" : "declared safe state", action: stopRobot },
    { icon: ShieldOff, label: "clear stop state", value: stopState ? "operator recovery" : "not in stop state", action: clearStop, disabled: !stopState },
    { icon: RadioTower, label: "normalized status", value: "NEM-5", panel: "go2.stats" }
  ], [clearStop, stopRobot, stopState]);

  if (cockpit.loading) {
    return (
      <section className="grid h-full min-h-0 place-items-center bg-surface-0 p-6 text-center" data-testid="mission-cockpit-panel">
        <div className="grid gap-2">
          <RadioTower className="mx-auto text-primary" size={22} />
          <strong className="text-sm text-foreground">Loading Mission API</strong>
          <p className="text-sm text-muted">Building the cockpit projection from runs, replay, scene, attention, and anomalies.</p>
        </div>
      </section>
    );
  }

  if (cockpit.error || !activeRun || !completedReplay) {
    return (
      <section className="grid h-full min-h-0 place-items-center bg-surface-0 p-6 text-center" data-testid="mission-cockpit-panel">
        <div className="grid max-w-md gap-2">
          <ShieldAlert className="mx-auto text-danger" size={22} />
          <strong className="text-sm text-foreground">Mission API unavailable</strong>
          <p className="text-sm text-muted">{cockpit.error ?? "The cockpit projection did not include a pending run and replay."}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="grid h-full min-h-0 grid-rows-[auto_auto_1fr] bg-surface-0 text-foreground" data-testid="mission-cockpit-panel">
      <header className="border-b border-surface-3 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-base font-bold">{cockpit.data?.mission.label ?? "Mission"}</h2>
              <Badge variant="outline">Gate 1</Badge>
              <Badge variant={connectionState === "connected" ? "secondary" : "outline"}>{connectionState}</Badge>
            </div>
            <p className="truncate text-xs text-muted">Mission API · Supervisor Kernel · Driver SPI</p>
          </div>
          <div className="flex items-center gap-2">
            <Button className="gap-2" size="sm" variant="outline" onClick={() => openPanel("conversation.main")}>
              <MessageSquareText size={15} />
              Agent
            </Button>
            <Button className="gap-2" disabled={cockpit.actionPendingRunId === "robot-stop"} size="sm" variant="destructive" onClick={stopRobot}>
              <ShieldAlert size={15} />
              {cockpit.actionPendingRunId === "robot-stop" ? "Stopping" : "Stop"}
            </Button>
          </div>
        </div>
      </header>

      <div className="grid gap-3 border-b border-surface-3 p-3 md:grid-cols-[1.2fr_1fr]">
        <div className="grid gap-3 rounded-md border border-surface-3 bg-surface-1 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-mono text-muted">{activeRun.id}</div>
              <h3 className="mt-1 truncate text-sm font-bold">{activeRun.verb} · {activeRun.robotId}</h3>
              <p className="mt-1 line-clamp-2 text-sm leading-5 text-muted">{activeRun.reason}</p>
            </div>
            <Badge className="shrink-0" variant="secondary">{activeRun.state}</Badge>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <Metric icon={ListChecks} label="Checks" value={`${activeRun.checks.filter((check) => check.status === "pass").length}/${activeRun.checks.length}`} />
            <Metric icon={Clock3} label="Watchdog" value={`${activeRun.grant.watchdogMs} ms`} />
            <Metric icon={ShieldCheck} label="Abort" value={activeRun.abortTriggers.length.toString()} />
          </div>
        </div>

        <div className="grid gap-3 rounded-md border border-surface-3 bg-surface-1 p-3">
          <div className="grid grid-cols-3 gap-2">
            <Metric icon={Bot} label="Driver" value={stopState ? "stopped" : driverMode ?? (emergencyStopped ? "damp" : "ready")} />
            <Metric icon={Activity} label="Battery" value={`${battery}%`} />
            <Metric icon={RadioTower} label="Kernel" value={cockpit.data?.robotStatus.safeStateCondition ?? (connectionState === "connected" ? "live" : "standby")} />
          </div>
          <Progress value={battery} />
          <p className={lastError ? "truncate text-xs text-danger" : "truncate text-xs text-muted"}>{lastError ?? lastEvent ?? "Supervisor waiting for an Authorization."}</p>
        </div>
      </div>

      <Tabs className="grid min-h-0 grid-rows-[auto_1fr]" defaultValue="approvals">
        <TabsList className="mx-3 mt-3 grid grid-cols-5">
          <TabsTrigger value="approvals">Approvals</TabsTrigger>
          <TabsTrigger value="operator">Operator</TabsTrigger>
          <TabsTrigger value="scene">Scene</TabsTrigger>
          <TabsTrigger value="replay">Replay</TabsTrigger>
          <TabsTrigger value="attention">Attention</TabsTrigger>
        </TabsList>

        <TabsContent className="min-h-0 overflow-auto p-3" value="approvals">
          <div className="grid gap-3 xl:grid-cols-2">
            {cockpit.actionError ? (
              <div className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
                {cockpit.actionError}
              </div>
            ) : null}
            {pendingRuns.map((run) => (
              <ApprovalCard
                actionPending={cockpit.actionPendingRunId === run.id}
                key={run.id}
                run={run}
                onApprove={() => {
                  void cockpit.decideRun(run.id, "approve");
                }}
                onReject={() => {
                  void cockpit.decideRun(run.id, "reject");
                }}
              />
            ))}
            <div className="grid gap-3">
              {anomalies.map((anomaly) => <AnomalyCard anomaly={anomaly} key={anomaly.id} />)}
            </div>
          </div>
        </TabsContent>

        <TabsContent className="min-h-0 overflow-auto p-3" value="operator">
          <div className="grid gap-3 lg:grid-cols-2">
            <OperatorLane title="Streams" rows={streamRows} />
            <OperatorLane title="Control" rows={controlRows} />
          </div>
        </TabsContent>

        <TabsContent className="min-h-0 overflow-auto p-3" value="scene">
          <div className="grid gap-3">
            {sceneObjects.map((object) => (
              <article className="rounded-md border border-surface-3 bg-surface-1 p-3" key={object.id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-mono text-muted">{object.id}</div>
                    <h3 className="mt-1 truncate text-sm font-bold">{object.label}</h3>
                    <p className="mt-1 text-sm text-muted">{object.relation} · {object.rangeM.toFixed(2)} m</p>
                  </div>
                  <Badge variant="outline">{Math.round(object.confidence * 100)}%</Badge>
                </div>
                <RefList refs={object.state} />
              </article>
            ))}
          </div>
        </TabsContent>

        <TabsContent className="min-h-0 overflow-auto p-3" value="replay">
          <ReplayPanel completedReplay={completedReplay} />
        </TabsContent>

        <TabsContent className="min-h-0 overflow-auto p-3" value="attention">
          <div className="grid gap-3">
            <div className="rounded-md border border-surface-3 bg-surface-1 p-3">
              <h3 className="text-sm font-bold">Agent inbox</h3>
              <p className="mt-1 text-sm leading-5 text-muted">run.own · mission.lifecycle · entity.bound · proximity.advisory</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <Metric icon={Clock3} label="Digest" value={attention.digestVersion} />
                <Metric icon={Activity} label="Pending" value={`${attention.pendingCount}`} />
                <Metric icon={ShieldAlert} label="Max severity" value={attention.maxSeverity} />
              </div>
            </div>
            {completedReplay.attentionDigests.map((digest) => (
              <div className="rounded-md border border-surface-3 bg-surface-1 p-3 font-mono text-xs text-primary" key={digest}>
                {digest}
              </div>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </section>
  );
}
