"use client";

import { PointerEvent as ReactPointerEvent, type CSSProperties, useEffect, useRef, useState } from "react";
import { Gamepad2, X } from "lucide-react";
import { robots } from "../../lib/mock-data";
import { useGo2Store } from "../../lib/robots/unitree/go2-store";
import { GO2_SPORT_CMD } from "../../lib/robots/unitree/go2-topics";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { CardContent } from "../ui/card";
import { Collapsible, CollapsibleContent } from "../ui/collapsible";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type JoystickValue = {
  x: number;
  y: number;
};

type ControllerState = {
  lx: number;
  ly: number;
  rx: number;
  ry: number;
  keys: number;
};

const EMPTY_CONTROLLER_STATE: ControllerState = { lx: 0, ly: 0, rx: 0, ry: 0, keys: 0 };
const JOYSTICK_INTERVAL_MS = 50;
const JOYSTICK_RELEASE_TICKS = 3;
const GAMEPAD_DEADZONE = 0.08;
const CONTROL_PANE_DEFAULT_HEIGHT = 380;
const CONTROL_PANE_MIN_HEIGHT = 176;
const CONTROL_PANE_MAX_HEIGHT = 560;
const JOYSTICK_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);
const DATA_TRUE = "{\"data\":true}";

type SportAction = {
  apiId: number;
  label: string;
  parameter?: string;
  danger?: boolean;
};

const PRIMARY_ACTIONS: SportAction[] = [
  { apiId: GO2_SPORT_CMD.RecoveryStand, label: "Stand" },
  { apiId: GO2_SPORT_CMD.Damp, label: "Damp", danger: true },
  { apiId: GO2_SPORT_CMD.StopMove, label: "Stop", danger: true }
];

const MODE_ACTIONS: SportAction[] = [
  { apiId: GO2_SPORT_CMD.FreeWalk, label: "Free Walk", parameter: DATA_TRUE },
  { apiId: GO2_SPORT_CMD.Pose, label: "Pose", parameter: DATA_TRUE },
  { apiId: GO2_SPORT_CMD.SwitchGait, label: "Run", parameter: "{\"data\":1}" },
  { apiId: GO2_SPORT_CMD.WalkStair, label: "Walk Stair", parameter: DATA_TRUE },
  { apiId: GO2_SPORT_CMD.StaticWalk, label: "Static Walk", parameter: DATA_TRUE },
  { apiId: GO2_SPORT_CMD.EconomicGait, label: "Endurance", parameter: DATA_TRUE },
  { apiId: GO2_SPORT_CMD.LeadFollow, label: "Leash", parameter: DATA_TRUE },
  { apiId: GO2_SPORT_CMD.HandStand, label: "Hand Stand", parameter: DATA_TRUE },
  { apiId: GO2_SPORT_CMD.FreeAvoid, label: "Free Avoid", parameter: DATA_TRUE },
  { apiId: GO2_SPORT_CMD.FreeBound, label: "Bound", parameter: DATA_TRUE },
  { apiId: GO2_SPORT_CMD.FreeJump, label: "Jump", parameter: DATA_TRUE },
  { apiId: GO2_SPORT_CMD.CrossStep, label: "Cross Step", parameter: DATA_TRUE },
  { apiId: GO2_SPORT_CMD.BackStand, label: "Rear Stand", parameter: DATA_TRUE },
  { apiId: GO2_SPORT_CMD.RageMode, label: "Rage", parameter: DATA_TRUE }
];

const TRICK_ACTIONS: SportAction[] = [
  { apiId: GO2_SPORT_CMD.Wallow, label: "Roll Over" },
  { apiId: GO2_SPORT_CMD.Stretch, label: "Stretch" },
  { apiId: GO2_SPORT_CMD.Hello, label: "Shake Hand" },
  { apiId: GO2_SPORT_CMD.FingerHeart, label: "Heart" },
  { apiId: GO2_SPORT_CMD.FrontPounce, label: "Pounce" },
  { apiId: GO2_SPORT_CMD.FrontJump, label: "Jump Fwd" },
  { apiId: GO2_SPORT_CMD.Scrape, label: "Greet" },
  { apiId: GO2_SPORT_CMD.Dance1, label: "Dance 1" },
  { apiId: GO2_SPORT_CMD.Dance2, label: "Dance 2" },
  { apiId: GO2_SPORT_CMD.FrontFlip, label: "Front Flip", parameter: DATA_TRUE, danger: true },
  { apiId: GO2_SPORT_CMD.BackFlip, label: "Back Flip", parameter: DATA_TRUE, danger: true },
  { apiId: GO2_SPORT_CMD.LeftFlip, label: "Left Flip", parameter: DATA_TRUE, danger: true },
  { apiId: GO2_SPORT_CMD.Sit, label: "Sit Down" },
  { apiId: GO2_SPORT_CMD.StandDown, label: "Crouch" },
  { apiId: GO2_SPORT_CMD.StandUp, label: "Lock On" }
];

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

function applyDeadzone(value: number): number {
  if (Math.abs(value) < GAMEPAD_DEADZONE) {
    return 0;
  }

  return value > 0 ? (value - GAMEPAD_DEADZONE) / (1 - GAMEPAD_DEADZONE) : (value + GAMEPAD_DEADZONE) / (1 - GAMEPAD_DEADZONE);
}

function readGamepadState(): ControllerState | null {
  const gamepad = navigator.getGamepads().find((candidate) => candidate?.connected);
  if (!gamepad) {
    return null;
  }

  let keys = 0;
  const buttons = gamepad.buttons;
  if (buttons[5]?.pressed) {
    keys |= 1 << 0;
  }
  if (buttons[4]?.pressed) {
    keys |= 1 << 1;
  }
  if (buttons[9]?.pressed) {
    keys |= 1 << 2;
  }
  if (buttons[8]?.pressed) {
    keys |= 1 << 3;
  }
  if (buttons[7]?.pressed) {
    keys |= 1 << 4;
  }
  if (buttons[6]?.pressed) {
    keys |= 1 << 5;
  }
  if (buttons[10]?.pressed) {
    keys |= 1 << 6;
  }
  if (buttons[11]?.pressed) {
    keys |= 1 << 7;
  }
  if (buttons[0]?.pressed) {
    keys |= 1 << 8;
  }
  if (buttons[1]?.pressed) {
    keys |= 1 << 9;
  }
  if (buttons[2]?.pressed) {
    keys |= 1 << 10;
  }
  if (buttons[3]?.pressed) {
    keys |= 1 << 11;
  }
  if (buttons[12]?.pressed) {
    keys |= 1 << 12;
  }
  if (buttons[15]?.pressed) {
    keys |= 1 << 13;
  }
  if (buttons[13]?.pressed) {
    keys |= 1 << 14;
  }
  if (buttons[14]?.pressed) {
    keys |= 1 << 15;
  }

  return {
    lx: applyDeadzone(gamepad.axes[0] ?? 0),
    ly: applyDeadzone(-(gamepad.axes[1] ?? 0)),
    rx: applyDeadzone(gamepad.axes[2] ?? 0),
    ry: applyDeadzone(-(gamepad.axes[3] ?? 0)),
    keys
  };
}

function inUse(state: ControllerState): boolean {
  return state.lx !== 0 || state.ly !== 0 || state.rx !== 0 || state.ry !== 0 || state.keys !== 0;
}

function JoystickPad({
  disabled,
  label,
  onChange,
  onStop
}: {
  disabled: boolean;
  label: string;
  onChange: (value: JoystickValue) => void;
  onStop: () => void;
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [value, setValue] = useState<JoystickValue>({ x: 0, y: 0 });
  const pointerIdRef = useRef<number | null>(null);

  const update = (clientX: number, clientY: number) => {
    const box = boxRef.current;
    if (!box) {
      return;
    }

    const rect = box.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const maxDistance = rect.width / 2 - 32;
    let dx = clientX - centerX;
    let dy = clientY - centerY;
    const distance = Math.hypot(dx, dy);

    if (distance > maxDistance) {
      dx = (dx / distance) * maxDistance;
      dy = (dy / distance) * maxDistance;
    }

    const next = { x: dx / maxDistance, y: -dy / maxDistance };
    setValue(next);
    onChange(next);
  };

  const reset = () => {
    pointerIdRef.current = null;
    setValue({ x: 0, y: 0 });
    onChange({ x: 0, y: 0 });
    onStop();
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled) {
      return;
    }

    event.preventDefault();
    pointerIdRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    update(event.clientX, event.clientY);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (pointerIdRef.current !== event.pointerId) {
      return;
    }

    event.preventDefault();
    update(event.clientX, event.clientY);
  };

  const knobX = value.x * 42;
  const knobY = -value.y * 42;

  return (
    <div className="grid justify-items-center gap-1">
      <div
        ref={boxRef}
        className={cn("relative size-[148px] touch-none select-none", disabled ? "pointer-events-none opacity-30" : "")}
        aria-label={label}
        role="application"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerCancel={reset}
        onPointerUp={reset}
      >
        <div className="absolute inset-0 rounded-full bg-gradient-to-b from-black/20 to-transparent" />
        <div className="absolute inset-0 rounded-full bg-[url('/sprites/joystick_bg.png')] bg-cover bg-center" />
        <div
          className="absolute left-1/2 top-1/2 size-16 bg-[url('/sprites/joystick-active2.png')] bg-cover bg-center"
          style={{ transform: `translate(calc(-50% + ${knobX}px), calc(-50% + ${knobY}px))` }}
        />
      </div>
      <span className="text-[10px] font-bold uppercase tracking-wide text-muted">{label}</span>
    </div>
  );
}

function ActionRow({
  actions,
  label,
  onAction
}: {
  actions: SportAction[];
  label: string;
  onAction: (action: SportAction) => void;
}) {
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

export function UnitreeControlPane({ open, onOpenChange }: Props) {
  const robot = robots[0];
  const go2ConnectionState = useGo2Store((state) => state.connectionState);
  const go2LastEvent = useGo2Store((state) => state.lastEvent);
  const go2LastError = useGo2Store((state) => state.lastError);
  const sendGo2Command = useGo2Store((state) => state.sendCommand);
  const paneRef = useRef<HTMLDivElement | null>(null);
  const joystickStateRef = useRef<ControllerState>(EMPTY_CONTROLLER_STATE);
  const keyboardCodesRef = useRef<Set<string>>(new Set());
  const releaseTicksRef = useRef(0);
  const [activeInput, setActiveInput] = useState<"keyboard" | "controller" | "joystick" | null>(null);
  const [controlFocused, setControlFocused] = useState(false);
  const [paneHeight, setPaneHeight] = useState(CONTROL_PANE_DEFAULT_HEIGHT);
  const controlsEnabled = open && go2ConnectionState === "connected";
  const controlsArmed = controlsEnabled && controlFocused;

  useEffect(() => {
    if (!open) {
      setControlFocused(false);
      setActiveInput(null);
    }
  }, [open]);

  useEffect(() => {
    const applyKeyboard = () => {
      const pressed = keyboardCodesRef.current;
      const lx = Number(pressed.has("KeyD") || pressed.has("ArrowRight")) - Number(pressed.has("KeyA") || pressed.has("ArrowLeft"));
      const ly = Number(pressed.has("KeyW") || pressed.has("ArrowUp")) - Number(pressed.has("KeyS") || pressed.has("ArrowDown"));
      const rx = Number(pressed.has("KeyE")) - Number(pressed.has("KeyQ"));
      joystickStateRef.current = { ...joystickStateRef.current, lx: lx * 0.7, ly: ly * 0.7, rx: rx * 0.7, ry: 0 };
      if (lx !== 0 || ly !== 0 || rx !== 0) {
        setActiveInput("keyboard");
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) {
        return;
      }

      if (event.code === "Space" && controlsArmed) {
        event.preventDefault();
        joystickStateRef.current = EMPTY_CONTROLLER_STATE;
        releaseTicksRef.current = JOYSTICK_RELEASE_TICKS;
        sendGo2Command({ type: "stop_move" });
        setActiveInput("keyboard");
        return;
      }

      if (!JOYSTICK_KEYS.has(event.code) || !controlsArmed) {
        return;
      }

      event.preventDefault();
      keyboardCodesRef.current.add(event.code);
      applyKeyboard();
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (!keyboardCodesRef.current.has(event.code)) {
        return;
      }

      event.preventDefault();
      keyboardCodesRef.current.delete(event.code);
      applyKeyboard();
      releaseTicksRef.current = JOYSTICK_RELEASE_TICKS;
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [controlsArmed, sendGo2Command]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!controlsArmed) {
        return;
      }

      const gamepadState = readGamepadState();
      const state = gamepadState && inUse(gamepadState) ? gamepadState : joystickStateRef.current;
      if (gamepadState && inUse(gamepadState)) {
        setActiveInput("controller");
      }

      if (inUse(state)) {
        releaseTicksRef.current = JOYSTICK_RELEASE_TICKS;
      } else if (releaseTicksRef.current <= 0) {
        return;
      } else {
        releaseTicksRef.current -= 1;
      }

      sendGo2Command({ type: "joystick", ...state });
    }, JOYSTICK_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [controlsArmed, sendGo2Command]);

  const setLeftJoystick = (value: JoystickValue) => {
    joystickStateRef.current = { ...joystickStateRef.current, lx: value.x, ly: value.y };
    setActiveInput("joystick");
  };

  const setRightJoystick = (value: JoystickValue) => {
    joystickStateRef.current = { ...joystickStateRef.current, rx: value.x, ry: value.y };
    setActiveInput("joystick");
  };

  const stopJoystick = () => {
    releaseTicksRef.current = JOYSTICK_RELEASE_TICKS;
  };

  const sendSportAction = (action: SportAction) => {
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
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setControlFocused(false);
          setActiveInput(null);
          joystickStateRef.current = EMPTY_CONTROLLER_STATE;
        }
      }}
      onFocusCapture={() => setControlFocused(true)}
      onPointerDownCapture={() => {
        paneRef.current?.focus();
        setControlFocused(true);
      }}
    >
      {open ? (
        <Button
          className="absolute left-0 right-0 top-0 z-20 m-0 h-2 w-full cursor-row-resize border-0 bg-transparent p-0 touch-none after:absolute after:left-0 after:right-0 after:top-0 after:h-px after:bg-transparent hover:after:bg-primary"
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
          className="absolute right-3 top-[52px] z-20 size-7"
          size="icon"
          variant="ghost"
          aria-label="Close control pane"
          onClick={() => onOpenChange(false)}
        >
          <X size={15} />
        </Button>
        <div
          className="overflow-auto border-t border-surface-3 px-4 py-3 pr-12"
          style={{ height: `${Math.max(paneHeight - 44, 0)}px` }}
        >
          <Tabs className="h-full min-h-0 gap-3" defaultValue="go2">
            <TabsList className="h-8 rounded-md bg-surface-2 p-0.5">
              <TabsTrigger className="h-7 px-3 text-xs" value="go2">
                Go2
              </TabsTrigger>
            </TabsList>
            <TabsContent className="min-h-0" value="go2">
              <div className="grid grid-cols-[160px_minmax(220px,1fr)_160px] items-end gap-4">
                <JoystickPad disabled={!controlsArmed} label="move" onChange={setLeftJoystick} onStop={stopJoystick} />

                <div className="grid min-w-0 gap-3 self-stretch">
                  <ActionRow actions={PRIMARY_ACTIONS} label="Safety" onAction={sendSportAction} />
                  <ActionRow actions={MODE_ACTIONS} label="Modes" onAction={sendSportAction} />
                  <ActionRow actions={TRICK_ACTIONS} label="Actions" onAction={sendSportAction} />

                  <CardContent className="grid gap-1 rounded-lg border border-surface-3 bg-surface-2 p-3 text-xs">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted">Robot</span>
                      <strong className="text-foreground">{robot.name}</strong>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted">Battery</span>
                      <strong className="text-foreground">{robot.battery}%</strong>
                    </div>
                    {controlsArmed ? <p className="text-muted">Input: {activeInput ?? "focused"}</p> : null}
                    {go2LastEvent ? <p className="truncate text-muted">{go2LastEvent}</p> : <p className="text-muted">No control events yet.</p>}
                    {go2LastError ? <p className="truncate text-danger">{go2LastError}</p> : null}
                  </CardContent>
                </div>

                <JoystickPad disabled={!controlsArmed} label="turn" onChange={setRightJoystick} onStop={stopJoystick} />
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
