# Nemeia with SpacetimeDB

Alternative implementation design, 2026-09-19. The existing protocol remains
available for comparison. This page does not deploy a database or control a
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

SAM3 supplies image/video segmentation and tracks; calibrated spatial processing
supplies measured geometry; ASR supplies transcripts; semantic models add
hypotheses. Validated association commits these to the same typed world.
Neither masks nor generated descriptions imply known 3D geometry or permission.

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
