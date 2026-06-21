"use client";

import { PointerEvent as ReactPointerEvent, useRef, useState } from "react";
import { cn } from "../../lib/utils";
import type { JoystickValue } from "./go2-control-types";

type JoystickPadProps = {
  disabled: boolean;
  label: string;
  onChange: (value: JoystickValue) => void;
  onStop: () => void;
};

export function Go2JoystickPad({ disabled, label, onChange, onStop }: JoystickPadProps) {
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
