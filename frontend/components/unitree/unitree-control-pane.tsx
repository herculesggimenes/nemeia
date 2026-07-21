"use client";

import { PointerEvent as ReactPointerEvent, type CSSProperties, useRef, useState } from "react";
import { Gamepad2, X } from "lucide-react";
import {
  ROBOT_MODE_ACTIONS,
  ROBOT_NATIVE_ACTIONS,
  ROBOT_PRIMARY_ACTIONS,
  type RobotNativeAction,
  useRobotRuntime
} from "../../lib/robots/standard/robot-runtime";
import { Button } from "../ui/button";
import { Collapsible, CollapsibleContent } from "../ui/collapsible";
import { Go2ActionRow } from "./go2-action-row";
import { Go2AudioCard } from "./go2-audio-card";
import { Go2JoystickPad } from "./go2-joystick-pad";
import { useGo2ControlInput } from "./use-go2-control-input";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type ContentProps = {
  open?: boolean;
};

const CONTROL_PANE_DEFAULT_HEIGHT = 380;
const CONTROL_PANE_MIN_HEIGHT = 176;
const CONTROL_PANE_MAX_HEIGHT = 560;

export function UnitreeControlPanelContent({ open = true }: ContentProps) {
  const controlsRef = useRef<HTMLDivElement | null>(null);
  const robotRuntime = useRobotRuntime();
  const controlsEnabled = open && robotRuntime.connectionState === "connected";
  const runtimeMessage = robotRuntime.lastError ?? robotRuntime.lastEvent ?? "No command event yet.";
  const {
    controlsArmed,
    focusControls,
    handleBlur,
    setControlFocused,
    setLeftJoystick,
    setRightJoystick,
    stopJoystick
  } = useGo2ControlInput({
    enabled: controlsEnabled,
    open,
    paneRef: controlsRef,
    sendControllerState: robotRuntime.sendControllerState,
    stopMotion: robotRuntime.stopMotion
  });

  const sendRobotAction = (action: RobotNativeAction) => {
    if (action.label === "Obstacle Avoid On" || action.label === "Obstacle Avoid Off") {
      robotRuntime.setObstacleAvoidance(action.label === "Obstacle Avoid On");
      return;
    }

    robotRuntime.sendNativeAction({
      apiId: action.apiId,
      label: action.label,
      modeLabel: action.role === "mode" ? action.label : undefined,
      parameter: action.parameter,
      priority: action.priority,
      role: action.role
    });
  };

  return (
    <div
      className="grid h-full min-h-0 overflow-auto p-2"
      data-testid="go2-control-pane"
      ref={controlsRef}
      tabIndex={-1}
      onBlurCapture={handleBlur}
      onFocusCapture={() => setControlFocused(true)}
      onPointerDownCapture={focusControls}
    >
      <div className="grid w-full grid-cols-[148px_minmax(320px,1fr)_148px] items-center gap-3 px-2">
        <Go2JoystickPad disabled={!controlsArmed} label="move" onChange={setLeftJoystick} onStop={stopJoystick} />

        <div className="mx-auto grid w-full max-w-[760px] min-w-0 gap-3 self-stretch">
          <Go2ActionRow actions={ROBOT_PRIMARY_ACTIONS} label="Safety" onAction={sendRobotAction} />
          <Go2ActionRow actions={ROBOT_MODE_ACTIONS} label="Modes" selectedLabel={robotRuntime.driverMode ?? "unknown"} onAction={sendRobotAction} />
          <Go2ActionRow actions={ROBOT_NATIVE_ACTIONS} label="Actions" onAction={sendRobotAction} />
          <div
            className="grid grid-cols-[repeat(3,minmax(0,1fr))] gap-2 rounded border border-surface-3 bg-surface-2/70 px-3 py-2 text-xs"
            data-testid="go2-control-runtime-feedback"
          >
            <div className="min-w-0">
              <div className="text-[10px] uppercase text-muted">Connection</div>
              <div className="truncate font-medium text-foreground">{robotRuntime.connectionState}</div>
            </div>
            <div className="min-w-0">
              <div className="text-[10px] uppercase text-muted">Mode</div>
              <div className="truncate font-medium text-foreground">{robotRuntime.driverMode ?? "unknown"}</div>
            </div>
            <div className="min-w-0">
              <div className="text-[10px] uppercase text-muted">{robotRuntime.lastError ? "Error" : "Last event"}</div>
              <div className={`truncate font-medium ${robotRuntime.lastError ? "text-danger" : "text-foreground"}`}>{runtimeMessage}</div>
            </div>
          </div>
          <Go2AudioCard />
        </div>

        <Go2JoystickPad disabled={!controlsArmed} label="turn" onChange={setRightJoystick} onStop={stopJoystick} />
      </div>
    </div>
  );
}

export function UnitreeControlPane({ open, onOpenChange }: Props) {
  const [paneHeight, setPaneHeight] = useState(CONTROL_PANE_DEFAULT_HEIGHT);

  const startResize = (event: ReactPointerEvent<HTMLElement>) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = paneHeight;

    const onMove = (moveEvent: PointerEvent) => {
      const nextHeight = startHeight + startY - moveEvent.clientY;
      setPaneHeight(Math.min(Math.max(nextHeight, CONTROL_PANE_MIN_HEIGHT), CONTROL_PANE_MAX_HEIGHT));
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <Collapsible
      className="relative shrink-0 overflow-hidden border-t border-surface-3 bg-surface-1/95"
      open={open}
      onOpenChange={onOpenChange}
      style={{ height: open ? `${paneHeight}px` : undefined } as CSSProperties}
    >
      {open ? (
        <Button
          className="absolute left-0 right-0 top-0 z-20 m-0 h-2 w-full cursor-row-resize touch-none border-0 bg-transparent p-0 after:absolute after:left-0 after:right-0 after:top-0 after:h-px after:bg-transparent hover:after:bg-primary"
          variant="ghost"
          aria-label="Resize control pane"
          onPointerDown={startResize}
        />
      ) : null}
      <div className="flex h-11 items-center justify-between gap-3 px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Gamepad2 size={16} className="text-muted" />
          <strong className="truncate text-sm text-foreground">Control Pane</strong>
        </div>
      </div>

      <CollapsibleContent>
        <Button
          className="absolute right-2 top-[52px] z-20 size-7"
          size="icon"
          variant="ghost"
          aria-label="Close control pane"
          onClick={() => onOpenChange(false)}
        >
          <X size={15} />
        </Button>
        <div className="overflow-auto border-t border-surface-3 p-2" style={{ height: `${Math.max(paneHeight - 44, 0)}px` }}>
          <UnitreeControlPanelContent open={open} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
