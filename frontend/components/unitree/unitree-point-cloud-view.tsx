import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Go2ConnectionState, Go2LidarFrame } from "../../lib/robots/unitree/go2-types";

type Props = {
  connectionState: Go2ConnectionState;
  frameCount: number;
  lastFrameBytes: number | null;
  frame: Go2LidarFrame | null;
  lidarState: string | null;
};

type VoxelGeometryMessage = {
  type: "geometry";
  geometryData: {
    point_count: number;
    face_count: number;
    positions: Uint8Array;
    uvs: Uint8Array;
    indices: Uint32Array;
  };
  resolution: number;
  origin: [number, number, number];
};

type WorkerMessage = VoxelGeometryMessage | { type: "ready" } | { type: "error"; message: string };

type VoxelScene = {
  controls: OrbitControls;
  dispose: () => void;
  processCompressed: (frame: Go2LidarFrame) => void;
};

function PointCloudWaitingState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="grid h-full min-h-0 place-items-center bg-surface-0 p-6 text-center" data-testid="unitree-point-cloud-waiting">
      <div className="grid max-w-xs gap-2">
        <span className="text-[10px] font-extrabold uppercase tracking-wide text-muted">SLAM</span>
        <strong className="text-base text-foreground">{title}</strong>
        <p className="text-sm leading-6 text-muted">{detail}</p>
      </div>
    </div>
  );
}

function createVoxelScene(
  canvas: HTMLCanvasElement,
  onFaceCount: (faceCount: number) => void,
  onWorkerError: (message: string) => void
): VoxelScene {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor("#11111b", 1);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#11111b");

  const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 500);
  camera.position.set(-3, 0, 3);
  camera.up.set(0, 0, 1);

  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;
  controls.minDistance = 0.5;
  controls.maxDistance = 20;
  controls.update();

  const ambient = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambient);

  const directional = new THREE.DirectionalLight(0xffffff, 1.2);
  directional.position.set(5, -5, 8);
  scene.add(directional);

  const grid = new THREE.GridHelper(40, 40, "#45475a", "#45475a");
  grid.rotateX(Math.PI / 2);
  scene.add(grid);

  const texture = new THREE.TextureLoader().load("/models/axisColor4.png");
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    side: THREE.DoubleSide,
    transparent: false
  });

  let mesh: THREE.Mesh | null = null;
  let throttleTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingFrame: Go2LidarFrame | null = null;

  const worker = new Worker("/workers/voxel-worker.js");
  const handleWorkerMessage = (event: MessageEvent<WorkerMessage>) => {
    if (event.data.type === "error") {
      onWorkerError(event.data.message);
      return;
    }

    if (event.data.type !== "geometry") {
      return;
    }

    const { geometryData, origin, resolution } = event.data;
    if (geometryData.face_count === 0) {
      return;
    }

    const positions = new Uint8Array(geometryData.positions);
    const uvs = new Uint8Array(geometryData.uvs);
    const indices = new Uint32Array(geometryData.indices);

    if (mesh) {
      scene.remove(mesh);
      mesh.geometry.dispose();
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2, true));
    if (indices.length > 0) {
      geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    }

    mesh = new THREE.Mesh(geometry, material);
    mesh.scale.set(resolution, resolution, resolution);
    mesh.position.set(origin[0], origin[1], origin[2]);
    mesh.frustumCulled = false;
    scene.add(mesh);
    onFaceCount(geometryData.face_count);
  };
  worker.addEventListener("message", handleWorkerMessage);
  worker.addEventListener("error", () => onWorkerError("Voxel worker failed"));

  const resize = () => {
    const width = Math.max(canvas.clientWidth, 1);
    const height = Math.max(canvas.clientHeight, 1);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };

  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();

  let animationFrame = 0;
  const animate = () => {
    animationFrame = requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  };
  animate();

  return {
    controls,
    processCompressed: (frame) => {
      pendingFrame = frame;
      if (throttleTimer) {
        return;
      }

      throttleTimer = setTimeout(() => {
        throttleTimer = null;
        if (!pendingFrame) {
          return;
        }

        const data = pendingFrame.data.slice(0);
        worker.postMessage({ ...pendingFrame, data }, [data]);
        pendingFrame = null;
      }, 150);
    },
    dispose: () => {
      cancelAnimationFrame(animationFrame);
      observer.disconnect();
      worker.removeEventListener("message", handleWorkerMessage);
      worker.terminate();
      if (throttleTimer) {
        clearTimeout(throttleTimer);
      }
      mesh?.geometry.dispose();
      material.dispose();
      texture.dispose();
      controls.dispose();
      renderer.dispose();
    }
  };
}

function PointCloudCanvas({
  frame,
  frameCount,
  lastFrameBytes,
  lidarState
}: {
  frame: Go2LidarFrame | null;
  frameCount: number;
  lastFrameBytes: number | null;
  lidarState: string | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<VoxelScene | null>(null);
  const [faceCount, setFaceCount] = useState(0);
  const [workerError, setWorkerError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const voxelScene = createVoxelScene(canvas, setFaceCount, setWorkerError);
    sceneRef.current = voxelScene;

    return () => {
      voxelScene.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!frame || !sceneRef.current) {
      return;
    }

    sceneRef.current.processCompressed(frame);
  }, [frame]);

  return (
    <div className="relative h-full min-h-0 bg-surface-0" data-testid="unitree-point-cloud-live">
      <canvas className="absolute inset-0 h-full w-full touch-none outline-none" ref={canvasRef} />
      <div className="absolute left-4 top-4 rounded-md border border-primary bg-surface-2/85 px-2.5 py-2 text-xs shadow-lg">
        <span className="block text-[10px] font-extrabold uppercase tracking-wide text-muted">SLAM</span>
        <strong className="block text-sm text-foreground">{faceCount > 0 ? `${faceCount.toLocaleString()} faces` : "Decoding"}</strong>
        <span className="block text-muted">{frameCount.toLocaleString()} frames</span>
        {lastFrameBytes ? <span className="block text-muted">{lastFrameBytes.toLocaleString()} bytes</span> : null}
        {lidarState ? <span className="block max-w-48 truncate text-muted">state received</span> : null}
        {workerError ? <span className="block max-w-48 truncate text-danger">{workerError}</span> : null}
      </div>
    </div>
  );
}

export function UnitreePointCloudView({ connectionState, frameCount, lastFrameBytes, frame, lidarState }: Props) {
  if (connectionState !== "connected") {
    return (
      <PointCloudWaitingState
        title="Waiting for Go2 connection"
        detail="Connect to the robot from Settings before opening the live LiDAR and SLAM view."
      />
    );
  }

  if (frameCount > 0) {
    return <PointCloudCanvas frame={frame} frameCount={frameCount} lastFrameBytes={lastFrameBytes} lidarState={lidarState} />;
  }

  return (
    <PointCloudWaitingState
      title="Connected, waiting for LiDAR frame"
      detail="The robot connection is active. Nemeia has not received a normalized point-cloud frame yet."
    />
  );
}
