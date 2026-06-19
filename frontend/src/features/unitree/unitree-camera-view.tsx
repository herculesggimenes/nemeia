import { useEffect, useRef } from "react";
import type { SceneObject } from "../../lib/types";

type Props = {
  objects: SceneObject[];
};

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
    <div className="unitreeCamera">
      <canvas ref={canvasRef} />
      <div className="unitreeCameraShade" />
      <div className="unitreeCameraHud">
        <span>front camera</span>
        <strong>No Video</strong>
      </div>
      {objects.map((object, index) => (
        <div className={`unitreeDetection detection${index}`} key={object.id}>
          <strong>{object.label}</strong>
          <span>{Math.round(object.confidence * 100)}%</span>
        </div>
      ))}
    </div>
  );
}
