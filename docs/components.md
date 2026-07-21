# Nemeia Components

> **Archived governance design.** This document describes the earlier NEM Suite
> component split. It is preserved as implementation history, not as the active
> Nemeia mental model. Start with [`world-runtime.md`](./world-runtime.md).

| Component | Description |
|---|---|
| `Interfaces` | Human and external entry points into Nemeia, centered on the web cockpit and `nemeiactl`. They submit Mission API requests, show robot state, display runs/events/replay, expose emergency stop, and let the operator inspect/debug the system. |
| `Runtime / Executive` | Codex-inspired orchestration core implemented on the AI SDK. It is a Mission API client: the agent proposes runs, reads attention, and uses `bash`/`nemeiactl`; it carries no robot authority and does not own long-lived robot connections. |
| `Mission Server` | Trusted policy authority. Owns missions, runs, presets, registry state, approval, issuance, replay, attention, and policy-plane timestamps. It persists signed Authorizations before dispatch. |
| `Event Log` | Append-only source of truth. Every stateful surface is pinned by log records or reproducible as a projection over the log. |
| `Supervisor Kernel` | Trusted control-plane kernel. Verifies Authorizations, owns stop state, clamps every tick, watches heartbeats/watchdogs, and commands the Driver's declared safe state locally. |
| `Driver` | Hardware boundary. Declares action spaces, caps, observables, streams, native actions, safe-state facts, and normalized status; translates kernel setpoints to the robot. |
| `Capability Host` | Sandbox for untrusted executors. Capabilities bind to Authorizations, consume declared streams, emit ActionChunks and observations, and must stop within one watchdog interval. |
| `Sensing` | Raw data ingestion from robots and devices: cameras, LiDAR, depth cameras, IMU, odometry, joint states, microphones, battery state, force/torque, tactile sensors, and simulator feeds. This layer captures signals before interpretation. |
| `Perception` | Converts raw sensor data into structured observations: object detections, segmentation masks, tracks, depth readings, point clouds, OCR text, speech transcripts, obstacle observations, and scene measurements. SAM 3-style concept segmentation belongs here. |
| `Visual Reasoning` | VLM-based inspection and explanation. Used when the system needs semantic visual judgment beyond detection, such as "is this a backpack or suitcase?", "is the door open?", "read this label," or "what looks unsafe here?" |
| `State Estimation / Localization` | Maintains poses, coordinate frames, transforms, tracked object positions, odometry, localization, sensor fusion, timestamps, uncertainty, and object association. This is where raw observations become spatially grounded. |
| `Scene` | NEM-8 belief projection over observation events. It exposes compact model-facing snapshots with entities, affordances, freshness, provenance, robots, and hazards. |
| `World Twin` | Deterministic derivation from a pinned Scene tuple. It predicts clearance and other physics-derived checks; it is not the source of truth. |
| `Planning` | Decides what should be proposed before execution. It can generate candidate runs, but physical authority still requires Mission Server issuance and Supervisor Kernel enforcement. |
| `Behavior Executive` | Runs multi-step behaviors and task logic as capabilities or Mission API clients. It does not bypass Authorization or kernel clamps. |
| `Control` | Exists inside capabilities and the Supervisor Kernel boundary. Capabilities emit advice chunks; the kernel clamps and forwards applied setpoints. |
| `Robot Interface / Actuation` | Implemented through Driver SPI packages such as Go2, simulator, ROS2, or other robot drivers. |
| `Safety / Monitoring` | Split between policy checks in the Mission Server and hard real-time invariants in the Supervisor Kernel. Stop and safe state never depend on the LLM turn loop. |
| `Attention` | Per-mission, per-principal inbox and digest surface. This is the agent's perceptual channel, with seams, wake predicates, persisted digest bytes, and rendering lint. |
| `Memory / Learning` | Stores and retrieves long-term information: object memories, place memories, embeddings, mission history, demonstrations, datasets, operator corrections, policy-training data, and replay logs. |
| `Predictive World Models` | Optional learned/simulated future-state predictors. In NEM terms, these feed the World Twin or advisory checks; they do not grant authority. |

## Short Dependency Flow

```text
Interfaces
  -> Runtime / Executive
  -> Mission Server
  -> signed Authorization
  -> Supervisor Kernel
  -> Driver
  -> Hardware
```

Cross-cutting:

```text
Event Log records everything.
Scene, Attention, Replay, and Reports are projections over the Event Log.
Perception writes observations, not commands.
Capabilities advise; the Supervisor Kernel enforces.
```
