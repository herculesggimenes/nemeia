"use client";

import { AlertTriangle, Database, LockKeyhole, Radio, RotateCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { setOperatorToken } from "../../lib/world-operator/native-client";
import { isEvidenceFresh } from "../../lib/world-operator/operator-policies";
import { useWorldOperator } from "../../lib/world-operator/use-world-operator";
import { useFeedbackHistory } from "../../lib/world-operator/use-feedback-history";
import type { OperatorEvidenceCandidate } from "../../types/operator";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { AssignmentControls, CreateMissionForm, MissionRecoveryControls } from "./mission-board-operations";
import { FindingRows } from "./finding-review";
import { ExecutionRows, MissionHeader, MissionRow, MissionSteps, ObjectiveRows, StateBadge, WorldEvidence } from "./mission-board-parts";

export function MissionBoardPanel() {
  const operator = useWorldOperator();
  const missionOperations = ["assignMission", "assignUnit", "cancelMission", "createMission", "rejectObjectiveFinding", "reconcileMission", "recordObjectiveProgress"] as const;
  const [selectedMissionId, setSelectedMissionId] = useState<string | null>(null);
  const [candidateEvidence, setCandidateEvidence] = useState<OperatorEvidenceCandidate[]>([]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(timer);
  }, []);
  const selectedMission = useMemo(
    () => operator.projection.missions.find((mission) => mission.id === selectedMissionId) ?? operator.projection.missions[0] ?? null,
    [operator.projection.missions, selectedMissionId]
  );
  const ready = operator.connection === "authenticated" && operator.projection.readiness.synchronized;
  const missionWritesReady = ready && !!operator.projection.operatorIdentity && !operator.pendingOperation && missionOperations.every((operation) => operator.supports(operation));
  const evidence = operator.projection.evidence;
  const staleEvidence = evidence.some((item) => !isEvidenceFresh(item.acquiredAt, 120_000, now));
  const selectedFindings = useMemo(
    () => selectedMission ? operator.projection.findings.filter((finding) => finding.missionId === selectedMission.id) : [],
    [operator.projection.findings, selectedMission]
  );
  const selectedCandidates = useMemo(
    () => selectedMission ? candidateEvidence.filter((candidate) => candidate.missionId === selectedMission.id) : [],
    [candidateEvidence, selectedMission]
  );
  const selectedExecutions = useMemo(
    () => selectedMission ? operator.projection.executions.filter((execution) => execution.missionId === selectedMission.id) : [],
    [operator.projection.executions, selectedMission]
  );
  const feedbackWatermark = useMemo(
    () => selectedMission ? operator.projection.feedbackWatermarks.find((watermark) => watermark.missionId === selectedMission.id) : undefined,
    [operator.projection.feedbackWatermarks, selectedMission]
  );
  const feedbackHistory = useFeedbackHistory(
    JSON.stringify([operator.projection.readiness.worldId, operator.projection.operatorIdentity]),
    selectedMission?.id ?? null,
    feedbackWatermark?.sequence ?? "0",
    ready,
    operator.readEvents
  );

  const proposeCandidate = (candidate: OperatorEvidenceCandidate) => {
    setCandidateEvidence((current) => current.some((item) => item.id === candidate.id) ? current : [...current, candidate]);
  };

  const reviewCandidate = async (candidate: OperatorEvidenceCandidate, accepted: boolean, feedback: string) => {
    const reviewer = operator.projection.operatorIdentity;
    if (!selectedMission || !reviewer || !missionWritesReady) { return; }
    const success = accepted
      ? await operator.invoke("recordObjectiveProgress", {
        evidence: { tag: "Finding", value: { entityId: candidate.entityId, observationIds: candidate.observationIds, reviewedBy: reviewer } },
        expectedMissionRevision: BigInt(selectedMission.revision),
        missionId: candidate.missionId,
        objectiveId: candidate.objectiveId
      })
      : await operator.invoke("rejectObjectiveFinding", {
        entityId: candidate.entityId,
        expectedMissionRevision: BigInt(selectedMission.revision),
        missionId: candidate.missionId,
        objectiveId: candidate.objectiveId,
        observationIds: candidate.observationIds,
        reason: feedback.trim() || "Operator rejected candidate evidence"
      });
    if (success) {
      setCandidateEvidence((current) => current.filter((item) => item.id !== candidate.id));
    }
  };

  return (
    <section className="grid h-full min-h-0 grid-rows-[auto_auto_1fr] overflow-hidden bg-[#F6F2E9] text-[#20352A]" data-testid="operator-mission-board" data-operator-role={operator.projection.readiness.role} data-operator-identity={operator.projection.operatorIdentity ?? undefined}>
      <BoardHeader connection={operator.connection} lastAppliedAt={operator.lastAppliedAt} mode={operator.projection.readiness.mode} onRefresh={operator.refresh} />
      <StatusNotice connection={operator.connection} error={operator.error ?? operator.actionError} missionWritesReady={missionWritesReady} mode={operator.projection.readiness.mode} onConnect={(token) => { setOperatorToken(token); operator.refresh(); }} />
      <div className="grid min-h-0 overflow-auto lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="min-h-0 border-r border-[#D9DED3] bg-[#FFFDF8] lg:overflow-auto">
          <CreateMissionForm disabled={!missionWritesReady} onCreate={operator.invoke} />
          <div className="border-b border-[#D9DED3] px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-[#6E8583]">Authorized missions</div>
          {operator.projection.missions.length > 0 ? operator.projection.missions.map((mission) => (
            <MissionRow key={mission.id} mission={mission} onSelect={() => setSelectedMissionId(mission.id)} selected={selectedMission?.id === mission.id} />
          )) : <p className="px-4 py-5 text-sm leading-5 text-[#6E8583]">No missions are visible in this authenticated world scope.</p>}
          <div className="border-t border-[#D9DED3] px-3 py-3 text-xs text-[#6E8583]">
            <div className="flex items-center gap-2 font-semibold text-[#20352A]"><Database size={14} /> World scope</div>
            <p className="mt-1 font-mono text-[10px]">{operator.projection.readiness.worldId}</p>
            <p className="mt-2">Read scope is the world. Entity interest is derived by the world, not selected here.</p>
          </div>
        </aside>
        <main className="min-w-0 bg-[#F6F2E9]">
          {selectedMission ? (
            <>
              <MissionHeader agents={operator.projection.agents} mission={selectedMission} units={operator.projection.units} />
              <MissionSteps mission={selectedMission} units={operator.projection.units} />
              <ObjectiveRows mission={selectedMission} />
              <AssignmentControls key={selectedMission.id} agents={operator.projection.agents} disabled={!missionWritesReady || selectedMission.state !== "active"} mission={selectedMission} onInvoke={operator.invoke} units={operator.projection.units} />
              <WorldEvidence evidence={evidence} maps={operator.projection.maps} previewEnabled={operator.connection === "authenticated"} stale={staleEvidence || operator.connection !== "authenticated"} />
              <FindingRows
                allowReject={operator.supports("rejectObjectiveFinding")}
                candidates={selectedCandidates}
                disabled={!missionWritesReady || selectedMission.state !== "active"}
                evidence={operator.projection.evidence}
                events={feedbackHistory.history.events}
                historyGap={feedbackHistory.history.historyGap}
                historyError={feedbackHistory.error}
                findings={selectedFindings}
                mission={selectedMission}
                onPropose={proposeCandidate}
                onReview={(candidate, accepted, feedback) => void reviewCandidate(candidate, accepted, feedback)}
              />
              <ExecutionRows disconnected={operator.connection === "disconnected"} executions={selectedExecutions} />
              <MissionRecoveryControls disabled={!missionWritesReady || selectedMission.state === "succeeded" || selectedMission.state === "failed" || selectedMission.state === "cancelled"} mission={selectedMission} onInvoke={operator.invoke} />
            </>
          ) : <><EmptyBoard connection={operator.connection} /><WorldEvidence evidence={evidence} maps={operator.projection.maps} previewEnabled={ready} stale={staleEvidence || !ready} /></>}
        </main>
      </div>
    </section>
  );
}

function BoardHeader({ connection, lastAppliedAt, mode, onRefresh }: { connection: string; lastAppliedAt: string | null; mode: string; onRefresh: () => void }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#D9DED3] bg-[#17382A] px-4 py-3 text-[#FFFDF8]">
      <div className="min-w-0"><div className="flex items-center gap-2"><Radio size={16} /><h1 className="text-base font-semibold">Mission board</h1><Badge className="border-[#8FA88E] text-[#DCE7D8]" variant="outline">World Operator</Badge></div><p className="mt-1 text-xs text-[#B7C9B7]">Durable missions, local maps, observed objects, and reviewed evidence</p></div>
      <div className="flex items-center gap-2 text-xs"><span className="text-[#B7C9B7]">{modeLabel(mode)}</span><StateBadge state={connectionLabel(connection)} /><Button aria-label="Refresh world subscription" className="border-[#8FA88E] bg-transparent text-[#FFFDF8] hover:bg-[#245A40]" onClick={onRefresh} size="iconSm" variant="outline"><RotateCw size={14} /></Button><span className="sr-only">{lastAppliedAt ? `Last applied ${lastAppliedAt}` : "No subscription applied"}</span></div>
    </header>
  );
}

function StatusNotice({ connection, error, missionWritesReady, mode, onConnect }: { connection: string; error: string | null; missionWritesReady: boolean; mode: string; onConnect: (token: string) => void }) {
  const [token, setToken] = useState("");
  if (connection === "authenticated" && !error && missionWritesReady) { return null; }
  const disconnected = connection === "disconnected";
  const forbidden = connection === "forbidden";
  const reducersPending = connection === "authenticated" && !missionWritesReady && !error;
  const title = disconnected ? "World subscription disconnected" : forbidden ? "Operator role not authorized" : connection === "unavailable" ? "Native world-client unavailable" : error ? "World operation failed" : reducersPending ? "World operation pending" : "Waiting for authenticated world subscription";
  const detail = disconnected
    ? "The board retains the last subscribed projection only. Browser stop is unavailable; use the independent local/hardware stop path."
    : forbidden
      ? "This surface accepts only an explicit World Operator or admin member."
      : reducersPending
        ? "Controls wait for the authenticated, synchronized World projection and confirmation of any pending operation."
      : mode === "physical"
        ? "Physical adapter qualification is not established; no physical operation is enabled."
        : "Connect the generated native client with an operator-owned token and member allowlist.";
  return <div className={`flex items-start gap-2 border-b px-4 py-2.5 text-xs ${disconnected || forbidden ? "border-[#E4C9BF] bg-[#FBF0EC] text-[#8D4B38]" : "border-[#D7C38B] bg-[#FBF7E9] text-[#8A6849]"}`} data-testid="operator-status-notice"><AlertTriangle className="mt-0.5 shrink-0" size={14} /><div className="min-w-0"><strong className="font-semibold">{title}</strong><p className="mt-0.5">{error ?? detail}</p>{connection === "unavailable" ? <form className="mt-2 flex max-w-md gap-2" onSubmit={(event) => { event.preventDefault(); if (!token.trim()) { return; } onConnect(token); setToken(""); }}><Input aria-label="Operator token" autoComplete="off" onChange={(event) => setToken(event.target.value)} placeholder="Enter scoped operator token" type="password" value={token} /><Button disabled={!token.trim()} size="sm" type="submit">Connect tab</Button></form> : null}</div></div>;
}


function EmptyBoard({ connection }: { connection: string }) {
  return <div className="grid min-h-80 place-items-center px-6 py-12 text-center"><div className="grid max-w-sm gap-2"><LockKeyhole className="mx-auto text-[#8FA88E]" size={24} /><h2 className="text-base font-semibold text-[#17382A]">No selected mission</h2><p className="text-sm leading-5 text-[#6E8583]">{connection === "authenticated" ? "Create or select a durable mission from the board." : "The board will show missions after an authenticated native subscription is applied."}</p></div></div>;
}

function modeLabel(mode: string): string {
  return mode === "simulation" ? "simulator · no motion" : mode === "physical" ? "physical · qualification required" : "mode unknown";
}

function connectionLabel(connection: string): string {
  return connection === "authenticated" ? "authenticated" : connection;
}
