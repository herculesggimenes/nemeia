# Nemeia Runtime Concepts

Nemeia should keep the useful parts of Codex's runtime model: a durable thread, turn-based execution, submission/event queues, persisted rollout history, and typed operations. The robotics-specific change is that turns operate on robots, sensors, scene state, safety gates, and tools that can affect physical systems.

Codex references:

- `/Users/hgimenes/src/codex/codex-rs/protocol/src/protocol.rs`
- `/Users/hgimenes/src/codex/codex-rs/core/src/codex_thread.rs`
- `/Users/hgimenes/src/codex/codex-rs/core/src/thread_manager.rs`
- `/Users/hgimenes/src/codex/codex-rs/core/src/session/session.rs`
- `/Users/hgimenes/src/codex/codex-rs/core/src/state/session.rs`
- `/Users/hgimenes/src/codex/codex-rs/core/src/state/turn.rs`

## Core Pattern

Codex uses a submission queue / event queue pattern:

```text
Client submits operation
  -> runtime processes it asynchronously
  -> runtime emits correlated events
  -> durable rollout stores what happened
```

Nemeia should use the same shape:

```text
Interface submits robotics operation
  -> runtime starts or updates a turn
  -> runtime reads prepared state from the app server/control plane
  -> runtime invokes tools that call the app server/control plane
  -> runtime emits correlated events
  -> rollout stores observations, proposals, validations, actions, results
```

## Concepts

| Concept | Codex Meaning | Nemeia Meaning |
|---|---|---|
| `Thread` | Long-lived conversation/session with durable history. | Long-lived mission/session across one or more robots. Owns mission state, scene state references, robot roster, user preferences, memory links, and rollout history. |
| `ThreadId` | Stable identifier for a session/thread. | Stable mission/session id used across the web console, API, event stream, logs, and replay. |
| `SessionMeta` | Metadata persisted at the start of a Codex rollout: id, cwd, source, model provider, instructions, dynamic tools. | Metadata for a Nemeia mission: id, created time, operator, robot fleet, active model provider, app-server endpoint, enabled plugins, safety profile, environment/map references. |
| `ThreadManager` | Creates, resumes, forks, tracks, archives, and restores thread state. | Creates, resumes, forks, stops, and supervises missions. Also owns robot-runtime registration and ensures interrupted/resumed missions have consistent rollout state. |
| `Submission` | Queue entry from client to agent, with unique id and operation payload. | Queue entry from operator/API/system to runtime. Every submission has an id used to correlate emitted events. |
| `Op` | Typed operation: user input, interrupt, settings change, approvals, realtime audio/text, tool responses. | Typed robotics operation: user task, speech task, interrupt, emergency stop, settings change, approval, sensor refresh, tool result, policy feedback, plugin lifecycle request. |
| `Event` | Queue entry from agent to client, correlated to a submission id. | Runtime output correlated to a submission id. Drives the web console, logs, telemetry, replay, and user-facing responses. |
| `EventMsg` | Typed event payload: turn started, turn complete, user message, agent message, tool call begin/end, error, warning. | Typed robotics event payload: turn started, observation updated, scene state updated, tool proposed, safety blocked, action started, action completed, robot status, emergency stop, turn complete. |
| `Turn` | One model execution cycle in response to user input. | One observe-plan-act cycle. A turn can contain multiple perception refreshes, model calls, safety checks, tool calls, and progress checks. |
| `ActiveTurn` | In-memory state for the currently executing turn. | Current executing robotics loop: goal, selected robots, observations used, pending approvals, active tool calls, active policy runs, cancellation state. |
| `TurnContext` | Turn-scoped context persisted into rollout. | Snapshot of turn-scoped runtime context: selected robots, scene state summary, enabled tools, safety profile, model/provider, relevant maps, operator constraints. |
| `RolloutItem` | Durable item in session history: session meta, response item, compacted history, turn context, event message. | Durable mission item: session meta, user/operator message, observation, model proposal, safety decision, tool call/result, semantic-scene-graph update, compacted summary, event message. |
| `ResponseItem` | Model-facing or conversation-facing message/tool item. | Model-facing item: user task, assistant response, tool call, tool result, VLM result, perception report, policy status. |
| `CompactedItem` | Summarized replacement for long conversation history. | Summarized replacement for long mission history. Should preserve safety-relevant facts, active goals, recent object memory, robot state, and unresolved hazards. |
| `SessionState` | In-memory state for a session. | In-memory state for a mission: config, app-server endpoint, selected robots, latest semantic scene graph snapshot, rollout writer, active turn, event sinks, and runtime handles. Long-lived robot/sensor connections live in the app server/control plane. |
| `Tool` | Model-invoked operation. | Same term as Codex. The first model-facing tool should be a single AI SDK `bash` tool. Robotics commands are reached through app-server APIs from bash helper CLIs over a long-lived WebSocket connection, with Nemeia still validating safety-critical operations. |

## Tool Model

Initial tool surface:

```text
bash
```

The agent runtime should run on the AI SDK and expose one model-facing tool:

```text
bash(command: string)
```

`bash` is the only tool the model uses directly. It can run shell commands, inspect context, and call small Nemeia helper CLIs. Those helper CLIs talk to the app server/control plane over a long-lived WebSocket connection. The runtime can implement session handling internally, but the model-facing contract stays simple.

Robot, scene-graph, audio, and policy operations should be exposed as app-server APIs through custom bash-friendly CLIs. These CLIs should be thin WebSocket clients. They should not own robot logic and should not open fresh robot/sensor connections inside the turn.

Perception should normally arrive as pre-baked state, not as raw model work the agent has to run every turn.

```text
nemeiactl robot status go2
nemeiactl scene get
nemeiactl scene refresh
nemeiactl scene objects --label backpack
nemeiactl robot stop go2
nemeiactl robot move go2 --x 0.2 --yaw 0
nemeiactl audio speak "I found the backpack."
nemeiactl policy run go2_approach_object --target obj17
```

`/api/scene/refresh` is a request to the app server/control plane:

```text
AI SDK bash tool
  -> nemeiactl
  -> long-lived WebSocket connection
  -> app server/control plane
  -> existing robot/sensor/perception workers
  -> updated Semantic Scene Graph snapshot
  -> compact result returned to the tool
```

The app server can still expose HTTP endpoints for the web UI, debugging, and integrations. The primary agent-control path is the long-lived WebSocket helper CLI path.

Perception plugins continuously or on-demand produce prepared observations:

```text
image/depth/lidar/audio
  -> perception plugins
  -> observation bundle
  -> Semantic Scene Graph
  -> app server/control-plane cache
  -> compact turn context
```

The LLM should usually see and query:

```text
latest Semantic Scene Graph
object list
hazards
free-space summary
object tracks
confidence/freshness metadata
```

not raw camera frames, masks, point clouds, or detector invocations. Direct visual inspection can still exist later as a bounded fallback, but the default path is pre-baked perception state.

The runtime still owns physical safety. A command that affects hardware must pass through Nemeia's validation, robot control locks, stop handling, and event logging.

## App Server Boundary

The app server/control plane is the long-running robotics process. It owns:

```text
robot connections
sensor streams
perception workers
scene refresh jobs
Semantic Scene Graph cache
robot control locks
low-level safety checks
operator/websocket event fanout
```

The agent runtime owns:

```text
thread
turn
submission loop
model context
tool calls
goal tracking
rollout history
agent-facing events
```

The agent runtime can request fresh state, but the refresh work happens outside the turn in the app server/control plane.

## Component Queues And Thread Triggers

The app server/control plane exposes normalized component queues. A component queue is the standard event format for anything that produces state, telemetry, observations, or control feedback.

Examples:

```text
camera component queue
lidar component queue
scene graph component queue
robot status component queue
robot control component queue
audio transcript component queue
policy component queue
mapping component queue
```

Every component event should use a normalized envelope:

```text
id
component_id
component_type
event_type
timestamp
source_robot_id
thread_id optional
payload
confidence optional
freshness optional
refs optional
```

Component queues are not the same as threads. They are runtime streams owned by the app server/control plane. Threads subscribe to them through thread triggers.

```text
component queue
  -> thread trigger filter
  -> main thread or subthread
  -> prompt/thread item
  -> optional turn start/steer
```

A thread trigger is a routing rule that decides which component events become prompts or thread items.

Examples:

```text
active-goal object found
  component: scene_graph
  event: object_detected
  filter: label matches current goal target
  target: main thread
  publish: prompt/thread item

robot battery low
  component: robot_status
  event: battery_low
  target: main thread
  publish: prompt/thread item

camera object update
  component: camera
  event: object_track_updated
  target: perception subthread
  publish: thread item only

policy progress update
  component: policy
  event: target_lost
  target: active control subthread
  publish: prompt/thread item
```

This keeps component data normalized while letting each thread decide what it cares about.

## Goal Tracking

Codex uses goals as persisted thread state for long-running objectives. Nemeia should use the same idea for long-running robot missions, but goal tracking does not need to be exposed as separate model-facing tools when the runtime uses a single `bash` tool.

| Operation | Purpose | Nemeia Semantics |
|---|---|---|
| `create_goal` | Create a current objective for the thread. | Start tracking a mission-level objective such as "find the red backpack", "map the living room", or "dock Go2". Should only create a goal when the operator explicitly asks for a durable objective. |
| `get_goal` | Read the current goal and usage/progress metadata. | Return objective, status, elapsed time, active turn count, selected robots, active constraints, last progress event, blockers, and budget if any. |
| `update_goal` | Mark the existing goal complete or blocked. | Mark the mission objective complete only when the robot/runtime has achieved it and no required work remains. Mark blocked only when the same blocker recurs and the runtime cannot make meaningful progress without operator input or external change. |

Goal status should be separate from turn status:

```text
Turn:
  one observe-plan-act cycle

Goal:
  durable objective spanning many turns
```

Goal status should be separate from robot state:

```text
Robot can be healthy while goal is blocked.
Robot can be stopped while goal is still active.
Goal can be complete even after multiple interrupted turns.
```

Recommended goal fields:

```text
id
thread_id
objective
status
created_at
updated_at
selected_robot_ids
constraints
success_criteria
last_progress_at
last_progress_summary
blocker
turn_count
elapsed_time_ms
budget
```

Recommended statuses:

```text
active
complete
blocked
```

Avoid adding pause/resume as model-controlled statuses in v0. Like Codex, pause/resume should be controlled by the user or system, not casually inferred by the model.

## Submission Operations

Nemeia operations should be typed and serializable. Initial operations:

| Operation | Description |
|---|---|
| `user_input` | Text task from web console or API. Usually starts a turn. |
| `speech_input` | Final transcript from STT. Usually starts a turn unless classified as emergency. |
| `component_event` | Normalized event from an app-server component queue. Usually updates runtime state or rollout history. |
| `thread_trigger` | Component event promoted into a main-thread or subthread prompt/thread item. Can start or steer a turn when it matches an active goal, safety rule, operator subscription, or trigger policy. |
| `emergency_stop` | Immediate stop request. Bypasses normal turn queues and control locks. |
| `interrupt` | Abort current turn without necessarily shutting down long-running runtime components. |
| `robot_status_request` | Ask runtime to refresh or report robot state. |
| `scene_refresh_request` | Ask sensing/perception/state-estimation to refresh scene state. |
| `tool_approval` | Operator response to a requested physical action approval. |
| `tool_result` | Result returned by an async tool backend. |
| `policy_feedback` | Status/progress/result from a running policy executor. |
| `settings_update` | Persistent mission settings update: model, safety profile, plugins, robot selection. |
| `plugin_lifecycle` | Start, stop, reload, configure, or health-check plugin. |

## Component Events

```text
component queue
  -> component_event
  -> SessionState + Semantic Scene Graph update
  -> optional thread_trigger
  -> optional turn starts or active turn is steered
```

The boundary:

```text
Components can emit normalized events.
Components can update Semantic Scene Graph through the app server/control plane.
Thread triggers can publish component events as prompts/thread items.
Thread triggers can start or steer a main thread or subthread.
Perception components should not directly execute robot actions.
```

Examples:

```text
object detected
  -> component_event
  -> scene_state_updated

active-goal target found
  -> component_event
  -> thread_trigger
  -> turn starts/continues

object lost during a goal
  -> component_event
  -> thread_trigger
  -> active turn receives updated context

close obstacle detected
  -> component_event
  -> scene_state_updated
  -> emergency_stop submission if safety policy requires it
```

## Event Messages

Events should be typed, correlated, and persisted when relevant.

| Event | Description |
|---|---|
| `turn_started` | A turn began for a submission. |
| `turn_completed` | The turn completed normally. |
| `turn_aborted` | The turn was interrupted, cancelled, or superseded. |
| `operator_message` | User/operator input recorded into history. |
| `agent_message` | Text response from the agent. |
| `component_event` | Normalized event from an app-server component queue. |
| `thread_triggered` | Thread trigger matched a component event and published it as a prompt/thread item. |
| `observation_started` | Sensing or perception refresh started. |
| `observation_completed` | Observation bundle produced. |
| `scene_state_updated` | Scene state changed: objects, maps, hazards, affordances, robot state. |
| `model_request_started` | A model call started. |
| `model_response_completed` | A model call completed with proposal/answer. |
| `tool_call_proposed` | Planner/model proposed a tool call. |
| `tool_approval_requested` | Runtime requires operator approval before execution. |
| `tool_call_started` | Tool execution began. |
| `tool_call_completed` | Tool execution completed. |
| `tool_call_failed` | Tool execution failed. |
| `safety_validated` | Safety validator approved a proposal. |
| `safety_blocked` | Safety validator blocked a proposal with reason. |
| `policy_started` | Policy/VLA/control executor started. |
| `policy_progress` | Policy emitted progress, clipped command, target lost, etc. |
| `policy_completed` | Policy completed or was stopped. |
| `robot_status` | Robot telemetry update. |
| `audio_transcript_partial` | Partial STT transcript. |
| `audio_transcript_final` | Final STT transcript. |
| `audio_output_started` | TTS/playback started. |
| `audio_output_completed` | TTS/playback completed. |
| `emergency_stop_started` | Emergency stop execution started. |
| `emergency_stop_completed` | Emergency stop completed or confirmed. |
| `warning` | Non-fatal runtime warning. |
| `error` | Fatal or submission-level error. |

## Turn Lifecycle

Turns can be started by a user/operator submission, speech input, API request, or thread trigger.

The default robotics turn:

```text
1. Accept submission
2. Emit turn_started
3. Record operator/user message
4. Gather current robot state
5. Refresh observations if needed
6. Update Semantic Scene Graph
7. Build compact model context
8. Call LLM/planner
9. Parse structured proposal
10. Validate proposal against safety and freshness constraints
11. Request approval if required
12. Execute tool or policy through the tool runtime and robot adapter
13. Observe result and update Semantic Scene Graph
14. Continue, ask follow-up, or complete
15. Emit turn_completed or turn_aborted
```

Component queues should not start turns for every frame or status tick. They should first update `SessionState` and the Semantic Scene Graph; only thread triggers should promote selected component events into prompts/submissions that start or steer turns.

Examples:

```text
camera frame
  -> perception updates Semantic Scene Graph
  -> no turn

SAM/concept segmenter finds active-goal target
  -> component_event
  -> thread_trigger starts/steers turn

LiDAR detects close obstacle during motion
  -> component_event
  -> thread_trigger or emergency_stop starts safety handling

STT final transcript says "come here"
  -> speech_input starts turn

STT detects "stop"
  -> emergency_stop bypasses normal turn flow
```

The turn should never be the only place safety exists. Safety monitors and emergency stop must remain active outside the turn loop.

## Rollout History

Rollout history is the durable record of a mission. It should support:

- replaying what the runtime believed and did;
- explaining why a motion was allowed or blocked;
- resuming a mission after interruption;
- compacting old history while preserving safety facts;
- forking a mission for simulation or alternative planning;
- training/evaluating policies from demonstrations and corrections.

Recommended `RolloutItem` variants:

```text
session_meta
turn_context
operator_message
agent_message
observation
scene_state_update
model_request
model_response
tool_call
tool_result
safety_decision
policy_run
audio_item
event
compacted
```

## Scene Context For Models

Codex builds context from conversation history, tool specs, environment, and recent events. Nemeia should build model context from:

```text
mission goal
operator constraints
selected robots
compact scene state
recent observations
known hazards
available tools
safety profile
active policies/actions
relevant memory
```

The LLM should receive compact semantic scene graph facts and `bash` tool instructions, not raw point clouds by default. Safety-critical robot commands must route through app-server APIs/helper commands that validate, log, and can be interrupted.

## Implementation Guidance

Keep these boundaries:

- `Runtime / Executive` owns threads, turns, the submission loop, event streams, rollout, and plugin lifecycle.
- `Semantic Scene Graph` owns current environment belief.
- `Planning` proposes feasible steps.
- `Safety / Monitoring` approves, blocks, clips, or interrupts.
- `Control` and `Robot Interface / Actuation` touch hardware.
- Models propose; the runtime executes.

This keeps the Codex strengths while adapting them to physical robots.
