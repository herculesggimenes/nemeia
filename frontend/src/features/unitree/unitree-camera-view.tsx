import { useEffect, useRef } from "react";
import type { SceneObject } from "../../lib/types";

type Props = {
  objects: SceneObject[];
};

const detectionPositions = [
  "left-[58%] top-[32%]",
  "left-[38%] top-[78%]",
  "left-[47%] top-[27%]"
];

export function UnitreeCameraView({ objects }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) {
      return;
    }

    let frame = 0;
    let raf = 0;

    const renderNoise = () => {
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(1, Math.floor(rect.width));
      const height = Math.max(1, Math.floor(rect.height));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      const imageData = ctx.createImageData(width, height);
      const data = imageData.data;
      for (let i = 0; i < data.length; i += 4) {
        const stripe = Math.sin((i / 4 + frame * 8) * 0.04) * 18;
        const v = Math.max(0, Math.min(255, 35 + Math.random() * 90 + stripe));
        data[i] = v;
        data[i + 1] = v * 0.82;
        data[i + 2] = v * 0.52;
        data[i + 3] = 255;
      }
      ctx.putImageData(imageData, 0, 0);

      frame += 1;
      raf = requestAnimationFrame(renderNoise);
    };

    renderNoise();
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="relative h-full min-h-0 overflow-hidden bg-surface-0" data-testid="unitree-camera">
      <canvas className="block size-full" ref={canvasRef} />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_28%,transparent_0,transparent_34%,rgba(17,17,27,0.46)_74%)]" />
      <div className="absolute left-4 top-4 rounded-md border border-primary bg-surface-2/85 px-2.5 py-2 text-xs shadow-lg">
        <span className="block text-[10px] font-extrabold uppercase tracking-wide text-muted">front camera</span>
        <strong className="block text-sm text-foreground">No Video</strong>
      </div>
      {objects.map((object, index) => (
        <div
          className={`absolute flex items-center gap-1.5 rounded-md border border-primary bg-surface-2/90 px-2.5 py-1 text-xs shadow-[0_0_0_8px_rgb(205_214_244/0.08)] ${detectionPositions[index] ?? "left-1/2 top-1/2"}`}
          key={object.id}
        >
          <strong className="text-foreground">{object.label}</strong>
          <span className="font-extrabold text-primary">{Math.round(object.confidence * 100)}%</span>
        </div>
      ))}
    </div>
  );
}
