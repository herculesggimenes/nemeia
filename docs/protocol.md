# Nemeia protocol

Status: canonical implementation target, 2026-09-15. Nemeia is a pre-production
prototype. This specification replaces the previous protocol designs outright.
There is no backward-compatibility requirement, old-format adapter, dual-write
period, or data migration. Existing experiments are evidence to learn from,
not APIs to preserve. This document does not claim the target is implemented.

Nemeia owns one world of entities, components, and relationships. Systems feed
evidence into that world. Actions declare requirements; the runtime derives
affordances and manages one execution for each requested action. Simulation and
hardware share this model. Hardware additionally requires a local control gate.

The checked TypeScript declarations are in
[`contracts/protocol/protocol.ts`](../contracts/protocol/protocol.ts). The
[example](../contracts/protocol/example.ts) uses those declarations directly.
The [review](./protocol-review.md) records the evidence behind these decisions.

## 1. Keep the foundations; reduce the deployment

| Foundation | Responsibility |
| --- | --- |
| World | Own one committed state and its journal cursor. |
| Entity | Give one thing an identity independent of its name or classification. |
| Component | Hold validated domain values, revision, and evidence when observed. |
| Relationship | Record a directed fact between existing entities. |
| Affordance | Explain whether an action's requirements hold at a particular time. |
| Action | Define intent, input/output schemas, and requirements; the executor binding selects the mode. |
| System | Ingest observations or propose validated changes as a trusted writer. |
| Event | Record the exact committed change, evidence, or execution transition. |

Start with one host process, one database when persistence is needed, and one
adapter per robot or simulator. Interfaces in the type file are ownership
boundaries, not required network services. Keep the control gate near the driver
with independent timers. It may be a separate process for hardware deployments.

The required public surface is `WorldService`. `ObservationSink` and
`WorldWriter` are trusted ingestion boundaries. Executors and drivers are local
plugins. `Journal` is a storage port. `ResourceStore` is needed only when bytes
are retained. Mission grouping, approvals, registry lifecycle, attention,
reports, replay rendering, and prediction are optional modules.
An agent is a client: it reads the world, selects an action and follows its
execution. Its conversation, planning and tool-call loop can use an existing
agent runtime. Those concerns do not need another Nemeia service contract or
permission to call the driver. A service interface does not imply an RPC hop.

## 2. Naming, values, schemas, and identity

Use camelCase for TypeScript and JSON, snake_case for SQL columns. This is a
local convention, not a claim that casing is a robotics standard. All core object shapes are closed;
reject unknown fields at write boundaries. Extension payloads must name an
installed schema and exact version. Unknown read-event versions return an
explicit unsupported-version error; they are never silently discarded by a reducer.
CloudEvents envelope extensions remain permitted by that standard; the closed
shape rule applies to Nemeia's authority-bearing inputs and domain payloads.

Use opaque globally unique IDs for entities, events, observations, requests,
and executions. Event IDs survive replication; cursors describe position in one
world's log. Never turn an event cursor into an entity identity. Label changes
do not rename entities. Relationship identity is the tuple
`(subjectId, predicate, objectId)`, represented structurally or with a composite
database key. IDs may contain punctuation without causing tuple collisions.

An action has one `{name, version}` reference. An executor has one immutable
package reference including its content hash. Input, output, component, and
extension schemas use `{name, version}`. Installing a different schema under
the same reference is an error. Registered component names are namespaced;
`ComponentValues` can be extended by packages with a corresponding schema.

JSON permits finite numbers, strings, booleans, null, arrays, and plain objects.
Reject NaN, infinity, undefined, functions, class instances, invalid Unicode,
duplicate object keys, and numbers outside their schema's range at ingress.
Integer counters must be safe integers. Zero is a value, null is known absence
or unknown where explicitly declared, and omission follows the exact union.

Use a maintained JSON Schema 2020-12 implementation at external boundaries.
Generate wire schemas and client types from one schema source during implementation;
replace the handwritten validator. The TypeScript files
are checked design artifacts, not runtime validation or a claim of wire conformance.

## 3. Geometry and evidence

`box3`, `box2`, `pointCloud`, and `mesh` are Nemeia union tags. Their semantics
are explicitly mapped to external conventions; no external standard defines
this exact union. A pose is a reusable value, not a shape or collision volume.

| Value | Required meaning |
| --- | --- |
| `Pose3` | Position in meters; unit quaternion `[x,y,z,w]`. |
| `box3` | Coordinate frame, center pose, full positive dimensions in meters. |
| `box2` | Exact image frame, center and full dimensions in pixels, rotation in radians. |
| `pointCloud` | Coordinate frame and a stored resource with an explicit payload schema. |
| `mesh` | Coordinate frame, pose, and a stored resource defining vertices and topology. |

The default axes follow ROS REP-103: right handed, body x forward/y left/z up;
camera optical frames use x right/y down/z forward. Angles use radians. World
frame names follow REP-105 where applicable: `odom` is locally continuous;
`map` can jump after localization corrections. Frame names are scoped within a
world. A multi-robot adapter must namespace colliding device frame names.

`sizeM` and `sizePx` have strictly positive entries. The quaternion norm must be
within 1e-6 of one. Never fill absent geometry with a default obstacle box.
Missing pose, frame conversion, or size produces unknown geometry. A prediction
may use an explicitly labeled prior, with its own provenance, but must not
report that prior as a sensor measurement.

Coordinate conversion must use the transform sample for the acquisition time.
Retain those samples on the observation, including the exact parent/child IDs.
A source version alone cannot reproduce a moving transform. A `box2` cannot
become `box3` without calibrated depth or another documented inference.

`FrameRef` identifies transient input by stream, session, sequence, and capture
time. It does not promise replayable bytes. `ResourceRef` identifies retained
bytes and their format schema. Store images/clouds before acknowledging a
durable resource reference; keep storage paths and signed download URLs behind
the store. Missing or expired bytes are explicit errors. Retaining an
observation does not automatically require retaining every source frame.

## 4. Time, association, and one world

`observedAt` is acquisition time mapped into the world's clock domain by the
trusted adapter. `recordedAt` is journal receipt time. A poll or replay never
refreshes acquisition time. In live systems, reject or quarantine evidence
whose clock error exceeds the configured bound; never make a future timestamp
fresh by clamping its age to zero. Local deadlines use monotonic elapsed time.
Simulation uses an explicit simulation clock; it is never mixed with live time.

Semantic and geometric samples retain independent times. Freshness is
`evaluationTime - observedAt`, checked independently against each requirement.
A slow label update must not refresh a stale location. Stored snapshots contain
timestamps, not changing `freshnessMs` values. Replaying the same committed
events produces the same state; availability also needs an explicit evaluation
time and the installed action versions.

Association belongs to a trusted perception system. A track is scoped by the
producer's `instanceId`; restarting tracking uses a new instance. Without a
track or accepted spatial association, create a new candidate identity. Never
merge all detections with the same label. Record association decisions and
the resulting `Change[]` so replay does not rerun today's tracking model.
`world.changed` includes explicit observation-to-entity `Association[]` alongside
the changes. Rebuild track bindings from these decisions plus recorded
observation source/track IDs; do not ask the perception model to associate again.
Ordinary non-perception changes use an empty association list.

Partial observations update only their supplied facets. Geometric observations
can create an unclassified entity. Explicit `supersedes` observation IDs carry
fusion provenance; do not infer fusion from a source-name prefix. Replacement
updates recompute the affected belief once and retain the old evidence in the
journal. Invalid or unknown superseded IDs cannot silently discard evidence.

`Scene` is a read view over world entities and their observed components.
`RobotWorldView` is a presentation mapping of the same snapshot. Display strings,
colors, panel names, and browser `MediaStream` handles never become component
values used by action checks. World Runtime lifetime follows the world session,
not a React render.

## 5. Atomic changes, events, and recovery

Use CloudEvents 1.0 JSON envelopes, not a second custom event header. `id`,
`source`, `type`, and `specversion` follow the standard; this profile also requires
`time` and JSON `data`. `source` is a URI bound to the authenticated producer.
Nemeia's versioned event types define only `data`: world, producer package,
causal event IDs, and a typed payload. The journal wraps the unchanged event
with its local `cursor` and `recordedAt`. CloudEvents does not supply ordering,
durability, deduplication, or exactly-once delivery; the journal supplies the first
three with the rules below. Require globally unique IDs in this profile, stricter
than CloudEvents' source-plus-ID identity rule.

A writer submits a complete change batch with its expected cursor. Validate
all entities, component schemas, component ownership, versions, and relationship
endpoints against the prospective final state before committing anything.
Reject a stale cursor with `conflict`; the writer must reread and recompute.
There is no implicit deep merge. `entity.put` replaces an entity;
`component.set` replaces one component; removal has its own operation.

The journal transaction persists the command receipt and all decision events
atomically. Apply committed changes to memory only after that transaction
succeeds. A failed batch produces no partial world changes. Entity removal also
removes incident relationships; replay implements the same cascade. Component
versions advance on changes and never reset while that entity identity exists.
Removed entity IDs are not reused.
Installed packages declare component write ownership; installation rejects
conflicting owners. A projector writes only its registered components. An
entity replacement cannot bypass another owner's components. Use individual
component changes for ordinary updates.

For v1, serialize commits per world. All events in one decision are visible
together. Snapshot reads return a committed state and its cursor atomically;
`changes(after)` resumes after that cursor and includes removals. Paginated
events use exclusive cursors, limits from 1 to 1,000, and an explicit `hasMore`.
`next` advances to the last scanned position, including when no event matched
the filter. Invalid, wrong-world, or expired cursors are errors, not cursor zero.
Authorization filtering cannot expose another principal's payloads or counts.
Each commit has a position; its events have ordinals. Public cursors point only
to complete commit boundaries. Event pages never split a commit: enforce at most
1,000 events per commit and treat the requested page limit as a target, extending
it to finish the last included commit. All events of that commit carry the same
resume cursor. A change batch too large for the configured response bound returns
an explicit snapshot-required problem, never an incomplete delta presented as current.

Keep each original event ID and timestamp when bridging local control events;
assign only a new receiving cursor/recorded time. Source attribution is checked
by the authenticated adapter. Record high-level decisions and state changes
durably. High-rate media and control diagnostics may have a separate bounded
recorder with declared loss counts; do not fsync every camera frame in the
control loop.

Read-only replay applies recorded changes and execution states. It never
dispatches hardware commands. Resimulation is a separate operation with pinned
inputs, transforms, algorithm, and engine. Only claim bit-identical replay for
deterministic reductions and retained output bytes. Do not claim that every
physics engine or model inference is bit-identical across machines.

## 6. Action execution and retries

Discovery matches actor and target requirements and returns structured reasons.
It is a hint, not permission or a promise of future availability. Dispatch
validates actual input, explicitly checks target cardinality, resolves the
installed executor, repeats requirements and policy, and pins the relevant
component versions. Clients name target identities; trusted code creates pins.
Policy owns confidence/freshness thresholds. A caller cannot lower them.

Use one execution record and one execution ID. `requestId` deduplicates the
initial dispatch; the server allocates the execution ID once and stores it in
the receipt. The states are:

```text
awaitingApproval → accepted → running → succeeded
       │              │          ├──→ failed
       ├──→ rejected  ├──→ failed
       └──→ cancelled └──→ cancelling → cancelled
                                 running → cancelling → cancelled | failed
```

`awaitingApproval` occurs only when an approval module requires it. Malformed
or unauthorized requests return a `Problem` before allocating an execution.
Valid requests denied by domain policy may create a `rejected` execution for
audit. Terminal states are immutable. A cancellation race returns the terminal
state if completion already committed; otherwise completion cannot overwrite
`cancelling`. Timeouts are failures with a typed reason, never success.

The authenticated principal, operation, world, canonical body, and request ID
define the idempotency receipt. Enforce a unique `(worldId, requestId)` key and
check authorization before returning any cached result. Same key/body/principal
returns the original response; changed input returns `conflict`. Concurrent
duplicates share the transaction. Retain receipts for the world's retention
lifetime. Expired identities cannot be reused. All command endpoints have this
rule; cancel and stop are naturally idempotent state requests.
After authentication, look up an existing receipt before checking the expected
cursor or current action requirements. An exact retry still returns its original
response even if the world has advanced; current execution state is a separate query.

Persist `accepted` before starting an executor. For v1, allow one physical
execution per robot; a second request gets `unavailable`/busy, never an invisible
queue. State-mode executions use optimistic commits. Physical-mode executions
hold no world transaction across IO; their measurements update the world
through ingestion. Hardware failures cannot roll back physical effects.

An executor returns one Promise result and emits bounded progress or observation
updates through a host callback. The host owns state transitions and aborts.
`state` results may propose changes. `physical` results carry output only;
they cannot optimistically move an entity to its requested position. The host
checks result schema and completion evidence before committing success.
The result kind must match the installed executor mode. The example's approach
distance is ground-plane distance to the tracked target center, not clearance
from its box surface. Obstacle/path clearance remains a separate admission and
continuous control check; a semantic label alone never makes a path safe.

On restart, reconstruct state from the journal/checkpoint. Accepted-but-unstarted
state actions can be retried under their original identity. Never automatically
redispatch uncertain physical actions: query the local gate's durable execution
receipt, enter safe state if needed, and resolve as failed/unknown if evidence
cannot establish the outcome. This protocol promises deduplicated decisions,
not exactly-once physical actuation across a crash.

## 7. Local physical control

The local gate is required for physical actuation even when governance is off.
It owns actor exclusivity, bounds, watchdog, cancellation, and stop. Human input,
agent actions, and autonomous executors share this boundary. Opening a UI panel
is a UI interaction, not a world action or evidence that a robot moved.

The initial control profile is planar velocity (`vxMps`, `vyMps`, `yawRadps`).
This describes three planar channels, not free 3D translation.
Limit linear speed by vector norm, and yaw by absolute magnitude, using the
intersection of host policy, local caps, and device caps. These are commanded
velocity bounds; claims about measured physical speed need measured feedback.

Sequence numbers start at one per control session. An identical duplicate of the latest command
returns its recorded ack without extending the watchdog; a changed duplicate,
older sequence, unknown field, or non-finite value is rejected. Only a new valid
command renews liveness. There is no unbounded queue: a superseded pending
command gets an explicit cancellation result. A successful submit returns after
the driver sends the clamped command, with requested and sent values. Device ack
is separately labeled; it never proves that the action goal was achieved.

The gate starts its first-chunk watchdog when it opens the session. It uses
monotonic deadlines for watchdog and maximum duration, checks the stop latch
each tick, and drives safe state on loss of liveness, expired duration, stale
device telemetry, fault, cancellation, or host connection loss. The last command
must not survive a local supervisor restart. Driver transport polling must not
manufacture fresh heartbeats from a cached device sample.

Stop sets the latch before awaiting driver IO. It remains available when the
world journal, perception, approval service, or agent is unavailable. Report
`latched` separately from safe-state confirmation; failure to confirm remains
visible. Startup defaults to latched/unknown until reconciliation. Clearing the
latch requires an authenticated operator and fresh device status; it never
restarts the old action. Normal completion enters safe state and releases the
session without setting the emergency latch.

Native actions remain an explicit driver extension with their own schema,
interruptibility, completion signal, and deadline. Do not treat a long native
action as an instantaneous one-chunk stream. Only enable a native action in the
public catalog once its execution and stop semantics have a conformance fixture.
The v1 example and control-session interface cover planar velocity only.

## 8. Optional governance and remote execution

Admission policy is a hook around the same action request. Approval adds a
pending state to that execution; it does not introduce another Run state machine.
Mission is optional execution grouping. Package installation is configuration
until independent users and deployments require a registry API. Action and
component schemas remain pinned regardless of deployment size.

For remote control, a signed grant must bind execution, robot, executor digest,
audience, controller epoch, expiry, limits, and signing key ID. Journal issuance
before dispatch; durably record grant consumption before starting actuation.
An exact transport retry returns the same admission receipt without restarting
motion. Reject a different grant for a consumed execution. Restart changes the
controller epoch; old grants cannot open new sessions. Keep consumption records
at least until expiry plus the configured skew bound and recovery window.

Use a maintained JOSE implementation: compact JWS JWT with EdDSA/Ed25519,
protected `kid` and `typ: nemeia-control+jwt`, and verified issuer, audience,
expiry, and private claims. Configure the allowed algorithm and trusted key
set locally; never trust a token's key URL or choose algorithms from its input.
JWT times use NumericDate seconds, unlike domain timestamps. This avoids
inventing a signed-envelope format. Reject unknown authority claims in this
profile and use a distinct validation path from login/access tokens. JWS signs
the encoded bytes and does not require canonical JSON. Use a tested RFC 8785
library only for request/content fingerprints that actually need canonicalization.
The optional remote adapter verifies the grant and converts it to local
`ControlAdmission`; raw grants are not a new action meaning. Sensitive sensor
access and network/sandbox permissions belong to the executor host's pinned
launch configuration and authenticated channel, not to a caller-editable request.

## 9. Attention, prediction, and projections

Start attention with `events(after)` plus deterministic formatting. The client
persists its cursor only after consuming a page. If durable delivery is needed,
store exact bytes and cursor movement in one transaction with a delivery ID;
retry returns the same delivery. A log cursor alone cannot reconstruct an LLM
summary. Avoid a custom expression language for a few filters: types, execution
scope, severity, and timeout cover the initial need. Do not call a small custom
parser CEL-compatible without a CEL conformance suite.

Replay, reports, and anomalies use the same execution IDs and event identities.
Count unique terminal executions, not both `run.completed` and an authorization
completion. Projection caches have an applied cursor and algorithm/schema pin.
They consume all pages, resume incrementally, and never stop silently after a
fixed 10,000-event prefix.

Prediction is a pure query over an explicit world snapshot, with algorithm and
engine pins. Its result names geometry coverage and uncertainty. The current
AABB checker is an approximation, not a Box3D engine integration. Keep predictions
advisory until the specific adapter and geometry class are validated.

## 10. Storage and transport

The durable core needs two tables: `events` and `command_receipts`. World state
and executions reduce from events; add `world_checkpoints` and `execution_index`
only for startup/query cost. Add `resources` only for retained bytes and
`deliveries` only for durable attention. Physical hosts additionally need local
`control_state` and `control_receipts`. The page lists every column and constraint.

The event cursor is a per-world ordered commit position, serialized as an opaque
token. The SQL implementation locks a world writer and allocates committed order
inside the transaction. Do not assume auto-increment allocation is commit order
under concurrent writers. `command_receipts` has the unique retry key, principal,
request fingerprint, original response, and committed cursor in the same
transaction. Checkpoints are disposable acceleration; events and receipts are
authoritative in the durable profile. Memory-only simulations advertise that
their identities and cursors expire with the world session.

HTTP is one adapter: `GET /world`, `GET /world/changes?after=`,
`GET /affordances?actorId=&targetId=`, `POST /executions`,
`GET /executions/{id}`, `POST /executions/{id}/cancel`, `GET /events?after=`.
Trusted ingestion uses `POST /observations`; world writes are host-internal.
The physical profile adds `POST /robots/{id}/stop` and `/clear-stop`.
Approval optionally adds `POST /executions/{id}/decision`.
Document this adapter with OpenAPI 3.1.1 and the same JSON Schema definitions;
generate clients rather than maintaining handwritten duplicate DTOs. These
host-side interfaces receive `RequestContext` from authentication middleware,
not caller-controlled JSON. The service instance fixes the world scope.

Use 400 invalid, 403 forbidden, 404 notFound, 409 conflict, 503 unavailable,
504 timeout, and 500 internal; authentication adds 401. Expected failures use
RFC 9457 `application/problem+json` on HTTP and
`Result` in the SDK. An accepted asynchronous execution returns 202 and its ID;
already terminal responses use 200. Transport loss leaves the caller uncertain:
retry the same request ID. CLI is a formatter over the same adapter and adds no
business policy. An SSE/WS convenience stream must preserve the journal cursor
and reconnect semantics; polling is sufficient for v1.

## 11. Reuse standards and operating-system mechanisms

The default stack is a modular host, existing robot adapters, a maintained
schema validator, and a transactional database. Do not build another scheduler,
message broker, signature format, schema engine, or sandbox. Add a separate
process only for isolation or a measured deployment constraint; an interface
is not a reason to create a microservice.

| Concern | Basis | What Nemeia adds |
| --- | --- | --- |
| Units and axes | [ROS REP-103](https://raw.githubusercontent.com/ros-infrastructure/rep/master/rep-0103.rst) | Explicit field units and validation. |
| Mobile coordinate frames | [ROS REP-105](https://raw.githubusercontent.com/ros-infrastructure/rep/master/rep-0105.rst) | World scoping and retained transform samples. |
| Oriented boxes | [ROS BoundingBox3D](https://raw.githubusercontent.com/ros-perception/vision_msgs/ros2/vision_msgs/msg/BoundingBox3D.msg), [BoundingBox2D](https://raw.githubusercontent.com/ros-perception/vision_msgs/ros2/vision_msgs/msg/BoundingBox2D.msg) | JSON union tags and evidence references. |
| Pose | [ROS Pose](https://raw.githubusercontent.com/ros2/common_interfaces/rolling/geometry_msgs/msg/Pose.msg) | Explicit containing frame and units. |
| Schema validation | [JSON Schema 2020-12](https://json-schema.org/draft/2020-12) | Closed registered core and package schemas. |
| HTTP description | [OpenAPI 3.1.1](https://spec.openapis.org/oas/v3.1.1.html) | World and execution resource routes; generated client bindings. |
| Event envelopes | [CloudEvents 1.0.2](https://raw.githubusercontent.com/cloudevents/spec/v1.0.2/cloudevents/spec.md) | Versioned domain payloads, causal links, and a separate journal cursor. |
| API failures | [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457.html) | Stable problem-type URIs; no parallel error envelope on HTTP. |
| Long-running actions | [ROS 2 actions](https://design.ros2.org/articles/actions.html) | One execution identity, feedback, cancel, and terminal result. Approval is a pre-admission extension. |
| Sensor delivery | [ROS 2 QoS](https://raw.githubusercontent.com/ros2/ros2_documentation/jazzy/source/Concepts/Intermediate/About-Quality-of-Service-Settings.rst) | Explicit depth, loss, freshness, and liveness requirements per stream. |
| Durable decisions | [PostgreSQL constraints](https://www.postgresql.org/docs/current/ddl-constraints.html), [ON CONFLICT](https://www.postgresql.org/docs/current/sql-insert.html) | Transactions and unique retry keys; no homegrown consensus protocol. |
| Remote event publishing | [Transactional outbox pattern](https://microservices.io/patterns/data/transactional-outbox.html) | Publish committed events at least once; consumers deduplicate by event ID. No broker required locally. |
| Signed remote grants | [JWT](https://www.rfc-editor.org/rfc/rfc7519.html), [EdDSA in JOSE](https://www.rfc-editor.org/rfc/rfc8037.html), [JWT security guidance](https://www.rfc-editor.org/rfc/rfc8725.html) | Execution/robot/executor/epoch/limits claims and durable admission receipt. |
| Request fingerprint | [RFC 8785 JCS](https://www.rfc-editor.org/rfc/rfc8785) | Hash the canonical operation/body/principal/world; not a custom signing scheme. |
| Worker RPC, if needed | [JSON-RPC 2.0](https://www.jsonrpc.org/specification) | Methods for executor start, progress, cancellation and result; local calls need no envelope. |
| Linux isolation | [bubblewrap](https://github.com/containers/bubblewrap), [Landlock](https://docs.kernel.org/userspace-api/landlock.html) | Least-privilege launch profile; use OS enforcement, not a JavaScript sandbox simulation. |
| Distributed tracing | [W3C Trace Context](https://www.w3.org/TR/trace-context/) | Propagate standard tracing metadata; domain causation remains explicit event IDs. |

ROS action states map as follows: accepted → `accepted`, executing → `running`,
canceling → `cancelling`, succeeded → `succeeded`, canceled → `cancelled`,
aborted → `failed`. These are semantic mappings, not ROS wire compatibility.
The local action adapter can delegate navigation to a qualified ROS action
server instead of rebuilding its planner/controller. Do not impose ROS on the
existing Go2 WebRTC path; adapt its device transport at the same boundary.

Choose bounded latest-sample delivery for live perception, with loss counters;
choose durable ordered delivery for decisions and results. ROS/DDS QoS is a
transport option, not a replacement for the decision journal. No distributed
transaction spans robot IO. Use an outbox only when crossing a remote boundary,
and do not claim exactly-once physical effects from broker delivery settings.

The host is a supervisor, not a new operating system: it owns process lifetime,
resource cleanup, permission configuration, deadlines and crash reconciliation.
Use systemd or the existing deployment supervisor for restarts and resource
limits; use OS sandboxing for untrusted executors. The repository already has a
bubblewrap path: make the required isolation profile explicit and fail closed
if it is unavailable, rather than adding a new sandbox framework. Terminate
process trees on timeout. Trigger the local stop path before waiting for
untrusted cleanup. A Node event loop is not a hard-real-time safety guarantee;
device watchdogs and robot qualification remain necessary.

These are mappings and selected conventions. Nemeia JSON is not a ROS message,
and a resource reference is not the `PointCloud2` binary layout. Each adapter
must state its conversion and resource encoding. No claim of full ROS, CEL,
physics-engine, or wire-schema conformance is implied by these declarations.

## 12. Implementation and acceptance

1. Replace the old contracts. Generate schemas, fixtures, and client bindings
   for these types; ensure the page renders the same declarations. Do not add
   compatibility adapters or preserve prototype databases.
2. Give the World Runtime one session lifetime, typed components, atomic batches,
   stable event IDs, and durable request receipts. Adapt the UI projection.
3. Implement observation timestamps, association, facet merging, transforms,
   and an incremental world projector. Remove the separate Scene authority.
4. Bind the same action catalog to simulation and the local physical gate.
   Migrate direct/manual motion through it before autonomous motion adoption.
5. Add mission grouping or approval only where a consumer requires it. Implement
   attention/report/replay over the common journal. Delete replaced prototype
   modules as each vertical slice lands; do not carry their wire formats forward.

Acceptance cases: two same-label objects remain distinct; geometry-only and
semantic-only updates compose; replay does not refresh evidence; stale/future
evidence blocks the relevant action; an invalid effect rolls back the complete
batch; duplicate dispatch across concurrent calls/restart does not start twice;
changed-body retries conflict; a snapshot resumes without gaps; projections pass
the old 10,000-event boundary; cancellation wins its race once committed;
watchdog/deadline are failures; stop works with storage unavailable; unknown
physical outcomes are never automatically repeated; and JCS official vectors pass.

The remaining implementation work is deliberate: runtime wire validation,
durable transactions, robot-host isolation, actual perception association, and
hardware qualification. This revision specifies those obligations and removes
unnecessary services; it does not claim the existing code already satisfies them.
