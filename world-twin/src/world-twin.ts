import { createHash } from "node:crypto";
import { canonicalize } from "../../contracts/src/canonical-json.ts";
import { WorldTwinError } from "./world-twin-errors.ts";

const DEFAULT_TUPLE = {
  builder_version: 1,
  engine_version: "box3d-0.1.0",
  inflation_policy: "conf_linear_v1",
  seed: 42
};

export class WorldTwinBuilder {
  constructor({ physicsAdapter = new AabbPhysicsAdapter(), ...defaults } = {}) {
    this.physicsAdapter = physicsAdapter;
    this.defaults = { ...DEFAULT_TUPLE, engine_version: physicsAdapter.descriptor().engine_version, ...defaults };
  }

  tupleForScene(sceneSnapshot, overrides = {}) {
    if (!sceneSnapshot?.scene_snapshot_id) {
      throw new WorldTwinError("SCENE_SNAPSHOT_REQUIRED", "World Twin requires a Scene snapshot.");
    }
    return {
      scene_snapshot_id: sceneSnapshot.scene_snapshot_id,
      ontology_version: sceneSnapshot.ontology_version,
      label_map_version: sceneSnapshot.label_map_version,
      ...this.defaults,
      ...overrides
    };
  }

  worldRef(tuple) {
    return worldRef(tuple);
  }

  build(sceneSnapshot, overrides = {}) {
    const tuple = this.tupleForScene(sceneSnapshot, overrides);
    const bodies = this.physicsAdapter.bodiesForScene(sceneSnapshot).sort((left, right) => left.entity_id.localeCompare(right.entity_id));
    return deepFreeze({
      tuple,
      world_ref: worldRef(tuple),
      physics_adapter: this.physicsAdapter.descriptor(),
      bodies
    });
  }
}

export class AabbPhysicsAdapter {
  descriptor() {
    return {
      name: "aabb-2d",
      fidelity: "reference",
      engine_version: "box3d-0.1.0"
    };
  }

  bodiesForScene(sceneSnapshot) {
    return bodiesForScene(sceneSnapshot, bodyForEntity);
  }
}

export class Precise2dPhysicsAdapter {
  descriptor() {
    return {
      name: "precise-2d",
      fidelity: "deterministic-capsule",
      engine_version: "precise2d-0.1.0"
    };
  }

  bodiesForScene(sceneSnapshot) {
    return bodiesForScene(sceneSnapshot, preciseBodyForEntity);
  }
}

export function worldRef(tuple) {
  return `sha256:${createHash("sha256").update(canonicalize(tuple)).digest("hex")}`;
}

export function clearanceCheck({
  world,
  sweep,
  min_clearance_m = 0.1,
  mode_by_physical_schema = { rigid: "advisory", deformable: "advisory" }
}) {
  if (!world?.world_ref || !Array.isArray(world.bodies)) {
    throw new WorldTwinError("WORLD_REQUIRED", "sim.clearance requires a World Twin.");
  }
  const sweepGeometry = geometryFromSweep(sweep);
  const violations = [];
  const considered = [];

  for (const body of world.bodies) {
    const mode = mode_by_physical_schema[body.physical_schema] ?? "advisory";
    const clearance_m = round(distanceToBody(sweepGeometry, body));
    const entry = {
      entity_id: body.entity_id,
      physical_schema: body.physical_schema,
      mode,
      clearance_m
    };
    considered.push(entry);
    if (clearance_m < min_clearance_m) {
      violations.push(entry);
    }
  }

  const mode = checkMode({ considered, violations });
  return {
    name: "sim.clearance",
    result: violations.length === 0 ? "pass" : "fail",
    mode,
    details: {
      world_ref: world.world_ref,
      min_clearance_m,
      sweep: normalizeSweep(sweep),
      considered,
      violations
    }
  };
}

export function clearanceGraduationEvidence({
  checks,
  physical_schemas = ["rigid", "deformable"],
  min_passes = 3
}) {
  if (!Array.isArray(checks)) {
    throw new WorldTwinError("GRADUATION_EVIDENCE_REQUIRED", "sim.clearance graduation requires check evidence.");
  }
  const rows = {};
  for (const physical_schema of physical_schemas) {
    rows[physical_schema] = {
      physical_schema,
      min_passes,
      passes: 0,
      failures: 0,
      evidence_refs: [],
      graduated: false,
      mode: "advisory"
    };
  }

  for (const [index, check] of checks.entries()) {
    if (check?.name !== "sim.clearance") {
      continue;
    }
    const considered = check.details?.considered ?? [];
    const violations = new Set((check.details?.violations ?? []).map((entry) => `${entry.physical_schema}:${entry.entity_id}`));
    for (const entry of considered) {
      const row = rows[entry.physical_schema];
      if (!row) {
        continue;
      }
      const evidenceRef = check.details?.evidence_ref ?? `check:${index + 1}`;
      row.evidence_refs.push(evidenceRef);
      if (violations.has(`${entry.physical_schema}:${entry.entity_id}`)) {
        row.failures += 1;
      } else {
        row.passes += 1;
      }
    }
  }

  for (const row of Object.values(rows)) {
    row.evidence_refs = [...new Set(row.evidence_refs)].sort();
    row.graduated = row.passes >= row.min_passes && row.failures === 0;
    row.mode = row.graduated ? "enforcing" : "advisory";
  }

  return deepFreeze({
    name: "sim.clearance.graduation",
    rows: Object.values(rows).sort((left, right) => left.physical_schema.localeCompare(right.physical_schema)),
    mode_by_physical_schema: Object.fromEntries(Object.values(rows).map((row) => [row.physical_schema, row.mode]))
  });
}

function bodiesForScene(sceneSnapshot, mapper) {
  return (sceneSnapshot.entities ?? [])
    .map((entity) => mapper(entity))
    .filter(Boolean);
}

function bodyForEntity(entity) {
  const aabb = aabbFromGeometry(entity.geometry);
  if (!aabb) {
    return null;
  }
  return {
    entity_id: entity.id,
    type: entity.type,
    physical_schema: entity.physical_schema ?? "rigid",
    physics_proxy: entity.physics_proxy ?? "box",
    shape: "aabb",
    aabb
  };
}

function preciseBodyForEntity(entity) {
  if (entity.geometry?.type === "pose_3d") {
    const position = entity.geometry.position_m ?? [0, 0, 0];
    const radius = Number(entity.geometry.radius_m ?? (entity.physics_proxy === "capsule" ? 0.25 : 0.1));
    const circle = normalizeCircle({
      x: Number(position[0]),
      y: Number(position[1]),
      radius
    });
    return {
      entity_id: entity.id,
      type: entity.type,
      physical_schema: entity.physical_schema ?? "rigid",
      physics_proxy: entity.physics_proxy ?? "capsule",
      shape: "circle",
      circle,
      aabb: normalizeAabb({
        min_x: circle.x - circle.radius,
        min_y: circle.y - circle.radius,
        max_x: circle.x + circle.radius,
        max_y: circle.y + circle.radius
      })
    };
  }
  return bodyForEntity(entity);
}

function aabbFromGeometry(geometry) {
  if (!geometry || typeof geometry !== "object") {
    return null;
  }
  if (geometry.type === "bbox_3d") {
    if (Array.isArray(geometry.min_m) && Array.isArray(geometry.max_m)) {
      return normalizeAabb({
        min_x: Number(geometry.min_m[0]),
        min_y: Number(geometry.min_m[1]),
        max_x: Number(geometry.max_m[0]),
        max_y: Number(geometry.max_m[1])
      });
    }
    const center = geometry.center_m ?? geometry.position_m ?? [0, 0, 0];
    const size = geometry.size_m ?? geometry.dimensions_m ?? [0.2, 0.2, 0.2];
    return normalizeAabb({
      min_x: Number(center[0]) - Number(size[0]) / 2,
      min_y: Number(center[1]) - Number(size[1]) / 2,
      max_x: Number(center[0]) + Number(size[0]) / 2,
      max_y: Number(center[1]) + Number(size[1]) / 2
    });
  }
  if (geometry.type === "pose_3d") {
    const position = geometry.position_m ?? [0, 0, 0];
    const radius = Number(geometry.radius_m ?? 0.1);
    return normalizeAabb({
      min_x: Number(position[0]) - radius,
      min_y: Number(position[1]) - radius,
      max_x: Number(position[0]) + radius,
      max_y: Number(position[1]) + radius
    });
  }
  return null;
}

function aabbFromSweep(sweep) {
  if (!sweep || typeof sweep !== "object") {
    throw new WorldTwinError("SWEEP_REQUIRED", "sim.clearance requires a sweep.");
  }
  const radius = Number(sweep.radius_m ?? 0.2);
  if (Array.isArray(sweep.start_m) && Array.isArray(sweep.end_m)) {
    return normalizeAabb({
      min_x: Math.min(Number(sweep.start_m[0]), Number(sweep.end_m[0])) - radius,
      min_y: Math.min(Number(sweep.start_m[1]), Number(sweep.end_m[1])) - radius,
      max_x: Math.max(Number(sweep.start_m[0]), Number(sweep.end_m[0])) + radius,
      max_y: Math.max(Number(sweep.start_m[1]), Number(sweep.end_m[1])) + radius
    });
  }
  if (Array.isArray(sweep.center_m) && Array.isArray(sweep.size_m)) {
    return normalizeAabb({
      min_x: Number(sweep.center_m[0]) - Number(sweep.size_m[0]) / 2,
      min_y: Number(sweep.center_m[1]) - Number(sweep.size_m[1]) / 2,
      max_x: Number(sweep.center_m[0]) + Number(sweep.size_m[0]) / 2,
      max_y: Number(sweep.center_m[1]) + Number(sweep.size_m[1]) / 2
    });
  }
  throw new WorldTwinError("SWEEP_UNSUPPORTED", "Sweep must define start_m/end_m or center_m/size_m.");
}

function geometryFromSweep(sweep) {
  const aabb = aabbFromSweep(sweep);
  if (Array.isArray(sweep?.start_m) && Array.isArray(sweep?.end_m)) {
    return {
      shape: "segment",
      start: [Number(sweep.start_m[0]), Number(sweep.start_m[1])],
      end: [Number(sweep.end_m[0]), Number(sweep.end_m[1])],
      radius: Number(sweep.radius_m ?? 0.2),
      aabb
    };
  }
  return {
    shape: "aabb",
    aabb
  };
}

function normalizeSweep(sweep) {
  return structuredClone(sweep);
}

function normalizeAabb(box) {
  for (const [key, value] of Object.entries(box)) {
    if (!Number.isFinite(value)) {
      throw new WorldTwinError("GEOMETRY_INVALID", `AABB field ${key} must be finite.`, { field: key });
    }
  }
  return {
    min_x: round(Math.min(box.min_x, box.max_x)),
    min_y: round(Math.min(box.min_y, box.max_y)),
    max_x: round(Math.max(box.min_x, box.max_x)),
    max_y: round(Math.max(box.min_y, box.max_y))
  };
}

function normalizeCircle(circle) {
  for (const [key, value] of Object.entries(circle)) {
    if (!Number.isFinite(value)) {
      throw new WorldTwinError("GEOMETRY_INVALID", `Circle field ${key} must be finite.`, { field: key });
    }
  }
  if (circle.radius < 0) {
    throw new WorldTwinError("GEOMETRY_INVALID", "Circle radius must be non-negative.", { field: "radius" });
  }
  return {
    x: round(circle.x),
    y: round(circle.y),
    radius: round(circle.radius)
  };
}

function distanceToBody(sweepGeometry, body) {
  if (body.shape === "circle" && sweepGeometry.shape === "segment") {
    return distancePointToSegment2d(body.circle, sweepGeometry.start, sweepGeometry.end) - body.circle.radius - sweepGeometry.radius;
  }
  if (body.shape === "circle") {
    return distanceCircleAabb2d(body.circle, sweepGeometry.aabb);
  }
  return distanceAabb2d(sweepGeometry.aabb, body.aabb);
}

function distanceCircleAabb2d(circle, box) {
  const dx = Math.max(box.min_x - circle.x, circle.x - box.max_x, 0);
  const dy = Math.max(box.min_y - circle.y, circle.y - box.max_y, 0);
  if (dx === 0 && dy === 0) {
    const overlapX = Math.min(circle.x - box.min_x, box.max_x - circle.x);
    const overlapY = Math.min(circle.y - box.min_y, box.max_y - circle.y);
    return -Math.min(overlapX, overlapY, circle.radius);
  }
  return Math.hypot(dx, dy) - circle.radius;
}

function distancePointToSegment2d(point, start, end) {
  const vx = end[0] - start[0];
  const vy = end[1] - start[1];
  const wx = point.x - start[0];
  const wy = point.y - start[1];
  const length2 = vx * vx + vy * vy;
  const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, (wx * vx + wy * vy) / length2));
  const closestX = start[0] + t * vx;
  const closestY = start[1] + t * vy;
  return Math.hypot(point.x - closestX, point.y - closestY);
}

function distanceAabb2d(left, right) {
  const dx = Math.max(right.min_x - left.max_x, left.min_x - right.max_x, 0);
  const dy = Math.max(right.min_y - left.max_y, left.min_y - right.max_y, 0);
  if (dx === 0 && dy === 0) {
    const overlapX = Math.min(left.max_x, right.max_x) - Math.max(left.min_x, right.min_x);
    const overlapY = Math.min(left.max_y, right.max_y) - Math.max(left.min_y, right.min_y);
    return -Math.min(overlapX, overlapY);
  }
  return Math.hypot(dx, dy);
}

function checkMode({ considered, violations }) {
  const relevant = violations.length > 0 ? violations : considered;
  return relevant.some((entry) => entry.mode === "enforcing") ? "enforcing" : "advisory";
}

function round(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function deepFreeze(value) {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}
