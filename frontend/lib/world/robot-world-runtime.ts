import { WorldRuntime, type WorldEvent } from "@nemeia/world-runtime";
import type { RobotRuntimeSnapshot } from "../robots/standard/robot-runtime";

export const WORLD_ROBOT_ID = "robot_01";
export const LOCAL_WORLD_ID = "world_local";

export type WorldActionId =
  | "robot.connect"
  | "robot.control"
  | "robot.stop"
  | "world.listen"
  | "world.map"
  | "world.observe";

export type WorldComponentPayload = {
  detail: string;
  label: string;
  state: "active" | "available" | "offline" | "unknown";
};

export type RobotWorldPort = Pick<
  RobotRuntimeSnapshot,
  | "audioStream"
  | "batteryPercent"
  | "cameraEnabled"
  | "connectionState"
  | "driverMode"
  | "lidarEnabled"
  | "lidarFrame"
  | "lidarFrameCount"
  | "robotPose"
  | "runtimePending"
  | "speakerEnabled"
  | "videoStream"
> & {
  connect: () => Promise<void>;
  setCameraEnabled: (enabled: boolean) => Promise<void>;
  setLidarEnabled: (enabled: boolean) => Promise<void>;
  setSpeakerEnabled: (enabled: boolean) => Promise<void>;
  stopMotion: () => void;
};

export type ManualInteractionRequest = {
  actionId: WorldActionId;
  actorId: string;
  input: Record<string, unknown>;
  targetId: string | null;
};

export type ManualInteractionReceipt = {
  completedAt: string | null;
  error: string | null;
  events: WorldEvent[];
  request: ManualInteractionRequest;
  result: Record<string, unknown> | null;
  startedAt: string;
  status: "completed" | "executing" | "failed";
};

export function createRobotWorldRuntime(robot: RobotWorldPort, mapFaceCount = 0): WorldRuntime {
  const runtime = new WorldRuntime();
  const connected = robot.connectionState === "connected";
  const sensingWorld = robot.lidarFrameCount > 0;
  const observingWorld = Boolean(robot.videoStream) || sensingWorld;
  const resolution = robot.lidarFrame?.resolution;
  const origin = robot.lidarFrame?.origin;

  runtime.upsertEntity({
    id: WORLD_ROBOT_ID,
    label: "Robot",
    type: "core.robot",
    components: {
      connection: component("Connection", connected ? "active" : "offline", robot.connectionState),
      locomotion: component("Locomotion", connected ? "available" : "offline", robot.driverMode ?? (connected ? "ready" : "unavailable")),
      vision: component("Vision", robot.videoStream ? "active" : connected ? "available" : "offline", robot.videoStream ? "streaming" : robot.cameraEnabled ? "enabled" : "off"),
      spatial_sensor: component("Spatial sensor", sensingWorld ? "active" : connected ? "available" : "offline", sensingWorld ? `${robot.lidarFrameCount.toLocaleString()} frames` : robot.lidarEnabled ? "waiting" : "off"),
      audio: component("Audio", robot.audioStream ? "active" : connected ? "available" : "offline", robot.audioStream ? "streaming" : robot.speakerEnabled ? "enabled" : "off"),
      power: component("Power", robot.batteryPercent === null ? "unknown" : "active", robot.batteryPercent === null ? "waiting for telemetry" : `${robot.batteryPercent}%`),
      transform: component("Transform", robot.robotPose ? "active" : connected ? "unknown" : "offline", robot.robotPose ? `${robot.robotPose.x.toFixed(2)}, ${robot.robotPose.y.toFixed(2)}, ${robot.robotPose.yaw.toFixed(2)} rad` : "pose unavailable")
    }
  });

  runtime.upsertEntity({
    id: LOCAL_WORLD_ID,
    label: "Local environment",
    type: "core.environment",
    components: {
      occupancy: component("Occupancy", sensingWorld ? "active" : connected ? "available" : "offline", mapFaceCount > 0 ? `${mapFaceCount.toLocaleString()} mapped faces` : sensingWorld ? "decoding geometry" : "waiting for spatial data"),
      geometry: component("Geometry", sensingWorld ? "active" : "unknown", resolution ? `${resolution.toFixed(2)} m voxels` : "resolution unknown"),
      reference_frame: component("Reference frame", origin ? "active" : "unknown", origin ? `${origin.map((value) => value.toFixed(2)).join(", ")}` : "origin unavailable"),
      semantics: component("Semantic layer", "unknown", "classification not connected"),
      observable: component("Observable", observingWorld ? "active" : connected ? "available" : "offline", observingWorld ? "live observations" : "waiting")
    }
  });

  if (connected) {
    runtime.relate({ subject_id: WORLD_ROBOT_ID, predicate: "located_in", object_id: LOCAL_WORLD_ID, components: {} });
  }
  if (observingWorld) {
    runtime.relate({ subject_id: WORLD_ROBOT_ID, predicate: "observes", object_id: LOCAL_WORLD_ID, components: {} });
  }
  if (sensingWorld) {
    runtime.relate({ subject_id: LOCAL_WORLD_ID, predicate: "mapped_by", object_id: WORLD_ROBOT_ID, components: {} });
  }

  registerRobotActions(runtime, robot);
  return runtime;
}

export async function executeManualInteraction(runtime: WorldRuntime, request: ManualInteractionRequest): Promise<ManualInteractionReceipt> {
  const startedAt = new Date().toISOString();
  const lastEventSeq = runtime.snapshot().last_event_seq;

  try {
    const result = await runtime.execute({
      action_id: request.actionId,
      actor_id: request.actorId,
      input: request.input,
      ...(request.targetId ? { target_id: request.targetId } : {})
    });
    return {
      completedAt: new Date().toISOString(),
      error: null,
      events: runtime.events({ after: lastEventSeq }),
      request,
      result,
      startedAt,
      status: "completed"
    };
  } catch (error) {
    return {
      completedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
      events: runtime.events({ after: lastEventSeq }),
      request,
      result: null,
      startedAt,
      status: "failed"
    };
  }
}

function registerRobotActions(runtime: WorldRuntime, robot: RobotWorldPort): void {
  runtime.registerAction({
    id: "robot.connect",
    label: "Connect",
    description: "Attach the robot to the live world.",
    actor_components: ["connection"],
    available: ({ actor }) => connectionState(actor.components.connection) === "connected" ? "Already connected" : robot.connectionState === "connecting" ? "Connection is in progress" : true,
    perform: async () => {
      await robot.connect();
      return actionAccepted("robot.connection_requested", "connection");
    }
  });

  runtime.registerAction({
    id: "world.observe",
    label: "Observe",
    description: "Enable vision and open the live observation surface.",
    actor_components: ["connection", "vision"],
    target_components: ["observable"],
    available: ({ actor }) => connectedReason(actor, robot.runtimePending.camera ? "Vision command is pending" : null),
    perform: async () => {
      if (!robot.cameraEnabled) {
        await robot.setCameraEnabled(true);
      }
      return actionAccepted("world.observation_enabled", "vision", { surface: "vision" });
    }
  });

  runtime.registerAction({
    id: "world.map",
    label: "Map",
    description: "Enable spatial sensing and update world geometry.",
    actor_components: ["connection", "spatial_sensor"],
    target_components: ["geometry"],
    available: ({ actor }) => connectedReason(actor, robot.runtimePending.lidar ? "Spatial command is pending" : null),
    perform: async () => {
      if (!robot.lidarEnabled) {
        await robot.setLidarEnabled(true);
      }
      return actionAccepted("world.mapping_enabled", "spatial_sensor");
    }
  });

  runtime.registerAction({
    id: "world.listen",
    label: "Listen",
    description: "Enable live audio observations.",
    actor_components: ["audio", "connection"],
    target_components: ["observable"],
    available: ({ actor }) => connectedReason(actor, robot.runtimePending.speaker ? "Audio command is pending" : null),
    perform: async () => {
      if (!robot.speakerEnabled) {
        await robot.setSpeakerEnabled(true);
      }
      return actionAccepted("world.audio_enabled", "audio", { surface: "audio" });
    }
  });

  runtime.registerAction({
    id: "robot.control",
    label: "Move",
    description: "Open direct locomotion controls without starting movement.",
    actor_components: ["connection", "locomotion"],
    target_components: ["geometry"],
    available: ({ actor }) => connectedReason(actor),
    perform: () => actionAccepted("robot.control_opened", "locomotion", { surface: "locomotion" })
  });

  runtime.registerAction({
    id: "robot.stop",
    label: "Stop",
    description: "Send a zero-motion stop through the robot component.",
    actor_components: ["connection", "locomotion"],
    available: ({ actor }) => connectedReason(actor),
    perform: () => {
      robot.stopMotion();
      return actionAccepted("robot.motion_stopped", "locomotion");
    }
  });
}

function actionAccepted(eventType: string, componentId: string, result: Record<string, unknown> = {}) {
  return {
    events: [{ type: eventType, data: { component_id: componentId } }],
    result: { accepted: true, ...result }
  };
}

function component(label: string, state: WorldComponentPayload["state"], detail: string): WorldComponentPayload {
  return { detail, label, state };
}

function connectedReason(actor: { components: Record<string, unknown> }, pendingReason: string | null = null): true | string {
  if (connectionState(actor.components.connection) !== "connected") {
    return "Connection is offline";
  }
  return pendingReason ?? true;
}

function connectionState(value: unknown): string {
  return typeof value === "object" && value !== null && "detail" in value ? String(value.detail) : "unknown";
}
