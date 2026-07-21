"use client";

import { useMemo, useRef } from "react";
import { FileAudio, Play, Square } from "lucide-react";
import { useRobotRuntime } from "../../lib/robots/standard/robot-runtime";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { CardContent } from "../ui/card";
import { Input } from "../ui/input";
import { Slider } from "../ui/slider";

export function Go2AudioCard() {
  const audioFileInputRef = useRef<HTMLInputElement | null>(null);
  const robotRuntime = useRobotRuntime();
  const audioInputPending = robotRuntime.runtimePending.audioInput;
  const audioFileLoaded = Boolean(robotRuntime.audioFileName);
  const audioFileControllable = audioFileLoaded && robotRuntime.audioFileState !== "loading" && robotRuntime.audioFileState !== "failed";
  const audioVolumeValue = useMemo(() => [robotRuntime.audioInputVolume], [robotRuntime.audioInputVolume]);
  const robotAudioStatus = robotRuntime.robotAudioState === "idle"
    ? "idle"
    : robotRuntime.robotAudioState === "uploading"
      ? "sending"
      : robotRuntime.robotAudioState === "playing"
        ? "sent"
        : robotRuntime.robotAudioState;

  return (
    <CardContent className="grid gap-2 rounded-lg border border-surface-3 bg-surface-2 p-2.5 text-xs">
      <div className="flex min-w-0 items-center gap-2">
        <div className="grid size-7 shrink-0 place-items-center rounded-md bg-surface-3 text-primary">
          <FileAudio size={15} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <span className="font-bold text-foreground">Robot audio</span>
            {robotRuntime.robotAudioState === "idle" ? null : (
              <span
                className={cn(
                  "text-[10px] font-bold uppercase tracking-wide",
                  robotRuntime.robotAudioState === "playing" || robotRuntime.robotAudioState === "ready"
                    ? "text-primary"
                    : robotRuntime.robotAudioState === "failed"
                      ? "text-danger"
                      : "text-muted"
                )}
              >
                {robotAudioStatus}
              </span>
            )}
          </div>
          <p className="truncate text-muted">{robotRuntime.audioFileName ?? "Audio or MP4 file"}</p>
        </div>
      </div>

      <Input
        ref={audioFileInputRef}
        className="hidden"
        type="file"
        accept="audio/*,video/*,.mp4"
        onChange={(event) => {
          const file = event.target.files?.[0] ?? null;
          void robotRuntime.setAudioFileInput(file);
          event.target.value = "";
        }}
      />

      <div className="grid grid-cols-[1fr_auto_auto] items-center gap-2">
        <Button
          className="h-7 min-w-0 justify-start px-2 text-[11px] font-bold"
          disabled={robotRuntime.connectionState !== "connected" || audioInputPending || robotRuntime.audioFileState === "loading"}
          onClick={() => audioFileInputRef.current?.click()}
          variant="outline"
        >
          {audioInputPending || robotRuntime.audioFileState === "loading" ? "Loading..." : robotRuntime.audioFileName ? "Replace file" : "Choose file"}
        </Button>
        <Button
          className="h-7 px-2 text-[11px] font-bold"
          disabled={!audioFileControllable || audioInputPending}
          onClick={() => {
            void robotRuntime.setAudioFilePlayback("play");
          }}
          variant="default"
        >
          <Play size={13} />
          Send
        </Button>
        <Button
          className="size-7"
          disabled={!audioFileLoaded || audioInputPending}
          size="icon"
          onClick={() => {
            void robotRuntime.setAudioFilePlayback("stop");
          }}
          variant="ghost"
          aria-label="Clear audio file"
        >
          <Square size={14} />
        </Button>
      </div>

      <div className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-muted">Volume</span>
        <Slider
          aria-label="Robot audio volume"
          className="min-w-0 flex-1"
          disabled={audioInputPending}
          max={100}
          min={0}
          step={1}
          value={audioVolumeValue}
          onValueChange={(value) => {
            robotRuntime.setAudioInputVolume(value[0] ?? robotRuntime.audioInputVolume);
          }}
        />
        <strong className="w-8 shrink-0 text-right text-[11px] text-foreground">{robotRuntime.audioInputVolume}%</strong>
      </div>

      {robotRuntime.robotAudioError ? <p className="truncate text-[11px] text-danger">{robotRuntime.robotAudioError}</p> : null}
    </CardContent>
  );
}
