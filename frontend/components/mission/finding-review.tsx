"use client";

import { AlertTriangle, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { reviewStatusLabel } from "../../lib/world-operator/state-presentation";
import type {
  OperatorEvidence,
  OperatorEvidenceCandidate,
  OperatorEvent,
  OperatorFinding,
  OperatorMission
} from "../../types/operator";
import { Checkbox } from "../ui/checkbox";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

export function FindingRows({ allowReject, candidates, disabled, evidence, events, findings, historyGap, historyError, mission, onPropose, onReview }: {
  allowReject: boolean;
  candidates: OperatorEvidenceCandidate[];
  disabled: boolean;
  evidence: OperatorEvidence[];
  events: OperatorEvent[];
  findings: OperatorFinding[];
  historyGap: boolean;
  historyError: boolean;
  mission: OperatorMission;
  onPropose: (candidate: OperatorEvidenceCandidate) => void;
  onReview: (candidate: OperatorEvidenceCandidate, accepted: boolean, feedback: string) => void;
}) {
  const rejectionEvents = events.filter((event) => event.kind === "mission.finding_rejected");
  const pendingCandidates = candidates.filter((candidate) => mission.objectives.some((objective) => objective.id === candidate.objectiveId && objective.criterion === "located" && objective.state !== "accepted"));
  const reviewLabel = reviewStatusLabel(mission.state, pendingCandidates.length, findings.length);
  return (
    <section className="border-b border-[#D9DED3] bg-[#FFFDF8]" data-testid="finding-review">
      <div className="flex items-center justify-between border-b border-[#D9DED3] px-4 py-2.5"><h3 className="text-xs font-semibold uppercase tracking-wide text-[#6E8583]">Evidence review</h3><span className={`text-[10px] ${reviewLabel === "operator decision required" ? "text-[#B86E56]" : "text-[#6E8583]"}`}>{reviewLabel}</span></div>
      <CandidateEvidencePicker key={mission.id} disabled={disabled} evidence={evidence} mission={mission} onPropose={onPropose} />
      {candidates.map((candidate) => (
        <div className="grid gap-3 border-t border-[#D9DED3] px-4 py-3" key={candidate.id}>
          <div><p className="text-sm font-medium text-[#20352A]">Candidate evidence for review · {candidate.entityLabel}</p><p className="mt-1 text-xs text-[#6E8583]">{candidate.description}</p><p className="mt-1 font-mono text-[10px] text-[#6E8583]">{candidate.entityId} · {candidate.observationIds.length} cited observation{candidate.observationIds.length === 1 ? "" : "s"} · tab-local proposal</p></div>
          <FindingActions allowReject={allowReject} candidate={candidate} disabled={disabled} onReview={onReview} />
        </div>
      ))}
      {findings.length > 0 ? <div className="grid gap-2 border-t border-[#D9DED3] px-4 py-3"><p className="text-xs font-semibold uppercase tracking-wide text-[#6E8583]">Accepted proof from World</p>{findings.map((finding) => <div className="grid gap-1" key={finding.id}><p className="text-sm text-[#20352A]">{finding.description}</p><p className="break-all font-mono text-[10px] text-[#6E8583]">{finding.observationIds.join(", ")} · reviewed by {finding.reviewedBy} · {formatTime(finding.reviewedAt)}</p></div>)}</div> : null}
      {rejectionEvents.length > 0 ? <div className="grid gap-2 border-t border-[#D9DED3] px-4 py-3"><p className="text-xs font-semibold uppercase tracking-wide text-[#6E8583]">World rejection feedback</p>{rejectionEvents.map((event) => <div className="grid gap-1" key={event.id}><p className="font-mono text-[10px] text-[#6E8583]">{formatTime(event.recordedAt)} · {event.id}</p><p className="break-words text-xs text-[#8D4B38]">{rejectionReason(event.detail)}</p></div>)}</div> : null}
      {historyError ? <p role="alert" className="px-4 py-2 text-xs text-[#8D4B38]">Feedback could not be refreshed. Previously read feedback remains visible.</p> : null}
      {historyGap ? <p className="border-t border-[#D7C38B] bg-[#FBF7E9] px-4 py-2 text-[11px] text-[#8A6849]">World event history has a bounded gap; only the authorized feedback page is shown.</p> : null}
    </section>
  );
}

function CandidateEvidencePicker({ disabled, evidence, mission, onPropose }: { disabled: boolean; evidence: OperatorEvidence[]; mission: OperatorMission; onPropose: (candidate: OperatorEvidenceCandidate) => void }) {
  const locatedObjectives = useMemo(() => mission.objectives.filter((objective) => objective.criterion === "located" && objective.state !== "accepted"), [mission.objectives]);
  const entities = useMemo(() => Array.from(new Map(evidence.map((item) => [item.entityId, item.label])).entries()), [evidence]);
  const [requestedObjectiveId, setObjectiveId] = useState(locatedObjectives[0]?.id ?? "");
  const [requestedEntityId, setEntityId] = useState(entities[0]?.[0] ?? "");
  const [observationIds, setObservationIds] = useState<string[]>([]);
  const selectedObjective = locatedObjectives.find((objective) => objective.id === requestedObjectiveId) ?? locatedObjectives[0];
  const objectiveId = selectedObjective?.id ?? "";
  const entityId = entities.some(([id]) => id === requestedEntityId) ? requestedEntityId : entities[0]?.[0] ?? "";
  const entityEvidence = evidence.filter((item) => item.entityId === entityId);

  const availableIdsKey = JSON.stringify(entityEvidence.slice(0, 32).map((item) => item.observationId).toSorted());
  useEffect(() => {
    const available = new Set<string>(JSON.parse(availableIdsKey));
    setObservationIds((selected) => selected.every((id) => available.has(id)) ? selected : selected.filter((id) => available.has(id)));
  }, [availableIdsKey]);

  if (mission.state !== "active") {
    return <p className="px-4 py-3 text-xs text-[#6E8583]">Candidate review is closed · mission {mission.state}.</p>;
  }
  if (!selectedObjective) {
    return <p className="px-4 py-3 text-xs text-[#6E8583]">{mission.objectives.some((objective) => objective.criterion === "located") ? "All Located objectives have accepted evidence." : "This mission has no Located objective."}</p>;
  }

  const propose = () => {
    if (!entityId || observationIds.length === 0) { return; }
    const label = entities.find(([id]) => id === entityId)?.[1] ?? entityId;
    onPropose({
      description: selectedObjective.description,
      entityId,
      entityLabel: label,
      id: `candidate:${mission.id}:${selectedObjective.id}:${entityId}:${observationIds.join(",")}`,
      missionId: mission.id,
      objectiveId: selectedObjective.id,
      observationIds: [...observationIds],
      status: "pending",
    });
    setObservationIds([]);
  };

  return <div className="grid gap-2 border-b border-[#D9DED3] px-4 py-3"><div><p className="text-xs font-semibold text-[#20352A]">Select candidate evidence for review</p><p className="mt-1 text-[11px] text-[#6E8583]">Choose an authorized observed object and one or more of its cited observations. This proposal is not an agent finding and is not stored until you review it.</p></div><div className="grid gap-2 sm:grid-cols-2"><label className="grid gap-1 text-[10px] font-semibold uppercase tracking-wide text-[#6E8583]">Located objective<select aria-label="Located objective" className="h-8 rounded border border-[#C8D1C5] bg-[#FFFDF8] px-2 text-xs font-normal normal-case text-[#20352A]" disabled={disabled} onChange={(event) => { setObjectiveId(event.target.value); setObservationIds([]); }} value={objectiveId}>{locatedObjectives.map((objective) => <option key={objective.id} value={objective.id}>{objective.description}</option>)}</select></label><label className="grid gap-1 text-[10px] font-semibold uppercase tracking-wide text-[#6E8583]">Observed object<select aria-label="Observed object" className="h-8 rounded border border-[#C8D1C5] bg-[#FFFDF8] px-2 text-xs font-normal normal-case text-[#20352A]" disabled={disabled || entities.length === 0} onChange={(event) => { setEntityId(event.target.value); setObservationIds([]); }} value={entityId}>{entities.map(([id, label]) => <option key={id} value={id}>{label} · {id}</option>)}</select></label></div><div className="grid gap-1">{entityEvidence.length > 0 ? entityEvidence.slice(0, 32).map((item) => <label className="flex items-center gap-2 text-xs text-[#20352A]" key={item.observationId}><Checkbox aria-label={`Cite ${item.observationId}`} checked={observationIds.includes(item.observationId)} disabled={disabled} onCheckedChange={(checked) => setObservationIds((current) => checked === true ? [...current, item.observationId] : current.filter((id) => id !== item.observationId))} /> <span className="min-w-0 truncate">{item.observationId} · {item.geometryKind} · {formatAge(item.acquiredAt)}</span></label>) : <span className="text-xs text-[#6E8583]">No authorized observations are available for this object.</span>}</div><Button className="justify-self-start" disabled={disabled || observationIds.length === 0} onClick={propose} size="sm" type="button" variant="outline">Add candidate evidence</Button></div>;
}

function FindingActions({ allowReject, candidate, disabled, onReview }: { allowReject: boolean; candidate: OperatorEvidenceCandidate; disabled: boolean; onReview: (candidate: OperatorEvidenceCandidate, accepted: boolean, feedback: string) => void }) {
  const [feedback, setFeedback] = useState("");
  return <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]"><Input maxLength={512} aria-label={`Feedback for ${candidate.id}`} disabled={disabled || !allowReject} onChange={(event) => setFeedback(event.target.value)} placeholder={allowReject ? "Required for useful rejection feedback" : "Rejection reducer unavailable"} value={feedback} /><div className="flex flex-wrap gap-2"><Button disabled={disabled} onClick={() => onReview(candidate, true, "")} size="sm" variant="default"><ShieldCheck size={14} /> Accept evidence</Button><Button disabled={disabled || !allowReject || !feedback.trim()} onClick={() => onReview(candidate, false, feedback)} size="sm" variant="outline"><AlertTriangle size={14} /> Reject</Button></div></div>;
}

function formatTime(valueToFormat: string | null): string {
  if (!valueToFormat) { return "—"; }
  const date = new Date(valueToFormat);
  return Number.isNaN(date.getTime()) ? valueToFormat : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function formatAge(valueToFormat: string | null): string {
  if (!valueToFormat) { return "time unknown"; }
  const date = new Date(valueToFormat);
  if (Number.isNaN(date.getTime())) { return "time unknown"; }
  const ageMs = Date.now() - date.getTime();
  if (ageMs < 0) { return "future timestamp · not fresh"; }
  const ageSeconds = Math.round(ageMs / 1_000);
  return ageSeconds < 60 ? `${ageSeconds}s old` : `${Math.round(ageSeconds / 60)}m old`;
}

function rejectionReason(detail: string): string {
  try {
    const value: unknown = JSON.parse(detail);
    if (value && typeof value === "object" && "reason" in value && typeof value.reason === "string") { return value.reason; }
  } catch { /* Older audit entries may be plain text. */ }
  return detail;
}
