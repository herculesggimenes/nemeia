# Nemeia with SpacetimeDB

Selected implementation design, 2026-09-19. This is the only protocol presented
on the architecture site. This page does not deploy a database or control a
robot. The accompanying module examples target SpacetimeDB 2.10.1 and are
type-checked; type checking is not a server integration or hardware test.

## Ownership

One database owns one world. Its typed tables hold current entities, components,
relationships and executions. Reducers validate and commit domain decisions;
subscriptions synchronize read-only client caches. Do not maintain a second
mutable JavaScript world and synchronize it back into the database.

Perception, inference, navigation and physical execution run outside the
database. The robot-local controller owns motion, command bounds, monotonic
watchdogs, stop and durable admission receipts. A database outage must not
prevent local stop. No database transaction spans robot IO.

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
versions and reject late, superseded or out-of-option answers. Admission checks
the task, candidates, relevant dependencies, freshness and policy. A decision
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

## Tracing and sensitive data

Use OpenTelemetry spans and OTLP export to Laminar for both LLM and ordinary
code. Trace perception, fusion, decision context/evaluation/admission, reducer
requests, local execution boundaries and measured completion. Use W3C context
on trusted request paths; subscription delivery does not automatically inherit
the writer's trace. Correlate observation/context/execution references and use
OTel links when originating context is available. A trace ID is never an
authorization credential or a physical retry identity.

Default to reviewed metadata, not content. Disable automatic input/output and
unreviewed library capture. Sanitize exception events, status text, URLs and
child attributes before export. Never export raw sensor media, full world
snapshots, transcripts, prompts, credentials or signed media URLs by default.
Laminar's PII redaction operates after ingestion on input/output fields; it
does not replace local filtering, cover all metadata, or rewrite old traces.
Content debugging requires an approved destination, restricted access and a
retention policy. Evaluate self-hosting if sensitive data must remain local.

Use bounded asynchronous export outside reducers and local control. On queue
overflow or an unavailable exporter, drop diagnostics and count the loss;
never delay safe stop or a domain commit. Sample frequent perception, aggregate
control-loop metrics and attempt to retain diagnostic errors/outcomes within
resource limits. Required audit records stay in domain storage: Laminar's
sampled/redacted traces cannot replace world_event, local execution receipts,
or exact decision evidence. Tracing is not a dependency of physical action.

The checked tracing file is illustrative metadata/options, not an installed
SDK or a complete privacy filter. Before enabling export, test secret canaries
in inputs, outputs, errors, URLs and nested spans; verify the outbound payload.
Test exporter outage/overload without delaying local stop or reducer calls.

## Verification scope

The SDK schema, cancellation reducer, authorized execution view, design
interfaces and static flow fixtures are type-checked against 2.10.1. Remaining
reducers and world views are specified, not implemented. The illustrative
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
