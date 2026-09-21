"use client";

import { Check, MapPinned, WifiOff } from "lucide-react";
import Image from "next/image";
import { useEffect, useState } from "react";
import { fetchAuthorizedResourceBytes, fetchAuthorizedResourceReferences } from "../../lib/world-operator/native-client";
import { parseResourceReference } from "../../lib/world-operator/resource-read-policy";
import { operatorStateTone } from "../../lib/world-operator/state-presentation";
import type {
  OperatorAgent,
  OperatorEvidence,
  OperatorExecution,
  OperatorMap,
  OperatorMission,
  OperatorUnit
} from "../../types/operator";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";

export function MissionRow({ mission, selected, onSelect }: { mission: OperatorMission; selected: boolean; onSelect: () => void }) {
  const complete = mission.objectives.filter((objective) => objective.state === "accepted").length;
  return (
    <Button
      aria-current={selected ? "page" : undefined}
      className={`grid h-auto min-h-16 w-full grid-cols-[8px_1fr_auto] items-start justify-normal gap-3 whitespace-normal rounded-none border-0 border-b border-[#D9DED3] px-3 py-3 text-left ${selected ? "bg-[#EEF2E8]" : "bg-[#FFFDF8] hover:bg-[#F3F0E8]"}`}
      onClick={onSelect}
      type="button"
      variant="ghost"
    >
      <span className={`mt-1.5 size-2 rounded-full ${missionTone(mission.state)}`} />
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-[#20352A]">{mission.description}</span>
        <span className="mt-1 block truncate font-mono text-[10px] text-[#6E8583]">{mission.id} · rev {mission.revision}</span>
      </span>
      <span className="text-right text-[10px] text-[#6E8583]">
        <span className="block font-semibold text-[#20352A]">{complete}/{mission.objectives.length}</span>
        <span className="block uppercase">{mission.state}</span>
      </span>
    </Button>
  );
}

export function MissionHeader({ mission, agents, units }: { mission: OperatorMission; agents: OperatorAgent[]; units: OperatorUnit[] }) {
  const participantNames = mission.agentIds.map((id) => agents.find((agent) => agent.id === id)?.displayName ?? id);
  const assignedUnits = units.filter((unit) => unit.agentId && mission.agentIds.includes(unit.agentId));
  return (
    <header className="border-b border-[#D9DED3] bg-[#FFFDF8] px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-[#17382A]">{mission.description}</h2>
            <StateBadge state={mission.state} />
          </div>
          <p className="mt-1 font-mono text-[11px] text-[#6E8583]">{mission.id} · revision {mission.revision}</p>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-right text-xs text-[#6E8583]">
          <span>agents <strong className="text-[#20352A]">{participantNames.join(", ") || "unassigned"}</strong></span>
          <span>Units <strong className="text-[#20352A]">{assignedUnits.map((unit) => unit.displayName).join(", ") || "none"}</strong></span>
          <span>deadline <strong className="text-[#20352A]">{formatTime(mission.deadlineAt)}</strong></span>
          <span>progress <strong className="text-[#20352A]">{mission.progressCount}/{mission.objectives.length}</strong></span>
        </div>
      </div>
    </header>
  );
}

export function MissionSteps({ mission, units }: { mission: OperatorMission; units: OperatorUnit[] }) {
  const assigned = mission.agentIds.length > 0;
  const granted = units.some((unit) => unit.agentId && mission.agentIds.includes(unit.agentId) && unit.actionNames.length > 0);
  const observed = mission.objectives.some((objective) => objective.evidenceIds.length > 0);
  const reviewed = mission.objectives.some((objective) => objective.state === "accepted");
  const steps = [
    ["Create", true],
    ["Assign agent", assigned],
    ["Grant Unit", granted],
    ["Observe", observed],
    ["Review", reviewed]
  ] as const;
  return (
    <ol className="grid grid-cols-5 border-b border-[#D9DED3] bg-[#F6F2E9] px-4 py-3">
      {steps.map(([label, complete], index) => (
        <li className="relative flex items-center gap-2 text-xs text-[#6E8583]" key={label}>
          <span className={`grid size-5 place-items-center rounded-full border text-[10px] ${complete ? "border-[#245A40] bg-[#245A40] text-white" : "border-[#B8C2B6] bg-[#FFFDF8]"}`}>
            {complete ? <Check size={12} /> : index + 1}
          </span>
          <span className={complete ? "font-semibold text-[#245A40]" : ""}>{label}</span>
        </li>
      ))}
    </ol>
  );
}

export function ObjectiveRows({ mission }: { mission: OperatorMission }) {
  return (
    <section className="border-b border-[#D9DED3] bg-[#FFFDF8]" data-testid="mission-objectives">
      <div className="flex items-center justify-between border-b border-[#D9DED3] px-4 py-2.5">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[#6E8583]">Objectives</h3>
        <span className="font-mono text-[10px] text-[#6E8583]">{mission.progressCount} accepted</span>
      </div>
      <div className="divide-y divide-[#D9DED3]">
        {mission.objectives.length > 0 ? mission.objectives.map((objective) => (
          <div className="grid grid-cols-[8px_1fr_auto] gap-3 px-4 py-3" key={objective.id}>
            <span className={`mt-1.5 size-2 rounded-full ${objective.state === "accepted" ? "bg-[#245A40]" : objective.state === "blocked" ? "bg-[#C5A15A]" : "bg-[#B86E56]"}`} />
            <div className="min-w-0">
              <p className="text-sm font-medium text-[#20352A]">{objective.description}</p>
              <p className="mt-1 font-mono text-[10px] text-[#6E8583]">{objective.id} · {objective.criterion}{objective.optional ? " · optional" : ""}</p>
              {objective.dependsOn.length > 0 ? <p className="mt-1 text-xs text-[#8A6849]">Depends on {objective.dependsOn.join(", ")}</p> : null}
            </div>
            <Badge className="self-start border-[#D9DED3] text-[10px]" variant="outline">{objective.state}</Badge>
          </div>
        )) : <p className="px-4 py-4 text-sm text-[#6E8583]">No objectives are visible in the authorized projection.</p>}
      </div>
    </section>
  );
}

export function WorldEvidence({ maps, evidence, previewEnabled, stale }: { maps: OperatorMap[]; evidence: OperatorEvidence[]; previewEnabled: boolean; stale: boolean }) {
  return (
    <section className="border-b border-[#D9DED3] bg-[#FFFDF8]" data-testid="world-evidence">
      <div className="flex items-center justify-between border-b border-[#D9DED3] px-4 py-2.5">
        <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[#6E8583]"><MapPinned size={14} /> World / evidence</h3>
        {stale ? <Badge className="border-[#C5A15A] text-[#8A6849]" variant="outline">stale</Badge> : null}
      </div>
      <div className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_250px]">
        <MapPreview maps={maps} evidence={evidence} />
        <EvidenceList evidence={evidence} previewEnabled={previewEnabled} />
      </div>
    </section>
  );
}

function MapPreview({ maps, evidence }: { maps: OperatorMap[]; evidence: OperatorEvidence[] }) {
  return (
    <div className="min-h-48 border border-[#D9DED3] bg-[#F6F2E9] p-3" data-testid="operator-map">
      <div className="flex items-center justify-between text-xs text-[#6E8583]">
        <span>local map metadata · {maps[0]?.id ?? "not subscribed"}</span>
        <span className="font-mono">rev {maps[0]?.revision ?? "—"}</span>
      </div>
      <div className="mt-3 grid gap-2 border border-[#D9DED3] bg-[#EEF2E8] p-3 text-[11px] text-[#6E8583]">
        <div className="grid gap-1 sm:grid-cols-3">
          <span>root frame <strong className="font-mono text-[#20352A]">{maps[0]?.rootFrameId ?? "—"}</strong></span>
          <span>Unit <strong className="font-mono text-[#20352A]">{maps[0]?.unitId ?? "—"}</strong></span>
          <span>updated <strong className="text-[#20352A]">{formatTime(maps[0]?.updatedAt ?? null)}</strong></span>
        </div>
        {evidence.filter((item) => item.position).slice(0, 8).map((item) => (
          <div className="grid gap-1 border-t border-[#D9DED3] pt-2" key={item.observationId}>
            <span className="font-medium text-[#20352A]">{item.label}</span>
            <span className="font-mono">{item.observationId} · {item.frameId ?? "frame unknown"} · {formatPosition(item.position!)}</span>
          </div>
        ))}
        {evidence.every((item) => !item.position) ? <span>No world-frame pose is available for an honest spatial plot.</span> : null}
      </div>
      <p className="mt-2 flex items-center gap-2 text-[11px] text-[#6E8583]"><MapPinned size={13} /> Coordinates stay in their authoritative source frame; a shared-frame plot waits for committed map bounds and axis metadata.</p>
    </div>
  );
}

function EvidenceList({ evidence, previewEnabled }: { evidence: OperatorEvidence[]; previewEnabled: boolean }) {
  return (
    <div className="divide-y divide-[#D9DED3] border-y border-[#D9DED3]">
      {evidence.length > 0 ? evidence.slice(0, 6).map((item) => (
        <div className="grid gap-1 py-2.5 text-xs" key={item.observationId}>
          <div className="flex items-center justify-between gap-2"><span className="font-medium text-[#20352A]">{item.label}</span><span className="font-mono text-[10px] text-[#6E8583]">{formatAge(item.acquiredAt)}</span></div>
          <span className="truncate font-mono text-[10px] text-[#6E8583]">{item.observationId} · {item.geometryKind} · {item.resources.length} retained reference{item.resources.length === 1 ? "" : "s"}</span>
          {item.resources.length > 0 ? <span className="truncate font-mono text-[10px] text-[#6E8583]">{item.resources.map((resource) => `${resource.schema} · ${resource.byteLength} B · ${resource.sha256.slice(0, 12)}…`).join(" | ")}</span> : null}
          {item.position ? <span className="font-mono text-[10px] text-[#6E8583]">position {formatPosition(item.position)}</span> : null}
          {item.imageBox ? <span className="font-mono text-[10px] text-[#6E8583]">image box {formatImageBox(item.imageBox)} · {item.imageBox.frame.streamId}</span> : null}
          {previewEnabled ? <EvidencePreview evidence={item} /> : <span className="text-[10px] text-[#8A6849]">Image preview requires an authenticated resource read.</span>}
        </div>
      )) : <p className="py-4 text-xs text-[#6E8583]">No observed objects in this authorized subscription.</p>}
    </div>
  );
}

function EvidencePreview({ evidence }: { evidence: OperatorEvidence }) {
  const observationId = evidence.observationId;
  const imageKey = JSON.stringify(evidence.resources.find(isImageReference) ?? null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [message, setMessage] = useState("Checking retained image evidence…");

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setPreviewUrl(null);
    setMessage("Checking retained image evidence…");

    const load = async () => {
      try {
        const references = imageKey !== "null"
          ? [parseResourceReference(JSON.parse(imageKey))]
          : await fetchAuthorizedResourceReferences({ kind: "observation", observationId });
        const image = references.find(isImageReference);
        if (!image) {
          if (!cancelled) { setMessage("No retained image reference for this observation."); }
          return;
        }
        const byteLength = Number(image.byteLength);
        if (!Number.isSafeInteger(byteLength) || byteLength <= 0 || byteLength > 8 * 1024 * 1024) {
          if (!cancelled) { setMessage("Image exceeds the bounded browser read."); }
          return;
        }
        const response = await fetchAuthorizedResourceBytes({
          context: { kind: "observation", observationId },
          length: byteLength,
          offset: 0,
          resource: image,
        });
        const url = URL.createObjectURL(await response.blob());
        objectUrl = url;
        if (cancelled) {
          URL.revokeObjectURL(url);
        } else {
          setPreviewUrl(url);
          setMessage("Retained image preview");
        }
      } catch {
        if (!cancelled) { setMessage("Authorized image preview unavailable."); }
      }
    };

    void load();
    return () => {
      cancelled = true;
      if (objectUrl) { URL.revokeObjectURL(objectUrl); }
    };
  }, [imageKey, observationId]);

  return previewUrl
    ? <Image alt={`${evidence.label} retained observation`} className="mt-2 h-20 w-20 rounded border border-[#D9DED3] object-cover" height={80} src={previewUrl} unoptimized width={80} />
    : <span className="text-[10px] text-[#6E8583]">{message}</span>;
}

function isImageReference(reference: OperatorEvidence["resources"][number]): boolean {
  return reference.schema === "image/png" || reference.schema === "image/jpeg" || reference.schema === "image/webp";
}

function formatPosition(position: { x: number; y: number; z: number }): string {
  return `${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)} m`;
}

function formatImageBox(imageBox: OperatorEvidence["imageBox"]): string {
  if (!imageBox) { return "—"; }
  return `${imageBox.centerX.toFixed(1)},${imageBox.centerY.toFixed(1)} · ${imageBox.width.toFixed(1)}×${imageBox.height.toFixed(1)} px`;
}

export function ExecutionRows({ executions, disconnected }: { executions: OperatorExecution[]; disconnected: boolean }) {
  return (
    <section className="border-b border-[#D9DED3] bg-[#FFFDF8]" data-testid="mission-executions">
      <div className="flex items-center justify-between border-b border-[#D9DED3] px-4 py-2.5"><h3 className="text-xs font-semibold uppercase tracking-wide text-[#6E8583]">Typed executions</h3><span className="text-[10px] text-[#6E8583]">No direct robot commands</span></div>
      <div className="divide-y divide-[#D9DED3]">
        {executions.length > 0 ? executions.map((execution) => (
          <div className="grid grid-cols-[1fr_auto] gap-3 px-4 py-3" key={execution.id}>
            <div className="min-w-0"><p className="truncate text-sm font-medium text-[#20352A]">{execution.action} · {execution.unitId}</p><p className="mt-1 truncate font-mono text-[10px] text-[#6E8583]">{execution.id} · {execution.result ?? "awaiting authoritative receipt"}</p></div>
            <Badge className="self-start border-[#D9DED3] text-[10px]" variant="outline">{execution.state}</Badge>
          </div>
        )) : <p className="px-4 py-4 text-sm text-[#6E8583]">No execution receipt is visible for this mission.</p>}
      </div>
      {disconnected ? <p className="flex items-center gap-2 border-t border-[#E4C9BF] bg-[#FBF0EC] px-4 py-2 text-xs text-[#8D4B38]"><WifiOff size={14} /> Browser stop is unavailable while disconnected. Use the independent local/hardware stop path.</p> : null}
    </section>
  );
}

export function StateBadge({ state }: { state: string }) {
  const tone = operatorStateTone(state);
  const className = tone === "healthy" ? "border-[#AFC7AF] bg-[#EEF2E8] text-[#245A40]" : tone === "warning" ? "border-[#D7C38B] bg-[#FBF7E9] text-[#8A6849]" : tone === "error" ? "border-[#E4C9BF] bg-[#FBF0EC] text-[#8D4B38]" : "border-[#C8D1C5] bg-[#F6F2E9] text-[#6E8583]";
  return <Badge className={className} variant="outline">{state}</Badge>;
}

function missionTone(state: string) {
  const tone = operatorStateTone(state);
  return tone === "healthy" ? "bg-[#245A40]" : tone === "warning" ? "bg-[#C5A15A]" : tone === "error" ? "bg-[#B86E56]" : "bg-[#6E8583]";
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
  if (date.getTime() > Date.now()) { return "future timestamp"; }
  const ageSeconds = Math.round((Date.now() - date.getTime()) / 1_000);
  return ageSeconds < 60 ? `${ageSeconds}s old` : `${Math.round(ageSeconds / 60)}m old`;
}
