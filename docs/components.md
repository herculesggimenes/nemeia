# Nemeia Components

| Component | Description |
|---|---|
| `Interfaces` | Human and external entry points into Nemeia, centered on a web console served by the app server, plus API and voice. They submit tasks, show robot state, display events, expose emergency stop, and let the operator inspect/debug the system. |
| `Runtime / Executive` | Codex-inspired orchestration core implemented on the AI SDK. Owns threads, turns, submissions, events, rollout history, plugin lifecycle, durable session state, and the single model-facing `bash` tool. It coordinates model-facing work but should not directly own long-lived robot/sensor connections. |
| `App Server / Control Plane` | Long-running process that owns robot adapters, sensor streams, perception workers, scene refreshes, semantic scene graph cache, robot control locks, normalized component queues, and runtime APIs. The agent runtime uses the `bash` tool to call thin helper CLIs that talk to this process over a long-lived WebSocket connection instead of opening fresh robot connections inside a turn. |
| `Component Queues` | Normalized event queues for robot, sensor, perception, audio, policy, mapping, and scene-graph components. Threads subscribe through trigger rules that publish selected component events as prompts/thread items into the main thread or subthreads. |
| `Sensing` | Raw data ingestion from robots and devices: cameras, LiDAR, depth cameras, IMU, odometry, joint states, microphones, battery state, force/torque, tactile sensors, and simulator feeds. This layer captures signals before interpretation. |
| `Perception` | Converts raw sensor data into structured observations: object detections, segmentation masks, tracks, depth readings, point clouds, OCR text, speech transcripts, obstacle observations, and scene measurements. SAM 3-style concept segmentation belongs here. |
| `Visual Reasoning` | VLM-based inspection and explanation. Used when the system needs semantic visual judgment beyond detection, such as "is this a backpack or suitcase?", "is the door open?", "read this label," or "what looks unsafe here?" |
| `State Estimation / Localization` | Maintains poses, coordinate frames, transforms, tracked object positions, odometry, localization, sensor fusion, timestamps, uncertainty, and object association. This is where raw observations become spatially grounded. |
| `Semantic Scene Graph` | Current explicit belief about the robot's environment represented as objects, robots, places, maps, hazards, affordances, free-space summaries, planning-scene refs, object memory, relations, and confidence/freshness metadata. This replaces the overloaded term "world model." |
| `Planning` | Decides what should happen before execution. Includes task planning, route/path planning, motion planning, entity-action planning, and converting goals like "go to the backpack" into feasible candidate plans. |
| `Behavior Executive` | Runs multi-step behaviors and task logic. Owns behavior trees, task graphs, recovery flows, policy selection, turn orchestration, retries, progress checks, and sequencing like "scan, detect, turn, re-check, approach." |
| `Control` | Converts plans or goals into robot commands. Includes deterministic controllers, PID/MPC, Nav2 controllers, trajectory followers, learned policies, VLA executors, visual servoing, and closed-loop behavior execution. |
| `Robot Interface / Actuation` | Hardware and simulator adapters. Converts Nemeia commands into robot-specific APIs such as Go2 DDS/WebRTC/ROS2, YAM WebSocket, generic ROS2 actions/services/topics, motor drivers, and simulator commands. |
| `Safety / Monitoring` | Cross-cutting guard layer. Validates actions, enforces limits, watches telemetry, handles emergency stop, collision checks, freshness checks, watchdogs, timeouts, ownership of control lanes, and safe shutdown/recovery. |
| `Memory / Learning` | Stores and retrieves long-term information: object memories, place memories, embeddings, mission history, demonstrations, datasets, operator corrections, policy-training data, and replay logs. |
| `Predictive World Models` | Optional learned/simulated future-state predictors. Given current scene/action, they estimate what may happen next. Useful for planning, policy evaluation, synthetic data, and counterfactual reasoning, but separate from the current Semantic Scene Graph. |

## Short Dependency Flow

```text
Interfaces
  -> Runtime / Executive
  -> App Server / Control Plane
  -> Sensing
  -> Perception
  -> State Estimation / Localization
  -> Semantic Scene Graph
  -> Planning
  -> Behavior Executive
  -> Control
  -> Robot Interface / Actuation
```

Cross-cutting:

```text
Safety / Monitoring watches everything.
Memory / Learning records and improves everything.
Visual Reasoning helps Perception and the Semantic Scene Graph.
Predictive World Models help Planning and Control.
```
