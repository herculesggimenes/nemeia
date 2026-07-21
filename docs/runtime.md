# Nemeia Runtime Concepts

> **Archived governance design.** This document preserves the earlier
> Mission/Authorization runtime. The active core is documented in
> [`world-runtime.md`](./world-runtime.md).

Nemeia should keep the useful parts of Codex's runtime model: a durable thread,
turn-based execution, submission/event queues, persisted rollout history, and
typed operations. Under the NEM Suite, the runtime is a client of the Mission
API. It proposes runs, reads Scene and Attention projections, and renders tool
results; it does not carry robot authority.

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
  -> runtime drains Attention and reads Mission API projections
  -> runtime invokes bash / nemeiactl
  -> Mission Server creates Runs and issues signed Authorizations when allowed
  -> Supervisor Kernel executes only verified Authorizations
  -> Event Log stores observations, proposals, checks, actions, and results
```

## Concepts

| Concept | Codex Meaning | Nemeia Meaning |
|---|---|---|
| `Thread` | Long-lived conversation/session with durable history. | Long-lived mission/session across one or more robots. Owns mission state, scene state references, robot roster, user preferences, memory links, and rollout history. |
| `ThreadId` | Stable identifier for a session/thread. | Runtime conversation id. It may bind to a NEM `mission_id`, but `mission_id` is the operational identifier for logs, runs, replay, and policy. |
| `SessionMeta` | Metadata persisted at the start of a Codex rollout: id, cwd, source, model provider, instructions, dynamic tools. | Runtime metadata: thread id, model provider, Mission API endpoint, principal, active mission id, and pinned preset references. |
| `ThreadManager` | Creates, resumes, forks, tracks, archives, and restores thread state. | Creates, resumes, forks, and tracks runtime threads. Mission lifecycle lives in the Mission Server. |
| `Submission` | Queue entry from client to agent, with unique id and operation payload. | Queue entry from operator/API/system to runtime. Every submission has an id used to correlate emitted events. |
| `Op` | Typed operation: user input, interrupt, settings change, approvals, realtime audio/text, tool responses. | Typed robotics operation: user task, speech task, interrupt, emergency stop, settings change, approval, sensor refresh, tool result, policy feedback, plugin lifecycle request. |
| `Event` | Queue entry from agent to client, correlated to a submission id. | Runtime output correlated to a submission id. Drives the web console, logs, telemetry, replay, and user-facing responses. |
| `EventMsg` | Typed event payload: turn started, turn complete, user message, agent message, tool call begin/end, error, warning. | Runtime-facing event payload. Physical-consequence events are NEM Event Log records with `run_id`. |
| `Turn` | One model execution cycle in response to user input. | One model execution cycle that may propose or inspect NEM Runs. It is not the physical execution boundary. |
| `ActiveTurn` | In-memory state for the currently executing turn. | Current model loop: active mission id, drained Attention digest, selected robots, pending tool calls, and cancellation state. |
| `TurnContext` | Turn-scoped context persisted into rollout. | Snapshot of runtime context: mission id, scene snapshot id, attention seam, allowed verbs as projected by Mission API, and relevant operator constraints. |
| `RolloutItem` | Durable item in session history: session meta, response item, compacted history, turn context, event message. | Durable runtime item. Operational evidence lives in the Event Log and Replay projection. |
| `ResponseItem` | Model-facing or conversation-facing message/tool item. | Model-facing item: user task, assistant response, tool call, tool result, VLM result, perception report, policy status. |
| `CompactedItem` | Summarized replacement for long conversation history. | Summarized replacement for long mission history. Should preserve safety-relevant facts, active goals, recent object memory, robot state, and unresolved hazards. |
| `SessionState` | In-memory state for a session. | In-memory runtime state: Mission API endpoint, principal, active mission id, latest drained digest, rollout writer, active turn, and event sinks. Long-lived robot/sensor connections live behind the Supervisor/Driver boundary. |
| `Tool` | Model-invoked operation. | Same term as Codex. The first model-facing tool should be a single AI SDK `bash` tool. Robotics operations are reached through `nemeiactl`, which renders the Mission API. |

## Tool Model

Initial tool surface:

```text
bash
```

The agent runtime should run on the AI SDK and expose one model-facing tool:

```text
bash(command: string)
```

`bash` is the only tool the model uses directly. It can run shell commands,
inspect context, and call `nemeiactl`. The CLI has no semantics of its own; its
`--json` output is byte-equivalent to the Mission API response body.

Robot, scene, entity, mission, run, event, replay, anomaly, and health
operations should be exposed through the Mission API and rendered by
`nemeiactl`. The CLI must not own robot logic and must not open fresh
robot/sensor connections inside the turn.

Perception should normally arrive as pre-baked state, not as raw model work the agent has to run every turn.

```text
nemeiactl robot status go2
nemeiactl scene get
nemeiactl entity ent_backpack
nemeiactl robot stop go2
nemeiactl run create --robot go2 --verb follow --target ent_person_01
nemeiactl run approve run_123
nemeiactl replay run_123
```

Run creation is a request to the Mission Server:

```text
AI SDK bash tool
  -> nemeiactl
  -> Mission API
  -> Run state machine
  -> approval if required
  -> signed Authorization if checks pass
  -> Supervisor Kernel execute
  -> Event Log / Replay
```

The Mission Server can expose HTTP and WebSocket surfaces for the web UI,
debugging, and integrations. The primary agent-control path is the Mission API,
not direct robot transport.

Perception plugins continuously or on-demand produce prepared observations:

```text
image/depth/lidar/audio
  -> perception plugins
  -> scene.observation events
  -> Event Log
  -> Scene projection
  -> Attention digest / compact turn context
```

The LLM should usually see and query:

```text
latest Scene projection
object list
hazards
free-space summary
object tracks
confidence/freshness metadata
```

not raw camera frames, masks, point clouds, or detector invocations. Direct visual inspection can still exist later as a bounded fallback, but the default path is pre-baked perception state.

The runtime does not own physical safety. A command that affects hardware must
pass through Mission Server validation, signed Authorization issuance,
Supervisor Kernel verification, Driver safe-state handling, and Event Log
recording.

## Mission Boundary

The Mission Server owns the policy plane:

```text
missions
runs
approvals
presets
registry state
Authorization issuance
Event Log writes
Scene, Attention, Replay, and Report projections
```

The Supervisor Kernel and Driver own the control plane:

```text
Authorization verification
stop state
tick loop
clamping
watchdog/deadman
driver status heartbeat
safe state
```

The agent runtime can request fresh state, but perception, scene reduction,
authorization, execution, and replay happen outside the model turn.

## Attention Instead Of Component Prompts

The NEM Suite replaces broad component-queue prompting with Attention. Attention
is a per-mission, per-principal inbox materialized from the preset at mission
bind. It drains at defined seams and persists the exact digest bytes the agent
saw.

Examples:

```text
pre-turn drain at every turn start
wake drain when the predicate fires for an idle mission
optional agent-step drain at tool boundaries
```

Every operational event should use the NEM Event Log envelope:

```text
seq
schema_version
source
event_type
severity
timestamp
robot_id optional
mission_id optional
run_id required for run causal chains
refs
payload
```

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

Runtime operations should be typed and serializable. Operations that affect NEM
state call the Mission API; they do not mutate operational records directly.

| Operation | Description |
|---|---|
| `user_input` | Text task from web console or API. Usually starts a turn. |
| `speech_input` | Final transcript from STT. Usually starts a turn unless classified as emergency. |
| `attention_digest` | Persisted NEM-9 digest drained before a turn or delivered by wake. |
| `mission_api_event` | Event Log tail or projection update consumed by the runtime. |
| `emergency_stop` | Immediate `POST /robots/{id}/stop`. Bypasses normal turn queues. |
| `interrupt` | Abort current turn without necessarily shutting down long-running runtime components. |
| `robot_status_request` | Read `GET /robots/{id}/status`. |
| `scene_request` | Read `GET /scene` or entity details. |
| `run_proposal` | Submit `POST /runs`; proposal carries zero safety-relevant assertions. |
| `run_approval` | Operator response to `POST /runs/{id}/approve` or `/reject`. |
| `tool_result` | Result returned by an async tool backend. |
| `settings_update` | Runtime settings update: model, principal, Mission API endpoint, or active mission binding. |
| `package_lifecycle` | Operator-only registry package flow through Mission API registry operations. |

## Event Log And Attention

The Event Log is the operational source of truth. Runtime events can still exist
for local UI state, but robot-affecting facts must become NEM Event Log records.

```text
perception / driver / kernel / mission-server
  -> Event Log
  -> Scene, Attention, Replay, Reports
  -> runtime turn context
```

Attention decides which events reach the agent:

```text
Event Log
  -> per-(mission, principal) inbox cursor
  -> pre-turn or wake seam
  -> persisted digest bytes
  -> model context
```

Perception components emit `scene.observation` events, not commands.
Capabilities emit ActionChunks to the Supervisor Kernel and observations/events
through the Capability Host, not direct log writes.

## Event Messages

Events should be typed, correlated, and persisted when relevant.

| Event | Description |
|---|---|
| `turn_started` | A turn began for a submission. |
| `turn_completed` | The turn completed normally. |
| `turn_aborted` | The turn was interrupted, cancelled, or superseded. |
| `operator_message` | User/operator input recorded into history. |
| `agent_message` | Text response from the agent. |
| `attention_drained` | Runtime consumed a persisted NEM-9 digest. |
| `mission_api_call_started` | `nemeiactl` or runtime client started a Mission API request. |
| `mission_api_call_completed` | Mission API request completed. |
| `model_request_started` | A model call started. |
| `model_response_completed` | A model call completed with proposal/answer. |
| `run_proposed` | Model or operator proposed a Run through Mission API. |
| `run_awaiting_approval` | Mission Server routed a Run to operator approval. |
| `run_terminal` | Run completed, rejected, aborted, stopped, or expired. |
| `tool_call_started` | Tool execution began. |
| `tool_call_completed` | Tool execution completed. |
| `tool_call_failed` | Tool execution failed. |
| `replay_linked` | Runtime linked to a NEM Replay for a Run. |
| `audio_transcript_partial` | Partial STT transcript. |
| `audio_transcript_final` | Final STT transcript. |
| `audio_output_started` | TTS/playback started. |
| `audio_output_completed` | TTS/playback completed. |
| `stop_requested` | Runtime requested `POST /robots/{id}/stop`. |
| `stop_observed` | Event Log or status projection shows stop state. |
| `warning` | Non-fatal runtime warning. |
| `error` | Fatal or submission-level error. |

## Turn Lifecycle

Turns can be started by a user/operator submission, speech input, API request,
or Attention wake.

The default robotics turn:

```text
1. Accept submission
2. Emit turn_started
3. Record operator/user message
4. Drain Attention for the active mission/principal
5. Read current robot status, verbs, and Scene projection as needed
6. Build compact model context
8. Call LLM/planner
9. Parse structured proposal or answer
10. Submit Run proposal through Mission API if action is requested
11. Surface awaiting-approval or terminal Run state
12. Observe Run/Replay/Attention updates
13. Continue, ask follow-up, or complete
14. Emit turn_completed or turn_aborted
```

High-rate status, camera, and perception events should not start turns directly.
They enter the Event Log or projections; Attention decides when the agent sees
mission-relevant changes.

Examples:

```text
camera frame
  -> perception emits scene.observation
  -> Scene projection updates
  -> no turn

SAM/concept segmenter finds active-goal target
  -> scene.observation
  -> Attention wake predicate may start/steer turn

LiDAR detects close obstacle during motion
  -> scene.observation / kernel or capability abort path
  -> Attention reports after state change

STT final transcript says "come here"
  -> speech_input starts turn

STT detects "stop"
  -> POST /robots/{id}/stop bypasses normal turn flow
```

The turn should never be the place safety exists. Stop, watchdog, heartbeat,
expiry, clamping, and safe state remain active outside the turn loop.

## Rollout History

Runtime rollout history is the durable record of the model conversation. The
operational record of a mission is the Event Log plus Replay projection. It
should support:

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
attention_digest_ref
operator_message
agent_message
model_request
model_response
tool_call
tool_result
mission_api_call
run_ref
replay_ref
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
Scene projection
Attention digest
known hazards
available verbs from Mission API
active Runs
relevant memory
```

The LLM should receive compact Scene facts and `bash`/`nemeiactl` instructions,
not raw point clouds by default. Safety-critical robot commands must route
through Mission API Runs, signed Authorizations, and the Supervisor Kernel.

## Implementation Guidance

Keep these boundaries:

- `Runtime / Executive` owns threads, turns, model context, and runtime rollout.
- `Mission Server` owns missions, runs, policy, approval, registry, issuance,
  Event Log writes, and projections.
- `Scene` owns current environment belief as a reproducible projection.
- `Planning` proposes feasible runs.
- `Supervisor Kernel` verifies, clamps, stops, and enforces safe state.
- `Driver` touches hardware.
- Models propose; Nemeia authorizes and enforces.

This keeps the Codex strengths while adapting them to physical robots.
