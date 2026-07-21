# Nemeia Architecture Validation Against NASA SP-287

Status: historical validation input. The current normative architecture is the
NEM Suite in [`nem-suite-specification.md`](./nem-suite-specification.md), with
the migration roadmap in
[`nem-suite-redesign-plan.md`](./nem-suite-redesign-plan.md).

Source: NASA SP-287, *What Made Apollo a Success?* NASA Technical Reports Server, document 19720005243.

This note uses SP-287 as an architecture review lens for Nemeia. The goal is not to copy Apollo. The goal is to apply the report's engineering disciplines to a robot agent runtime: simple interfaces, deep testing, disciplined change control, simulation, operator procedures, anomaly closure, and mission planning.

## Validation Summary

Nemeia is directionally strong. The current architecture already separates the operator UI, runtime, app server/control plane, robot adapters, perception, scene state, and safety. That matches SP-287's repeated theme that successful mission systems depend on understandable interfaces, rehearsed operations, and explicit control of risk.

The main gaps are operational, not conceptual:

- safety needs to exist outside the LLM turn loop as an always-on system;
- robot-affecting commands need acceptance tests and failure-injection tests;
- change control needs to cover command schemas, safety profiles, scene model contracts, and procedures;
- every mission needs anomaly tracking and closure before increasing autonomy;
- operator procedures need to be trained and rehearsed, not only documented.

## SP-287 Criteria Applied To Nemeia

| SP-287 discipline | Nemeia status | Validation |
|---|---:|---|
| Simple design and minimized interfaces | Strong, with one risk | The single model-facing `bash` tool and app-server boundary are the right direction. Risk: raw Unitree topics or browser-owned controls can bypass the Nemeia command layer if not constrained. |
| Redundancy and abort paths | Partial | `emergency_stop`, `interrupt`, `stop_move`, `damp`, command bounds, and event logs are planned. They need implementation as independent, always-available paths outside the active turn. |
| Qualification and acceptance testing | Partial | Frontend checks and vision tests exist. Nemeia still needs hardware-in-loop, safety-gate, command-timeout, stale-scene, network-loss, and emergency-stop acceptance tests. |
| Change control | Gap | SP-287 treats every change as potentially invalidating prior experience. Nemeia needs a lightweight configuration-control process for runtime contracts, command schemas, safety policy, perception labels, and mission procedures. |
| Human-machine procedure design | Partial | The architecture correctly says models propose and the runtime executes. Nemeia needs an explicit approval matrix defining what the agent may do autonomously, what requires confirmation, and what is operator-only. |
| Simulation and operator training | Partial | Scene model, replay, and rollout history are planned. Nemeia should add simulation/replay drills for normal, degraded, and emergency procedures. |
| Mission evaluation and anomaly closure | Partial | Rollout history supports this. Nemeia needs an anomaly list with owner, cause, corrective action, and closure status after each real robot session. |
| Flexible but disciplined mission planning | Strong conceptually | Threads, goals, component queues, triggers, and turn lifecycle give Nemeia the right planning substrate. Each mission still needs success criteria, constraints, abort rules, and alternate plans. |

## Architecture Findings

### 1. Keep The Model Interface Small

SP-287 emphasizes minimizing functional interfaces between complex systems. Nemeia's model-facing surface should stay small:

```text
LLM -> bash -> nemeiactl -> app server/control plane -> robot adapter
```

This is a good design because one person can reason about the model-facing contract. The complexity stays behind Nemeia-owned APIs where it can be validated, logged, tested, and interrupted.

Recommended rule:

```text
No model-facing API should expose Unitree topic names, raw DDS/WebRTC message types, or low-level control channels.
```

Good:

```text
nemeiactl robot move go2 --x 0.2 --yaw 0 --duration-ms 500
nemeiactl robot stop go2
nemeiactl scene get
```

Bad:

```text
publish rt/wirelesscontroller ...
publish rt/lowcmd ...
```

### 2. Make Safety Independent Of The Turn Loop

SP-287's lesson is that safety cannot depend on the nominal plan continuing to work. In Nemeia, the LLM turn loop is not a safety system. It is a planner and explainer.

Safety must remain active even when:

- the LLM call is stuck;
- the browser disconnects;
- perception is stale;
- the control plane loses a robot heartbeat;
- the operator interrupts the mission;
- a plugin crashes;
- a command completes without a clear acknowledgement.

Required v0 safety mechanisms:

```text
always-on emergency stop
command lease / max duration
zero command on timeout
blocked motion while emergency stop is active
freshness checks before motion
robot heartbeat watchdog
control ownership lock
event log for every physical command
manual operator fallback
```

### 3. Treat Scene Freshness Like A Flight Constraint

Nemeia's scene graph is a belief state, not reality. SP-287 repeatedly distinguishes planned behavior from verified operational data. Nemeia should do the same.

Every scene fact used for planning should carry:

```text
source_component_id
timestamp
confidence
freshness
provenance
artifact refs
coordinate frame
```

Physical actions should fail closed when required scene data is stale:

```text
if command affects motion:
  require robot status freshness
  require pose freshness
  require hazard/free-space freshness
  require safety profile match
  otherwise block or request refresh
```

### 4. Define Qualification And Acceptance Tests

SP-287 separates design qualification from acceptance testing. Nemeia should copy that distinction.

Qualification tests answer:

```text
Is this design good enough under expected conditions?
```

Acceptance tests answer:

```text
Is this specific build/session/robot/config safe to use today?
```

Recommended Nemeia test classes:

| Test class | Purpose |
|---|---|
| Unit tests | Validate command schemas, event envelopes, scene updates, policy decisions. |
| Integration tests | Validate `nemeiactl -> control plane -> adapter -> event log` without hardware. |
| Simulation tests | Validate observe-plan-act flows in replay or simulated worlds. |
| Hardware-in-loop tests | Validate real Go2 status, stop, damp, bounded move, timeout, and recovery. |
| Failure-injection tests | Drop network, stale scene, missing ack, crashed worker, delayed telemetry, invalid command. |
| Operator acceptance tests | Verify the operator can stop, inspect, recover, replay, and understand the state. |

Minimum physical-command acceptance suite:

```text
status returns fresh telemetry
emergency_stop works during idle
emergency_stop works during motion
bounded move stops after duration
zero command is sent on timeout
motion is blocked when emergency stop is active
motion is blocked on stale robot status
motion is blocked on stale scene state when scene-dependent
every command produces correlated events
rollout can replay command reason, safety decision, command result
```

### 5. Add Configuration Control For Runtime Contracts

SP-287 warns that changes can void previous test and flight experience. For Nemeia, this means changes to the following need review and versioning:

```text
nemeiactl command schema
robot command mappings
safety policy thresholds
approval matrix
component event envelope
scene model schema
semantic scene graph schema
thread trigger rules
mission procedures
plugin interfaces
storage schema
```

Recommended lightweight process:

```text
Architecture Decision Record for contract changes
schema version in persisted events
migration notes for stored mission data
updated acceptance tests before real robot use
operator-facing release note for changed procedures
```

### 6. Build Mission Rules Before Autonomy

Apollo used mission techniques: decision logic, thresholds, and ground rules for nominal and contingency cases. Nemeia needs the same idea for robot missions.

A Nemeia mission rule should define:

```text
goal
success criteria
selected robot
allowed autonomy level
required scene freshness
command bounds
approval requirements
abort triggers
fallback behavior
logging/replay requirements
post-mission review requirements
```

Example:

```text
Mission: find backpack in living room
Autonomy: perception and planning autonomous; motion requires approval
Motion bound: <= 0.2 m/s, <= 500 ms per command
Freshness: robot status <= 500 ms, pose <= 500 ms, hazards <= 1000 ms
Abort: operator stop, obstacle inside keepout, target lost during approach, heartbeat lost
Fallback: stop, refresh scene, ask operator
```

### 7. Train The Operator Workflow

SP-287 treats crew training and simulation as part of the system, not as documentation after the fact. Nemeia should treat the operator the same way.

Required operator drills:

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
replay the last action
file an anomaly
```

The UI should make these workflows obvious under stress. A stop path that is technically present but visually buried is not an operationally valid stop path.

### 8. Close Anomalies Before Increasing Autonomy

SP-287 describes mission evaluation as extracting maximum information from each flight and resolving anomalies promptly. Nemeia should keep a mission anomaly list for every real robot session.

An anomaly record should include:

```text
id
mission_id
turn_id optional
robot_id
time
summary
severity
what happened
expected behavior
observed evidence
suspected cause
affected systems
corrective action
owner
closure criteria
status
```

Recommended rule:

```text
Do not increase autonomy level after a mission with unresolved safety-relevant anomalies.
```

## Immediate Architecture Actions

1. Define Nemeia autonomy levels.

```text
L0 read-only observation
L1 propose actions only
L2 execute non-motion actions
L3 execute bounded motion with approval
L4 execute bounded motion under mission rules
L5 extended autonomy with operator supervision
```

2. Add a command approval matrix.

```text
status: autonomous
scene refresh: autonomous
audio speak: approval configurable
damp / stop_move: autonomous safety action
bounded move: approval required in v0
policy execution: approval required
low-level control: disallowed in v0
```

3. Add physical-command acceptance tests before expanding Go2 control.

4. Add a `mission_rules` concept to the runtime model.

5. Add anomaly records to storage and mission reports.

6. Add schema versions to component events, scene snapshots, tool calls, and safety decisions.

7. Add freshness gates to every motion-affecting command.

8. Add replay-first debugging: each physical command must be explainable from persisted rollout items.

## Verdict

The Nemeia architecture is aligned with SP-287 in its major shape: small model-facing interface, durable event history, separated control plane, explicit scene state, and cross-cutting safety. It is not yet validated in the SP-287 sense because the operational discipline is not fully specified.

The next architecture milestone should not be "more autonomy." It should be:

```text
one safe, replayable, bounded observe-plan-act loop on Go2
```

That loop should prove:

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

Once Nemeia can do that repeatedly, autonomy can increase on a foundation that resembles SP-287's actual lesson: mission success comes from architecture plus disciplined operations.
