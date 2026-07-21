import type { RobotRuntimeSnapshot } from "../robots/standard/robot-runtime";

export type WorldComponentView = {
  detail: string;
  id: string;
  label: string;
  state: "active" | "available" | "offline" | "unknown";
};

export type WorldActionView = {
  actorId: string;
  available: boolean;
  description: string;
  id: "connect" | "control" | "listen" | "map" | "observe" | "stop";
  label: string;
  reason: string | null;
  targetId: string | null;
};

export type WorldEntityView = {
  components: WorldComponentView[];
  id: string;
  label: string;
  type: string;
};

export type WorldRelationshipView = {
  objectId: string;
  predicate: string;
  subjectId: string;
};

export type RobotWorldView = {
  actions: WorldActionView[];
  entities: WorldEntityView[];
  relationships: WorldRelationshipView[];
};

type RobotWorldSource = Pick<
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
  | "speakerEnabled"
  | "videoStream"
>;

export function projectRobotWorld(robot: RobotWorldSource, mapFaceCount = 0): RobotWorldView {
  const connected = robot.connectionState === "connected";
  const sensingWorld = robot.lidarFrameCount > 0;
  const observingWorld = Boolean(robot.videoStream) || sensingWorld;
  const resolution = robot.lidarFrame?.resolution;
  const origin = robot.lidarFrame?.origin;

  const robotEntity: WorldEntityView = {
    id: "robot_01",
    label: "Robot",
    type: "core.robot",
    components: [
      component("connection", "Connection", connected ? "active" : "offline", robot.connectionState),
      component("locomotion", "Locomotion", connected ? "available" : "offline", robot.driverMode ?? (connected ? "ready" : "unavailable")),
      component("vision", "Vision", robot.videoStream ? "active" : connected ? "available" : "offline", robot.videoStream ? "streaming" : robot.cameraEnabled ? "enabled" : "off"),
      component("spatial_sensor", "Spatial sensor", sensingWorld ? "active" : connected ? "available" : "offline", sensingWorld ? `${robot.lidarFrameCount.toLocaleString()} frames` : robot.lidarEnabled ? "waiting" : "off"),
      component("audio", "Audio", robot.audioStream ? "active" : connected ? "available" : "offline", robot.audioStream ? "streaming" : robot.speakerEnabled ? "enabled" : "off"),
      component("power", "Power", robot.batteryPercent === null ? "unknown" : "active", robot.batteryPercent === null ? "waiting for telemetry" : `${robot.batteryPercent}%`),
      component("transform", "Transform", robot.robotPose ? "active" : connected ? "unknown" : "offline", robot.robotPose ? `${robot.robotPose.x.toFixed(2)}, ${robot.robotPose.y.toFixed(2)}, ${robot.robotPose.yaw.toFixed(2)} rad` : "pose unavailable")
    ]
  };

  const environmentEntity: WorldEntityView = {
    id: "world_local",
    label: "Local environment",
    type: "core.environment",
    components: [
      component("occupancy", "Occupancy", sensingWorld ? "active" : connected ? "available" : "offline", mapFaceCount > 0 ? `${mapFaceCount.toLocaleString()} mapped faces` : sensingWorld ? "decoding geometry" : "waiting for spatial data"),
      component("geometry", "Geometry", sensingWorld ? "active" : "unknown", resolution ? `${resolution.toFixed(2)} m voxels` : "resolution unknown"),
      component("reference_frame", "Reference frame", origin ? "active" : "unknown", origin ? `${origin.map((value) => value.toFixed(2)).join(", ")}` : "origin unavailable"),
      component("semantics", "Semantic layer", "unknown", "classification not connected"),
      component("observable", "Observable", observingWorld ? "active" : connected ? "available" : "offline", observingWorld ? "live observations" : "waiting")
    ]
  };

  const relationships: WorldRelationshipView[] = connected
    ? [
        { subjectId: robotEntity.id, predicate: "located_in", objectId: environmentEntity.id },
        ...(observingWorld ? [{ subjectId: robotEntity.id, predicate: "observes", objectId: environmentEntity.id }] : []),
        ...(sensingWorld ? [{ subjectId: environmentEntity.id, predicate: "mapped_by", objectId: robotEntity.id }] : [])
      ]
    : [];

  return {
    entities: [environmentEntity, robotEntity],
    relationships,
    actions: [
      action("connect", "Connect", "Attach the robot to the live world.", !connected, connected ? "Already connected" : null),
      action("observe", "Observe", "Open the live visual observation.", connected, connected ? null : "Vision is offline", environmentEntity.id),
      action("map", "Map", sensingWorld ? "Continue updating spatial geometry." : "Start spatial sensing for this environment.", connected, connected ? null : "Spatial sensing is offline", environmentEntity.id),
      action("listen", "Listen", "Enable live audio observations.", connected, connected ? null : "Audio is offline", environmentEntity.id),
      action("control", "Move", "Open direct locomotion controls.", connected, connected ? null : "Locomotion is offline", environmentEntity.id),
      action("stop", "Stop", "Send a zero-motion stop.", connected, connected ? null : "Connection is offline")
    ]
  };
}

function component(id: string, label: string, state: WorldComponentView["state"], detail: string): WorldComponentView {
  return { detail, id, label, state };
}

function action(
  id: WorldActionView["id"],
  label: string,
  description: string,
  available: boolean,
  reason: string | null,
  targetId: string | null = null
): WorldActionView {
  return { actorId: "robot_01", available, description, id, label, reason, targetId };
}
