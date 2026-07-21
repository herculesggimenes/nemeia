import assert from "node:assert/strict";
import test from "node:test";
import {
  createRobotWorldRuntime,
  executeManualInteraction,
  type RobotWorldPort
} from "../../lib/world/robot-world-runtime.ts";

function robotPort(overrides: Partial<RobotWorldPort> = {}): RobotWorldPort {
  return {
    audioStream: null,
    batteryPercent: null,
    cameraEnabled: false,
    connect: async () => undefined,
    connectionState: "idle",
    driverMode: null,
    lidarEnabled: false,
    lidarFrame: null,
    lidarFrameCount: 0,
    robotPose: null,
    runtimePending: { audioInput: false, camera: false, lidar: false, obstacleAvoidance: false, speaker: false },
    setCameraEnabled: async () => undefined,
    setLidarEnabled: async () => undefined,
    setSpeakerEnabled: async () => undefined,
    speakerEnabled: false,
    stopMotion: () => undefined,
    videoStream: null,
    ...overrides
  };
}

test("the world derives manual interactions from standard robot components", () => {
  const runtime = createRobotWorldRuntime(robotPort());
  const affordances = runtime.affordancesFor("robot_01");

  assert.equal(affordances.find((item) => item.action_id === "robot.connect")?.available, true);
  assert.equal(affordances.find((item) => item.action_id === "world.map")?.available, false);
  assert.equal(affordances.find((item) => item.action_id === "world.map")?.target_id, "world_local");
});

test("a manual map request executes through WorldRuntime and the standard port", async () => {
  let lidarCommands = 0;
  const runtime = createRobotWorldRuntime(robotPort({
    connectionState: "connected",
    setLidarEnabled: async (enabled) => {
      if (enabled) {
        lidarCommands += 1;
      }
    }
  }));

  const receipt = await executeManualInteraction(runtime, {
    actionId: "world.map",
    actorId: "robot_01",
    input: {},
    targetId: "world_local"
  });

  assert.equal(lidarCommands, 1);
  assert.equal(receipt.status, "completed");
  assert.deepEqual(receipt.result, { accepted: true });
  assert.deepEqual(receipt.events.map((event) => event.type), ["action.started", "world.mapping_enabled", "action.completed"]);
});

test("opening locomotion controls is an interaction but does not issue motion", async () => {
  let stopCommands = 0;
  const runtime = createRobotWorldRuntime(robotPort({
    connectionState: "connected",
    stopMotion: () => {
      stopCommands += 1;
    }
  }));

  const receipt = await executeManualInteraction(runtime, {
    actionId: "robot.control",
    actorId: "robot_01",
    input: {},
    targetId: "world_local"
  });

  assert.equal(stopCommands, 0);
  assert.deepEqual(receipt.result, { accepted: true, surface: "locomotion" });
});
