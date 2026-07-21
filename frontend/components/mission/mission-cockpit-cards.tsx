"use client";

import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  FileClock,
  ShieldCheck,
  XCircle
} from "lucide-react";
import type { AnomalyRecord, CheckResult, MissionRun, ReplaySummary } from "../../types/nemeia";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { useWorkbenchActions } from "../workbench/workbench-context";

const statusTone: Record<CheckResult["status"], string> = {
  fail: "text-danger",
  pass: "text-green",
  warn: "text-primary"
};

const anomalyTone: Record<AnomalyRecord["severity"], string> = {
  info: "border-primary/40 text-primary",
  safety: "border-danger/50 text-danger",
  warning: "border-primary/60 text-primary"
};

export function Metric({ icon: Icon, label, value }: { icon: typeof Activity; label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border border-surface-3 bg-surface-2 p-2">
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase text-muted">
        <Icon size={13} />
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1 truncate text-sm font-bold text-foreground">{value}</div>
    </div>
  );
}

export function ApprovalCard({
  actionPending,
  onApprove,
  onReject,
  run
}: {
  actionPending?: boolean;
  onApprove: () => void;
  onReject: () => void;
  run: MissionRun;
}) {
  return (
    <article className="rounded-md border border-surface-3 bg-surface-1 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-xs font-mono text-muted">{run.id}</div>
          <h3 className="mt-1 text-sm font-bold">{run.verb} · {run.robotId}</h3>
          <p className="mt-1 text-sm leading-5 text-muted">{run.reason}</p>
        </div>
        <Badge className="shrink-0" variant="secondary">{run.state}</Badge>
      </div>
      <div className="mt-3 grid gap-2 rounded-md border border-surface-3 bg-surface-2 p-3 text-xs">
        <div className="flex items-center gap-2 font-semibold">
          <ShieldCheck className="text-primary" size={15} />
          {run.grant.mode}
        </div>
        <div className="text-muted">{run.grant.limits.join(" · ")}</div>
        <div className="text-muted">watchdog {run.grant.watchdogMs}ms · max duration {run.grant.maxDurationMs}ms</div>
      </div>
      <div className="mt-3 grid gap-2">
        {run.checks.map((check) => (
          <div className="flex items-start gap-2 text-sm" key={check.name}>
            {check.status === "pass" ? <CheckCircle2 className={statusTone.pass} size={16} /> : check.status === "warn" ? <AlertTriangle className={statusTone.warn} size={16} /> : <XCircle className={statusTone.fail} size={16} />}
            <div className="min-w-0">
              <div className="font-medium">{check.name}</div>
              <div className="text-xs leading-5 text-muted">{check.detail}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 grid gap-2 text-xs text-muted">
        <div>Approval expires {new Date(run.approval.expiresAt).toLocaleTimeString()}</div>
        <div>Abort triggers: {run.abortTriggers.join(", ")}</div>
        <div>Predicted sweep: {run.predictedSweep}</div>
      </div>
      <RefList refs={run.evidenceRefs} />
      <div className="mt-3 flex gap-2">
        <Button disabled={actionPending} size="sm" onClick={onApprove}>{actionPending ? "Working" : "Approve"}</Button>
        <Button disabled={actionPending} size="sm" variant="outline" onClick={onReject}>Reject</Button>
      </div>
    </article>
  );
}

export function OperatorLane({
  rows,
  title
}: {
  rows: Array<{ action?: () => void; disabled?: boolean; icon: typeof Activity; label: string; panel?: string; value: string }>;
  title: string;
}) {
  const { openPanel } = useWorkbenchActions();
  return (
    <div className="rounded-md border border-surface-3 bg-surface-1 p-3">
      <h3 className="text-sm font-bold">{title}</h3>
      <div className="mt-3 grid gap-2">
        {rows.map((row) => (
          <Button
            className="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-md border border-surface-3 bg-surface-2 p-3 text-left hover:border-primary/50"
            key={row.label}
            variant="ghost"
            disabled={row.disabled}
            onClick={() => {
              if (row.panel) {
                openPanel(row.panel);
              } else {
                row.action?.();
              }
            }}
          >
            <row.icon className="text-primary" size={16} />
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{row.label}</span>
              <span className="block truncate text-xs text-muted">{row.value}</span>
            </span>
            <Badge variant="outline">open</Badge>
          </Button>
        ))}
      </div>
    </div>
  );
}

export function ReplayPanel({ completedReplay }: { completedReplay: ReplaySummary }) {
  return (
    <div className="grid gap-3">
      <div className="rounded-md border border-surface-3 bg-surface-1 p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold">Replay {completedReplay.runId}</h3>
            <p className="text-xs text-muted">Authorizations {completedReplay.authorizationIds.join(", ")}</p>
          </div>
          <Badge variant="outline">{completedReplay.attentionDigests.length} digest</Badge>
        </div>
      </div>
      <ol className="grid gap-2">
        {completedReplay.steps.map((step) => (
          <li className="rounded-md border border-surface-3 bg-surface-1 p-3" key={step.seq}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-xs font-mono text-muted">seq {step.seq} · {step.time}</div>
                <div className="mt-1 text-sm font-semibold">{step.eventType}</div>
                <p className="mt-1 text-sm leading-5 text-muted">{step.summary}</p>
              </div>
              <FileClock className="mt-1 shrink-0 text-primary" size={16} />
            </div>
            <RefList refs={step.refs} />
          </li>
        ))}
      </ol>
    </div>
  );
}

export function AnomalyCard({ anomaly }: { anomaly: AnomalyRecord }) {
  return (
    <article className="rounded-md border border-surface-3 bg-surface-1 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-xs font-mono text-muted">{anomaly.id}</div>
          <h3 className="mt-1 text-sm font-bold">{anomaly.observed}</h3>
        </div>
        <Badge className={anomalyTone[anomaly.severity]} variant="outline">{anomaly.severity}</Badge>
      </div>
      <p className="mt-2 text-sm leading-5 text-muted">{anomaly.expected}</p>
      <div className="mt-2 text-xs text-muted">Owner {anomaly.owner} · {anomaly.status}</div>
      <div className="mt-2 text-xs text-muted">Cause: {anomaly.suspectedCause}</div>
      <RefList refs={anomaly.evidenceRefs} />
    </article>
  );
}

export function RefList({ refs }: { refs: string[] }) {
  return (
    <div className="mt-3 flex flex-wrap gap-1">
      {refs.map((ref) => (
        <Badge className="font-mono text-[10px]" key={ref} variant="outline">{ref}</Badge>
      ))}
    </div>
  );
}
