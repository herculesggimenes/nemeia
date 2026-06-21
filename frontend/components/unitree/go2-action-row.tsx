"use client";

import type { Go2SportAction } from "../../lib/robots/unitree/go2-control-actions";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";

type Go2ActionRowProps = {
  actions: Go2SportAction[];
  label: string;
  onAction: (action: Go2SportAction) => void;
};

export function Go2ActionRow({ actions, label, onAction }: Go2ActionRowProps) {
  return (
    <div className="grid gap-1">
      <span className="text-[10px] font-bold uppercase tracking-wide text-muted">{label}</span>
      <div className="thin-scrollbar-x flex min-w-0 gap-2 overflow-x-auto pb-1">
        {actions.map((action) => (
          <Button
            key={`${label}-${action.apiId}-${action.label}`}
            className={cn("h-8 shrink-0 px-2 text-[11px] font-bold", action.danger ? "border-danger/50 text-danger" : "")}
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
