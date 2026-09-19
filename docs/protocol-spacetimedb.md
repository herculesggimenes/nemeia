# Nemeia architecture and protocol

Selected design, 2026-09-19. Nemeia defines perception, a shared world,
client subscriptions, decisions and bounded execution. Its foundations
are world, entity, component, relationship, affordance, action, system and event.
Mission is a first-class domain abstraction built on those foundations: durable
intent, typed objectives, constraints and evidence-backed progress.
World Masters assign missions and authority. Agents collaborate on outcomes and
coordinate Units: entities with installed controllable capabilities. Systems
handle perception, classification, pathfinding and local execution.
SpacetimeDB is the selected world-storage and synchronization implementation,
not a foundational concept. This document does not deploy a database or control
a robot. Module examples target SpacetimeDB 2.10.1; type checking is not a server
integration or hardware test.
Eve is the selected agent runtime. This planning update changes the website and
specification only; the channel, sandbox and backend implementation remain work
for a later phase. Integration details were reviewed against Eve 0.63.0 bundled
documentation; Eve is in preview and must be pinned and qualified.

## V0: durable world state for one agent

The release gate is one logical agent accumulating and recovering a progressive
local map through one Unit. World Master creates missions, assigns the agent,
and grants Unit authority separately. One agent can coordinate multiple missions
through its mission log. A perfect reconstruction, motion execution,
another Unit, cross-Unit calibration and automatic map fusion are not required.

WorldView is a read projection, not another database. Persist entity identities,
source-local tracks, independently timed facets, retained observations, mission
progress and local-map checkpoint heads outside Eve history. Missing depth stays
unknown. Leaving the current view does not delete an entity or prove absence.
The same source acquisition cannot be counted twice through retries or multiple
model outputs. New evidence may refine a known entity only after validated
association, never by matching labels alone.

The selected schema plan adds `spatial_frame`, `local_map` and `map_revision`.
Pose and geometry are keyed by entity plus frame, with one owning projection
pipeline per facet/frame in v0. Remove the mandatory world-wide frame from
`world_config`. Reset origins receive new immutable frame IDs; historical
coordinates must not silently change meaning. Exact calibration/transform
provenance belongs with observations. Image-only evidence remains useful before
metric mapping is possible.

A local map retains current knowledge plus immutable checkpoint manifests.
Each manifest records its root frame, revision and parent, complete referenced
spatial chunks, exact input evidence coverage and optional native mapper export.
Large data stays in immutable resource storage. The trusted mapper/storage
boundary verifies retained bytes before an atomic compare-and-set advances
`local_map` head, inserts `map_revision` and records audit. An identical manifest
retry resolves to its existing revision. Storage IO and SLAM stay outside reducers.
Retention must preserve the reference closure of supported checkpoints and
mission proofs; an audit log alone cannot reconstruct the map.

After restart, recover the last committed checkpoint and reconcile newer retained
observations against its input coverage. Restoring map bytes does not establish
the Unit's current position. Require relocalization before reusing a previous
frame; otherwise start a new local frame. Eve session reset does not erase map,
agent, mission, entity or execution identities. Each inference gets a bounded
authorized projection; prompt omission never deletes durable knowledge.

World persistence and restart recovery are platform responsibilities, not mission
objectives. The walkthrough uses two missions for an already known target: acquire
a fresh semantic observation and acquire measured local geometry. Their typed
objectives validate domain evidence; they do not certify complete scene coverage.
Restart recovery remains an independent release acceptance test.

Acceptance tests to implement: ingest observations; refine an associated entity;
retain map chunks and evidence; interrupt before/after head commit; recover the
last valid head; deduplicate redelivery; reset Eve without losing the world; and
continue local observation with localization uncertainty explicit. Reject stale
spatial actions without blocking evidence reading or reporting. These tests are
specified here, not passed by the website checks.

Sequence: (1) single-agent local durability; (2) additional Units with separate
views and non-spatial coordination; (3) qualified, versioned frame alignment;
(4) collaborative mapping only where missions justify it. Frame alignment and
cross-Unit entity association are separate decisions. Preserve original local
evidence so reconciliation can be revised later. Do not implement a distributed
SLAM engine inside the world database.

## Ownership

One world owns committed state. Perception associates observations with stable
entities and supplies independently timed components and relationships. Clients
subscribe to missions and relevant world changes, then prepare context at their own pace. Decisions propose
intent; action admission and local execution enforce current requirements.
Measured outcomes feed back into the world. Tracing records the context behind
the work without becoming another state or control authority.

In the selected implementation, one database owns one world. Its typed tables hold current entities, components,
relationships and executions. Reducers validate and commit domain decisions;
subscriptions synchronize read-only client caches. Do not maintain a second
mutable JavaScript world and synchronize it back into the database.

Perception, inference, navigation and physical execution run outside the
database. The robot-local controller owns motion, command bounds, monotonic
watchdogs, stop and durable admission receipts. A database outage must not
prevent local stop. No database transaction spans robot IO.

## World Masters, agents and Units

Entity is the common identity for a chair, room, Go2 or vacuum. Unit is the role
of an entity with controllable capabilities, not a new identity or a hardware
class hierarchy. An offline Unit remains a Unit but is unavailable. The optional
motion extension specifies `approach@1`; other devices need their own typed
bindings and validators, not an unvalidated universal command payload.

A World Master is a privileged client role, human-operated or automated, not a
mandatory singleton service. It sees the whole recorded world, establishes or
cancels missions, assigns teams and Unit grants, and can pause/reassign agents.
It cannot invent observations, bypass admission or override robot-local safety.
Platform administrators provision credentials/bindings separately; the World
Master role governs domain work rather than inheriting unrestricted sensor writes.

An agent is a durable logical decision-maker, not a robot, model, worker process
or connection. It may use LLMs, Typesafe or rules, work on multiple missions,
control several Units, or contribute advice without controlling any Unit.
Multiple agents collaborate on the same mission and objective credit ledger.
`mission_agent` stores participation; inbox progress is independent per agent.

Keep three boundaries separate:

- Visibility: the World Master's `agent.readScope` grants the world in the
  single-agent v0 deployment. Automatically derived Unit awareness narrows
  interest, never permission. Restricted multi-user spatial visibility is later
  work; a preselected entity list must not hide newly discovered objects.
- Assignment: one command-owning agent per Unit in `unit_assignment`, with named
  allowed actions, a monotonically increasing revision and optional expiry.
  Observers/advisers may coexist; split capability ownership is deferred.
- Reservation: `unit_control.activeExecutionId` records the physical attempt
  currently occupying the Unit. Assignment alone never makes a busy Unit free.

World Masters compare expected revisions when editing grants/rosters. Roster
changes bump mission revision; Unit grants have a separate authority revision.
Pause, revocation and expiry invalidate affected proposals and block admission
and claim, request cancellation, and retain reservations until confirmed local
closure. New owners wait for this reconciliation. Expiry needs a timer even
without sensor writes; it is not proof of physical stop. Local controller epochs
fence executors independently from agent assignment revisions.

Shared objectives, assignments, reservations and measured outcomes coordinate
facts. `agent_message` carries bounded addressed requests/explanations between
active mission participants. Derive sender from authenticated identity; authorize
read access for sender, recipient and World Masters only. Message text is data,
not a control grant or proof. A handoff needs an explicit World Master assignment
operation. Retain must-handle messages until durable recipient acknowledgement;
enforce byte/rate limits and explicit backpressure, not silent loss. A coordinator
agent is optional, not an extra mandatory abstraction.

Observation, decision and control clocks are independent. Agents choose RTS-level
intent; systems execute lower-level work without waiting for each LLM step or
needing a mission of their own. No fixed update rates are assumed before measurement.

## State and history

Current tables are authoritative. The database supplies its own commit log and
restart recovery. A normal persisted `world_event` table retains application
history for inspection; each `execution` row is also its durable request receipt.
Domain state, execution receipts and domain events change
in the same reducer transaction. Do not implement this history with SpacetimeDB
transient event tables. This is not event-sourced world reconstruction: the audit
row is an index of decisions, not every historical component value. Scene replay
needs a separately specified recorder. The engine's commit log remains internal.

Read subscriptions receive a consistent initial snapshot and subsequent atomic
transaction updates. A reconnect establishes current state again; it does not
promise replay of every transition missed while offline. Readers that require
history use an authorized, bounded history boundary over retained world events;
an audit sequence is not a subscription cursor.

Use confirmed reads for executors and clients that act on committed decisions.
The subscription cache is a replica for reading, not control authority. An
available affordance is a hint; the request reducer rechecks current evidence.

## Deployment scope

Begin with one world database on a robot-adjacent host and a separate local
controller. Multiple world databases are not automatically one distributed
transaction or conflict-free replicated world. Federation is out of scope.

Keep sensor frames on their existing streaming transport and retained media in
an object store. Store semantic entities, spatial summaries and references in
SpacetimeDB. Bound retained observation/event history; its documented table
storage is memory-resident with durable backing. No Nemeia workload latency or
capacity claim is made before measurement.

The engine is source-available under BSL. The current additional production-use
grant limits an application/service to one production instance. Check the
selected release and commercial terms before independent fleet/customer
deployments. This is a deployment constraint, not a reason to add another
custom state engine.

## Model composition

Use YOLOE as the first candidate for frequent local detection/segmentation and
tracking, with SAM3 scheduled selectively for richer segmentation or ambiguous
targets. Both feed the same observation and association boundaries. Calibrated spatial processing
supplies measured geometry; ASR supplies transcripts; semantic models add
hypotheses. Validated association commits these to the same typed world.
Neither masks nor generated descriptions imply known 3D geometry or permission.

Keep bounded inference concurrency and one latest pending frame per stream.
Preserve capture time; stale completions and tracking predictions must not
refresh measured evidence. Cross-model association requires evidence, not a
same-label merge. Pin model, prompt profile and runtime in producer provenance.
Start with a small YOLOE checkpoint and task-scoped classes; qualify resolution,
rate, end-to-end p95 latency, memory and accuracy on the actual host. No frame
rate is promised. Exported prompted models may freeze classes; changing the
vocabulary can require re-export. SAM3 is not on every frame's critical path.

Typesafe, LLMs and rules consume a task-scoped projection of that world.
Typesafe supplies focused choices/scores/probabilities; LLMs interpret unfamiliar
goals and propose plans or versioned questions. Exact checks remain code.
Decision workers run outside transactions. Preserve context/model/question
versions and reject late, superseded or out-of-option answers. A changed row
triggers dependency review, not automatic cancellation of all reasoning. Recheck
the goal, candidate identities and task-relevant meaning. Explicit task rules may
establish equivalence; otherwise recompute. Inference deadlines differ from
physical evidence-age limits. Build an action request from fresh evidence and
strict current geometry pins; admission and claim repeat their checks. A decision
never calls an actuator directly. Reducers independently repeat current action
requirements; model confidence never overrides them.

For the first slice, decision records belong in the worker's bounded audit
store; they are not world components. Retain their exact input context or a
durable reference when audit is required. No live provider connection or
database deployment is included here.

`contracts/spacetimedb/intelligence.ts` defines the detached JSON projection of
SDK rows: decimal strings for u64 and UTC strings for Timestamp. These types
do not perform serialization or validate runtime input. Preserve evidence and
row versions; do not serialize a mutable subscription cache or Map directly.

## Missions, mission log and objective progress

The reference patterns come from open-source MMO server implementations, not
claims about the commercial games' internal systems. AzerothCore separates
[quest definitions](https://www.azerothcore.org/wiki/quest_template) from
[per-character progress](https://www.azerothcore.org/wiki/character_queststatus).
[EQEmu task activities](https://docs.eqemu.dev/server/task-system-guide/) define
typed goals, counts, optional activities and ordered steps.
[TrinityCore QuestObjective](https://github.com/TrinityCore/TrinityCore/blob/master/src/server/game/Quests/QuestDef.h)
has distinct identity, type, target and amount fields. We adopt the separation
of description, objectives, quest log and objective progress, not their game-specific schemas.
This is a Nemeia design, not an established universal mission protocol.

### Definition and identity

A mission is one accepted, immutable specification plus a durable lifecycle.
`MissionSpec.description` explains the intended outcome and context, like a quest
briefing; it replaces `goal`. `objectives[]` defines the measurable conditions.
Description is useful reasoning context, not executable completion logic.
Keep the bound specification inline in `mission`; an optional template pin is
authoring provenance, not a mutable lookup. Resolve target identities and
authorize the specification before creation. The owner records the creating
World Master's identity; it does not lock the mission to one agent. World Masters
create/cancel and assign participants; active assigned agents may submit proof.
Subscription access alone grants neither participation nor Unit authority.
Dedicated views enforce these boundaries, with scoped controller access. Those
views remain unimplemented.

Creation with the same owner, ID and specification returns the existing instance;
a changed body conflicts. The specification never changes in place. Repeating
or replacing a mission requires a new ID. Plans may adapt without changing the
agreed outcome. One mission can span clients and executions; there is no separate
Run, Plan or Task record. A stopped client does not erase or cancel the mission.

### Mission log and coordination

One agent can have multiple assigned missions in v0. `MissionLog` is a read
projection over `mission_agent`, `mission` and `mission_objective_progress`, not
a new table, an audit log or an Eve conversation. It contains the agent's
authorized assignments and retained outcomes. Later teams may share progress on
one mission; there is no duplicate mission instance per participant.

The World Master defines and assigns work. The agent coordinates its log through
one reasoning loop, selecting work across missions according to deadlines,
readiness, available evidence and Unit availability. Focus is not a mission
lifecycle state: other missions stay active, their deadlines continue and
independent evidence may advance them. Changing focus does not cancel physical
work. A Unit reservation prevents conflicts across the entire log.

Before each step, prepare a compact summary of every assignment, relevant changes
and outstanding work; load deeper authorized details as needed. Do not hide an
assignment simply because its target is outside a Unit's awareness radius. If no
useful work is possible, retain change/deadline subscriptions without repeatedly
invoking inference. Eve owns the runtime loop; the log introduces no scheduler.

### Objectives and objective progress

An objective has an ID, explanatory text, all-of dependencies, an optional flag
and a typed criterion. Validate 1–32 nodes, unique IDs, existing references,
acyclic dependencies and at least one required objective. Optional objectives
cannot gate required ones. Independent objectives may progress in parallel.
The planning contract defines two criteria; only observation is needed for v0:

- `observed`: acquire a geometry or semantic facet for an already bound entity.
  Load the retained observation and its association. The required facet must
  exist, be acquired at/after objective readiness, and satisfy `maxAgeMs` at
  credit time with the world's clock-error policy. A semantic facet proves that
  hypotheses were acquired, not that a label is true.
- `approached`: a successful `approach@1` receipt for the required target and
  standoff, using an eligible assigned Unit selected by an agent. Verify the request's mission/objective link, admission after objective
  readiness, successful measured completion and the pinned effective policy.
  A sent command, model answer or unlinked standalone action is not credit.

Readiness begins at mission creation or the latest prerequisite credit timestamp.
These are latched milestones, not perpetual conditions. Old proof cannot satisfy
a newly unlocked objective; repeated frames cannot stand in for distinct objects.
Live physical freshness is still rechecked for every action.

`mission_objective_progress` stores one immutable completion proof per
`[missionId, objectiveId]`. Pending entries in `ObjectiveProgress` derive from the
specification and do not need persisted rows. There is no caller-writable status
flag, percentage or second progress counter.
Check World Master or active participant authority and evidence access; load authoritative domain records instead
of accepting caller-provided progress. The first valid proof wins. Redelivery
returns the existing credit without replacing evidence. Validate and record the
credit, audit event and any transition to closing in one transaction. Retain
proof records for the supported mission audit lifetime; a missing reference
cannot advance progress. `MissionView.objectiveProgress` includes every objective
as pending or completed, with evidence for completed ones. Derive
`readyObjectiveIds` from dependencies, lifecycle and deadline. Readiness does not
imply that a Unit or a safe action is available. One observation may advance
multiple objectives only after each independently validates it. A client inbox
acknowledgement and objective progress are different operations.

`Missions.readMissionLog` exposes the authorized projection;
`Missions.recordObjectiveProgress` accepts evidence references, not asserted
progress. Creation and assignment remain separate World Master operations.

### Lifecycle and execution

The lifecycle is `active → closing → succeeded | failed | cancelled`. Creation
activates a complete authorized specification; drafts remain authoring inputs.
All required credits request success. Cancellation requests cancellation; expiry
requests failure. Entering closing blocks new admission and claim, requests
cancellation of unfinished linked attempts and bumps the lifecycle revision.
Record cancellation intent for linked executions atomically with that transition;
bound outstanding attempts to one per mission/objective. Deadline checks occur
at admission, claim, credit and reconciliation; schedule reconciliation even when
no sensor writes arrive. A mission deadline is not a robot-local watchdog.

Before a terminal mission state, confirm safe closure for every linked attempt.
An execution marked failed with an unknown physical outcome is insufficient.
An unreachable controller leaves closing unresolved, never implies stopped.
Cancellation can replace pending success before terminal commit. A deadline
reached while closing prevents success; it does not override requested cancellation.
An already requested cancellation is an idempotent retry, checked before the
revision precondition; cancellation cannot rewrite another terminal outcome.
Terminal mission outcomes are immutable. A failed action alone need not fail the
mission: reconcile it before considering a fresh execution with a new ID.

Action requests pin mission ID, objective ID, mission revision and Unit assignment
revision. Admission and claim verify the current caller role, unpaused agent,
participation, current unexpired grant for the action, active mission, deadline,
ready matching objective, evidence freshness and target version. Reject a second
nonterminal attempt for that objective. MissionSpec has no Unit list, speed cap
or motor duration. Pin installed execution policy in the accepted row; local
control may tighten it. Only an explicit audited World Master intervention can
omit agent assignment and, for standalone actions, mission linkage. Agents cannot
strip either pin to bypass cancellation or revocation. Entity removal must
reject references from active/closing missions as well as active executions.

Objective progress uses mission and evidence-backed progress tables; teamwork adds participation and
assignment records without per-agent mission copies. Counted objectives need an
explicit distinct-item identity and deduplication policy before addition.
Dynamic branches, nested missions, mission pause/resume, rewards,
reset calendars and automatic mission chains are intentionally deferred.
The website defines the selected planning types; the checked SDK scaffold still
uses the older names. Mission reducers, validators, authorized views and
crash/race tests are not implemented here.

## Client subscriptions

Subscriptions are transport, not agent-managed configuration. Nemeia derives
interest from assigned Units, their observations and local maps, mission
dependencies and pending outcomes. A world-managed `AwarenessPolicy` controls
batching and an optional radius; `agent_subscription` and `putSubscription` are
not part of the selected plan. Direct perceptions and unlocated evidence remain
available without a metric position. Apply radius filtering only where positions
can be compared reliably. Discovery must not depend on the radius whose spatial
relationship it is trying to establish. Across unaligned views, distance is
unknown, not outside the radius. Interest never grants control.

A native subscription delivers relevant authorized world changes.
An inbox buffers work that needs attention; context is the detached, frozen
input prepared when the client is ready to decide. These are separate concerns,
not three world authorities or three required services.

Select entities, components, relationships and executions relevant to the task,
including the dependencies needed to evaluate it. Interest filters do not grant
read or action permissions; the server enforces those independently. Use native
database subscriptions rather than inventing a new transport or query language.
On a scope change, wait for the new matching view and review active-step
dependencies. A row entering or leaving a query is not evidence that an object
physically appeared or disappeared. A display-only client can render its cache
directly without a durable inbox or reasoning-step lifecycle.

Each logical client keeps independent progress. The Nemeia adapter coalesces
replaceable entity/component changes, retains must-handle messages/occurrences,
and evaluates world-managed wake/cadence policy. Latest state
cannot reconstruct an event that happened between steps. A rate cap is not a
requirement to poll; `maxBatchWaitMs` is a desired batching bound, not guaranteed
inference latency. Emit bounded useful wakes, never a model turn per sensor frame.

Eve owns the reasoning lifecycle. At its next inference boundary, after any
delivery delay, the adapter selects a consistent authorized projection and
publishes a frozen context manifest and files. Preserve acquisition times,
unknown values and relevant revisions. Eve supplies history and compaction;
the projection supplies current mission, Unit, evidence and message context.
Defer excess must-handle work explicitly rather than silently truncating it.
Recover the persisted context identity on retry; do not silently rerun a command
against a different snapshot. Recheck current authority and evidence at admission.

Keep `idle`, `ready`, `thinking` and `waiting` only as an activity projection of
pending useful work, Eve events and domain dependencies. They are not another
persisted runtime state machine. Eve's `session.waiting` alone does not distinguish
domain-idle from waiting on a physical execution. Administrative pause and
synchronization remain independent. Unavailable Units do not justify repetitive
LLM inference; availability changes or coordination can make work useful again.

The client may propose an action, ask for clarification or do nothing. Receiving
an update does not require inference or grant permission to execute. Review
current task dependencies before proposing an action; admission, controller
claim and robot-local limits remain mandatory. Receipts and measured outcomes
return through subscriptions and can wake the next step. Avoid wake rules that
turn the client's own bookkeeping writes into a self-triggering inference loop.

## Agent runtime: Eve

Eve owns sessions, turns, model/tool execution, history, compaction, checkpoints,
session state and subagents. Do not implement a parallel Nemeia thread, turn or
step store, custom step lease or conversation engine. The durable Nemeia agent
identity is independent of an Eve session: resets and session expiry must not
erase mission progress, Unit assignments, execution receipts or pending messages.

### World channel

A custom `defineChannel` adapter uses a collision-safe continuation address made
from `[worldId, agentId]`. Do not create a session per mission, Unit or subscription.
Eve manages address ownership and serialized turns. Use `turnPolicy: "queue"`
for normal world updates; the default is steering. Eve may fold adjacent queued
deliveries into a turn, so one wake does not imply one turn. Filter and coalesce
before calling `send` rather than asking Eve to digest the perception stream.

Authenticate bridge deliveries and derive the agent principal from trusted
configuration. Enforce pause, scope and size/rate limits. Eve metadata and
continuation addresses route work; they do not grant world authority. A cancellation
of reasoning is not physical stop: revoke domain permissions and cancel physical
attempts through their own boundaries.

Eve's durable command inbox is not a general-purpose domain message bus. Retain
narrow bridge delivery bookkeeping: source event IDs, pending batch, accepted
delivery and explicit handling receipts. Do not acknowledge domain work merely
because `send` returned or a turn ended. Reconcile uncertain deliveries and
session resets without losing must-handle events; use explicit backpressure.
Choose that adapter persistence during implementation, without copying Eve's history.

### just-bash world access

Use Eve's native `justbash()` backend and its `customCommands`/`filesystem`
extension points. Mount `/world` as a bounded read-only projection; keep Eve's
`/workspace`, temporary and home paths intact for writable scratch work. Publish
a manifest plus immutable context files at a step boundary; the model can inspect
JSON with shell tools instead of receiving the whole world in every prompt.
Persist audit/retry-critical context separately from disposable sandbox files.

A registered `nemeia` custom command translates typed CLI input into the existing
world operations. It runs trusted host code, not a real binary in the interpreter.
Derive the principal from the active authenticated session on every command and
read; never from model-selected flags, environment variables or files. Keep
credentials outside the virtual filesystem. Writing a scratch action request does
not execute it; only the validated bridge/reducer boundary can admit it.

Enforce read-only semantics against all mutators, links, rename and traversal.
The stock Eve just-bash backend has no network isolation and rejects
`setNetworkPolicy`; do not claim a deny-all configuration exists there. Before
handling sensitive data or autonomous commands, constrain host egress or qualify
an adapted backend, bound execution/output, and test active-session identity
propagation through custom commands and filesystem hooks. Fail closed if the
bridge cannot establish the principal. Bash approval alone does not provide
per-command domain authorization.

Interrupted Eve steps can rerun; stable physical execution IDs and world/local
receipts still provide idempotency. Eve durability does not make robot effects
exactly once. Eve subagents are reasoning helpers, not automatically new Nemeia
agents with mission membership or Unit grants. Perception, focused Typesafe
workers and deterministic control need not run through Eve.

The website shows API sketches, not a deployed integration. Existing runtime
draft declarations are not being migrated in this planning phase.

References: [custom channels](https://eve.dev/docs/channels/custom),
[sandboxes](https://eve.dev/docs/sandbox),
[durability](https://eve.dev/docs/concepts/execution-model-and-durability),
and [context control](https://eve.dev/docs/concepts/context-control).

## Tracing and sensitive data

Use OpenTelemetry spans and OTLP export to Laminar for both LLM and ordinary
code. Trace perception, fusion, inbox batches, compiled context/evaluation/admission, reducer
requests, local execution boundaries and measured completion. Use W3C context
on trusted request paths; subscription delivery does not automatically inherit
the writer's trace. Correlate observation/context/execution references and use
OTel links when originating context is available. A trace ID is never an
authorization credential or a physical retry identity.

Use controlled content capture, including authorized sensitive application
data. Record the compiled step context, selected world projection, relevant
event/history content, model prompts/responses, tool results and selected image
evidence. This supports understanding decisions, not just measuring duration.
Exclude credentials, signed access URLs and unrelated private content across
inputs, outputs, errors and nested spans. Configure an approved destination,
restricted access, retention and byte limits before export. Use metadata-only
mode where content is not authorized. Keep continuous media and large point
clouds in evidence storage; attach selected samples or authorized references
and report truncation/expired evidence explicitly.

Laminar's optional PII redaction operates after ingestion on input/output
fields; it does not cover all metadata or rewrite old traces. Choose redaction
for the intended data policy instead of removing every sensitive field by
default. Evaluate self-hosting if sensitive data must remain local.

Use bounded asynchronous export outside reducers and local control. On queue
overflow or an unavailable exporter, drop diagnostics and count the loss;
never delay safe stop or a domain commit. Sample frequent perception, aggregate
control-loop metrics and attempt to retain diagnostic errors/outcomes within
resource limits. Required audit records stay in domain storage: Laminar's
sampled/redacted traces cannot replace world_event, local execution receipts,
or exact decision evidence. Tracing is not a dependency of physical action.

The checked tracing file shows content and metadata-only option profiles, not
an installed SDK or a complete privacy filter. Before enabling export, test secret canaries
in inputs, outputs, errors, URLs and nested spans; verify the outbound payload.
Test exporter outage/overload without delaying local stop or reducer calls.

## Verification scope

The existing twenty-table SDK scaffold, cancellation reducer, authorized execution
view and older static flow fixtures are type-checked against 2.10.1. The selected
website plan has twenty-two tables: three local-map/frame records replace the
per-agent subscription table, with explicit changes to world config and spatial
component keys. It renames the mission proof table to `mission_objective_progress`,
uses `MissionSpec.description`, and adds derived `MissionLog` and `ObjectiveProgress`
views without adding storage tables. The v0 WorldView, WorldMemory and awareness
are documentation-only designs that supersede the scaffold where they differ.
No runtime `.ts` implementation was changed for this planning update. Mission
validators/lifecycle, World Master operations, assignment/expiry reconciliation,
message authorization/retention, scheduling, remaining reducers and world views
are specified, not implemented. The illustrative
generated-client fragment requires bindings from the completed module.
Server integration, auth revocation, crash/retry tests, model evaluation and
hardware qualification remain implementation work.

## Platform references

- [Reducers](https://spacetimedb.com/docs/functions/reducers/): transactional module functions.
- [Views](https://spacetimedb.com/docs/functions/views/): read-only, caller-scoped projections.
- [Subscriptions](https://spacetimedb.com/docs/clients/subscriptions/semantics/): consistent initialization and atomic updates.
- [Durability and transient events](https://spacetimedb.com/docs/upgrade/): confirmed reads and event-table limits.
- [Table storage](https://spacetimedb.com/docs/tables/): typed, memory-resident tables with persistence.
- [License](https://github.com/clockworklabs/SpacetimeDB/blob/master/LICENSE.txt): deployment terms.
- [YOLOE](https://docs.ultralytics.com/models/yoloe/): prompting modes, tracking and export constraints.
- [SAM3](https://github.com/facebookresearch/sam3): segmentation and tracking.
- [Laminar OTLP](https://laminar.sh/docs/tracing/otel): standard tracing transport.
- [Laminar capture options](https://laminar.sh/docs/sdk/observe): function inputs, outputs and exceptions.
- [Laminar PII redaction](https://laminar.sh/docs/platform/pii-redaction): ingestion-time scope and limits.
- [OpenTelemetry context](https://opentelemetry.io/docs/concepts/context-propagation/): trusted propagation and baggage boundaries.
