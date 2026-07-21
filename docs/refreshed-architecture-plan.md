# Nemeia Refreshed Architecture Plan

Status: superseded by the NEM Suite migration plan. Keep this document as
historical context for the SP-287-derived roadmap. The current contract and
roadmap live in [`nem-suite-specification.md`](./nem-suite-specification.md) and
[`nem-suite-redesign-plan.md`](./nem-suite-redesign-plan.md).

This plan turns the SP-287 validation into an implementation roadmap. It treats Nemeia as a mission system for safe robot-agent operation, not as a UI-first robotics demo.

The first architecture milestone is deliberately narrow:

```text
one safe, replayable, bounded observe-plan-act loop on Go2
```

That loop must prove:

```text
fresh state
clear mission rule
bounded proposal
safety validation
operator approval
physical command
independent stop path
observed result
persisted replay
post-mission anomaly review
```

## Architecture Thesis

Nemeia should separate policy-plane authority from control-plane enforcement:

```text
Policy plane:
  clients -> Mission Server -> Event Log, Registry, Scene, Attention

Control plane:
  Mission Server -> signed Authorization -> Supervisor Kernel
  Supervisor Kernel -> Driver SPI -> hardware
  Capability Host -> ActionChunks -> Supervisor Kernel
```

The model-facing surface stays small:

```text
LLM -> bash -> nemeiactl -> Mission API -> Run / Authorization
```

The model proposes. The Mission Server validates, logs, and issues signed
Authorizations. The Supervisor Kernel executes only verified Authorizations,
clamps every tick, and can interrupt locally.

## Non-Negotiable Architecture Rules

1. No raw robot transport details in model-facing APIs.

```text
Allowed:    nemeiactl robot move go2 --x 0.2 --yaw 0 --duration-ms 500
Disallowed: publish rt/wirelesscontroller ...
Disallowed: publish rt/lowcmd ...
```

2. Safety must not depend on the LLM turn loop.

```text
emergency stop
command timeout
heartbeat watchdog
control ownership lock
freshness gate
manual fallback
```

must remain active even if the model, browser, perception worker, or plugin fails.

3. Scene state is a belief state, not truth.

Every planning-relevant scene fact needs:

```text
timestamp
confidence
freshness
source_component_id
provenance
coordinate frame
artifact refs
```

4. Every physical command must be replayable.

For each robot-affecting command, storage must preserve:

```text
operator intent
mission rule
scene context used
model proposal
safety decision
approval decision
command sent
robot acknowledgement
observed result
warnings/anomalies
```

5. Autonomy increases only after anomalies close.

Do not move to a higher autonomy level while safety-relevant anomalies from the current level remain unresolved.

## Autonomy Levels

Use autonomy levels as a formal safety and product boundary.

| Level | Name | Meaning | Go2 v0 status |
|---:|---|---|---|
| L0 | Read-only observation | Inspect robot state, telemetry, scene, logs. | Required first |
| L1 | Propose only | Agent proposes actions; operator executes manually. | Required first |
| L2 | Non-motion execution | Agent can execute non-motion commands with policy. | Later |
| L3 | Bounded motion with approval | Agent proposes bounded motion; operator approves. | First physical milestone |
| L4 | Bounded motion under mission rules | Agent executes bounded motion if mission rules allow. | Not v0 |
| L5 | Extended supervised autonomy | Multi-step autonomy with operator supervision. | Research goal |

## Command Approval Matrix

Initial command policy:

| Command | Autonomy | Approval | Notes |
|---|---:|---|---|
| `robot status` | L0 | Not required | Read-only. |
| `scene get` | L0 | Not required | Read-only. |
| `scene refresh` | L0/L1 | Not required | May consume compute, but no physical action. |
| `robot stop` | Any | Not required | Safety action, should bypass normal queues. |
| `robot action damp` | Any | Not required | Safety/stabilization action. |
| `robot action balance-stand` | L1/L3 | Required in v0 | Can move actuators; treat as physical. |
| `robot move bounded` | L3 | Required in v0 | Hard duration and velocity bounds. |
| `policy run` | L3+ | Required | Not v0 until primitive commands are proven. |
| low-level control | None | Disallowed | Not exposed in v0. |

## Phase 0: Contract Baseline

Goal: freeze the minimum contracts before adding more robot behavior.

Deliverables:

- `nemeiactl` command contract for read-only status, scene access, stop, action, bounded move.
- Component event envelope with schema version.
- Safety decision schema.
- Mission rule schema.
- Autonomy level and approval matrix definitions.
- Rollout item variants for physical commands.
- Anomaly record schema.

Acceptance criteria:

```text
all command/event/safety schemas are documented
all physical command events include correlation ids
all persisted records include schema_version
all robot-affecting commands have a safety decision record
```

Implementation notes:

- Keep the first schema small and explicit.
- Prefer typed records over generic blobs for commonly queried fields.
- Use `jsonb` only for flexible payloads and adapter-specific details.

## Phase 1: App Server / Control Plane Skeleton

Goal: create the long-running process boundary that owns robot state and command validation.

Deliverables:

- App-server process with health endpoint.
- WebSocket or local IPC path for `nemeiactl`.
- In-memory component queues for v0.
- Robot registry with `go2` as first robot.
- Control ownership lock.
- Emergency-stop state gate.
- Command lease/timeout manager.
- Event fanout to UI/runtime.

Acceptance criteria:

```text
nemeiactl can read control-plane health
nemeiactl can read registered robots
every submitted command receives a command id
every command emits started/completed/failed events
emergency stop bypasses normal turn handling
emergency stop state blocks motion commands
```

## Phase 2: Go2 Read-Only Integration

Goal: prove L0 observation before any agent-initiated motion.

Deliverables:

- Go2 connection settings: robot id, mode, IP.
- Local WebRTC/proxy path based on the Unitree integration notes.
- Camera stream surface.
- Robot status normalization.
- Odometry/pose normalization where available.
- Point-cloud read-only display when stable.
- `nemeiactl robot status go2`.

Acceptance criteria:

```text
operator can connect/disconnect Go2
UI shows connection state and heartbeat freshness
UI shows robot battery/mode/status if available
nemeiactl returns normalized status
status events persist with timestamps
disconnect produces a clear component event
```

SP-287 rationale:

Do not add control before telemetry is trustworthy. Apollo treated current system state as operationally central; Nemeia should do the same.

## Phase 3: Independent Safety Path

Goal: implement abort and stop behavior before bounded motion.

Deliverables:

- UI emergency stop control, always visible.
- `nemeiactl robot stop go2`.
- Control-plane emergency stop state.
- Adapter mapping to Go2 `StopMove` and/or `Damp`.
- Stop confirmation event.
- Heartbeat watchdog.
- Motion-blocking safety gate.

Acceptance criteria:

```text
stop works when no turn is active
stop works while a command is active
stop blocks future motion until cleared by operator
lost heartbeat blocks motion
every stop attempt is logged even if adapter fails
UI displays stop state prominently
```

Failure-injection tests:

```text
adapter does not ack stop
robot disconnects during stop
duplicate stop commands
stop during active bounded move
browser disconnect while stop state is active
```

## Phase 4: Scene State V0

Goal: establish the minimum belief state for safe planning and replay.

Deliverables:

- Scene model snapshot record.
- Semantic scene graph snapshot record.
- Observation record.
- Freshness metadata.
- Provenance links from scene entity to observation/artifact.
- `nemeiactl scene get`.
- `nemeiactl scene refresh`.

V0 scene scope:

```text
robot pose
known obstacles/hazards if available
camera observation summary
object/entity list from perception pipeline if available
free-space/hazard freshness status
```

Acceptance criteria:

```text
scene snapshot has timestamp and frame id
entities link back to observations
stale scene is distinguishable from empty scene
motion commands can require scene freshness
scene get returns compact model-facing facts
raw frames are not required in normal model context
```

## Phase 5: Mission Rules And Turn Context

Goal: make missions explicit before letting the agent propose physical action.

Deliverables:

- Mission rule object.
- Goal object with success criteria.
- Turn context builder.
- Runtime support for autonomy level.
- Approval matrix enforcement.
- Operator-visible active mission rule.

Mission rule fields:

```text
id
thread_id
goal_id
selected_robot_ids
autonomy_level
success_criteria
required_freshness
command_bounds
approval_requirements
abort_triggers
fallback_behavior
logging_requirements
post_mission_review_required
```

Acceptance criteria:

```text
turn context includes active mission rule
safety validator can reject commands outside mission bounds
operator can inspect current autonomy level
physical command cannot execute without a mission rule
```

## Phase 6: Bounded Motion With Approval

Goal: prove L3 autonomy for one primitive command.

Deliverables:

- `nemeiactl robot move go2 --x --y --yaw --duration-ms`.
- Velocity and duration bounds.
- Zero command on timeout.
- Safety validation before execution.
- Operator approval flow.
- Command acknowledgement and result events.
- Replay record for command.

Acceptance criteria:

```text
bounded move requires approval in v0
bounded move cannot exceed configured limits
bounded move is blocked on emergency stop
bounded move is blocked on stale robot status
scene-dependent bounded move is blocked on stale scene state
zero command is sent after duration
command result is observable in telemetry
rollout can replay why the command was allowed
```

Minimum demo:

```text
operator: "move Go2 forward slightly"
runtime: gathers fresh status and scene
agent: proposes bounded move
safety: validates limits and freshness
operator: approves
control plane: sends bounded move
watchdog: sends zero command after timeout
runtime: observes result and records replay
```

## Phase 7: Replay, Mission Evaluation, And Anomaly Closure

Goal: make every real robot session teach the system something.

Deliverables:

- Mission report generator.
- Anomaly list.
- Anomaly ownership and closure status.
- Replay view for physical commands.
- Query support for commands, safety decisions, scene snapshots, telemetry, and anomalies.

Anomaly fields:

```text
id
mission_id
turn_id
robot_id
time
severity
summary
expected_behavior
observed_behavior
evidence_refs
suspected_cause
affected_systems
corrective_action
owner
closure_criteria
status
```

Acceptance criteria:

```text
mission report lists all physical commands
mission report lists all safety blocks
mission report lists all warnings/errors
operator can file anomaly from event history
safety-relevant open anomaly blocks autonomy-level increase
```

## Phase 8: Simulation And Operator Drills

Goal: rehearse normal, degraded, and emergency behavior before expanding autonomy.

Deliverables:

- Replay-based simulated mission runner.
- Fake Go2 adapter for command and telemetry tests.
- Failure-injection harness.
- Operator drill checklist.
- UI affordances for stale state, stop state, approval, and replay.

Required drills:

```text
connect robot
inspect telemetry
refresh scene
issue read-only task
approve bounded motion
hit emergency stop during motion
recover from emergency stop
handle stale scene warning
handle robot disconnect
replay the last physical action
file an anomaly
```

Acceptance criteria:

```text
each drill has a repeatable test or checklist
operator can complete emergency stop drill without reading docs
failure-injection tests pass before real robot sessions
```

## Phase 9: Perception Integration

Goal: connect the vision pipeline to scene state without letting perception directly drive action.

Deliverables:

- Perception component queue.
- Observation bundle format.
- Entity candidate creation/update.
- Confidence/freshness propagation.
- Artifact refs for frames, masks, overlays.
- Active vocabulary/label provenance.
- Scene graph update policy.

Acceptance criteria:

```text
perception emits observations, not commands
observations retain source and confidence
scene entities retain provenance
stale perception cannot authorize motion
operator can inspect why an entity exists
```

## Phase 10: Policy / Behavior Executive

Goal: add multi-step behavior only after primitive control is proven.

Deliverables:

- Behavior run record.
- Policy progress events.
- Target-lost and obstacle events.
- Retry and recovery limits.
- Approval rules for policy execution.
- Stop/interrupt integration.

Acceptance criteria:

```text
policy cannot start without mission rule
policy emits progress events
policy can be stopped independently of the LLM
policy respects command leases and freshness gates
policy result is replayable
```

## Storage Plan

Use Postgres as source of truth for v0:

```text
threads
goals
mission_rules
turns
rollout_items
component_events
tool_calls
safety_decisions
robot_status_samples
scene_model_snapshots
semantic_scene_graph_snapshots
observations
artifact_metadata
physical_commands
anomalies
mission_reports
```

Every table that stores operational records should include:

```text
id
schema_version
created_at
thread_id optional
turn_id optional
robot_id optional
correlation_id optional
payload jsonb optional
```

## Testing Plan

### Qualification Tests

Design-level tests:

```text
schema validation
safety policy validation
mission rule validation
approval matrix validation
scene freshness validation
event correlation validation
replay reconstruction
fake-adapter observe-plan-act loop
failure-injection loop
```

### Acceptance Tests

Session-level tests before real robot operation:

```text
control plane health ok
Go2 reachable
fresh robot status observed
emergency stop works
stop state blocks motion
bounded move requires approval
bounded move obeys duration
zero command sent after bounded move
stale status blocks motion
command replay available
mission report generated
```

## Suggested Issue Breakdown

1. Document and version v0 command/event/safety schemas.
2. Implement control-plane skeleton and `nemeiactl health`.
3. Add robot registry and normalized component events.
4. Implement emergency-stop state gate.
5. Add Go2 read-only status through normalized API.
6. Add UI stop control and stop-state display.
7. Add mission rule schema and runtime binding.
8. Add approval matrix and autonomy levels.
9. Implement bounded move adapter with lease/timeout.
10. Add physical-command rollout records.
11. Add replay query for one physical command.
12. Add anomaly record and mission report.
13. Add fake Go2 adapter and failure-injection tests.
14. Add operator drill checklist and UI affordance checks.
15. Wire perception observations into scene graph snapshots.

## Definition Of Done For The First Milestone

The first milestone is complete when Nemeia can run this scenario repeatedly:

```text
1. Operator starts a mission: "move Go2 forward slightly."
2. Runtime creates a goal and mission rule at L3.
3. Control plane confirms fresh robot status.
4. Scene state is refreshed or explicitly marked not required for this simple command.
5. Agent proposes one bounded move.
6. Safety validates command bounds, robot freshness, stop state, and approval need.
7. Operator approves.
8. Control plane sends command and starts command lease.
9. Stop path remains active throughout.
10. Control plane sends zero command on timeout.
11. Runtime observes status after command.
12. Storage persists proposal, safety decision, approval, command, telemetry, and result.
13. Mission report can replay what happened.
14. Any anomaly has an owner and closure criteria.
```

This is the smallest serious proof that the refreshed architecture works.

## Program-Level Roadmap

The architecture should progress through three program horizons:

```text
Horizon 1: Prove safe primitive operation
  one Go2, one operator, one bounded command, full replay

Horizon 2: Prove closed-loop mission operation
  one Go2, perception-backed scene state, multi-turn goal, bounded approach/search

Horizon 3: Prove supervised autonomy
  behavior executive, policy runs, recovery paths, anomaly-driven improvement
```

Do not blur these horizons. Horizon 1 is a safety and observability program. Horizon 2 is a robotics mission program. Horizon 3 is an autonomy program.

### Horizon 1 Exit Criteria

```text
Go2 read-only telemetry is stable
operator can stop the robot at any time
agent can propose but not directly force motion
bounded motion requires approval
all physical commands are persisted and replayable
stale state blocks motion
mission report and anomaly workflow exist
```

### Horizon 2 Exit Criteria

```text
scene graph is fed by real perception observations
mission rules include scene freshness requirements
agent can run a bounded multi-turn goal with approval gates
object search and target confirmation work in replay and real sessions
operator can inspect why the system believes an object exists
target-lost, obstacle, stale-state, and disconnect paths are rehearsed
```

### Horizon 3 Exit Criteria

```text
behavior executive can run bounded policies under mission rules
policies emit progress and can be interrupted independently
closed-loop control respects leases, freshness, and stop state
autonomy-level increase is blocked by unresolved safety anomalies
simulation/replay tests are required before real robot execution
```

## Workstreams

The plan should be executed as parallel workstreams with explicit integration gates.

| Workstream | Owns | Primary risk |
|---|---|---|
| Runtime / Executive | threads, turns, goals, approvals, rollout | LLM loop becomes confused with safety loop |
| Control Plane | robot state, command routing, queues, leases | physical control path bypasses validation |
| Safety / Monitoring | stop, bounds, freshness, watchdogs, policy gates | safety only works in happy path |
| Robot Adapter | Go2 WebRTC/DDS/API mapping | raw vendor semantics leak upward |
| Scene / Perception | observations, scene graph, provenance | belief state treated as truth |
| Storage / Replay | Postgres records, artifacts, reports | cannot reconstruct why action happened |
| Operator UI | cockpit, approval, stop, replay, anomalies | operator cannot act under stress |
| Simulation / Test | fake adapters, failure injection, drills | real robot discovers basic integration failures |
| Program Control | change control, release gates, anomaly closure | architecture drift invalidates tests |

Each workstream needs its own definition of done, but no workstream is complete until the integrated observe-plan-act loop passes.

## Runtime / Executive Detailed Plan

The runtime is the mission operations layer. It should coordinate model reasoning, approvals, rollout history, and event presentation. It should not own long-lived robot connections or raw sensor streams.

### Runtime Responsibilities

```text
create/resume/archive/fork mission threads
track active goal
load active mission rule
start and abort turns
build compact model context
call model
parse structured proposal
route proposals to safety validator
request approval when policy requires it
submit approved commands to control plane
persist rollout items
emit user-facing events
summarize/compact mission history
```

### Runtime Non-Responsibilities

```text
raw Go2 WebRTC connection
low-level command publication
heartbeat watchdog
emergency stop execution
continuous camera/lidar processing
perception worker lifecycle
direct filesystem artifact storage as source of truth
```

### Turn State Machine

```text
queued
  -> starting
  -> gathering_context
  -> planning
  -> validating
  -> awaiting_approval
  -> executing
  -> observing_result
  -> completing
  -> completed
```

Abort paths:

```text
queued -> aborted
starting -> aborted
gathering_context -> aborted
planning -> aborted
validating -> aborted
awaiting_approval -> aborted
executing -> abort_requested -> observing_result -> aborted
```

Turn abort does not equal emergency stop. A turn abort stops model/runtime activity. Emergency stop affects robot control and must bypass the normal turn state machine.

### Runtime Proposal Shape

The model should produce proposals that are understandable before execution:

```json
{
  "proposal_type": "robot_command",
  "robot_id": "go2",
  "command": {
    "type": "bounded_move",
    "vx_mps": 0.15,
    "vy_mps": 0.0,
    "yaw_rps": 0.0,
    "duration_ms": 400
  },
  "reason": "Move forward slightly to test bounded motion.",
  "expected_result": "Go2 moves forward a short distance and stops.",
  "required_observations": ["robot_status"],
  "scene_dependent": false
}
```

The runtime should reject proposals that are not structured, not explainable, or not tied to the active mission rule.

## Control Plane Detailed Plan

The control plane is the spacecraft systems layer. It owns long-lived robot and perception state. It must be usable by the UI, runtime, and CLI without duplicating robot connection logic.

### Control Plane Responsibilities

```text
robot registry
robot adapter lifecycle
sensor stream ownership
component queue ingestion
scene cache
command validation prechecks
control ownership locks
command leases
stop state
watchdogs
event fanout
adapter error normalization
```

### Control Plane API Groups

```text
/health
/robots
/robots/{robot_id}/status
/robots/{robot_id}/commands
/robots/{robot_id}/stop
/scene
/scene/refresh
/events
/missions
/approvals
/anomalies
```

The first implementation can be local and simple. The important part is that the boundary exists and is not skipped.

### Control Ownership

Every physical command should acquire a control lease:

```text
lease_id
robot_id
owner_type: operator | runtime | policy | safety
owner_id
command_id
started_at
expires_at
status
```

Rules:

```text
safety owner can preempt all others
operator stop can preempt all others
only one motion command lease per robot at a time
expired lease triggers stop/zero command
failed lease release produces warning event
```

### Command Lifecycle

```text
command_submitted
  -> command_prechecked
  -> command_safety_validated
  -> command_lease_acquired
  -> command_sent_to_adapter
  -> command_acknowledged
  -> command_timeout_started
  -> command_stop_or_zero_sent
  -> command_observed
  -> command_completed
```

Failure states:

```text
precheck_failed
safety_blocked
approval_missing
lease_denied
adapter_send_failed
adapter_ack_timeout
watchdog_timeout
observation_timeout
command_failed
```

## `nemeiactl` Detailed Contract

`nemeiactl` is the model-facing and operator-debug CLI. It should be narrow, stable, and boring.

### Command Groups

```text
nemeiactl health
nemeiactl robot list
nemeiactl robot status <robot_id>
nemeiactl robot stop <robot_id>
nemeiactl robot action <robot_id> damp
nemeiactl robot action <robot_id> balance-stand
nemeiactl robot move <robot_id> --x <mps> --y <mps> --yaw <rps> --duration-ms <ms>
nemeiactl scene get
nemeiactl scene refresh
nemeiactl mission get
nemeiactl mission rule get
nemeiactl events tail
nemeiactl replay command <command_id>
nemeiactl anomaly create ...
```

### Output Rules

All commands should support:

```text
--json
--pretty
--timeout-ms
--thread-id
--turn-id
--correlation-id
```

Model-facing defaults should be compact JSON:

```json
{
  "ok": true,
  "command_id": "cmd_123",
  "event_ids": ["evt_1", "evt_2"],
  "summary": "Go2 stop command accepted.",
  "freshness": {
    "robot_status_ms": 120
  }
}
```

Error responses must be structured:

```json
{
  "ok": false,
  "error_code": "STALE_ROBOT_STATUS",
  "message": "Robot status is 2400 ms old; required <= 500 ms.",
  "blocked_by": "safety.freshness.robot_status",
  "recommended_action": "Run `nemeiactl robot status go2` or refresh the robot connection."
}
```

### CLI Stability Rule

Breaking changes to `nemeiactl` require:

```text
schema version bump
updated docs
updated replay tests
updated model tool instructions
updated operator release note
```

## Component Event Envelope

All component events should share a normalized envelope:

```json
{
  "id": "evt_...",
  "schema_version": 1,
  "component_id": "go2.control",
  "component_type": "robot_control",
  "event_type": "command_ack",
  "timestamp": "2026-07-05T12:00:00.000Z",
  "source_robot_id": "go2",
  "thread_id": "thr_...",
  "turn_id": "turn_...",
  "correlation_id": "corr_...",
  "confidence": null,
  "freshness_ms": null,
  "refs": [],
  "payload": {}
}
```

Required envelope behavior:

```text
id is globally unique
timestamp is generated by control plane when received or emitted
source timestamps can live in payload when needed
correlation_id links submission, command, safety decision, and result
component_type is from a controlled vocabulary
event_type is component-specific but documented
payload is versioned by schema_version
```

Component types:

```text
robot_status
robot_control
camera
lidar
audio
perception
scene_graph
mapping
policy
safety
runtime
operator
storage
```

## Safety Case

The safety case is the argument that Nemeia can execute a bounded command without relying on luck.

### Top-Level Safety Claim

```text
Nemeia can execute a bounded Go2 motion command only when the operator, robot state,
mission rule, command bounds, stop path, and logging path are all valid.
```

### Supporting Claims

```text
S1: A physical command cannot bypass safety validation.
S2: A physical command cannot execute without a control lease.
S3: A physical command cannot exceed configured velocity or duration bounds.
S4: A stale robot status blocks motion.
S5: A stale required scene state blocks scene-dependent motion.
S6: Emergency stop can preempt any active command.
S7: Command timeout causes zero/stop command.
S8: Every physical command is persisted and replayable.
S9: Operator approval is required for L3 bounded motion in v0.
S10: Open safety anomalies block autonomy-level increase.
```

### Evidence Required

```text
unit tests for validators
integration tests for command path
fake-adapter tests for stop preemption
failure-injection tests for timeout and stale state
hardware-in-loop tests for stop and bounded move
replay test reconstructing command decision
operator drill completion
mission report with no unresolved safety anomalies
```

## Safety Validators

Initial validators:

| Validator | Blocks when |
|---|---|
| `safety.emergency_stop` | stop state is active and command is not stop/clear-stop |
| `safety.autonomy_level` | command exceeds mission autonomy level |
| `safety.approval` | command requires approval and none is present |
| `safety.command_bounds` | velocity/duration/action exceeds mission or robot bounds |
| `safety.robot_freshness` | robot heartbeat/status is stale |
| `safety.scene_freshness` | command depends on scene and required scene facts are stale |
| `safety.control_lock` | another owner holds motion control |
| `safety.adapter_capability` | adapter does not support requested action |
| `safety.open_anomaly` | unresolved safety anomaly blocks requested autonomy level |

Safety decision record:

```json
{
  "id": "safe_...",
  "schema_version": 1,
  "thread_id": "thr_...",
  "turn_id": "turn_...",
  "command_id": "cmd_...",
  "robot_id": "go2",
  "decision": "approved",
  "validators": [
    {
      "name": "safety.robot_freshness",
      "result": "pass",
      "details": {
        "age_ms": 120,
        "max_ms": 500
      }
    }
  ],
  "requires_operator_approval": true,
  "created_at": "2026-07-05T12:00:00.000Z"
}
```

## Mission Rules Detailed Model

Mission rules are how Nemeia converts a vague task into operational constraints.

### Mission Rule Example

```json
{
  "id": "mr_...",
  "schema_version": 1,
  "thread_id": "thr_...",
  "goal_id": "goal_...",
  "name": "L3 bounded Go2 motion test",
  "selected_robot_ids": ["go2"],
  "autonomy_level": "L3",
  "success_criteria": [
    "Go2 executes one approved bounded move",
    "Go2 stops within command lease timeout",
    "Command is replayable from stored rollout"
  ],
  "required_freshness": {
    "robot_status_ms": 500,
    "robot_pose_ms": 1000,
    "scene_graph_ms": null,
    "hazards_ms": null
  },
  "command_bounds": {
    "max_vx_mps": 0.2,
    "max_vy_mps": 0.1,
    "max_yaw_rps": 0.3,
    "max_duration_ms": 500
  },
  "approval_requirements": {
    "bounded_move": "operator_required",
    "balance_stand": "operator_required",
    "stop": "not_required",
    "damp": "not_required"
  },
  "abort_triggers": [
    "operator_stop",
    "heartbeat_lost",
    "command_timeout",
    "adapter_error",
    "unexpected_motion"
  ],
  "fallback_behavior": "stop_and_ask_operator",
  "logging_requirements": ["proposal", "safety_decision", "approval", "command", "telemetry", "result"],
  "post_mission_review_required": true
}
```

### Mission Rule Lifecycle

```text
draft
  -> active
  -> completed
  -> superseded
  -> archived
```

Only one mission rule should be active per robot per thread in v0.

## Storage Schema Draft

These are draft tables, not final migrations. They define the operational record Nemeia needs.

### `mission_rules`

```sql
id text primary key
schema_version integer not null
thread_id text not null
goal_id text
name text not null
status text not null
autonomy_level text not null
selected_robot_ids text[] not null
success_criteria jsonb not null
required_freshness jsonb not null
command_bounds jsonb not null
approval_requirements jsonb not null
abort_triggers jsonb not null
fallback_behavior text not null
logging_requirements jsonb not null
post_mission_review_required boolean not null
created_at timestamptz not null
updated_at timestamptz not null
```

### `physical_commands`

```sql
id text primary key
schema_version integer not null
thread_id text
turn_id text
mission_rule_id text
robot_id text not null
correlation_id text not null
command_type text not null
command_payload jsonb not null
status text not null
submitted_by text not null
safety_decision_id text
approval_id text
lease_id text
adapter_command_ref text
started_at timestamptz
completed_at timestamptz
created_at timestamptz not null
```

### `safety_decisions`

```sql
id text primary key
schema_version integer not null
thread_id text
turn_id text
mission_rule_id text
command_id text
robot_id text
decision text not null
validators jsonb not null
requires_operator_approval boolean not null
created_at timestamptz not null
```

### `approvals`

```sql
id text primary key
schema_version integer not null
thread_id text
turn_id text
command_id text not null
operator_id text
decision text not null
reason text
expires_at timestamptz
decided_at timestamptz
created_at timestamptz not null
```

### `anomalies`

```sql
id text primary key
schema_version integer not null
mission_id text
thread_id text
turn_id text
robot_id text
severity text not null
status text not null
summary text not null
expected_behavior text
observed_behavior text
evidence_refs jsonb not null
suspected_cause text
affected_systems jsonb not null
corrective_action text
owner text
closure_criteria text
created_at timestamptz not null
updated_at timestamptz not null
closed_at timestamptz
```

### `mission_reports`

```sql
id text primary key
schema_version integer not null
mission_id text
thread_id text not null
summary text not null
started_at timestamptz
completed_at timestamptz
physical_command_count integer not null
safety_block_count integer not null
anomaly_count integer not null
open_safety_anomaly_count integer not null
report jsonb not null
created_at timestamptz not null
```

## Operator UI Plan

The UI should behave like a cockpit and mission evaluation room, not like a chat app with widgets.

### Required Persistent UI Regions

```text
global stop/status bar
mission panel
robot status panel
scene panel
conversation/turn panel
approval panel
event timeline
replay/anomaly panel
```

### Global Stop/Status Bar

Must show:

```text
robot connection state
heartbeat age
stop state
active command if any
active autonomy level
freshness warning
emergency stop button
```

Rules:

```text
emergency stop is always visible
stop state uses unmistakable visual treatment
approval dialogs cannot cover stop
disconnect state is visible within one second
active command countdown is visible during motion
```

### Approval Panel

Approval UI must show:

```text
proposed command
robot id
mission rule
reason
expected result
safety validator results
freshness ages
command bounds
timeout/lease duration
approve button
reject button
stop button still visible
```

Approval should expire:

```text
default expiration: 15 seconds
expiration blocks command execution
expired approvals produce event
```

### Event Timeline

The event timeline should support filtering:

```text
all events
safety events
physical commands
robot status
scene updates
warnings/errors
operator actions
model proposals
```

Each physical command event should have a replay link.

### Replay View

Replay should show:

```text
operator request
active mission rule
turn context summary
model proposal
safety decision
approval
command sent
adapter acknowledgement
telemetry before/after
warnings/errors
anomaly links
```

## App Server API Draft

### Health

```http
GET /health
```

Response:

```json
{
  "ok": true,
  "version": "0.1.0",
  "schema_version": 1,
  "uptime_ms": 12345,
  "components": {
    "storage": "ok",
    "event_bus": "ok",
    "go2.adapter": "not_connected"
  }
}
```

### Robot Status

```http
GET /robots/{robot_id}/status
```

Response:

```json
{
  "robot_id": "go2",
  "connected": true,
  "heartbeat_age_ms": 120,
  "battery_percent": 82,
  "mode": "balance_stand",
  "pose": {
    "frame_id": "map",
    "timestamp": "2026-07-05T12:00:00.000Z",
    "position": [0, 0, 0],
    "rotation_xyzw": [0, 0, 0, 1]
  },
  "stop_state": {
    "active": false
  }
}
```

### Submit Command

```http
POST /robots/{robot_id}/commands
```

Request:

```json
{
  "thread_id": "thr_...",
  "turn_id": "turn_...",
  "mission_rule_id": "mr_...",
  "correlation_id": "corr_...",
  "command": {
    "type": "bounded_move",
    "vx_mps": 0.1,
    "vy_mps": 0,
    "yaw_rps": 0,
    "duration_ms": 400
  },
  "approval_id": "appr_..."
}
```

Response:

```json
{
  "ok": true,
  "command_id": "cmd_...",
  "status": "accepted",
  "event_ids": ["evt_..."]
}
```

### Stop

```http
POST /robots/{robot_id}/stop
```

Stop must bypass the normal command queue where practical. It still persists events.

## Go2 Adapter Plan

The Go2 adapter should translate Nemeia commands into Unitree-specific operations while hiding Unitree details from the rest of the system.

### Adapter Responsibilities

```text
connect/disconnect
normalize status
normalize odometry/pose
normalize camera stream refs
execute stop/damp/balance/move commands
send zero command on timeout
emit adapter acknowledgements
surface adapter errors
```

### Adapter Non-Responsibilities

```text
mission planning
LLM prompting
approval policy
high-level autonomy
scene graph ownership
anomaly closure
```

### Go2 Command Mapping

| Nemeia command | Go2 mapping | Notes |
|---|---|---|
| `stop` | `StopMove` then optional `Damp` | Safety action. |
| `damp` | sport request `1001` | Stabilization. |
| `balance-stand` | sport request `1002` | Requires approval in v0. |
| `bounded_move` | `rt/wirelesscontroller` with timeout then zero | Hard duration and bounds. |

Low-level command topics remain excluded from v0.

## Scene / Perception Detailed Plan

The scene system should avoid one overloaded "object" abstraction. Keep physical state, observations, and semantic entities separate.

### Scene Update Pipeline

```text
sensor data
  -> perception observation
  -> observation record with artifact refs
  -> entity candidate update
  -> physical body/shape update if spatially grounded
  -> semantic scene graph snapshot
  -> compact model-facing scene summary
```

### Observation Record

```json
{
  "id": "obs_...",
  "schema_version": 1,
  "source_component_id": "perception.sam3",
  "timestamp": "2026-07-05T12:00:00.000Z",
  "frame_id": "camera_front",
  "sensor_pose": null,
  "labels": ["backpack"],
  "confidence": 0.74,
  "geometry_estimate": {
    "type": "bbox_2d",
    "xywh": [120, 80, 64, 90]
  },
  "artifact_refs": ["artifact:frame_...", "artifact:mask_..."],
  "entity_candidates": ["ent_backpack_01"]
}
```

### Compact Scene Summary For Model

The model should see:

```json
{
  "scene_snapshot_id": "ssg_...",
  "timestamp": "2026-07-05T12:00:00.000Z",
  "freshness_ms": 180,
  "robots": [
    {
      "id": "go2",
      "status_freshness_ms": 120,
      "pose_available": true,
      "stop_active": false
    }
  ],
  "hazards": [],
  "entities": [
    {
      "id": "ent_backpack_01",
      "labels": ["backpack"],
      "confidence": 0.74,
      "freshness_ms": 300,
      "relations": ["visible_from:go2_front_camera"]
    }
  ]
}
```

The model should not normally receive masks, full frames, or point clouds unless it asks through a bounded inspection tool and the mission rule allows it.

## Testing Matrix

### Unit Test Matrix

| Area | Tests |
|---|---|
| Command schema | valid/invalid bounded move, unsupported command, missing robot id |
| Mission rule | missing bounds, invalid autonomy, stale freshness config |
| Approval matrix | approval required, approval expired, wrong command id |
| Safety validators | stop active, stale status, over-bound command, missing mission rule |
| Event envelope | required fields, schema version, correlation id |
| Replay | reconstruct physical command from stored records |

### Integration Test Matrix

| Scenario | Expected result |
|---|---|
| health check | control plane returns ok |
| fake robot status | normalized status event emitted and persisted |
| fake stop | stop event emitted, stop state active |
| stop blocks move | bounded move rejected |
| approval missing | bounded move awaits or rejects |
| approval present | bounded move accepted |
| command timeout | zero/stop command emitted |
| adapter failure | command failed, anomaly candidate produced |

### Failure-Injection Matrix

| Failure | Required behavior |
|---|---|
| stale robot status | block motion |
| lost heartbeat | set unsafe state, block motion |
| adapter ack timeout | emit failure, attempt stop/zero if needed |
| browser disconnect | active robot command lease still times out |
| model hangs | safety watchdog remains active |
| duplicate command | idempotency or explicit rejection |
| expired approval | block command |
| invalid scene frame | block scene-dependent motion |
| storage write failure | block physical command unless safe event buffering exists |

### Hardware-In-Loop Acceptance Matrix

Run before any real robot demo:

```text
connect Go2
read fresh status
trigger stop while idle
trigger damp while idle
attempt move with no approval -> blocked
approve bounded move -> executes
stop during bounded move -> preempts
disconnect robot -> status stale -> motion blocked
generate mission report
replay bounded command
file and close a non-safety anomaly
```

## Change Control Process

Nemeia should adopt a lightweight configuration-control process inspired by SP-287.

### Changes That Require Review

```text
robot command schema
control-plane API contract
nemeiactl output schema
component event envelope
mission rule schema
safety validator behavior
autonomy level policy
approval matrix
Go2 command mapping
scene model schema
storage schema
operator procedure
test acceptance criteria
```

### Change Record Template

```text
Title:
Date:
Author:
Affected contracts:
Reason:
Previous behavior:
New behavior:
Risks:
Safety impact:
Replay/storage impact:
Tests added/updated:
Migration required:
Operator-facing change:
Decision:
```

### Change Gate

A contract change is not accepted until:

```text
docs are updated
tests are updated
schema_version impact is decided
replay impact is checked
safety impact is checked
operator-facing procedures are updated if needed
```

## Mission Evaluation Process

Every real robot session should produce a lightweight mission report.

### Mission Report Sections

```text
mission summary
active mission rules
autonomy level
robot roster
timeline
physical commands
safety approvals and blocks
telemetry freshness summary
scene freshness summary
warnings/errors
anomalies
operator interventions
lessons learned
recommended corrective actions
```

### Mission Review Questions

```text
Did the robot do anything not explainable from persisted records?
Did any command execute without the expected safety decision?
Did any scene-dependent action use stale scene state?
Did the operator understand the active state?
Did the stop path work?
Were there warnings that should become blockers?
Should any autonomy level remain blocked?
What test should be added before the next session?
```

## Risk Register

| Risk | Severity | Mitigation |
|---|---:|---|
| Raw Unitree controls leak into model-facing surface | High | `nemeiactl` only; lint/review rule; adapter boundary. |
| Stop path depends on frontend being connected | Critical | Control-plane stop state and watchdog independent of browser. |
| LLM turn blocks safety work | Critical | Safety outside turn loop; control-plane watchdogs. |
| Scene graph treated as truth | High | freshness/confidence/provenance required; fail closed. |
| Storage cannot replay command | High | physical command and safety decision records required before motion. |
| Approval UI obscures emergency stop | High | persistent global stop bar. |
| Tests pass with fake adapter but fail on Go2 | Medium | hardware-in-loop acceptance gate. |
| Too much autonomy too early | High | autonomy levels; anomaly closure gate. |
| Event volume overwhelms thread context | Medium | component queues update state; triggers promote only selected events. |
| Schema drift breaks replay | High | schema versions and change control. |
| Perception false positive drives motion | High | perception emits observations only; motion requires mission rule and freshness. |
| Operator cannot recover under stress | High | drills and UI affordance checks. |

## Release Gates

### Gate A: Read-Only System

Required:

```text
control plane health
Go2 connect/disconnect
normalized status
event timeline
no physical command path except stop/damp safety path
```

### Gate B: Safety Path

Required:

```text
stop works while idle
stop state blocks motion
watchdog detects stale heartbeat
operator UI shows stop state
stop events persist
```

### Gate C: Bounded Motion In Fake Adapter

Required:

```text
mission rule
approval
safety decision
bounded move
timeout zero command
replay
mission report
failure injection
```

### Gate D: Bounded Motion On Go2

Required:

```text
same as Gate C
hardware-in-loop acceptance matrix passes
operator drill completed
no unresolved safety anomalies
```

### Gate E: Perception-Backed Scene

Required:

```text
observations with provenance
scene graph freshness
object/entity inspection
scene-dependent command block on stale state
```

### Gate F: Multi-Step Behavior

Required:

```text
behavior run record
progress events
target-lost handling
policy stop/preemption
replay and anomaly review
```

## Documentation Set To Maintain

The following docs should exist or be kept current as the architecture matures:

```text
docs/components.md
docs/runtime.md
docs/scene-model.md
docs/storage.md
docs/unitree-integration.md
docs/sp287-architecture-validation.md
docs/refreshed-architecture-plan.md
docs/contracts.md
docs/safety-case.md
docs/operator-procedures.md
docs/testing-and-acceptance.md
docs/anomaly-process.md
docs/change-control.md
```

Avoid duplicating detail unnecessarily. The plan can point to contract-specific docs once they exist.

## Expanded Issue Backlog

### Epic 1: Contracts And Schemas

1. Create `docs/contracts.md`.
2. Define component event envelope.
3. Define command envelope.
4. Define safety decision record.
5. Define approval record.
6. Define mission rule record.
7. Define anomaly record.
8. Define physical command record.
9. Define model proposal schema.
10. Add schema versioning policy.

### Epic 2: Control Plane

1. Add control-plane package/process.
2. Add health endpoint.
3. Add event bus abstraction.
4. Add robot registry.
5. Add fake robot adapter.
6. Add command submission path.
7. Add command lifecycle events.
8. Add command lease manager.
9. Add emergency stop state.
10. Add heartbeat watchdog.

### Epic 3: CLI

1. Add `nemeiactl health`.
2. Add `nemeiactl robot list`.
3. Add `nemeiactl robot status go2`.
4. Add `nemeiactl robot stop go2`.
5. Add `nemeiactl scene get`.
6. Add `nemeiactl mission rule get`.
7. Add JSON output mode.
8. Add structured error output.
9. Add replay command.
10. Add events tail.

### Epic 4: Safety

1. Implement emergency-stop validator.
2. Implement autonomy-level validator.
3. Implement approval validator.
4. Implement command-bounds validator.
5. Implement robot-freshness validator.
6. Implement scene-freshness validator.
7. Implement control-lock validator.
8. Implement open-anomaly validator.
9. Persist safety decisions.
10. Add safety decision UI.

### Epic 5: Go2 Read-Only

1. Add Go2 connection settings.
2. Add local signaling proxy.
3. Port minimal WebRTC camera path.
4. Normalize connection state.
5. Normalize robot status.
6. Normalize odometry if available.
7. Add camera panel.
8. Add status panel.
9. Persist robot status samples.
10. Add read-only acceptance tests.

### Epic 6: Go2 Physical Commands

1. Implement stop mapping.
2. Implement damp mapping.
3. Implement balance-stand mapping with approval.
4. Implement bounded move mapping.
5. Implement zero command on timeout.
6. Emit command ack events.
7. Emit adapter error events.
8. Add hardware-in-loop stop test.
9. Add hardware-in-loop bounded move test.
10. Add failure injection for missing ack.

### Epic 7: Runtime Integration

1. Add mission goal binding.
2. Add mission rule loading.
3. Add compact turn context.
4. Add model proposal parser.
5. Add approval request flow.
6. Add command submission after approval.
7. Add turn events for validation/execution.
8. Persist rollout items.
9. Add replay reconstruction.
10. Add mission report trigger.

### Epic 8: UI Cockpit

1. Add global stop/status bar.
2. Add mission rule panel.
3. Add autonomy-level indicator.
4. Add freshness indicators.
5. Add approval panel.
6. Add active command countdown.
7. Add event timeline filters.
8. Add replay panel.
9. Add anomaly filing panel.
10. Add operator drill mode/checklist.

### Epic 9: Storage And Replay

1. Add Postgres migrations for mission rules.
2. Add physical commands table.
3. Add safety decisions table.
4. Add approvals table.
5. Add anomalies table.
6. Add mission reports table.
7. Add artifact metadata table if missing.
8. Add replay query for command.
9. Add mission report generator.
10. Add storage tests.

### Epic 10: Scene And Perception

1. Define observation schema.
2. Define semantic scene graph snapshot schema.
3. Add scene freshness model.
4. Add `scene get`.
5. Add `scene refresh`.
6. Connect perception observations.
7. Add entity provenance view.
8. Add stale-scene safety gate.
9. Add scene replay.
10. Add perception false-positive anomaly workflow.

### Epic 11: Simulation And Acceptance

1. Add fake Go2 adapter.
2. Add fake telemetry stream.
3. Add fake command ack delay.
4. Add fake network drop.
5. Add fake stale status.
6. Add fake adapter crash.
7. Add replay mission runner.
8. Add operator drill checklist.
9. Add hardware-in-loop acceptance script.
10. Add release gate checklist.

## First 30 Implementation Tasks

This is the recommended sequence for the first serious implementation pass:

1. Create `docs/contracts.md` from the contract sections in this plan.
2. Create `docs/safety-case.md` from the safety case sections.
3. Create `docs/testing-and-acceptance.md` from the testing matrices.
4. Implement a fake control plane with `/health`.
5. Add `nemeiactl health --json`.
6. Add normalized component event type definitions.
7. Add fake robot registry with `go2`.
8. Add `nemeiactl robot status go2 --json` against fake adapter.
9. Add command envelope and command lifecycle events.
10. Add emergency stop state to fake control plane.
11. Add `nemeiactl robot stop go2 --json`.
12. Add command lease manager.
13. Add safety validators for stop state and command bounds.
14. Add mission rule type and one hardcoded L3 rule for fake runs.
15. Add approval record type.
16. Add bounded move command against fake adapter.
17. Add zero-on-timeout behavior in fake adapter.
18. Add replay record for fake bounded move.
19. Add unit tests for validators.
20. Add integration test for fake observe-plan-act loop.
21. Add mission report generator for fake mission.
22. Add anomaly record type.
23. Add anomaly creation from failed command.
24. Add UI global stop/status bar.
25. Add UI event timeline fed by fake control plane.
26. Add UI approval panel.
27. Port Go2 read-only connection settings.
28. Add Go2 status normalization.
29. Run read-only Go2 acceptance.
30. Only then wire real Go2 bounded move.

## Final Architecture Test Scenario

This scenario should be the first real proof point and a recurring regression test:

```text
Initial state:
  Go2 connected
  emergency stop inactive
  robot status freshness <= 500 ms
  active mission rule L3
  bounded move max duration 500 ms
  bounded move requires approval

Operator request:
  "Move Go2 forward slightly."

Expected runtime behavior:
  create turn
  gather robot status
  load mission rule
  build compact context
  model proposes bounded move
  safety validates command
  approval requested
  operator approves
  command submitted to control plane
  lease acquired
  adapter sends bounded move
  timeout manager sends zero command
  result observed
  mission report generated

Expected persisted evidence:
  operator message
  turn context
  model proposal
  safety decision
  approval
  physical command
  command lifecycle events
  robot status before/after
  command result
  mission report

Expected safety properties:
  stop button visible throughout
  stop preempts command if pressed
  command cannot run after approval expiration
  command cannot exceed bounds
  command cannot run on stale status
  command is replayable
```

## Final Guiding Principle

Do not measure progress by how autonomous the robot looks. Measure progress by how much of the mission can be explained, stopped, replayed, tested, and improved.

The architecture is ready for more autonomy only when the boring parts are strong:

```text
contracts
freshness
approval
stop
leases
logs
replay
tests
anomaly closure
```
