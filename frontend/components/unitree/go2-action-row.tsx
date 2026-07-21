"use client";

import type { RobotNativeAction } from "../../lib/robots/standard/robot-runtime";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";

type Go2ActionRowProps = {
  actions: RobotNativeAction[];
  label: string;
  onAction: (action: RobotNativeAction) => void;
  selectedLabel?: string | null;
};

export function Go2ActionRow({ actions, label, onAction, selectedLabel }: Go2ActionRowProps) {
  return (
    <div className="grid gap-1">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wide text-muted">{label}</span>
        {selectedLabel ? <span className="min-w-0 truncate text-[10px] font-semibold text-primary">{selectedLabel}</span> : null}
      </div>
      <div className="thin-scrollbar-x flex min-w-0 gap-2 overflow-x-auto pb-1">
        {actions.map((action) => (
          <Button
            key={`${label}-${action.apiId}-${action.label}`}
            className={cn(
              "h-8 shrink-0 px-2 text-[11px] font-bold",
              action.priority ? "border-danger/50 text-danger" : "",
              selectedLabel === action.label ? "border-primary/70 bg-primary/15 text-primary" : ""
            )}
            variant="outline"
            onClick={() => onAction(action)}
          >
            {action.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
