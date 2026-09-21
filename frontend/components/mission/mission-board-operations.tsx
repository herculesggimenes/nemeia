"use client";

import { Check, Plus, RefreshCw, Shield, UserRound } from "lucide-react";
import { Timestamp } from "spacetimedb";
import { useState, type FormEvent } from "react";
import type {
  NativeOperatorCall,
  OperatorAgent,
  OperatorMission,
  OperatorUnit
} from "../../types/operator";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";

type Invoke = NativeOperatorCall;

export function CreateMissionForm({ disabled, onCreate }: { disabled: boolean; onCreate: Invoke }) {
  const [description, setDescription] = useState("");
  const [objective, setObjective] = useState("");
  const [deadline, setDeadline] = useState("");
  const [open, setOpen] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!description.trim() || !objective.trim()) { return; }
    const id = randomId("mission");
    const saved = await onCreate("createMission", {
      missionId: id,
      spec: {
        deadlineAt: deadline ? Timestamp.fromDate(new Date(deadline)) : undefined,
        description: description.trim(),
        objectives: [{
          criterion: { tag: "Located", value: { description: objective.trim() } },
          dependsOn: [],
          description: objective.trim(),
          id: `${id}:objective:1`,
          optional: false
        }],
        template: undefined
      }
    });
    if (!saved) { return; }
    setDescription("");
    setObjective("");
    setDeadline("");
    setOpen(false);
  };

  return (
    <div className="border-b border-[#D9DED3] bg-[#F6F2E9] p-3">
      <Button className="w-full justify-start gap-2 border-[#B8C2B6] bg-[#FFFDF8] text-[#245A40] hover:bg-[#EEF2E8]" disabled={disabled} onClick={() => setOpen((current) => !current)} size="sm" variant="outline">
        <Plus size={14} /> Create mission
      </Button>
      {open ? (
        <form className="mt-3 grid gap-2" onSubmit={(event) => void submit(event)} data-testid="mission-create-form">
          <Textarea aria-label="Mission description" onChange={(event) => setDescription(event.target.value)} placeholder="Find my blue backpack" value={description} />
          <Input aria-label="First objective" onChange={(event) => setObjective(event.target.value)} placeholder="Identify and report its evidenced local position" value={objective} />
          <Input aria-label="Mission deadline" onChange={(event) => setDeadline(event.target.value)} type="datetime-local" value={deadline} />
          <Button disabled={disabled || !description.trim() || !objective.trim()} size="sm" type="submit"><Check size={14} /> Save to world</Button>
          <p className="text-[10px] leading-4 text-[#6E8583]">Creates durable mission intent only. It does not start a Unit or grant authority.</p>
        </form>
      ) : null}
    </div>
  );
}

export function AssignmentControls({ disabled, mission, agents, units, onInvoke }: { disabled: boolean; mission: OperatorMission; agents: OperatorAgent[]; units: OperatorUnit[]; onInvoke: Invoke }) {
  const [agentId, setAgentId] = useState(mission.agentIds[0] ?? agents[0]?.id ?? "");
  const [unitId, setUnitId] = useState(units[0]?.id ?? "");
  const [actions, setActions] = useState("navigate@1");
  const [expiresAt, setExpiresAt] = useState("");
  const assignedUnit = units.find((unit) => unit.id === unitId);

  return (
    <section className="border-b border-[#D9DED3] bg-[#FFFDF8]" data-testid="mission-authority-controls">
      <div className="flex items-center justify-between border-b border-[#D9DED3] px-4 py-2.5"><h3 className="text-xs font-semibold uppercase tracking-wide text-[#6E8583]">Authority</h3><Badge className="border-[#D9DED3] text-[10px]" variant="outline">separate grants</Badge></div>
      <div className="grid gap-3 p-4 lg:grid-cols-2">
        <div className="grid gap-2 border-l-2 border-[#8FA88E] pl-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#20352A]"><UserRound size={14} /> Assign agent to mission</div>
          <Input aria-label="Agent identity" disabled={disabled} onChange={(event) => setAgentId(event.target.value)} placeholder="agent identity" value={agentId} />
          <Button disabled={disabled || !agentId} onClick={() => void onInvoke("assignMission", { agentId, expectedAgentRevision: BigInt(agents.find((agent) => agent.id === agentId)?.revision ?? "0"), expectedMissionRevision: BigInt(mission.revision), missionId: mission.id })} size="sm" variant="outline">Assign participant</Button>
          <p className="text-[10px] leading-4 text-[#6E8583]">One agent can hold several missions. Assignment does not grant Unit control.</p>
        </div>
        <div className="grid gap-2 border-l-2 border-[#C5A15A] pl-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#20352A]"><Shield size={14} /> Grant named Unit authority</div>
          <p className="break-words text-xs text-[#6E8583]" data-testid="unit-grant-state">Current grant · revision {assignedUnit?.assignmentRevision ?? "0"} · {assignedUnit?.agentId ?? "unassigned"} · {assignedUnit?.actionNames.join(", ") || "no actions"} · expires {assignedUnit?.expiresAt ?? "never"}</p>
          <Input aria-label="Unit identity" disabled={disabled} onChange={(event) => setUnitId(event.target.value)} placeholder="Unit identity" value={unitId} />
          <Input aria-label="Allowed action names" disabled={disabled} onChange={(event) => setActions(event.target.value)} placeholder="navigate@1" value={actions} />
          <Input aria-label="Grant expiry" disabled={disabled} onChange={(event) => setExpiresAt(event.target.value)} type="datetime-local" value={expiresAt} />
          <Button disabled={disabled || !unitId || !agentId || !actions.trim()} onClick={() => void onInvoke("assignUnit", { actionNames: actions.split(",").map((action) => action.trim()).filter(Boolean), agentId: agentId || undefined, expiresAt: expiresAt ? Timestamp.fromDate(new Date(expiresAt)) : undefined, expectedRevision: BigInt(assignedUnit?.assignmentRevision ?? "0"), unitId })} size="sm" variant="outline">Grant authority</Button>
          <p className="text-[10px] leading-4 text-[#6E8583]">Only named operations are admitted. The grant is not a physical stop or completion receipt.</p>
        </div>
      </div>
    </section>
  );
}

export function MissionRecoveryControls({ disabled, mission, onInvoke }: { disabled: boolean; mission: OperatorMission; onInvoke: Invoke }) {
  const terminal = ["cancelled", "failed", "succeeded"].includes(mission.state);
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-[#D9DED3] bg-[#F6F2E9] px-4 py-3">
      <Button disabled={disabled || terminal} onClick={() => void onInvoke("cancelMission", { expectedRevision: BigInt(mission.revision), missionId: mission.id })} size="sm" variant="outline">Cancel mission</Button>
      <Button disabled={disabled} onClick={() => void onInvoke("reconcileMission", { missionId: mission.id })} size="sm" variant="outline"><RefreshCw size={13} /> Reconcile durable state</Button>
      <span className="ml-auto text-[10px] text-[#6E8583]">Reconcile reads receipts; it never sends motion.</span>
    </div>
  );
}

function randomId(prefix: string): string {
  const uuid = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}`;
  return `${prefix}-${uuid}`;
}
