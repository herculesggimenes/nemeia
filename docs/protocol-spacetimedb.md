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
class hierarchy. An offline Unit remains a Unit but is unavailable. This slice
specifies one installed action, `approach@1`; other devices need their own typed
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

- Visibility: the World Master's `agent.readScope` grant; subscriptions narrow
  interest within it. Participation exposes that mission, its credits and shared
  execution outcomes, not all world entities. Scope must include needed evidence.
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

## Missions and objectives

The reference patterns come from open-source MMO server implementations, not
claims about the commercial games' internal systems. AzerothCore separates
[quest definitions](https://www.azerothcore.org/wiki/quest_template) from
[per-character progress](https://www.azerothcore.org/wiki/character_queststatus).
[EQEmu task activities](https://docs.eqemu.dev/server/task-system-guide/) define
typed goals, counts, optional activities and ordered steps.
[TrinityCore QuestObjective](https://github.com/TrinityCore/TrinityCore/blob/master/src/server/game/Quests/QuestDef.h)
has distinct identity, type, target and amount fields. We adopt the separation
of definition, progress and objective credit, not their game-specific schemas.
This is a Nemeia design, not an established universal mission protocol.

### Definition and identity

A mission is one accepted, immutable specification plus a durable lifecycle.
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

### Objectives and credit

An objective has an ID, explanatory text, all-of dependencies, an optional flag
and a typed criterion. Validate 1–32 nodes, unique IDs, existing references,
acyclic dependencies and at least one required objective. Optional objectives
cannot gate required ones. Independent objectives may progress in parallel.
The first slice has two criteria:

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

`mission_credit` stores one immutable proof per `[missionId, objectiveId]`.
Check World Master or active participant authority and evidence access; load authoritative domain records instead
of accepting caller-provided progress. The first valid proof wins. Redelivery
returns the existing credit without replacing evidence. Validate and record the
credit, audit event and any transition to closing in one transaction. Retain
proof records for the supported mission audit lifetime; a missing reference
cannot grant new credit. Derive ready/completed IDs from the specification and
credits, with no additional mutable progress table. A client inbox acknowledgement
and a mission objective credit are different operations.

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

Goal progress uses mission and credit tables; teamwork adds participation and
assignment records without per-agent mission copies. Counted objectives need an
explicit distinct-item identity and deduplication policy before addition.
Dynamic branches, nested missions, mission pause/resume, rewards,
reset calendars and automatic mission chains are intentionally deferred.
The typed schema and fixtures specify this design; mission reducers, validators,
authorized views, scheduler and crash/race tests are not implemented here.

## Client subscriptions

A subscription selects its mission, credits and relevant authorized world changes.
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

Each logical client keeps independent progress. Coalesce replaceable state by
entity/component, but retain must-handle events such as user instructions, tool
results and important transitions, including messages received outside world
subscriptions. Latest state does not reconstruct events
that occurred between steps. One client consuming an event must not consume it
for every other client.

Wait until the required subscriptions are ready. Prepare context immediately
before a reasoning step: reserve an exact event
batch at a consistent committed-cache boundary, detach the relevant world,
include the authorized goal/constraints, available actions, execution state and
relevant history, then freeze the input with a context ID. Preserve acquisition
times and unknown values. Bound tokens and retained bytes; defer excess events
without silently discarding required meaning. While inference runs, new updates
remain pending for another step. The prompt already in flight does not mutate.
After a disconnect, resynchronize and review dependencies before proposing new
physical work.

Start with one active reasoning step per logical agent. Wake on meaningful
changes, user input, tool completion or deadlines, not every frame. Task
cancellation supersedes work immediately; reject late results even when model
cancellation is unavailable. Local stop never waits for this queue. UI, rules
and faster model workers may consume the same world at different cadences.

An agent may have several `agent_subscription` policies, each with scoped interests,
allowlisted wake triggers, priority and a minimum interval between eligible steps.
`maxWaitMs` bounds desired batching after useful work arrives, subject to that
interval and available compute; it is not a latency promise. All policies feed
one agent inbox and a durably leased step across worker replicas. They are rate
caps and wake rules, not independent inference loops or mandatory polling.

Worker scheduling states are `idle` (no useful work), `ready` (awaiting budget),
`thinking` (one active step), and `waiting` (execution/resource/message/condition).
Administrative pause and connection health are separate. Keep availability and
deadline subscriptions active when all Units are unavailable; avoid repetitive
inference. Coordination, analysis or help requests can still make work useful
without any Unit. General AgentContext can span zero or multiple missions; the
focused DecisionContext used by TargetSelector is intentionally narrower.

The client may propose an action, ask for clarification or do nothing. Receiving
an update does not require inference or grant permission to execute. Review
current task dependencies before proposing an action; admission, controller
claim and robot-local limits remain mandatory. Receipts and measured outcomes
return through subscriptions and can wake the next step. Avoid wake rules that
turn the client's own bookkeeping writes into a self-triggering inference loop.

Durable clients persist required events, active-step identity, outcomes and
acknowledgements in a worker store. Complete only after verifying the durable
handled outcome; acknowledge the exact reserved event IDs, not later arrivals.
Delivery retries use the same identity. Releasing a failed/superseded step
retains unhandled events and invalidates late completion; re-evaluation gets a
new step ID. Reconcile durable outcomes before retrying physical actions.
Queue limits require explicit backpressure/admission errors, never silent loss
of required messages. A replaceable-state key overflow can instead request a
fresh projection. Reuse domain audit events only when they actually contain
the required occurrence and retention covers the consumer's progress.

AgentSteps is a worker-side design interface. Its persistent schema and crash
recovery are not yet implemented or included in the world tables.
No separate message broker or concurrency framework is required for this first slice.

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

The twenty-table SDK schema, cancellation reducer, authorized execution view, design
interfaces and static flow fixtures are type-checked against 2.10.1. Mission
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
