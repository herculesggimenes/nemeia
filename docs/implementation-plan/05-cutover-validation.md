# Cutover, development topology, validation, and delivery

This is an incremental replacement plan; it does not preserve old APIs or require
an all-at-once rewrite.
Authority is `docs/protocol-spacetimedb.md`, the `docs/*-content.mjs` inputs, and
the generated read-only `docs/index.html`: one durable SpacetimeDB
world, native subscriptions, Eve-owned runtime, World Operator/Agent/Unit
separation, local frames, observation evidence, and a local controller outside
database transactions. It does not claim Go2 navigation is implemented.

## Pre-implementation baseline

The following facts describe the planning snapshot, not the current worktree.
Use [EXECUTION.md](EXECUTION.md) for implemented versions and gate evidence, and
[RUNBOOK.md](RUNBOOK.md) for runnable commands. The module and generated client
now exist; pending gates must still pass before default-route retirement.

Confirmed facts at the planning baseline:

- `package.json` defines a large npm workspace with per-package `node --test`
  checks; `frontend` adds type-check, lint, build, unit, and Playwright smoke.
  There is no generated-client package or real module deployment.
- `contracts/spacetimedb/schema.ts` is an explicitly checked SDK example, not a
  deployed module. It currently declares 20 `table(...)` values and its package
  pins SpacetimeDB 2.10.1, which is the existing fixture pin. First qualify a
  matching CLI/module pair; do not float to latest as part of cutover. The exact
  selected inventory is the 22-table model: 20 raw tables minus
  `agent_subscription`, plus `spatial_frame`, `local_map`, and `map_revision`.
- The installed sibling repository has Eve 0.31; the current published Eve 0.63.0
  tarball exposes `customCommands` and filesystem hooks. Treat 0.63.0 as a
  qualification candidate, not an upgrade action now. Retain the desired
  just-bash world integration and run an auth-context spike; do not silently
  replace it with typed tools.
- `mission-api/src/http-server.ts`, `supervisor/src/http-server.ts`, CLI routes,
  and frontend `/api` routes form parallel HTTP/WebSocket seams. The selected
  design makes generated clients/native subscriptions the world boundary; add no
  handwritten protocol/HTTP clone.
- `mission-api`, `mission-server`, `supervisor`, `policy`, `attention`,
  `anomaly`, and `replay` are tightly coupled in-process prototypes. Their tests
  are behavioral evidence, not compatibility obligations. `world-runtime` is
  another mutable authority; `scene` and `world-twin` must remain projections or
  advisory predictors, not a second database.
- `README.md` still names World Master and per-agent subscriptions, while the
  selected model requires World Operator terminology and world-managed awareness.
  `docs/protocol-review.md` still calls `docs/protocol.md` canonical and proposes
  the older CloudEvents/OpenAPI/custom-journal shape. `contracts/README.md` and
  `contracts/protocol/*` repeat it. Treat the review as historical risk evidence,
  not the new boundary.

Reuse deterministic fakes, fixture builders, driver normalization, UI components,
and safety scenarios. Replace/retire the old journal, Map-backed run state,
custom transport, mutable world synchronization, and superseded helpers after
coverage.

## Smallest target topology and ownership

Runtime paths:

1. `contracts/spacetimedb/` owns the real module schema, reducers, caller-scoped views,
   and generated bindings for the real module. Generated bindings are build output,
   never hand-edited. `world-client/` owns connection configuration,
   read projection, reducer invocation, reconnect reconciliation, and confirmed
   reads; it must not expose a second world or invent a transport cursor.
2. `agent/` is the Eve application. It owns the one agent channel, bounded
   WorldView/MissionLog preparation and wake handoff. Eve owns history and turns;
   it does not write physical state, configure subscriptions as an agent privilege,
   or create a loop per mission.
3. `perception/` owns acquisition, mapping, association, local frames,
   retained-resource references, and provenance. It publishes through
   `world-client/`; mapping and fast perception remain independent of reasoning.
4. `local-controller/` owns Unit reservation handoff, local receipts, monotonic
   watchdog, bounds, stop latch, device health, and reconciliation after restart.
   `driver-go2/` remains behind it. No database outage, model response, exporter,
   or frontend route may prevent local stop.
5. `world-resources/` is the selected local-disk evidence service for images,
   masks, map chunks, and manifests. A narrow SQLite bridge/local-ledger may hold
   Eve-bridge and local-controller receipts; it must never duplicate world state.
   Start with no online GC of
   referenced bytes; enforce quota/backpressure and perform reachability cleanup
   only while quiesced/offline, after a reference snapshot, to avoid races.
6. `frontend/` is the operator read/proposal client; `conformance/` owns gates
   and fixtures. Both use generated clients and neither hosts Mission Server state.

Default local topology is one nearby SpacetimeDB, controller, Eve worker,
optional frontend, and `world-resources/`. First install a private SDK identity
token, explicitly allow its member in the module, bind services to loopback, and
store scoped credentials in OS-protected files. Configure URI/name,
module/bindings version, member credential, controller endpoint, and optional
OTel endpoint. Remote OIDC/TLS is a later deployment gate, not core blockage.

## Work packets and acceptance gates

**P0 — authority and inventory cleanup.** Scope `README.md`,
`docs/protocol-review.md`, `docs/protocol.md`, `contracts/README.md`,
`contracts/protocol/*`, selected `docs/*-content.mjs`, and the page checker.
Mark old documents historical, change terminology to World Operator, remove
claims that agent-managed subscriptions or the old journal are canonical, and
add a machine-checkable manifest for the selected 22-table model.
After gates pass, delete stale authority pages or replace them with concise
redirects; retaining obsolete protocols is not compatibility. Planned tests are
page build/check, stale-authority/name scans, manifest comparison to schema and
bindings, and visibility of the simple-map/no-room-region/no-annotation rules.

**P1 — real module/client seam.** Scope `contracts/spacetimedb/*`, generated
binding output, and `world-client/`. Replace hand-authored DTO transport
with generated rows/reducers/views. Planned integration tests use a pinned local
module: reducer writes commit atomically with audit rows; duplicate request IDs
are idempotent; changed bodies conflict; subscriptions initialize consistently,
apply transaction changes atomically, and reconnect to current state; confirmed
reads are used by decision/executor consumers. PR tests may use a loopback local
database, but not external network, robot, or paid API. Bootstrap tests must
prove the SDK identity token is accepted only for an explicit `member` allowlist,
scoped credential files are unreadable by other users, and non-loopback binds are
not part of the core local path.

**P2 — client and runtime cutover.** Scope `world-client/`, `agent/`,
`frontend/`, CLI code, and selected reusable UI/fixture code. Migrate one vertical
slice first: create mission, assign Agent and Unit, ingest recorded blue-backpack
observations, prepare bounded context, select a measured viewing pose, submit a
typed `navigate@1` proposal, and render progress from subscribed rows. `approach@1`
remains a separate optional capability; it requires a usable measured 3D target,
so a partially observed backpack must not be forced into its box-based contract.
Planned tests prove there is one mutable authority, one agent loop across missions,
no direct actuator call from model/tool code, and reconnect never redispatches a
terminal execution. Retire `mission-api`, `mission-server`, old CLI API routes,
and frontend proxy routes once this slice passes.

**P3 — deterministic fake to real local integration.** Scope `conformance/`,
`perception/`, `world-resources/`, `local-controller/`, and reusable
`driver-go2` normalization tests. First run with fake clock, fake SDK client, fake
controller, and recorded evidence; then run the same contract suite against the
real loopback module/client. Failure tests include duplicate delivery, disconnect,
restart around map-head commit, stale evidence, revoked assignment, lost
acknowledgement, old epoch, unknown outcome, exporter outage, quota/backpressure,
cleanup refusal while writers are active, and hung worker cleanup. Prove quiesced
reachability cleanup cannot delete bytes referenced by a committed manifest.

**P4a — qualified read-only acquisition.** After `world-resources/` and recorded
fixture qualification, independently of `agent/`/Eve, acquire identity,
timestamps, frames, provenance, and retained references with an explicit zero-
actuator assertion. **P4b — physical actuation.** Only after the full simulated
E8/G3 loop plus Q5, run first supervised navigation with local watchdog/stop,
bounds, measured state, and durable receipt. Autonomous actuation remains later;
physical navigation is not a repository assumption.

Dependencies/scheduling groups (not file ownership): P0 gates authority. After
P0, World schedules `contracts/spacetimedb/` + `world-client/`; Integration
schedules `conformance/`; Perception schedules `perception/` while consuming the
World-owned `world-resources/` API; Missions/control schedules `local-controller/`
and UI/runtime schedules `frontend/` and `agent/` as distinct owners. P2 joins
runtime/UI to World; P3/E8 depends on P1 and P2; P4a/E9 depends on
storage/fixtures and can run before P2; P4b/E11 depends on E8, E9, and Q5.

## CI, observability, and practical success

CI order: authority/static inventory; TypeScript/generated bindings;
deterministic fixtures; loopback SpacetimeDB; fake controller/conformance;
frontend smoke. Read-only acquisition is a separately authorized E9/G4 job;
physical jobs are later and opt-in. After dependencies and toolchains are
preprovisioned, PR test execution uses no external network, robot access, or paid
APIs; installation/provisioning is a separate setup concern.

Each gate retains versions, fixture digest, domain references, acquisition times,
reducer result, subscription readiness, and local receipt.
OTel/Laminar correlates references off the control path; missing/redacted traces
never authorize retry or replace world events/receipts.

Core software success (P0–P3) is one reproducible local run of “find blue
backpack” in which the World Operator creates the mission, one Agent coordinates
one Go2 Unit, the world retains observations and evidence across an Eve reset, the
client resumes from current subscribed state, and a measured viewing-pose
`navigate@1` proposal is admitted through the fake/local controller seam. This
durable-world/software-loop result does not require physical navigation.

Read-only sensing success is P4a/G4 and can stand alone: it proves identity and
evidence without Eve or actuation. Physical actuation success is P4b/G5 and later
proves localization, bounds, watchdog, stop, and measured completion. P4b cannot
invalidate core software success or imply navigation is already implemented.

## Traceability matrix

| Selected commitment | Planned check | Gate |
|---|---|---|
| Simple spatial map + observed objects + evidence; no room/region/annotation subsystem | Authority scan plus recorded association/map fixtures reject room/region/annotation tables and label-only merges | P0/P3 |
| World Operator, Agent, Unit; visibility ≠ assignment ≠ reservation | Reducer authorization, revision/expiry, one active Unit reservation, and terminology checks | P0/P1/P3 |
| One durable SpacetimeDB world with native subscriptions | Real-module consistent snapshot, atomic update, reconnect, and no custom HTTP/WorldDelta test | P1/P2 |
| Eve owns runtime/history; bounded step context | Restart Eve while world/execution rows survive; one loop serves multiple missions | P2/P3 |
| YOLOE frequent, SAM3 selective; fast perception independent of reasoning | Recorded producer cadence/provenance fixtures and stale-completion rejection; no rate guarantee | P3 |
| One-agent/one-Go2 “find blue backpack” first demonstration | End-to-end local fixture with evidence-linked progress and a measured `navigate@1` viewing pose; `approach@1` is optional | P2/P3 |
| Physical navigation is not presumed | E9/G4 read-only acquisition has zero actuator calls; E11/G5 actuation is later and supervised | P4a/P4b |

## Blockers versus proposed defaults

Open qualification gates are the SpacetimeDB CLI/module match and generated
bindings, Eve 0.63.0 plus the just-bash auth-context spike, and verified
Go2/controller capabilities. Local SDK-token/member-allowlist auth,
loopback-only services, OS-protected scoped credentials, and selected local-disk
resources are defaults, not blockers. Remote OIDC/TLS remains a later gate.

## Primary references (checked 2026-09-19)

- Local authority: [`docs/protocol-spacetimedb.md`](../protocol-spacetimedb.md),
  [`docs/index.html`](../index.html), and [`docs/spacetimedb-content.mjs`](../spacetimedb-content.mjs).
- SpacetimeDB [subscription semantics](https://spacetimedb.com/docs/clients/subscriptions/semantics/),
  [TypeScript SDK/reference and generated bindings](https://spacetimedb.com/docs/clients/typescript/),
  [reducers](https://spacetimedb.com/docs/functions/reducers/), and
  [authentication/authorization](https://spacetimedb.com/docs/core-concepts/authentication/)
  document the relevant current platform boundaries.
- SpacetimeDB [self-hosting](https://spacetimedb.com/docs/how-to/deploy/self-hosting/)
  supports the local-first deployment default; exact release and production terms
  remain qualification items.
