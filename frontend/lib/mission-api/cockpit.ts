"use client";

import { useEffect, useRef, useState } from "react";
import type { AnomalyRecord, MissionRun, ReplaySummary, SceneObject } from "../../types/nemeia";

export type MissionCockpitData = {
  anomalies: AnomalyRecord[];
  attention: {
    digestVersion: string;
    maxSeverity: string;
    pendingCount: number;
  };
  completedReplay: ReplaySummary;
  mission: {
    id: string;
    label: string;
  };
  pendingRuns: MissionRun[];
  robotStatus: {
    safeStateCondition: string;
    stopState: boolean;
  };
  runs: MissionRun[];
  sceneObjects: SceneObject[];
};

type CockpitState = {
  actionError: string | null;
  actionPendingRunId: string | null;
  clearStop: () => Promise<void>;
  data: MissionCockpitData | null;
  decideRun: (runId: string, decision: "approve" | "reject") => Promise<void>;
  error: string | null;
  loading: boolean;
  refresh: () => Promise<void>;
  stopRobot: () => Promise<void>;
};

type UnknownRecord = Record<string, unknown>;
type CockpitDataState = Omit<CockpitState, "actionError" | "actionPendingRunId" | "clearStop" | "decideRun" | "refresh" | "stopRobot">;

export function useMissionCockpit(): CockpitState {
  const mountedRef = useRef(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionPendingRunId, setActionPendingRunId] = useState<string | null>(null);
  const [state, setState] = useState<CockpitDataState>({ data: null, error: null, loading: true });

  async function refresh() {
    setState((current) => ({ ...current, loading: true }));
    try {
      const response = await fetch("/api/mission/cockpit", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body?.message ?? "Mission cockpit request failed.");
      }
      if (mountedRef.current) {
        setState({ data: normalizeCockpit(body), error: null, loading: false });
      }
    } catch (error) {
      if (mountedRef.current) {
        setState({ data: null, error: error instanceof Error ? error.message : String(error), loading: false });
      }
    }
  }

  async function decideRun(runId: string, decision: "approve" | "reject") {
    setActionError(null);
    setActionPendingRunId(runId);
    try {
      const response = await fetch(`/api/mission/cockpit/runs/${encodeURIComponent(runId)}/decision`, {
        body: JSON.stringify({ decision, reason: `Operator selected ${decision} in cockpit.` }),
        headers: { "content-type": "application/json" },
        method: "POST"
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body?.message ?? `Run ${decision} failed.`);
      }
      await refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setActionPendingRunId(null);
    }
  }

  async function stopRobot() {
    setActionError(null);
    setActionPendingRunId("robot-stop");
    try {
      const response = await fetch("/api/mission/cockpit/robots/robot_01/stop", {
        body: JSON.stringify({ reason: "Operator selected Stop in cockpit." }),
        headers: { "content-type": "application/json" },
        method: "POST"
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body?.message ?? "Robot stop failed.");
      }
      await refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setActionPendingRunId(null);
    }
  }

  async function clearStop() {
    setActionError(null);
    setActionPendingRunId("robot-clear-stop");
    try {
      const response = await fetch("/api/mission/cockpit/robots/robot_01/clear-stop", {
        method: "POST"
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body?.message ?? "Stop-state recovery failed.");
      }
      await refresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setActionPendingRunId(null);
    }
  }

  useEffect(() => {
    mountedRef.current = true;
    void loadCockpit();

    async function loadCockpit() {
      await refresh();
    }

    return () => {
      mountedRef.current = false;
    };
  }, []);

  return { ...state, actionError, actionPendingRunId, clearStop, decideRun, refresh, stopRobot };
}

function normalizeCockpit(rawValue: unknown): MissionCockpitData {
  const raw = record(rawValue);
  const rawEvents = record(raw.events);
  const rawAnomalies = record(raw.anomalies);
  const rawAttention = record(raw.attention);
  const rawContract = record(rawAttention.contract);
  const rawPending = record(rawAttention.pending);
  const rawMission = record(raw.mission);
  const rawRobotStatus = record(raw.robot_status);
  const rawKernelStatus = record(rawRobotStatus.kernel);
  const rawScene = record(raw.scene);
  const runs = records(raw.runs);
  const events = records(rawEvents.items);
  const anomalyItems = records(rawAnomalies.items);
  const replay = raw.replay ?? { authorization_ids: [], attention_digests: [], events: [] };
  const pendingRuns = runs
    .filter((run) => run.state === "awaiting_approval")
    .map((run) => normalizeRun(run, events));
  const normalizedRuns = runs.map((run) => normalizeRun(run, events));
  const completedReplay = normalizeReplay(replay);

  return {
    anomalies: anomalyItems.map(normalizeAnomaly),
    attention: {
      digestVersion: String(rawContract.digest_version ?? "none"),
      maxSeverity: maxSeverity(anomalyItems),
      pendingCount: Number(rawPending.pending_count ?? 0)
    },
    completedReplay,
    mission: {
      id: String(rawMission.id ?? "mission"),
      label: String(rawMission.label ?? "Mission")
    },
    pendingRuns,
    robotStatus: {
      safeStateCondition: String(rawKernelStatus.safe_state_condition ?? "unknown"),
      stopState: Boolean(rawKernelStatus.stop_state)
    },
    runs: normalizedRuns,
    sceneObjects: records(rawScene.entities).map(normalizeSceneObject)
  };
}

function normalizeRun(run: UnknownRecord, events: UnknownRecord[]): MissionRun {
  const awaiting = events.find((event) => event.run_id === run.id && event.event_type === "run.awaiting_approval");
  const awaitingPayload = record(awaiting?.payload);
  const approvalExpiresAt = awaitingPayload.approval_expires_at ?? new Date(Date.now() + 60_000).toISOString();
  const args = record(run.args);
  const target = record(run.target);
  const evidenceRefs = strings(target.evidence_refs);
  const fallbackEvidenceRefs = events.filter((event) => event.run_id === run.id).map((event) => `event:${event.seq}`);

  return {
    id: String(run.id),
    missionId: String(run.mission_id),
    robotId: "robot_01",
    verb: String(run.verb),
    state: missionRunState(run.state),
    proposedBy: String(run.proposed_by ?? "agent"),
    reason: String(run.reason ?? "Mission API run proposal."),
    checks: [
      { name: "run.persisted", status: "pass", detail: "Run proposal is persisted in the NEM Event Log." },
      { name: "approval.required", status: "pass", detail: "Run is awaiting operator approval before Authorization issuance." },
      { name: "authorization.pending", status: "warn", detail: "No physical authority exists until approval creates a signed Authorization." }
    ],
    approval: {
      required: true,
      scope: "per_run",
      expiresAt: String(approvalExpiresAt)
    },
    grant: {
      mode: run.verb === "bounded_move" ? "discrete bounded_move" : "streaming base_velocity_3d",
      limits: [`max_speed_mps ${args.max_speed_mps ?? 0.15}`, `max_yaw_rps ${args.max_yaw_rps ?? 0.2}`],
      watchdogMs: Number(args.watchdog_ms ?? 100),
      maxDurationMs: Number(args.max_duration_ms ?? 120_000)
    },
    abortTriggers: ["operator_stop", "stream_silence"],
    evidenceRefs: evidenceRefs.length > 0 ? evidenceRefs : fallbackEvidenceRefs,
    predictedSweep: target.entity_id ? `Bound target ${target.entity_id} in ${target.snapshot_id}.` : "No target-bound sweep."
  };
}

function normalizeReplay(replayValue: unknown): ReplaySummary {
  const replay = record(replayValue);
  const events = records(replay.events).length > 0 ? records(replay.events) : records(replay.timeline);
  return {
    runId: String(replay.run_id ?? replay.runId ?? "run"),
    authorizationIds: strings(replay.authorization_ids),
    attentionDigests: strings(replay.attention_digests).length > 0 ? strings(replay.attention_digests) : strings(replay.attentionDigests),
    steps: events.map((event) => ({
      seq: Number(event.seq ?? 0),
      time: shortTime(typeof event.timestamp === "string" ? event.timestamp : undefined),
      eventType: String(event.event_type ?? "event"),
      summary: summarizeEvent(event),
      refs: strings(event.refs)
    }))
  };
}

function normalizeSceneObject(entity: UnknownRecord): SceneObject {
  const geometry = record(entity.geometry);
  const center = Array.isArray(geometry.center) ? geometry.center : [];
  const affordances = records(entity.affordances);
  return {
    id: String(entity.id),
    label: String(entity.type ?? entity.id),
    relation: center.length >= 2 ? `map x ${Number(center[0]).toFixed(2)}, y ${Number(center[1]).toFixed(2)}` : "current scene",
    rangeM: Math.hypot(Number(center[0] ?? 0), Number(center[1] ?? 0)),
    confidence: Math.max(0, Math.min(1, Number(affordances[0]?.confidence ?? 0))),
    state: [
      `schema:${entity.physical_schema ?? "unknown"}`,
      `proxy:${entity.physics_proxy ?? "unknown"}`,
      `freshness:${entity.freshness_ms ?? 0}ms`
    ]
  };
}

function normalizeAnomaly(anomaly: UnknownRecord): AnomalyRecord {
  return {
    id: String(anomaly.id),
    missionId: String(anomaly.mission_id),
    severity: anomalySeverity(anomaly.severity),
    status: anomaly.status === "closed" ? "closed" : "open",
    owner: String(anomaly.owner ?? "operator"),
    expected: String(anomaly.expected ?? ""),
    observed: String(anomaly.observed ?? ""),
    evidenceRefs: strings(anomaly.evidence_refs),
    suspectedCause: String(anomaly.suspected_cause ?? "")
  };
}

function shortTime(value: string | undefined): string {
  if (!value) {
    return "--:--:--";
  }
  return new Date(value).toLocaleTimeString();
}

function summarizeEvent(event: UnknownRecord): string {
  const payload = record(event.payload);
  if (payload.reason) {
    return String(payload.reason);
  }
  if (payload.authorization_id) {
    return `authorization ${payload.authorization_id}`;
  }
  if (payload.verb) {
    return `verb ${payload.verb}`;
  }
  return String(event.event_type ?? "event");
}

function maxSeverity(anomalies: UnknownRecord[]): string {
  if (anomalies.some((anomaly) => anomaly.severity === "safety")) {
    return "safety";
  }
  if (anomalies.some((anomaly) => anomaly.severity === "warning")) {
    return "warning";
  }
  return anomalies.length > 0 ? "info" : "none";
}

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {};
}

function records(value: unknown): UnknownRecord[] {
  return Array.isArray(value) ? value.map(record) : [];
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function missionRunState(value: unknown): MissionRun["state"] {
  const allowed: MissionRun["state"][] = ["awaiting_approval", "authorized", "completed", "rejected", "aborted", "executing", "expired"];
  return allowed.includes(value as MissionRun["state"]) ? value as MissionRun["state"] : "awaiting_approval";
}

function anomalySeverity(value: unknown): AnomalyRecord["severity"] {
  return value === "safety" || value === "warning" || value === "info" ? value : "info";
}
