# Nemeia implementation plan

> Historical planning handoff. For current implementation state and measured
> gate evidence, read [EXECUTION.md](EXECUTION.md). For setup, qualification
> and runtime configuration, read [RUNBOOK.md](RUNBOOK.md). The planning-only
> restrictions and future-tense tasks below describe the original planning
> pass; they are not the current execution status or authorization record.

This is an implementation handoff, not an implementation. The architecture page
defines the product model; this plan defines work boundaries, dependency order,
qualification gates and the evidence required to call each slice complete.

Planning baseline: repository `c639098fd5afb7c27ec1dd364ec33f41d8b83064`.
Five GPT-5.6 luna planning subagents scoped the work; the coordinator reconciles
their proposals here. No runtime changes, dependency installs, deployments or
robot operations belong to this planning pass.

## Outcome

One agent can use a durable, progressively accumulated local world to work on
missions assigned by a World Operator. That world survives an Eve session reset
and a process restart. Perception continues independently of reasoning. When a
qualified local executor is available, the agent can propose a measured local
goal and receive an evidence-backed result through the same world.

The first success is **retained local knowledge**, not autonomous walking:
recover the map, Unit position history, object tracks, supporting observations
and mission progress; read them through one authenticated agent. Restoring a map
does not assert that the Unit is currently localized.

The reference scenario is “Find my blue backpack”: inspect an already-populated
world, investigate a candidate when permitted, report its last observed local
position and image, and record World Operator-reviewed progress. A prerecorded
or fake-controller run proves software integration, not physical navigation.

## Settled boundaries

| Area | Implementation constraint |
| --- | --- |
| World model | Spatial map, observed objects and their evidence. No room hierarchy, region masks or new annotation subsystem. |
| Identity | Entity is the shared identity; Unit means an entity with controllable capabilities; Agent is a decision-maker, not a robot. |
| Authority | World Operator creates missions, assigns agents and grants Unit rights. Read scope, mission participation, command grant and execution reservation remain separate. |
| Persistence | SpacetimeDB owns domain state. Native map/media payloads live in retained resource storage. Neither Eve history nor a browser cache is another world. |
| Reasoning | Eve owns sessions, turns, steps, history and compaction. Nemeia supplies a world channel and a narrow just-bash integration. |
| Awareness | Derive interest automatically from Units, their observations, mission dependencies and outcomes. A usable-frame radius is an optional addition, not an agent-managed entity allowlist. |
| Time | Preserve acquisition times. Sensor acquisition, inference, publication, reasoning and control have independent cadences. |
| Geometry | Preserve native frames, reset epochs, partial measurements and missing depth. Cross-Unit alignment is not a prerequisite. |
| Missions | Description, typed objectives, dependencies, objective progress and a derived mission log. One agent may hold several missions. |
| Actions | Models propose intent. Admission validates current state. A local controller owns motion, stopping, watchdogs and durable effect receipts. |
| Models | YOLOE frequent candidate; SAM3 selective; LLMs, Typesafe and rules have different jobs behind the same domain boundaries. Qualify actual capabilities and rates. |
| Tracing | Laminar/OpenTelemetry explains decisions, including approved sensitive content. Secrets stay excluded; diagnostic export is not a control dependency. |
| Replacement | No backward compatibility, dual writes or legacy protocol adapters. Retire prototypes only after their replacement's acceptance gate passes. |

## Workstream handoffs

| Workstream | Detailed plan | Owns |
| --- | --- | --- |
| World | [World storage](01-world-storage.md) | Domain tables, reducers, authorized projections, generated bindings, evidence retention and restart recovery. |
| Perception | [Perception and mapping](02-perception-mapping.md) | Acquisition, native map products, image detections, tracking, calibrated association and spatial qualification. |
| Agent | [Agent runtime](03-agent-runtime.md) | Eve channel, bounded context, useful wake delivery, just-bash authorization, model adapters and tracing. |
| Missions/control | [Missions and execution](04-missions-execution.md) | Operator workflows, mission/progress validation, Unit grants, execution lifecycle, local controller and UI. |
| Integration | [Cutover and validation](05-cutover-validation.md) | Package/process ownership, prototype retirement, CI, dependency order and end-to-end evidence. |

## Execution rules

1. Establish one checked contract source before implementing dependent clients.
   The page's displayed overlays are not generated production bindings; old SDK
   fixtures and the earlier protocol review cannot silently override it.
2. Keep boundaries small enough to test independently. A service contract does
   not imply a separate service process or a handwritten HTTP API.
3. Deliver vertical slices with failure tests, not all schemas followed by all
   UI followed by all hardware integration.
4. Use recorded inputs and a fake controller before live acquisition. Run no
   physical action as part of unattended CI or a generic integration command.
5. Qualification failures disable the affected capability, not world retention.
   Image-only evidence is useful; unavailable localization blocks dependent
   actions; unavailable Typesafe does not block Eve or rule-based decisions.
6. Every implementation task must name its write scope, dependencies, contract
   consumed/produced, success/failure checks and evidence artifact. Cross-scope
   contract changes return to the integration owner before dependent work lands.
7. No package retirement until inbound imports, scripts, docs and tests have been
   accounted for. Do not remove user data, recordings, credentials or Git history.

## Integration decisions

These decisions resolve the workstreams' overlap. Qualification tasks below can
reject an incompatible dependency or hardware capability; they do not silently
replace the agreed architecture.

### One contract source and one package owner per boundary

| Path | Owner and purpose |
| --- | --- |
| `contracts/spacetimedb/` | World owner: real module schema, reducers, views and shared domain types. Mission/control owner contributes separate reducer/test files against the frozen schema. |
| `world-client/` | World owner: generated bindings, connection readiness, detached read projections and JSON boundary validation. No custom world transport or writable mirror. |
| `world-resources/` | World owner: authenticated local-disk evidence gateway, digest/length checks and durable resource commit. Not another domain database. |
| `perception/` | Perception owner: acquisition, mapping, detection, tracking and association modules in one package surface; Python model workers may be subprocesses. No package per pipeline stage. |
| `agent/` | Runtime owner: Eve application, world channel, just-bash integration, delivery ledger, context preparation, decision-provider adapters and trace configuration. |
| `local-controller/` | Control owner: durable effect receipts, local watchdog/stop, claim reconciliation and deterministic fake executor. |
| `driver-go2/` | Control owner: qualified vendor transport only; keep useful decoding/tests, not old authority or lifecycle logic. |
| `frontend/` | Missions/UI owner: authenticated World Operator interface and read-only world visualization. The documentation Site remains read-only and separate. |
| `conformance/` | Integration owner: replay manifests, failure harnesses, gate reports and cross-package tests. |

The module's selected baseline is **22 domain tables and 13 semantic service
boundaries**, listed in the world plan. The prototype has 20 tables; removing
`agent_subscription` and adding three local-map tables produces 22. These are
not 13 deployable microservices. Operational ledgers are not new world concepts.
Any necessary schema addition must explain its invariant and replace, rather
than duplicate, an existing authority.

### Minimal local deployment

One world database on the workstation, one evidence gateway, one Eve application,
perception workers, a separate local controller, and the operator UI. Use OS
process supervision; no Kubernetes, Kafka, federation or cloud deployment is
required. Media decoding and GPU work stay outside database transactions. The
controller's stop/watchdog path never waits on other processes.

Use the self-hosted SDK's authenticated identity/token mechanism plus an explicit
`member` allowlist for the first private deployment. The administrator bootstraps
roles out of band; there is no public self-enrollment or user-selected role.
Keep worker credentials outside the model filesystem, with separate least-
privilege credentials and OS-readable secret files. Bind development services
to loopback. Shared/remote exposure requires a separately qualified issuer,
audience, transport protection and login policy; do not add an identity service
merely for offline fixtures. Authentication support is verified in Q1 below.
Before any later remote exposure, test issuer/audience rejection, expiry and
revoked access, TLS and the login policy; a successful loopback setup is not
evidence for that deployment gate.

### Evidence, delivery and physical receipts

Retain native immutable bytes on local disk behind `world-resources/`. The
trusted ingestion/gateway path verifies digest, size, format and complete
reference closure, persists bytes, then invokes an authorized module operation.
An agent cannot commit an arbitrary resource reference. Do not introduce a
custom signed-receipt format unless qualification proves the enrolled gateway
boundary insufficient.

Start with explicit byte/history quotas and backpressure. Keep all committed
evidence needed by current state, supported map checkpoints, pending work and
accepted mission proofs. **No online deletion of referenced resources.** Initial
cleanup is a quiesced, offline reachability pass with a recoverable removal plan.
A later online reclamation protocol must prevent a new reference racing a
deletion; a query that found no references is not sufficient.

Use separate SQLite-WAL ledgers for the single Eve bridge and the local
controller. They record delivery/effect receipts, not duplicate world state or
Eve history. Controller storage is robot-adjacent and must survive its own
restart. Back up each ledger with its referenced records and check its integrity.
Do not share one SQLite file across hosts or introduce a second agent scheduler.

### Time, retry and uncertainty

- A producer/tracker restart changes its source session. Only a coordinate-origin
  reset changes the spatial frame; qualified relocalization may reuse an existing
  frame. An Eve reset changes neither.
- Compare normalized, validated request values for idempotency, not raw JSON
  formatting. Preserve array order where it carries meaning. Same identity with
  different semantic input conflicts.
- Treat Eve delivery as at least once. A crash between `send` and recording its
  result leaves an uncertain delivery, not a magically acknowledged one. Domain
  effects still require stable trusted retry identities and receipt reconciliation.
- A new inference step gets a fresh authorized projection and freshness evaluation
  even if no row changed. A retry of the same step reuses its retained context
  identity. Content digest and step/context identity are different concepts.
- Late physical receipts remain evidence after cancellation. Record what happened
  and reconcile safe closure; cancellation cannot undo movement. A new fence or
  operator click alone cannot prove the Unit is safe or release its reservation.
- A browser disconnected from the controller cannot promise a working stop button.
  An independent local/hardware stop remains available outside the UI/database.

## Qualification tasks before committing to an integration

| ID | Bounded question and output | Pass / failure behavior |
| --- | --- | --- |
| Q1 | Qualify candidate SpacetimeDB `2.10.1` with matching CLI/module/client: authenticated identity, private tables, caller views, generated bindings, confirmed reads, transaction/reconnect behavior and supported indexes. | A repeatable local module fixture with a version lock. Failure selects one tested compatible release before dependent code; no floating `latest`. |
| Q2 | Qualify candidate Eve `0.63.0` + compatible just-bash: active principal propagation to trusted commands/filesystem, isolated `/world` per agent, exact step-hook ordering, retry identity, readonly operations and host egress restrictions. | The agreed world channel + read-only mount + `nemeia` command works without model-selected authority. Failure blocks that integration and returns a concrete API gap; typed tools may diagnose it but do not silently replace the requested interface. |
| Q3 | Validate one native recorded sensor/map fixture: bytes, acquisition clock, local frame, decoding, checkpoint recovery and expected object annotations for evaluation. | Replay works without robot access. If real captures are absent, synthetic fixtures unblock software tests but are labeled synthetic; a separately authorized recording task remains necessary. |
| Q4 | Qualify actual camera/range timing, intrinsics, extrinsics, pose history and association quality. | Publish measured local object geometry only for supported observations. Failure retains image-only detections and native map knowledge. |
| Q5 | Qualify local pose navigation, traversability, obstacle response, controller epoch, watchdog/stop and measured completion on the actual Unit. | Enable physical `navigate@1` only after the approved supervised test. Failure keeps it unavailable; G1–G3 remain valid. |
| Q6 | Qualify enabled inference/export profiles: YOLOE quality/latency/VRAM, selective SAM3, Typesafe question/response support, and Laminar destination/access/content policy. | Record exact artifacts and measured limits. No model throughput assumption; optional provider failure falls back to rules/LLM or abstention, never bypasses admission. No external sensitive-data export before policy approval. |

Q1 and Q2 are small dependency/API fixtures, not permission to implement a new
database or agent runtime. Q3–Q6 are explicit engineering tasks with saved
reports; physical and paid-provider tests need their own authority.

The Eve candidate is based on the published `0.63.0` package, whose public type
declares `customCommands` and `filesystem` hooks. A sibling project's installed
`0.31.0` is not Nemeia's target. Hook availability alone does not prove safe
session binding. See the [published package metadata](https://registry.npmjs.org/eve/0.63.0)
and the runtime workstream's source references. SpacetimeDB reducers provide
[transactional writes](https://spacetimedb.com/docs/functions/reducers/);
[transient event tables](https://spacetimedb.com/docs/tables/event-tables/) are
not the durable world history or agent delivery ledger.

## Ordered execution backlog

Each row is a bounded implementation package, not permission to start it now.
The listed acceptance evidence joins the detailed workstream tests.

| ID | Deliverable and write owner | Depends on | Completion evidence |
| --- | --- | --- | --- |
| E0 | Canonical contract manifest, checked JSON/domain boundaries, authority cleanup and dependency/API fixtures — integration + world/runtime owners. | Q1/Q2 investigation begins here. | Published model maps to one module source; no accidental old-model imports; dependency findings recorded separately. Contract freeze does not wait for the Eve seam to pass. |
| E1 | Private module, bootstrap/auth policy, observation/frame/map reducers, resource gateway and atomic checkpoint path — world owner. | E0, Q1. | G1 transaction/idempotency/resource/crash tests against the real local module, not just mocks. |
| E2 | Generated clients, authorized indexed views, bounded history/detail reads, consistent WorldView projection — world owner. | E1. | Role-denial tests, full scope readiness, atomic cache update and reconnect tests; no unbounded history subscription. |
| E3 | Replay acquisition, native map publisher, image-only detection/tracking adapter — perception owner. | E0/Q3; joins E1/E2 for publication. | Repeatable retained map/object fixture, preserved times/session IDs, same-label separation and measured queue limits. |
| E4 | Mission/objective/grant reducers and scheduled reconciliation — missions owner, shared schema owned by world. | E0/E1. | Graph validation, multi-mission log, expiry without sensor writes, operator-only finding acceptance, cancellation/deadline precedence. |
| E5 | Typed action admission/claim/completion and durable fake local controller — control owner. | E1/E2/E4. | Single reservation, current authority checks, retry/fence tests, local stop during world outage, ambiguous receipt recovery with no repeated effect. |
| E6 | Eve channel, narrow delivery ledger, readonly world mount, trusted commands, bounded context and tracing — runtime owner. | E2/E4, Q2; E5 for action integration. | G2 slow-reasoning/coalescing, context retry/reset, authorization, readonly mount and exporter-failure tests. |
| E7 | Operator mission board, world/map/object/evidence views and explicit reviewed operations — missions/UI owner. | E2/E4; joins E5/E6. | Browser create→assign→grant→observe→review flow; visible stale/unknown/disconnected state; no direct robot or database bypass. |
| E8 | Integrated backpack replay, durability and failure gauntlet — integration owner. | E3/E5/E6/E7. | G1–G3 report: one agent, retained partial map and object evidence, `navigate@1` fake viewpoint, updated observation, operator-reviewed result, restart and outage recovery. |
| E9 | Approved live read-only acquisition, native map recovery, YOLOE benchmark and calibrated association — perception owner. | E1/E3; Q3 fixture baseline, Q4/Q6 sensing qualifications run here; independent of E6 completion. | G4 report; no actuator calls, measured capability matrix and image-only fallback when fusion is unqualified. |
| E10 | Typesafe/SAM3 optional profiles and approved content-rich Laminar capture — runtime/perception owners in disjoint files. | E6/E9 where relevant, Q6. | Recorded provider contract tests, measured profile results when authorized, secret canaries and selected-content limits. |
| E11 | Qualified physical navigation adapter and supervised end-to-end check — control + perception owners. | E8/E9, Q5. | G5 independent stop/watchdog, fresh localization, known traversability, measured arrival and safe closure under failure. |
| E12 | Remove superseded entrypoints/packages/docs and finalize runbooks — integration owner. | Per-boundary replacement tests; E8 for general cutover. | No inbound imports or startup path uses old state/transport; replacement CI/runbooks pass; recordings/secrets/user data untouched. |

E1/E3/E4 can proceed in parallel after contract freeze. E6 and E7 consume the
same generated client instead of maintaining parallel DTOs. E9 need not wait for
LLM integration. An unresolved Q2 blocks E6, not storage or replay work; an
unresolved Q4 blocks calibrated fusion, not native map retention or image-only
evidence. E10 and E11 are not prerequisites for durable-world success.
Stop exposing an old command path as soon as its replacement becomes active;
do not leave two authorities controlling the same Unit during gradual cutover.

### First implementation assignment

Start with **E0 plus the Q1/Q2 fixtures**, not a broad package rewrite. Deliver a
reviewable contract manifest, exact dependency locks, generated-client smoke
fixture and an authenticated Eve/just-bash seam test. In parallel, inventory a
Q3 replay dataset without contacting hardware. Then take E1's smallest vertical
slice: one observation → retained object/map evidence → restart → same world.

Implementation coordination uses the same five workstreams. Only the world
owner edits shared schema/generated bindings; only integration owns root scripts
and cutover. Each task hands back changed paths, test results, known limitations
and any proposed contract change. No agent may expand its write set silently.

## Acceptance ladder

These gates describe different claims. Passing a later-looking UI demo cannot
substitute for an earlier durability or authorization test.

| Gate | Required demonstration | Does not establish |
| --- | --- | --- |
| G0 — contracts | One selected schema generates compatible clients and rendered reference material; runtime inputs are validated; prototypes cannot be imported accidentally into the new path. | A running world or correct hardware behavior. |
| G1 — durable world | Ingest recorded observations; retain a native local-map product and evidence; kill/restart storage and workers; recover identities and the last valid checkpoint; deduplicate replay; reject missing resources. | Current robot localization or complete scene reconstruction. |
| G2 — agent access | One authenticated Eve agent sees its mission log and bounded world context; perception advances during a deliberately slow inference; next step sees current state; retry/reset preserves required pending work without duplicating commands. | Model accuracy or authorization to move. |
| G3 — software loop | Operator creates/assigns/grants; agent proposes a typed action; fake controller claims/reports; new observations support a reviewed finding; progress commits; cancellation, lost acknowledgements and disconnects are exercised. | A qualified physical controller or the ability to navigate a home. |
| G4 — physical sensing | Approved read-only acquisition produces timestamped recorded data; useful local-map products recover; actual frame/calibration/localization limits are recorded; unsupported fusion stays image-only. | Permission for autonomous motion or reliable room recognition. |
| G5 — supervised physical action | Qualified local navigation, single command authority, watchdog/stop, measured completion and crash reconciliation pass a separately approved physical test. | Unsupervised deployment, a second Unit, or globally aligned maps. |

G1–G3 use deterministic replay and a fake model/controller where needed. G4 may
run alongside agent work once read-only ingestion is qualified. G5 depends on
the physical qualifications, not just a successful simulated backpack story.

### Failure tests that cannot be postponed

- **Domain transaction:** a rejected input leaves no partial component, receipt,
  progress or audit write.
- **Duplicate delivery:** identical authenticated input has one effect; changed
  content under the same identity conflicts.
- **Boundary encoding:** generated native values round-trip through the shared
  JSON projection without losing bigint revisions, timestamp precision, optional
  values or union tags. Canonical request comparison uses that validated codec,
  not ad hoc JSON serialization in each client.
- **Evidence freshness:** polling, replay, delayed inference and context rebuilds
  do not refresh acquisition time. Old/out-of-order results cannot overwrite
  a newer measured facet merely by arriving last.
- **Identity:** two similarly labeled objects remain distinct without association
  evidence; a producer restart does not reuse a track identity silently.
- **Resource commit:** interruption before/after storing bytes and before/after
  checkpoint commit yields either a valid retained head or an explicit failure,
  never a dangling successful checkpoint.
- **Agent backlog:** continuous replaceable updates have bounded pending state;
  must-handle events are acknowledged explicitly or remain pending with visible
  backpressure. Reconnection is not treated as missed-event replay.
- **Authority change:** pause, grant expiry and reassignment take effect at
  admission/claim even when a model is still thinking on older context.
- **Physical ambiguity:** lost feedback does not free a Unit, retry its motion,
  claim a stop succeeded, or finish its mission.
- **Isolation:** model-controlled files/flags cannot select another principal;
  every `/world` mutation and traversal escape is denied; no raw robot command,
  generic database writer or unrestricted host shell is exposed. Eve, agents,
  browsers and generic clients cannot write evidence bytes or commit unchecked
  resource references around the gateway.
- **Capability enablement:** normal runtime configuration cannot enable an
  unqualified physical adapter. Only a separately approved supervised
  qualification run may exercise the candidate; release requires G3 and Q5
  evidence and does not authorize unsupervised operation.
- **Diagnostics:** exporter failure cannot delay domain commits or local stop;
  secret canaries in nested content/errors/URLs do not reach the exporter.

### Evidence required at each handoff

Retain the exact source and dependency versions, test command/results, fixture
manifest, resource checksums and capability configuration with each gate report.
Record measured rates/latencies, calibration coverage and failed cases where
relevant. A screenshot, type check, vendor benchmark or successful model response
alone is not a gate report. No fixed sensor/model rate is promised by this plan.

## What this plan does not authorize

Implementation itself; installing/upgrading software; altering credentials or
sharing; turning on sensor services; recording private surroundings; running
paid inference; activating robot motion; or deleting prototypes. Those actions
belong to a later implementation request and, where applicable, a separate
explicitly supervised hardware qualification session.
