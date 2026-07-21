"use client";

import {
  Camera,
  Check,
  CircleStop,
  Gamepad2,
  Headphones,
  LoaderCircle,
  Map as MapIcon,
  Play,
  RadioTower,
  X
} from "lucide-react";
import type { WorldActionView } from "../../lib/world/robot-world-model";
import type { ManualInteractionReceipt, WorldActionId } from "../../lib/world/robot-world-runtime";
import { Button } from "../ui/button";

const actionIcons = {
  "robot.connect": RadioTower,
  "robot.control": Gamepad2,
  "robot.stop": CircleStop,
  "world.listen": Headphones,
  "world.map": MapIcon,
  "world.observe": Camera
};

export function ManualInteractionPanel({
  actions,
  executing,
  onExecute,
  onSelect,
  receipt,
  selectedActionId
}: {
  actions: WorldActionView[];
  executing: boolean;
  onExecute: (action: WorldActionView) => void;
  onSelect: (actionId: WorldActionId) => void;
  receipt: ManualInteractionReceipt | null;
  selectedActionId: WorldActionId;
}) {
  const selectedAction = actions.find((action) => action.id === selectedActionId) ?? actions[0];

  if (!selectedAction) {
    return <div className="border border-dashed border-surface-3 px-2 py-3 text-center text-[10px] text-muted">No interactions available</div>;
  }

  return (
    <div className="grid gap-2.5" data-testid="manual-interaction-panel">
      <div className="grid grid-cols-2 gap-1.5">
        {actions.map((action) => {
          const Icon = actionIcons[action.id];
          const selected = action.id === selectedAction.id;
          return (
            <Button
              aria-label={`Select ${action.label} interaction`}
              aria-pressed={selected}
              className={`group grid h-14 min-w-0 grid-cols-[auto_1fr] items-start gap-2 whitespace-normal px-2 py-2 text-left ${selected ? "border-primary bg-primary/10" : "border-surface-3 bg-surface-0"}`}
              key={action.id}
              onClick={() => onSelect(action.id)}
              title={action.available ? action.description : action.reason ?? undefined}
              type="button"
              variant="outline"
            >
              <Icon className={action.id === "robot.stop" ? "text-danger" : action.available ? "text-primary" : "text-muted"} size={14} />
              <span className="min-w-0">
                <strong className="block truncate text-[11px]">{action.label}</strong>
                <span className="mt-0.5 block truncate font-mono text-[8px] text-muted">{action.id}</span>
              </span>
            </Button>
          );
        })}
      </div>

      <div className="border-y border-surface-3 bg-surface-0 py-2" data-testid="manual-interaction-request">
        <div className="grid grid-cols-[46px_1fr] gap-x-2 gap-y-1 px-2 font-mono text-[9px]">
          <RequestField label="actor" value={selectedAction.actorId} />
          <RequestField label="action" value={selectedAction.id} />
          <RequestField label="target" value={selectedAction.targetId ?? "none"} />
          <RequestField label="input" value="{}" />
        </div>
        {!selectedAction.available && <p className="mt-2 border-t border-surface-3 px-2 pt-2 text-[9px] leading-3 text-danger">{selectedAction.reason}</p>}
      </div>

      <Button
        aria-label={`Execute ${selectedAction.label} interaction`}
        className="w-full justify-center gap-2"
        disabled={!selectedAction.available || executing}
        onClick={() => onExecute(selectedAction)}
        type="button"
      >
        {executing ? <LoaderCircle className="animate-spin" size={13} /> : <Play size={13} />}
        {executing ? "Executing" : "Execute"}
      </Button>

      {receipt && <InteractionReceipt receipt={receipt} />}
    </div>
  );
}

function RequestField({ label, value }: { label: string; value: string }) {
  return <><span className="text-muted">{label}</span><span className="min-w-0 truncate text-foreground">{value}</span></>;
}

function InteractionReceipt({ receipt }: { receipt: ManualInteractionReceipt }) {
  const StatusIcon = receipt.status === "executing" ? LoaderCircle : receipt.status === "completed" ? Check : X;
  const tone = receipt.status === "completed" ? "text-green" : receipt.status === "failed" ? "text-danger" : "text-primary";
  return (
    <div className="border border-surface-3 bg-surface-0 p-2" data-testid="manual-interaction-receipt">
      <div className={`flex items-center gap-1.5 text-[10px] font-bold ${tone}`}>
        <StatusIcon className={receipt.status === "executing" ? "animate-spin" : ""} size={12} />
        <span className="capitalize">{receipt.status}</span>
      </div>
      {receipt.error && <p className="mt-1.5 text-[9px] leading-3 text-danger">{receipt.error}</p>}
      {receipt.status === "completed" && <p className="mt-1.5 font-mono text-[9px] text-muted">accepted · {receipt.events.length} events</p>}
      {receipt.events.length > 0 && (
        <div className="mt-2 divide-y divide-surface-3 border-t border-surface-3">
          {receipt.events.slice(-3).map((event) => (
            <div className="grid grid-cols-[24px_1fr] gap-1 py-1 font-mono text-[8px]" key={event.seq}>
              <span className="text-muted">#{event.seq}</span>
              <span className="truncate">{event.type}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
