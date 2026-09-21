# World storage implementation plan

Scope: durable world state, SpacetimeDB module boundaries, observation/map
commits, retained resources, authorized reads, and the delivery boundary to
Eve. “Confirmed” below means supported by the checked repository or
official platform documentation; “decision” is the selected implementation;
“hypothesis” needs qualification before rollout.

## Evidence, gaps, and selected inventory

Confirmed local evidence: `docs/protocol-spacetimedb.md:16-56, 167-182` makes
one database authoritative with read-only views and local-frame checkpoints.
The delta in `docs/world-view-content.mjs:118-183` removes
`agent_subscription`, frame-qualifies facets, adds locality, renames progress,
and adds map tables. The prototype in `contracts/spacetimedb/schema.ts` still
has 20 tables, old keys/roles, and no maps; `values.ts` lacks final locality and
`ActionIntent`. The page/protocol replace it without compatibility.

The exact selected 22-table inventory is:

`world_config`, `member`, `entity`, `pose`, `geometry`, `semantic`, `relation`,
`observation`, `track`, `action_binding`, `unit_control`, `mission`,
`mission_objective_progress`, `agent`, `mission_agent`, `unit_assignment`,
`agent_message`, `execution`, `world_event`, `spatial_frame`, `local_map`, and
`map_revision`. The exact 13 contract boundaries in
`docs/spacetimedb-content.mjs:30-44` are `WorldMemory`, `Missions`,
`WorldOperators`, `AgentCoordination`, `PerceptionIngress`, `ActionRequests`,
`ExecutionClaims`, `Cancellation`, `ControlFeedback`, `ExecutionCompletion`,
`WorldAdministration`, `LocalController`, and `EvidenceStorage`.

The 22 tables are the domain baseline, not an operational-table cap. Any later
delivery, quota, or resource metadata table needs an explicit operational
inventory delta and must not become domain authority.

Platform facts verified against SpacetimeDB 2.0 docs on 2026-09-19: tables are
memory-resident with disk persistence; reducers are isolated/atomic mutations;
private tables are server-only; caller views require indexed reads; bindings
cover functions/views; subscriptions are not replay. Event tables are
transient/unavailable to views, so they cannot replace `world_event`. The
prototype’s public full-scan `visible_executions` is not acceptable.
The repository records SpacetimeDB `2.10.1` as the candidate module/client
version; Q1 must pin a matching CLI/module/client or reject it before dependent
implementation.

## Smallest topology and ownership

**Decision:** start with one SpacetimeDB database owning one logical world on a
robot-adjacent host, plus one narrow authorized immutable-resource service on
the same host or trusted local storage boundary. Keep sensor/media streaming,
SLAM, association, Eve, and the robot-local controller outside transactions.
The database owns identity, evidence references, facets, missions, assignments,
executions, messages, and audit events. World Operators administer; Agents
propose; perception workers write only their Unit scope; controllers claim and
report only their Unit. No client snapshot, room/region subsystem, second world,
or global frame.

Keep base tables private and expose focused generated views for world/mission/
execution state, bounded event/observation history, maps, and resource metadata;
never build one scanning `WorldView`. An Agent with `readScope: world` can query
authorized data and mission records across the same world. Awareness relevance
narrows context, not permission; participation/recipient checks govern
coordination and private messages, not a fabricated per-Unit read partition.
Index identity, memberships, `(entityId, frameId)`, `(mapId, revision)`,
recipient/mission, event sequence/subject, and execution routing. Use canonical
keys plus bounded indexed reads where composite indexes are unavailable.
Regenerate bindings; derive identity server-side and treat messages/events as
untrusted data.

The context boundary must apply every requested scope before assembling a
context: the Agent’s world-level read permission, mission participation rules,
relevance/awareness selection, and bounded history ranges. If multiple native
subscriptions or views are involved, wait until all requested scopes are
applied, then assemble at the installed SDK’s transaction-consistent boundary.
If the adapter cannot prove that the resulting rows came from one consistent
committed state, context preparation fails as unsynchronized; it must not hand
Eve a partial WorldView or permit an action. Relevance may omit detail, but
cannot turn same-world read permission into per-Unit denial.

## Commit boundaries and lifecycle

1. **Observation/association packet.** A reducer authenticates `ctx.sender`,
   resolves `member`, checks producer package/session and derives `unitId`.
   Validate `localMapId`/frame locality; unlocated evidence remains attached
   without invented coordinates. The observation ID makes identical authenticated
   retries no-ops and changed duplicates conflicts. Track keys are producer
   identity + session + track ID; labels never merge entities. One transaction
   inserts observation, validates/allocates entity, updates newer facets, and
   audits. Test duplicate, stale facet, wrong locality, invalid geometry, and
   rollback.

2. **Frame/map packet.** Register an immutable `spatial_frame`; an origin reset
   always creates a new frame ID. `local_map` starts at revision zero and points
   to no head. A checkpoint supplies map/expected revision/parent, manifest
   digest, evidence coverage, layers, and optional mapper state. After resources
   are durable, the reducer validates ownership/root frame/parent, inserts
   immutable `map_revision`, advances `local_map`, and audits. Same-manifest
   retry is idempotent; an old head conflicts. Restore the last valid head and
   require fresh localization before spatial action.

3. **Resource packet.** Close the first resource protocol now with immutable
   disk under `world-resources/`, a quota, and explicit backpressure. The
   enrolled host ingester/resource gateway is the only component allowed to
   write that directory or call the resource-bearing reducer. It is trusted
   host code. For this single-host default, it holds
   one scoped SpacetimeDB credential per enrolled producer. Worker ingress is
   separately host-authenticated through local IPC or a gateway-spawned
   configured worker binding; workers do not present the module credential. The
   gateway maps that binding to the enrolled producer and Unit using configured
   binding plus member scope, validates the producer session at ingestion, and
   ignores any producer-supplied Unit or source string. It streams into a
   private temporary file, computes SHA-256/length, enforces schema/size/quota,
   flushes, atomically renames to the immutable ID, then calls the reducer with
   that producer credential; no custom signed receipt.

   Reducer validation in the selected TypeScript runtime:
   `ctx.sender` as the authenticated producer, its enrolled package and Unit
   scope, plus the validated producer session at ingestion, ID/idempotency,
   allowed schema, valid digest, bounded positive
   `byteLength`, local-map locality, and whether the exact reference is already
   committed. It cannot inspect the filesystem. The gateway’s durable-write
   assertion is trusted; a reducer failure leaves an unreferenced orphan for
   offline inspection. Module producer credentials are exclusive to the
   gateway; other clients retain their own scoped SDK access. This is the first
   topology trust boundary, not a reducer-level gateway distinction.
   Add only `byteLength` to `ResourceRef`; never store URLs, credentials, or
   signatures. Host locality is the one-host policy; multi-host evidence is
   deferred. If producer credentials cannot be safely held by the gateway, stop
   and explicitly evolve to an enrolled gateway role with bounded attribution;
   do not forward an unverified source string.

   Initial configurable gateway/world limits are: 256 MiB maximum per resource,
   20 GiB retained-resource quota, one resource writer at a time, 1,000 rows
   per history read, 100,000 `world_event` rows or 90 days, 250,000 observation
   rows or 30 days, 10,000 messages or 90 days, and 10,000 bridge batches or 30
   days. These thresholds are configurable capacity/cleanup policy, not
   performance or TTL-delete authority: referenced proofs, current state,
   supported checkpoints, and unhandled work remain retained regardless of age
   or row count. If safe reclamation cannot be proven, refuse cleanup and apply
   explicit backpressure rather than deleting or accepting dependent commits.
   Missing or corrupt bytes make reads, map restore, and dependent actions fail
   closed; never fabricate placeholders or success. No online GC of referenced
   objects: no-reference checks race with new references. Offline, quiesced GC
   stops writers, snapshots the world, traverses facets, proofs, map ancestry,
   observations, and pending events, then quarantines only unreachable files.
   Tombstone/lease GC is later.

4. **Event/message delivery packet.** `world_event` is an ordinary persisted
   bounded audit table, and `agent_message` is the durable addressed message.
   Their domain meaning and retention stay in the world. `world_event.sequence`
   is audit ordering only, not a subscription cursor; gaps are valid. The world-channel
   adapter owns a narrow durable bridge ledger outside the 22 domain tables:
   source event/message IDs, batch ID, accepted-to-Eve state, explicit handled
   outcome, retry count, and last error. It is not a second world, mission log,
   or authority. Eve reset loses neither domain records nor bridge progress.
   Reclamation is governed by the offline/quiesced world/resource reachability
   run; a bridge acknowledgement cannot make a referenced source collectible.
   If the bridge ledger is lost, resubscribe current state and issue only
   bounded authorized history reads for events, observations, and messages;
   return `history_gap` when the cursor predates retention, never inventing a
   wake or action. No unbounded history views. A per-recipient world ledger is a
   future evolution only if the bridge cannot meet recovery requirements.

## Task packets and qualification gates

* **W1 — final module/schema:** scope `contracts/spacetimedb/schema.ts`,
  `values.ts`, `agents.ts`, `missions.ts`, and generated-binding build output.
  Depends on the frozen delta. Tests assert 22 domain tables, no
  `agent_subscription`, composite keys, private bases, generated calls, and no
  World Master names; operational metadata needs an explicit delta. E0/Q3
  fixtures retain source-session registration and restart/new-session cases;
  gateway binding attribution is separate.
* **W2 — authoritative reducers:** scope the module reducer files and
  integration fixtures. Depends on W1. Tests cover auth, observation
  idempotency, CAS map commits, mission/execution atomicity, immutable domain
  terminals with append-only late physical evidence, and rollback.
* **W3 — views/awareness:** scope generated view definitions plus the world
  adapter only. Depends on W1/W2. Tests prove world-level read scope,
  message privacy, relevance not becoming per-Unit authorization, direct
  observations outside radius, one SDK-consistent context boundary, and no
  unbounded scan.
* **W4 — resource service/recovery:** scope the narrow EvidenceStorage service
  and resource adapter. Depends on W2. Tests cover digest/length/schema,
  gateway/reducer replay, quota backpressure, quiesced reachability, crash
  recovery, and missing/corrupt failures.
* **W5 — bridge coordination:** runtime owns the bridge ledger and Eve handoff;
  world-storage owns source event/message reads and retention signals. Depends
  on W2/W3. Tests cover coalescing, accepted-versus-handled state, Eve reset,
  duplicate delivery, revocation/pause, cursor gaps, and no action from
  unhandled/expired events.

## Blockers, defaults, and cross-workstream conflicts

Qualification before implementation: Q1 must pin or reject candidate
SpacetimeDB `2.10.1` with matching CLI/module/client and confirm binding/view
behavior; enroll the host gateway; define the SDK-consistent context boundary
and `history_gap` handling. The configurable initial byte/history limits above
are defaults, not vague blockers; Q1/Q3 may revise them with evidence.
Hardware localization, navigation, and throughput remain gates.

Defaults: one host/one world, private focused views, immutable resources first,
observation-first awareness, and no action without fresh locality/authority.
Conflict: runtime must not equate Eve turns with domain acknowledgements, and
storage must not add an Eve/thread schema; bridge progress belongs to the
runtime ledger. Navigation consumes a frame-qualified goal, not a global map.

## Primary references (accessed 2026-09-19)

* [Tables and persistence](https://spacetimedb.com/docs/tables/)
* [Reducers and transactional execution](https://spacetimedb.com/docs/functions/reducers/)
* [Transactions and atomicity](https://spacetimedb.com/docs/databases/transactions-atomicity/)
* [Views, caller context, and indexed access](https://spacetimedb.com/docs/functions/views/)
* [Table access permissions](https://spacetimedb.com/docs/tables/access-permissions/)
* [Subscriptions](https://spacetimedb.com/docs/clients/subscriptions/)
* [Generated client bindings](https://spacetimedb.com/docs/clients/codegen/)
* [Authentication](https://spacetimedb.com/docs/core-concepts/authentication/)
* [Event-table limitations](https://spacetimedb.com/docs/tables/event-tables/)
