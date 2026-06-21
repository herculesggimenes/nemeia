import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { Go2ConnectionState, Go2LidarFrame, Go2MotorState, Go2RobotPose } from "../../lib/robots/unitree/go2-types";

type Props = {
  connectionState: Go2ConnectionState;
  enabled: boolean;
  frameCount: number;
  lastFrameBytes: number | null;
  frame: Go2LidarFrame | null;
  lidarState: string | null;
  robotPose: Go2RobotPose | null;
  robotPoseMessageCount: number;
  robotPoseParseFailureCount: number;
  motorState: Go2MotorState[] | null;
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
  updateMotorState: (motors: Go2MotorState[] | null) => void;
  updateRobotPose: (pose: Go2RobotPose | null) => void;
};

type Joint = {
  axis: THREE.Vector3;
  node: THREE.Object3D;
  initialAngle: number;
  initialQuaternion: THREE.Quaternion;
};

const LEG_ORDER = ["FR", "FL", "RR", "RL"] as const;
const JOINT_ORDER = ["hip", "thigh", "calf"] as const;
const REQUIRED_GO2_JOINT_COUNT = LEG_ORDER.length * JOINT_ORDER.length;

function createTextSprite(text: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 96;
  const context = canvas.getContext("2d");
  if (context) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "rgba(24, 24, 37, 0.88)";
    context.strokeStyle = "rgba(137, 180, 250, 0.95)";
    context.lineWidth = 3;
    context.roundRect(16, 18, 224, 54, 10);
    context.fill();
    context.stroke();
    context.fillStyle = "#cdd6f4";
    context.font = "700 24px system-ui, -apple-system, BlinkMacSystemFont, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(text, canvas.width / 2, 45);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ depthTest: false, map: texture, transparent: true }));
  sprite.scale.set(0.9, 0.34, 1);
  return sprite;
}

function createGo2Marker(): THREE.Group {
  const marker = new THREE.Group();
  marker.name = "Go2 marker";
  marker.position.set(0, 0, 0.3);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.43, 0.5, 72),
    new THREE.MeshBasicMaterial({ color: "#89b4fa", side: THREE.DoubleSide, transparent: true, opacity: 0.72 })
  );
  ring.name = "Go2 fallback ring";
  ring.rotation.x = Math.PI / 2;
  ring.position.z = -0.19;
  marker.add(ring);

  const footprint = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 0.31, 0.012),
    new THREE.MeshBasicMaterial({ color: "#89b4fa", transparent: true, opacity: 0.18 })
  );
  footprint.name = "Go2 fallback footprint";
  footprint.position.z = -0.19;
  marker.add(footprint);

  const arrow = new THREE.ArrowHelper(
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0.22, 0, 0.24),
    0.75,
    "#f38ba8",
    0.18,
    0.1
  );
  arrow.name = "Go2 fallback heading";
  marker.add(arrow);

  const label = createTextSprite("Go2");
  label.position.set(0, 0, 0.62);
  marker.add(label);

  return marker;
}

function buildGo2JointMap(model: THREE.Object3D): Map<string, Joint> {
  const joints = new Map<string, Joint>();
  for (const leg of LEG_ORDER) {
    const hipNode = model.getObjectByName(`HipBone${leg}`);
    if (hipNode) {
      joints.set(`hip${leg}`, {
        axis: new THREE.Vector3(1, 0, 0),
        node: hipNode,
        initialAngle: 0,
        initialQuaternion: hipNode.quaternion.clone()
      });
    }

    const thighNode = model.getObjectByName(`ThighBone${leg}`);
    if (thighNode) {
      joints.set(`thigh${leg}`, {
        axis: new THREE.Vector3(0, 0, 1),
        node: thighNode,
        initialAngle: Math.PI / 4,
        initialQuaternion: thighNode.quaternion.clone()
      });
    }

    const calfNode = model.getObjectByName(`CalfBone${leg}`);
    if (calfNode) {
      joints.set(`calf${leg}`, {
        axis: new THREE.Vector3(0, 0, 1),
        node: calfNode,
        initialAngle: -Math.PI / 2,
        initialQuaternion: calfNode.quaternion.clone()
      });
    }
  }

  return joints;
}

function setJointAngle(joint: Joint | undefined, angle: number): void {
  if (!joint) {
    return;
  }

  const quaternion = new THREE.Quaternion();
  quaternion.setFromAxisAngle(joint.axis, angle - joint.initialAngle);
  quaternion.premultiply(joint.initialQuaternion);
  joint.node.quaternion.copy(quaternion);
  joint.node.updateMatrixWorld(true);
}

function disposeObject(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh || child instanceof THREE.Sprite || child instanceof THREE.Line || child instanceof THREE.Points) {
      child.geometry?.dispose();
      const material = child.material;
      const materials = Array.isArray(material) ? material : [material];
      for (const item of materials) {
        if ("map" in item && item.map) {
          item.map.dispose();
        }
        item.dispose();
      }
    }
  });
}

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
  onJointCount: (jointCount: number) => void,
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

  const go2Marker = createGo2Marker();
  scene.add(go2Marker);
  let go2Joints = new Map<string, Joint>();
  let latestMotorState: Go2MotorState[] | null = null;
  const jointAngles = new Map<string, number>();
  const targetJointAngles = new Map<string, number>();
  let robotPlanarSpeed = 0;
  let gaitPhase = 0;
  let lastAnimationTime = performance.now();
  let lastPoseSample: { at: number; x: number; y: number } | null = null;
  let hasRobotPose = false;
  const robotTarget = new THREE.Vector3(0, 0, 0.3);
  const robotQuatTarget = new THREE.Quaternion();
  const controlsTarget = new THREE.Vector3();
  const previousControlsTarget = new THREE.Vector3();
  const controlsTargetDelta = new THREE.Vector3();

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

  const setMotorTargets = (motors: Go2MotorState[] | null) => {
    if (!motors || motors.length < 12 || go2Joints.size === 0) {
      return;
    }

    for (let legIndex = 0; legIndex < LEG_ORDER.length; legIndex += 1) {
      const leg = LEG_ORDER[legIndex];
      for (let jointIndex = 0; jointIndex < JOINT_ORDER.length; jointIndex += 1) {
        const motor = motors[legIndex * 3 + jointIndex];
        if (motor) {
          const jointName = `${JOINT_ORDER[jointIndex]}${leg}`;
          targetJointAngles.set(jointName, motor.q);
          if (!jointAngles.has(jointName)) {
            jointAngles.set(jointName, motor.q);
            setJointAngle(go2Joints.get(jointName), motor.q);
          }
        }
      }
    }
  };

  const setProceduralGaitTargets = (now: number) => {
    if (go2Joints.size === 0 || robotPlanarSpeed < 0.03) {
      return;
    }

    const elapsedSeconds = Math.min((now - lastAnimationTime) / 1000, 0.05);
    const cadence = THREE.MathUtils.clamp(robotPlanarSpeed * 5.2, 2.2, 7.5);
    const amplitude = THREE.MathUtils.clamp(robotPlanarSpeed * 1.8, 0.18, 0.42);
    gaitPhase += elapsedSeconds * cadence;

    for (const leg of LEG_ORDER) {
      const diagonalPhase = leg === "FR" || leg === "RL" ? 0 : Math.PI;
      const phase = gaitPhase + diagonalPhase;
      const swing = Math.sin(phase);
      const lift = Math.max(0, swing);
      targetJointAngles.set(`hip${leg}`, 0.05 * Math.sin(phase + Math.PI / 2));
      targetJointAngles.set(`thigh${leg}`, 0.78 + amplitude * swing);
      targetJointAngles.set(`calf${leg}`, -1.52 - amplitude * 1.35 * lift + amplitude * 0.4 * Math.min(0, swing));
    }
  };

  const animateMotorTargets = (now: number) => {
    setProceduralGaitTargets(now);
    if (go2Joints.size === 0 || targetJointAngles.size === 0) {
      return;
    }

    for (const [jointName, targetAngle] of targetJointAngles) {
      const currentAngle = jointAngles.get(jointName) ?? targetAngle;
      const nextAngle = THREE.MathUtils.lerp(currentAngle, targetAngle, 0.42);
      jointAngles.set(jointName, nextAngle);
      setJointAngle(go2Joints.get(jointName), nextAngle);
    }
  };

  const gltfLoader = new GLTFLoader();
  gltfLoader.load("/models/Go2.glb", (gltf) => {
    const model = gltf.scene;
    model.name = "Go2 CAD";
    model.position.set(0, 0, -0.3);
    model.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) {
        return;
      }

      child.castShadow = true;
      child.receiveShadow = true;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const modelMaterial of materials) {
        modelMaterial.transparent = true;
        modelMaterial.opacity = 0.9;
      }
    });

    const rail = model.getObjectByName("ExtendRail");
    if (rail) {
      rail.visible = false;
    }
    for (const leg of ["FL", "FR", "RL", "RR"]) {
      const rod = model.getObjectByName(`Rod${leg}`);
      if (rod) {
        rod.visible = false;
      }
    }

    go2Joints = buildGo2JointMap(model);
    onJointCount(go2Joints.size);
    go2Marker.getObjectByName("Go2 fallback ring")?.removeFromParent();
    go2Marker.getObjectByName("Go2 fallback footprint")?.removeFromParent();
    go2Marker.getObjectByName("Go2 fallback heading")?.removeFromParent();
    go2Marker.add(model);
    setMotorTargets(latestMotorState);
  });

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
    const now = performance.now();
    if (hasRobotPose) {
      go2Marker.position.lerp(robotTarget, 0.22);
      go2Marker.quaternion.slerp(robotQuatTarget, 0.22);
      controlsTarget.set(robotTarget.x, robotTarget.y, 0);
      previousControlsTarget.copy(controls.target);
      controls.target.lerp(controlsTarget, 0.1);
      controlsTargetDelta.subVectors(controls.target, previousControlsTarget);
      camera.position.add(controlsTargetDelta);
    }
    animateMotorTargets(now);
    lastAnimationTime = now;
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
    updateMotorState: (motors) => {
      latestMotorState = motors;
      setMotorTargets(motors);
    },
    updateRobotPose: (pose) => {
      if (!pose) {
        return;
      }

      hasRobotPose = true;
      const now = performance.now();
      if (lastPoseSample) {
        const elapsedSeconds = Math.max((now - lastPoseSample.at) / 1000, 0.001);
        const distance = Math.hypot(pose.x - lastPoseSample.x, pose.y - lastPoseSample.y);
        robotPlanarSpeed = THREE.MathUtils.lerp(robotPlanarSpeed, distance / elapsedSeconds, 0.35);
      }
      lastPoseSample = { at: now, x: pose.x, y: pose.y };
      robotTarget.set(pose.x, pose.y, pose.z);
      robotQuatTarget.setFromEuler(new THREE.Euler(0, 0, pose.yaw));
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
      disposeObject(go2Marker);
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
  lidarState,
  robotPose,
  robotPoseMessageCount,
  robotPoseParseFailureCount,
  motorState
}: {
  frame: Go2LidarFrame | null;
  frameCount: number;
  lastFrameBytes: number | null;
  lidarState: string | null;
  robotPose: Go2RobotPose | null;
  robotPoseMessageCount: number;
  robotPoseParseFailureCount: number;
  motorState: Go2MotorState[] | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<VoxelScene | null>(null);
  const previousMotorStateRef = useRef<Go2MotorState[] | null>(null);
  const [faceCount, setFaceCount] = useState(0);
  const [jointCount, setJointCount] = useState(0);
  const [motorDelta, setMotorDelta] = useState(0);
  const [workerError, setWorkerError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const voxelScene = createVoxelScene(canvas, setFaceCount, setJointCount, setWorkerError);
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

  useEffect(() => {
    sceneRef.current?.updateRobotPose(robotPose);
  }, [robotPose]);

  useEffect(() => {
    sceneRef.current?.updateMotorState(motorState);
    const previousMotorState = previousMotorStateRef.current;
    if (!motorState || !previousMotorState) {
      previousMotorStateRef.current = motorState;
      setMotorDelta(0);
      return;
    }

    const sampleCount = Math.min(motorState.length, previousMotorState.length, REQUIRED_GO2_JOINT_COUNT);
    let maxDelta = 0;
    for (let index = 0; index < sampleCount; index += 1) {
      maxDelta = Math.max(maxDelta, Math.abs(motorState[index].q - previousMotorState[index].q));
    }
    previousMotorStateRef.current = motorState;
    setMotorDelta(maxDelta);
  }, [motorState]);

  return (
    <div className="relative h-full min-h-0 bg-surface-0" data-testid="unitree-point-cloud-live">
      <canvas className="absolute inset-0 h-full w-full touch-none outline-none" ref={canvasRef} />
      <div className="absolute left-4 top-4 rounded-md border border-primary bg-surface-2/85 px-2.5 py-2 text-xs shadow-lg">
        <span className="block text-[10px] font-extrabold uppercase tracking-wide text-muted">SLAM</span>
        <strong className="block text-sm text-foreground">{faceCount > 0 ? `${faceCount.toLocaleString()} faces` : "Decoding"}</strong>
        <span className="block text-muted">{frameCount.toLocaleString()} frames</span>
        {lastFrameBytes ? <span className="block text-muted">{lastFrameBytes.toLocaleString()} bytes</span> : null}
        {lidarState ? <span className="block max-w-48 truncate text-muted">LiDAR state received</span> : null}
        {robotPose ? <span className="block max-w-48 truncate text-primary">Go2 pose tracking</span> : <span className="block max-w-48 truncate text-danger">Go2 pose missing</span>}
        {jointCount > 0 ? (
          <span className="block max-w-48 truncate text-primary">
            model joints {jointCount}/{REQUIRED_GO2_JOINT_COUNT}
          </span>
        ) : (
          <span className="block max-w-48 truncate text-muted">model loading</span>
        )}
        {motorState ? (
          <span className="block max-w-48 truncate text-primary">joint data Δ {motorDelta.toFixed(3)}</span>
        ) : (
          <span className="block max-w-48 truncate text-muted">joint data waiting</span>
        )}
        <span className="block max-w-48 truncate text-muted">
          pose {robotPoseMessageCount.toLocaleString()}
          {robotPoseParseFailureCount > 0 ? ` / ${robotPoseParseFailureCount.toLocaleString()} bad` : ""}
        </span>
        {workerError ? <span className="block max-w-48 truncate text-danger">{workerError}</span> : null}
      </div>
    </div>
  );
}

export function UnitreePointCloudView({
  connectionState,
  enabled,
  frameCount,
  lastFrameBytes,
  frame,
  lidarState,
  robotPose,
  robotPoseMessageCount,
  robotPoseParseFailureCount,
  motorState
}: Props) {
  if (!enabled) {
    return (
      <PointCloudWaitingState
        title="LiDAR disabled"
        detail="Turn the LiDAR stream back on from the LiDAR Config tab when you need live SLAM data."
      />
    );
  }

  if (connectionState !== "connected") {
    return (
      <PointCloudWaitingState
        title="Waiting for Go2 connection"
        detail="Connect to the robot from Settings before opening the live LiDAR and SLAM view."
      />
    );
  }

  if (frameCount > 0) {
    return (
      <PointCloudCanvas
        frame={frame}
        frameCount={frameCount}
        lastFrameBytes={lastFrameBytes}
        lidarState={lidarState}
        robotPose={robotPose}
        robotPoseMessageCount={robotPoseMessageCount}
        robotPoseParseFailureCount={robotPoseParseFailureCount}
        motorState={motorState}
      />
    );
  }

  return (
    <PointCloudWaitingState
      title="Connected, waiting for LiDAR frame"
      detail="The robot connection is active. Nemeia has not received a normalized point-cloud frame yet."
    />
  );
}
