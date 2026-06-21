"use client";

import { useMemo, useRef } from "react";
import { FileAudio, Play, Square } from "lucide-react";
import { useGo2Store } from "../../lib/robots/unitree/go2-store";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { CardContent } from "../ui/card";
import { Input } from "../ui/input";
import { Slider } from "../ui/slider";

export function Go2AudioCard() {
  const audioFileInputRef = useRef<HTMLInputElement | null>(null);
  const go2AudioFileName = useGo2Store((state) => state.audioFileName);
  const go2AudioFileState = useGo2Store((state) => state.audioFileState);
  const go2AudioInputVolume = useGo2Store((state) => state.audioInputVolume);
  const go2RobotAudioError = useGo2Store((state) => state.robotAudioError);
  const go2RobotAudioState = useGo2Store((state) => state.robotAudioState);
  const go2ConnectionState = useGo2Store((state) => state.connectionState);
  const go2RuntimeTogglePending = useGo2Store((state) => state.runtimeTogglePending);
  const setGo2AudioFileInput = useGo2Store((state) => state.setAudioFileInput);
  const setGo2AudioFilePlayback = useGo2Store((state) => state.setAudioFilePlayback);
  const setGo2AudioInputVolume = useGo2Store((state) => state.setAudioInputVolume);
  const audioInputPending = Boolean(go2RuntimeTogglePending.audioInput);
  const audioFileLoaded = Boolean(go2AudioFileName);
  const audioFileControllable = audioFileLoaded && go2AudioFileState !== "loading" && go2AudioFileState !== "failed";
  const audioVolumeValue = useMemo(() => [go2AudioInputVolume], [go2AudioInputVolume]);
  const robotAudioStatus = go2RobotAudioState === "idle"
    ? "idle"
    : go2RobotAudioState === "uploading"
      ? "sending"
      : go2RobotAudioState === "playing"
        ? "sent"
        : go2RobotAudioState;

  return (
    <CardContent className="grid gap-2 rounded-lg border border-surface-3 bg-surface-2 p-2.5 text-xs">
      <div className="flex min-w-0 items-center gap-2">
        <div className="grid size-7 shrink-0 place-items-center rounded-md bg-surface-3 text-primary">
          <FileAudio size={15} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <span className="font-bold text-foreground">Robot audio</span>
            {go2RobotAudioState === "idle" ? null : (
              <span
                className={cn(
                  "text-[10px] font-bold uppercase tracking-wide",
                  go2RobotAudioState === "playing" || go2RobotAudioState === "ready"
                    ? "text-primary"
                    : go2RobotAudioState === "failed"
                      ? "text-danger"
                      : "text-muted"
                )}
              >
                {robotAudioStatus}
              </span>
            )}
          </div>
          <p className="truncate text-muted">{go2AudioFileName ?? "Audio or MP4 file"}</p>
        </div>
      </div>

      <Input
        ref={audioFileInputRef}
        className="hidden"
        type="file"
        accept="audio/*,video/*,.mp4"
        onChange={(event) => {
          const file = event.target.files?.[0] ?? null;
          void setGo2AudioFileInput(file);
          event.target.value = "";
        }}
      />

      <div className="grid grid-cols-[1fr_auto_auto] items-center gap-2">
        <Button
          className="h-7 min-w-0 justify-start px-2 text-[11px] font-bold"
          disabled={go2ConnectionState !== "connected" || audioInputPending || go2AudioFileState === "loading"}
          onClick={() => audioFileInputRef.current?.click()}
          variant="outline"
        >
          {audioInputPending || go2AudioFileState === "loading" ? "Loading..." : go2AudioFileName ? "Replace file" : "Choose file"}
        </Button>
        <Button
          className="h-7 px-2 text-[11px] font-bold"
          disabled={!audioFileControllable || audioInputPending}
          onClick={() => {
            void setGo2AudioFilePlayback("play");
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
            void setGo2AudioFilePlayback("stop");
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
            setGo2AudioInputVolume(value[0] ?? go2AudioInputVolume);
          }}
        />
        <strong className="w-8 shrink-0 text-right text-[11px] text-foreground">{go2AudioInputVolume}%</strong>
      </div>

      {go2RobotAudioError ? <p className="truncate text-[11px] text-danger">{go2RobotAudioError}</p> : null}
    </CardContent>
  );
}
