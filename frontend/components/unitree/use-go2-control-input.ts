"use client";

import { FocusEvent, RefObject, useEffect, useRef, useState } from "react";
import type { RobotControllerState } from "../../lib/robots/standard/robot-runtime";
import { EMPTY_CONTROLLER_STATE, type ControllerState, type JoystickValue } from "./go2-control-types";

const JOYSTICK_INTERVAL_MS = 50;
const JOYSTICK_RELEASE_TICKS = 3;
const GAMEPAD_DEADZONE = 0.08;
const JOYSTICK_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

type UseGo2ControlInputProps = {
  enabled: boolean;
  open: boolean;
  paneRef: RefObject<HTMLDivElement | null>;
  sendControllerState: (state: RobotControllerState) => void;
  stopMotion: () => void;
};

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

export function useGo2ControlInput({ enabled, open, paneRef, sendControllerState, stopMotion }: UseGo2ControlInputProps) {
  const joystickStateRef = useRef<ControllerState>(EMPTY_CONTROLLER_STATE);
  const keyboardCodesRef = useRef<Set<string>>(new Set());
  const releaseTicksRef = useRef(0);
  const [, setActiveInput] = useState<"keyboard" | "controller" | "joystick" | null>(null);
  const [controlFocused, setControlFocused] = useState(false);
  const controlsArmed = enabled && controlFocused;

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
        stopMotion();
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
  }, [controlsArmed, stopMotion]);

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

      sendControllerState(state);
    }, JOYSTICK_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [controlsArmed, sendControllerState]);

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

  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      setControlFocused(false);
      setActiveInput(null);
      joystickStateRef.current = EMPTY_CONTROLLER_STATE;
    }
  };

  const focusControls = () => {
    paneRef.current?.focus();
    setControlFocused(true);
  };

  return {
    controlsArmed,
    focusControls,
    handleBlur,
    setControlFocused,
    setLeftJoystick,
    setRightJoystick,
    stopJoystick
  };
}
