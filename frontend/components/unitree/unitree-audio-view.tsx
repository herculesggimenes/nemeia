"use client";

import { useEffect, useRef, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import type { Go2ConnectionState } from "../../lib/robots/unitree/go2-types";
import { Button } from "../ui/button";
import { CardContent } from "../ui/card";
import { Slider } from "../ui/slider";
import { Switch } from "../ui/switch";

type Props = {
  audioStream: MediaStream | null;
  connectionState: Go2ConnectionState;
  enabled: boolean;
};

function AudioWaitingState({ detail, title }: { detail: string; title: string }) {
  return (
    <div className="grid h-full min-h-0 place-items-center bg-surface-0 p-6 text-center">
      <div className="grid max-w-xs gap-2">
        <span className="text-[10px] font-extrabold uppercase tracking-wide text-muted">audio</span>
        <strong className="text-base text-foreground">{title}</strong>
        <p className="text-sm leading-6 text-muted">{detail}</p>
      </div>
    </div>
  );
}

export function UnitreeAudioView({ audioStream, connectionState, enabled }: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [volume, setVolume] = useState([80]);
  const [muted, setMuted] = useState(false);
  const [playbackState, setPlaybackState] = useState<"idle" | "playing" | "blocked">("idle");

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    audio.srcObject = audioStream;
    audio.volume = volume[0] / 100;
    audio.muted = muted;

    if (audioStream) {
      void audio.play().then(
        () => setPlaybackState("playing"),
        () => setPlaybackState("blocked")
      );
    }

    return () => {
      audio.pause();
      audio.srcObject = null;
    };
  }, [audioStream, muted, volume]);

  if (!enabled) {
    return <AudioWaitingState title="Speaker disabled" detail="Turn the speaker output stream back on from robot settings when you need robot audio." />;
  }

  if (connectionState !== "connected") {
    return <AudioWaitingState title="Waiting for robot connection" detail="Connect to the robot before opening the speaker stream." />;
  }

  if (!audioStream) {
    return <AudioWaitingState title="Connected, waiting for speaker audio" detail="Nemeia is waiting for the robot audio track to attach." />;
  }

  return (
    <div className="grid h-full min-h-0 place-items-center bg-surface-0 p-6">
      {/* oxlint-disable-next-line jsx-a11y/media-has-caption -- Live WebRTC speaker stream has no caption source in v0. */}
      <audio ref={audioRef} />
      <CardContent className="grid w-full max-w-md gap-5 rounded-lg border border-surface-3 bg-surface-1 p-5">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-md bg-surface-3 text-primary">
            {muted ? <VolumeX size={20} /> : <Volume2 size={20} />}
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-bold text-foreground">Speaker</h2>
            <p className="text-xs text-muted">{playbackState === "blocked" ? "Playback needs a user gesture." : "Robot audio output stream."}</p>
          </div>
        </div>

        <div className="grid gap-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-bold uppercase tracking-wide text-muted">Volume</span>
            <strong className="text-foreground">{volume[0]}%</strong>
          </div>
          <Slider aria-label="Speaker volume" max={100} min={0} step={1} value={volume} onValueChange={setVolume} />
        </div>

        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-muted">Mute speaker</span>
          <Switch aria-label="Mute speaker" checked={muted} onCheckedChange={setMuted} />
        </div>

        {playbackState === "blocked" ? (
          <Button
            className="justify-center"
            onClick={() => {
              void audioRef.current?.play().then(
                () => setPlaybackState("playing"),
                () => setPlaybackState("blocked")
              );
            }}
            variant="outline"
          >
            Start playback
          </Button>
        ) : null}
      </CardContent>
    </div>
  );
}
