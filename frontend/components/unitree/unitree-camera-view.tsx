import { useCallback, useEffect, useState } from "react";
import { RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { TransformComponent, TransformWrapper } from "react-zoom-pan-pinch";
import type { Go2ConnectionState } from "../../lib/robots/unitree/go2-types";
import { Button } from "../ui/button";

type Props = {
  connectionState: Go2ConnectionState;
  enabled: boolean;
  stream: MediaStream | null;
};

const MIN_CAMERA_ZOOM = 1;
const MAX_CAMERA_ZOOM = 4;
const CAMERA_ZOOM_STEP = 0.25;

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

export function UnitreeCameraView({ connectionState, enabled, stream }: Props) {
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null);
  const [videoReady, setVideoReady] = useState(false);
  const bindVideoElement = useCallback((element: HTMLVideoElement | null) => {
    setVideoElement(element);
  }, []);

  useEffect(() => {
    if (!videoElement) {
      return;
    }

    let cancelled = false;
    let retryCount = 0;
    let retryTimer: number | null = null;
    const tracks = stream?.getVideoTracks() ?? [];

    const clearRetryTimer = () => {
      if (retryTimer) {
        window.clearTimeout(retryTimer);
        retryTimer = null;
      }
    };
    const markReady = () => {
      if (!cancelled && videoElement.videoWidth > 0 && videoElement.videoHeight > 0) {
        setVideoReady(true);
      }
    };
    const playVideo = () => {
      if (cancelled || !stream) {
        return;
      }

      void videoElement.play().then(markReady, () => {
        if (!cancelled) {
          setVideoReady(false);
        }
      });
    };
    const trackHandlers = tracks.map((track) => ({
      handleEnded: () => setVideoReady(false),
      handleMute: () => setVideoReady(false),
      handleUnmute: playVideo,
      track
    }));
    const schedulePlaybackRetry = () => {
      clearRetryTimer();
      if (!stream || cancelled || retryCount >= 12) {
        return;
      }

      retryCount += 1;
      retryTimer = window.setTimeout(() => {
        if (cancelled) {
          return;
        }

        if (videoElement.videoWidth > 0 && videoElement.videoHeight > 0 && !videoElement.paused) {
          markReady();
          return;
        }

        playVideo();
        schedulePlaybackRetry();
      }, 500);
    };

    setVideoReady(false);
    videoElement.srcObject = stream;
    if (stream) {
      videoElement.load();
      playVideo();
      schedulePlaybackRetry();
    }

    videoElement.addEventListener("loadedmetadata", playVideo);
    videoElement.addEventListener("canplay", playVideo);
    videoElement.addEventListener("playing", markReady);
    videoElement.addEventListener("resize", markReady);
    trackHandlers.forEach(({ handleEnded, handleMute, handleUnmute, track }) => {
      track.addEventListener("unmute", handleUnmute);
      track.addEventListener("ended", handleEnded);
      track.addEventListener("mute", handleMute);
    });

    return () => {
      cancelled = true;
      clearRetryTimer();
      videoElement.removeEventListener("loadedmetadata", playVideo);
      videoElement.removeEventListener("canplay", playVideo);
      videoElement.removeEventListener("playing", markReady);
      videoElement.removeEventListener("resize", markReady);
      trackHandlers.forEach(({ handleEnded, handleMute, handleUnmute, track }) => {
        track.removeEventListener("unmute", handleUnmute);
        track.removeEventListener("ended", handleEnded);
        track.removeEventListener("mute", handleMute);
      });
      videoElement.pause();
      videoElement.srcObject = null;
    };
  }, [stream, videoElement]);

  if (!enabled) {
    return (
      <CameraWaitingState
        title="Front camera disabled"
        detail="Turn the stream back on from the Front Camera Config tab when you need live video."
      />
    );
  }

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
    <div className="relative h-full min-h-0 overflow-hidden bg-black" data-testid="unitree-camera">
      <TransformWrapper
        centerOnInit
        centerZoomedOut
        doubleClick={{ mode: "reset", step: CAMERA_ZOOM_STEP }}
        limitToBounds
        maxScale={MAX_CAMERA_ZOOM}
        minScale={MIN_CAMERA_ZOOM}
        panning={{ allowLeftClickPan: true, velocityDisabled: true }}
        pinch={{ step: CAMERA_ZOOM_STEP }}
        wheel={{ step: CAMERA_ZOOM_STEP }}
      >
        {({ resetTransform, state, zoomIn, zoomOut }) => (
          <>
            <TransformComponent
              contentClass="!grid !h-full !w-full !place-items-center"
              wrapperClass="!h-full !w-full"
            >
              <video
                autoPlay
                className="block max-h-full max-w-full select-none"
                muted
                playsInline
                ref={bindVideoElement}
              />
            </TransformComponent>
            <div className="absolute left-3 top-3 rounded-md border border-white/10 bg-black/45 px-2 py-1.5 text-xs shadow-lg backdrop-blur">
              <span className="block text-[9px] font-extrabold uppercase tracking-wide text-white/50">front camera</span>
              <strong className="block text-xs text-white">{videoReady ? "Live" : "Starting"}</strong>
            </div>
            <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-white/10 bg-black/45 p-1 shadow-lg backdrop-blur">
              <Button
                aria-label="Zoom out camera"
                className="size-7 rounded-full text-white/70 hover:bg-white/10 hover:text-white disabled:text-white/30"
                disabled={state.scale === MIN_CAMERA_ZOOM}
                onClick={() => zoomOut(CAMERA_ZOOM_STEP)}
                size="icon"
                type="button"
                variant="ghost"
              >
                <ZoomOut className="size-4" />
              </Button>
              <span className="min-w-10 text-center text-[11px] font-semibold text-white/70">{Math.round(state.scale * 100)}%</span>
              <Button
                aria-label="Zoom in camera"
                className="size-7 rounded-full text-white/70 hover:bg-white/10 hover:text-white disabled:text-white/30"
                disabled={state.scale === MAX_CAMERA_ZOOM}
                onClick={() => zoomIn(CAMERA_ZOOM_STEP)}
                size="icon"
                type="button"
                variant="ghost"
              >
                <ZoomIn className="size-4" />
              </Button>
              <Button
                aria-label="Reset camera view"
                className="size-7 rounded-full text-white/70 hover:bg-white/10 hover:text-white disabled:text-white/30"
                disabled={state.scale === MIN_CAMERA_ZOOM && state.positionX === 0 && state.positionY === 0}
                onClick={() => resetTransform()}
                size="icon"
                type="button"
                variant="ghost"
              >
                <RotateCcw className="size-4" />
              </Button>
            </div>
          </>
        )}
      </TransformWrapper>
    </div>
  );
}
