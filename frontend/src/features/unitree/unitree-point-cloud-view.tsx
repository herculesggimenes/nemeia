import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { SceneObject } from "../../lib/types";

type Props = {
  objects: SceneObject[];
};

function createHeightMaterial(size: number): THREE.PointsMaterial {
  const material = new THREE.PointsMaterial({ size });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = `varying float heightZ;\n${shader.vertexShader}`;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <project_vertex>",
      `vec4 mvPosition = vec4(transformed, 1.0);
       mvPosition = modelViewMatrix * mvPosition;
       gl_Position = projectionMatrix * mvPosition;
       heightZ = transformed.z;`
    );
    shader.fragmentShader = `varying float heightZ;\n${shader.fragmentShader}`;
    shader.fragmentShader = shader.fragmentShader.replace(
      "vec4 diffuseColor = vec4( diffuse, opacity );",
      `vec4 diffuseColor = vec4(diffuse, opacity);
       diffuseColor.r = abs(sin(heightZ / 1.0));
       diffuseColor.g = 0.5 * abs(cos(heightZ / 1.0));
       diffuseColor.b = 0.3;`
    );
  };
  return material;
}

function mockMapPoints(): Float32Array {
  const points: number[] = [];
  for (let i = 0; i < 850; i += 1) {
    const angle = i * 0.21;
    const radius = 0.8 + (i % 80) * 0.035;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    const z = Math.sin(i * 0.07) * 0.18 + (i % 9 === 0 ? 0.35 : 0);
    points.push(x, y, z);
  }
  return new Float32Array(points);
}

function mockLaserPoints(objects: SceneObject[]): Float32Array {
  const points: number[] = [];
  objects.forEach((object, objectIndex) => {
    const baseAngle = -0.7 + objectIndex * 0.55;
    for (let i = 0; i < 70; i += 1) {
      const angle = baseAngle + (i - 35) * 0.008;
      const radius = object.rangeM + Math.sin(i * 0.5) * 0.035;
      points.push(Math.sin(angle) * radius, -Math.cos(angle) * radius, 0.08 + (i % 6) * 0.035);
    }
  });
  return new Float32Array(points);
}

function createRobotMarker(): THREE.Group {
  const group = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.66, 0.32, 0.28),
    new THREE.MeshStandardMaterial({ color: 0x89b4fa, roughness: 0.48, metalness: 0.08, transparent: true, opacity: 0.9 })
  );
  body.position.z = 0.35;
  group.add(body);

  const radar = new THREE.Mesh(
    new THREE.CylinderGeometry(0.13, 0.13, 0.05, 24),
    new THREE.MeshStandardMaterial({ color: 0xfff3e0, roughness: 0.4 })
  );
  radar.position.z = 0.53;
  group.add(radar);

  for (const x of [-0.23, 0.23]) {
    for (const y of [-0.22, 0.22]) {
      const leg = new THREE.Mesh(
        new THREE.CylinderGeometry(0.035, 0.035, 0.38, 8),
        new THREE.MeshStandardMaterial({ color: 0x585b70 })
      );
      leg.position.set(x, y, 0.18);
      leg.rotation.x = Math.PI / 2;
      group.add(leg);
    }
  }

  return group;
}

function createGoalMarker(x: number, y: number): THREE.Group {
  const group = new THREE.Group();
  group.position.set(x, y, 0);

  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.018, 0.018, 0.8, 8),
    new THREE.MeshStandardMaterial({ color: 0xf9e2af })
  );
  pole.rotation.x = Math.PI / 2;
  pole.position.z = 0.4;
  group.add(pole);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.14, 0.025, 8, 24),
    new THREE.MeshStandardMaterial({ color: 0xf9e2af })
  );
  ring.position.z = 0.025;
  group.add(ring);

  return group;
}

export function UnitreePointCloudView({ objects }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mapPoints = useMemo(() => mockMapPoints(), []);
  const laserPoints = useMemo(() => mockLaserPoints(objects), [objects]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) {
      return;
    }

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setClearColor("#11111b");

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#11111b");

    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500);
    camera.up.set(0, 0, 1);
    camera.position.set(0, -5, 5.5);

    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.maxPolarAngle = Math.PI / 2;
    controls.target.set(0, 0, 0);

    scene.add(new THREE.AmbientLight(0xffffff, 0.58));
    const light = new THREE.DirectionalLight(0xffffff, 0.8);
    light.position.set(5, -5, 10);
    scene.add(light);

    const grid = new THREE.GridHelper(50, 50, "#45475a", "#313244");
    grid.rotation.x = Math.PI / 2;
    scene.add(grid);

    const mapGeometry = new THREE.BufferGeometry();
    mapGeometry.setAttribute("position", new THREE.Float32BufferAttribute(mapPoints, 3));
    mapGeometry.computeBoundingSphere();
    const filteredPoints = new THREE.Points(mapGeometry, createHeightMaterial(0.03));
    scene.add(filteredPoints);

    const laserGeometry = new THREE.BufferGeometry();
    laserGeometry.setAttribute("position", new THREE.Float32BufferAttribute(laserPoints, 3));
    laserGeometry.computeBoundingSphere();
    const currentLaser = new THREE.Points(laserGeometry, new THREE.PointsMaterial({ size: 0.055, color: 0xffffff }));
    scene.add(currentLaser);

    const robot = createRobotMarker();
    scene.add(robot);

    const target = objects[0];
    const goal = createGoalMarker(Math.sin(-0.7) * (target?.rangeM ?? 1.8), -Math.cos(-0.7) * (target?.rangeM ?? 1.8));
    scene.add(goal);

    const traceGeometry = new THREE.BufferGeometry();
    traceGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(new Float32Array([0, 0, 0.04, 0.35, -0.42, 0.04, 0.7, -0.68, 0.04]), 3)
    );
    scene.add(new THREE.Line(traceGeometry, new THREE.LineBasicMaterial({ color: 0xff3d3d })));

    const resize = () => {
      const width = parent.clientWidth;
      const height = parent.clientHeight;
      renderer.setSize(width, height, false);
      camera.aspect = width / Math.max(1, height);
      camera.updateProjectionMatrix();
    };

    let raf = 0;
    let t = 0;
    const animate = () => {
      t += 0.018;
      robot.rotation.z = Math.sin(t) * 0.04;
      const radar = robot.children[1];
      radar.rotation.z += 0.08;
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(animate);
    };

    resize();
    window.addEventListener("resize", resize);
    animate();

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(raf);
      controls.dispose();
      renderer.dispose();
      mapGeometry.dispose();
      laserGeometry.dispose();
      traceGeometry.dispose();
    };
  }, [laserPoints, mapPoints, objects]);

  return (
    <div className="relative h-full min-h-0 overflow-hidden bg-surface-0" data-testid="unitree-point-cloud">
      <canvas className="block size-full" ref={canvasRef} />
      <div className="absolute left-4 top-4 rounded-md border border-primary bg-surface-2/85 px-2.5 py-2 text-xs shadow-lg">
        <span className="block text-[10px] font-extrabold uppercase tracking-wide text-muted">SLAM</span>
        <strong className="block text-sm text-foreground">{mapPoints.length / 3} map pts</strong>
        <strong className="block text-sm text-foreground">{laserPoints.length / 3} scan pts</strong>
      </div>
    </div>
  );
}
