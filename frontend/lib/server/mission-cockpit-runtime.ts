import { pathToFileURL } from "node:url";

const ROBOT_ID = "robot_01";
const OPERATOR_HEADERS = { authorization: "Bearer operator-token" };
const AGENT_HEADERS = { authorization: "Bearer agent-token" };

type MissionApiHandle = {
  handle: (request: { body?: Record<string, unknown>; headers?: Record<string, string>; method: string; path: string }) => Promise<{
    body: Record<string, unknown>;
    status: number;
  }>;
};

type CockpitRuntime = {
  api: MissionApiHandle;
  completedRunId: string;
  missionId: string;
  runIds: string[];
};

type SceneProjectorHandle = {
  appendObservation: (input: Record<string, unknown>) => unknown;
};
type SimDriverHandle = {
  connect: () => void;
  manifest: () => Record<string, unknown>;
};
type MissionServerHandle = {
  publicKey: unknown;
};
type ReferenceModules = {
  EventLog: new (options: Record<string, unknown>) => Record<string, unknown>;
  MissionApi: new (options: Record<string, unknown>) => MissionApiHandle;
  MissionServer: new (options: Record<string, unknown>) => MissionServerHandle;
  SceneProjector: new (options: Record<string, unknown>) => SceneProjectorHandle;
  SimDriver: new (options: Record<string, unknown>) => SimDriverHandle;
  SupervisorKernel: new (options: Record<string, unknown>) => unknown;
};

let runtimeState: CockpitRuntime | null = null;

export function resetCockpitRuntime() {
  runtimeState = null;
}

export async function cockpitProjection() {
  const cockpit = await cockpitRuntime();
  const runs = await Promise.all(cockpit.runIds.map((runId) => missionApi(cockpit.api, "GET", `/runs/${runId}`, AGENT_HEADERS)));
  const [health, robots, robotStatus, replay, scene, anomalies, attention, events] = await Promise.all([
    missionApi(cockpit.api, "GET", "/health", AGENT_HEADERS),
    missionApi(cockpit.api, "GET", "/robots", AGENT_HEADERS),
    missionApi(cockpit.api, "GET", `/robots/${ROBOT_ID}/status`, AGENT_HEADERS),
    missionApi(cockpit.api, "GET", `/runs/${cockpit.completedRunId}/replay`, AGENT_HEADERS),
    missionApi(cockpit.api, "GET", "/scene", AGENT_HEADERS),
    missionApi(cockpit.api, "GET", `/anomalies?mission_id=${cockpit.missionId}`, AGENT_HEADERS),
    missionApi(cockpit.api, "GET", `/missions/${cockpit.missionId}/attention`, AGENT_HEADERS),
    missionApi(cockpit.api, "GET", `/events?mission_id=${cockpit.missionId}&limit=100`, AGENT_HEADERS)
  ]);

  return {
    schema_version: 1,
    source: "mission-api",
    mission: {
      id: cockpit.missionId,
      label: "Mission Gate 1"
    },
    health,
    robots,
    robot_status: robotStatus,
    runs,
    replay,
    scene,
    anomalies,
    attention,
    events
  };
}

export async function decideCockpitRun({ decision, reason, runId }: { decision: "approve" | "reject"; reason?: string; runId: string }) {
  const cockpit = await cockpitRuntime();
  const body = await missionApi(cockpit.api, "POST", `/runs/${runId}/${decision}`, {
    ...OPERATOR_HEADERS,
    "idempotency-key": `cockpit-${decision}-${runId}`
  }, {
    reason: reason ?? `Cockpit ${decision}.`
  });
  if (decision === "approve") {
    cockpit.completedRunId = runId;
  }
  return body;
}

export async function stopCockpitRobot({ reason = "Cockpit stop." }: { reason?: string } = {}) {
  const cockpit = await cockpitRuntime();
  return missionApi(cockpit.api, "POST", `/robots/${ROBOT_ID}/stop`, {
    ...AGENT_HEADERS,
    "idempotency-key": `cockpit-stop-${Date.now()}`
  }, {
    reason
  });
}

export async function clearCockpitRobotStop() {
  const cockpit = await cockpitRuntime();
  return missionApi(cockpit.api, "POST", `/robots/${ROBOT_ID}/clear-stop`, {
    ...OPERATOR_HEADERS,
    "idempotency-key": `cockpit-clear-stop-${Date.now()}`
  });
}

async function cockpitRuntime(): Promise<CockpitRuntime> {
  if (runtimeState) {
    return runtimeState;
  }

  const { EventLog, MissionApi, MissionServer, SceneProjector, SimDriver, SupervisorKernel } = await loadReferenceModules();
  const clock = fixedClock;
  const eventLog = new EventLog({ clock });
  const scene = new SceneProjector({ eventLog, clock });
  const driver = new SimDriver({ robotId: ROBOT_ID, clock });
  driver.connect();
  const missionServer = new MissionServer({ eventLog, scene, driverManifest: driver.manifest(), clock });
  const supervisor = new SupervisorKernel({
    robotId: ROBOT_ID,
    driver,
    trustedPublicKey: missionServer.publicKey,
    clock
  });
  const api = new MissionApi({
    eventLog,
    missionServer,
    scene,
    supervisors: new Map([[ROBOT_ID, supervisor]]),
    drivers: new Map([[ROBOT_ID, driver]]),
    clock
  });

  const mission = await missionApi(api, "POST", "/missions", {
    ...OPERATOR_HEADERS,
    "idempotency-key": "cockpit-mission"
  }, {
    preset: "gate1-reference",
    robot_ids: [ROBOT_ID]
  });

  seedScene(scene, String(mission.id));
  const pendingRun = await seedPendingRun(api, String(mission.id));
  const completedRun = await seedCompletedRun(api, String(mission.id));
  await seedAnomaly(api, String(mission.id), String(pendingRun.id));

  runtimeState = {
    api,
    completedRunId: String(completedRun.id),
    missionId: String(mission.id),
    runIds: [String(pendingRun.id), String(completedRun.id)]
  };
  return runtimeState;
}

function seedScene(scene: SceneProjectorHandle, missionId: string) {
  scene.appendObservation({
    source: "perception:front-camera@0.1.0",
    robot_id: ROBOT_ID,
    mission_id: missionId,
    refs: ["artifact:frame_123"],
    payload: {
      labels: ["backpack"],
      track_id: "red_backpack",
      confidence: 0.86,
      artifact_refs: ["artifact:frame_123"],
      geometry: { frame_id: "map", center: [1.82, -0.42, 0.2], size: [0.42, 0.24, 0.36] }
    }
  });
  scene.appendObservation({
    source: "perception:lidar@0.1.0",
    robot_id: ROBOT_ID,
    mission_id: missionId,
    refs: ["artifact:sweep_left_arc"],
    severity: 1,
    payload: {
      labels: ["obstacle"],
      track_id: "floor_cable",
      confidence: 0.74,
      artifact_refs: ["artifact:sweep_left_arc"],
      geometry: { frame_id: "map", center: [0.62, 0.05, 0.02], size: [1.1, 0.04, 0.03] }
    }
  });
}

async function seedPendingRun(api: MissionApiHandle, missionId: string) {
  return missionApi(api, "POST", "/runs", {
    ...AGENT_HEADERS,
    "idempotency-key": "cockpit-pending-run"
  }, {
    mission_id: missionId,
    robot_id: ROBOT_ID,
    verb: "follow",
    target: { entity_id: "ent_red_backpack" },
    reason: "Approach the bound backpack after checking the floor cable hazard.",
    args: { max_speed_mps: 0.15, max_yaw_rps: 0.2, watchdog_ms: 100, max_duration_ms: 120_000 }
  });
}

async function seedCompletedRun(api: MissionApiHandle, missionId: string) {
  const proposal = await missionApi(api, "POST", "/runs", {
    ...AGENT_HEADERS,
    "idempotency-key": "cockpit-completed-run"
  }, {
    mission_id: missionId,
    robot_id: ROBOT_ID,
    verb: "bounded_move",
    reason: "Refresh the scene with a bounded zero-motion control-plane drill.",
    args: { vx_mps: 0, vy_mps: 0, yaw_rps: 0, duration_ms: 200 }
  });
  await missionApi(api, "POST", `/runs/${proposal.id}/approve`, {
    ...OPERATOR_HEADERS,
    "idempotency-key": "cockpit-completed-approve"
  }, {
    reason: "Cockpit reference seed approval."
  });
  return proposal;
}

async function seedAnomaly(api: MissionApiHandle, missionId: string, runId: string) {
  await missionApi(api, "POST", "/anomalies", {
    ...OPERATOR_HEADERS,
    "idempotency-key": "cockpit-anomaly"
  }, {
    mission_id: missionId,
    run_id: runId,
    severity: "safety",
    owner: "operator",
    expected: "No protected clearance violations in the planned sweep.",
    observed: "Cable intersects direct approach corridor.",
    evidence_refs: ["artifact:frame_123", "artifact:sweep_left_arc"],
    suspected_cause: "Scene hazard requires route adjustment before approval."
  });
}

async function missionApi(api: MissionApiHandle, method: string, path: string, headers: Record<string, string>, body: Record<string, unknown> = {}) {
  const response = await api.handle({ method, path, headers, body });
  if (response.status >= 400) {
    throw new Error(`${method} ${path} failed: ${JSON.stringify(response.body)}`);
  }
  return response.body;
}

function fixedClock() {
  return new Date("2026-07-07T17:00:00.000Z");
}

async function loadReferenceModules(): Promise<ReferenceModules> {
  const importModule = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<Record<string, unknown>>;
  const root = process.cwd().replace(/\/frontend$/, "");
  const [eventLog, missionApiModule, missionServer, scene, simDriver, supervisor] = await Promise.all([
    importModule(pathToFileURL(`${root}/mission-server/src/event-log.ts`).href),
    importModule(pathToFileURL(`${root}/mission-api/src/mission-api.ts`).href),
    importModule(pathToFileURL(`${root}/mission-server/src/mission-server.ts`).href),
    importModule(pathToFileURL(`${root}/scene/src/scene-projector.ts`).href),
    importModule(pathToFileURL(`${root}/supervisor/src/sim-driver.ts`).href),
    importModule(pathToFileURL(`${root}/supervisor/src/supervisor-kernel.ts`).href)
  ]);

  return {
    EventLog: eventLog.EventLog,
    MissionApi: missionApiModule.MissionApi,
    MissionServer: missionServer.MissionServer,
    SceneProjector: scene.SceneProjector,
    SimDriver: simDriver.SimDriver,
    SupervisorKernel: supervisor.SupervisorKernel
  } as ReferenceModules;
}
