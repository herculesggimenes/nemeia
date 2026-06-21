"use client";

import { PointerEvent as ReactPointerEvent, type CSSProperties, useRef, useState } from "react";
import { Gamepad2, X } from "lucide-react";
import {
  GO2_MODE_ACTIONS,
  GO2_PRIMARY_ACTIONS,
  GO2_TRICK_ACTIONS,
  type Go2SportAction
} from "../../lib/robots/unitree/go2-control-actions";
import { useGo2Store } from "../../lib/robots/unitree/go2-store";
import { Button } from "../ui/button";
import { Collapsible, CollapsibleContent } from "../ui/collapsible";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { Go2ActionRow } from "./go2-action-row";
import { Go2AudioCard } from "./go2-audio-card";
import { Go2JoystickPad } from "./go2-joystick-pad";
import { useGo2ControlInput } from "./use-go2-control-input";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const CONTROL_PANE_DEFAULT_HEIGHT = 380;
const CONTROL_PANE_MIN_HEIGHT = 176;
const CONTROL_PANE_MAX_HEIGHT = 560;

export function UnitreeControlPane({ open, onOpenChange }: Props) {
  const paneRef = useRef<HTMLDivElement | null>(null);
  const go2ConnectionState = useGo2Store((state) => state.connectionState);
  const sendGo2Command = useGo2Store((state) => state.sendCommand);
  const [paneHeight, setPaneHeight] = useState(CONTROL_PANE_DEFAULT_HEIGHT);
  const controlsEnabled = open && go2ConnectionState === "connected";
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
    paneRef,
    sendCommand: sendGo2Command
  });

  const sendSportAction = (action: Go2SportAction) => {
    if (action.label === "Obstacle Avoid On" || action.label === "Obstacle Avoid Off") {
      sendGo2Command({
        type: "obstacle_avoidance",
        enabled: action.label === "Obstacle Avoid On"
      });
      return;
    }

    sendGo2Command({
      type: "sport_request",
      apiId: action.apiId,
      label: action.label,
      parameter: action.parameter,
      priority: action.danger
    });
  };

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
      data-testid="go2-control-pane"
      open={open}
      onOpenChange={onOpenChange}
      ref={paneRef}
      style={{ height: open ? `${paneHeight}px` : undefined } as CSSProperties}
      tabIndex={-1}
      onBlurCapture={handleBlur}
      onFocusCapture={() => setControlFocused(true)}
      onPointerDownCapture={focusControls}
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
          <Tabs className="h-full min-h-0 gap-2" defaultValue="go2">
            <TabsList className="h-8 rounded-md bg-surface-2 p-0.5">
              <TabsTrigger className="h-7 px-3 text-xs" value="go2">
                Go2
              </TabsTrigger>
            </TabsList>
            <TabsContent className="min-h-0" value="go2">
              <div className="grid w-full grid-cols-[148px_minmax(320px,1fr)_148px] items-center gap-3 px-2">
                <Go2JoystickPad disabled={!controlsArmed} label="move" onChange={setLeftJoystick} onStop={stopJoystick} />

                <div className="mx-auto grid w-full max-w-[760px] min-w-0 gap-3 self-stretch">
                  <Go2ActionRow actions={GO2_PRIMARY_ACTIONS} label="Safety" onAction={sendSportAction} />
                  <Go2ActionRow actions={GO2_MODE_ACTIONS} label="Modes" onAction={sendSportAction} />
                  <Go2ActionRow actions={GO2_TRICK_ACTIONS} label="Actions" onAction={sendSportAction} />
                  <Go2AudioCard />
                </div>

                <Go2JoystickPad disabled={!controlsArmed} label="turn" onChange={setRightJoystick} onStop={stopJoystick} />
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
