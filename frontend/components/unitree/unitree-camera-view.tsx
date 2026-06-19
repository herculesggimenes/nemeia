import { useEffect, useRef } from "react";
import type { Go2ConnectionState } from "../../lib/robots/unitree/go2-types";

type Props = {
  connectionState: Go2ConnectionState;
  stream: MediaStream | null;
};

function CameraWaitingState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="grid h-full min-h-0 place-items-center bg-surface-0 p-6 text-center" data-testid="unitree-camera-waiting">
      <div className="grid max-w-xs gap-2">
        <span className="text-[10px] font-extrabold uppercase tracking-wide text-muted">front camera</span>
        <strong className="text-base text-foreground">{title}</strong>
        <p className="text-sm leading-6 text-muted">{detail}</p>
      </div>
    </div>
  );
}

export function UnitreeCameraView({ connectionState, stream }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    video.srcObject = stream;
    if (stream) {
      void video.play().catch(() => undefined);
    }

    return () => {
      video.pause();
      video.srcObject = null;
    };
  }, [stream]);

  if (connectionState !== "connected") {
    return (
      <CameraWaitingState
        title="Waiting for Go2 connection"
        detail="Connect to the robot from Settings before opening the live camera stream."
      />
    );
  }

  if (!stream) {
    return (
      <CameraWaitingState
        title="Connected, waiting for video"
        detail="The WebRTC session is connected. Nemeia is waiting for the robot to attach the front camera track."
      />
    );
  }

  return (
    <div className="relative h-full min-h-0 overflow-hidden bg-surface-0" data-testid="unitree-camera">
      <video
        className="block size-full object-cover"
        muted
        playsInline
        ref={videoRef}
      />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_28%,transparent_0,transparent_34%,rgba(17,17,27,0.46)_74%)]" />
      <div className="absolute left-4 top-4 rounded-md border border-primary bg-surface-2/85 px-2.5 py-2 text-xs shadow-lg">
        <span className="block text-[10px] font-extrabold uppercase tracking-wide text-muted">front camera</span>
        <strong className="block text-sm text-foreground">Live</strong>
      </div>
    </div>
  );
}
