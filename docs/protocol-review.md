# Protocol review and simplification decisions

Reviewed 2026-09-15 against repository commit
`df78b1c2d779f4cfd2fc5dfa5428c76bc358eea4`. This is a design review, not a
hardware certification or a claim that the proposed API is implemented.
The resulting [protocol](./protocol.md) is the canonical implementation target.
The project is pre-production: replace the old contracts outright, with no
backward-compatibility, dual-write, historical decoder, or data-migration requirement.

## Conclusion

Keep World, Entity, Component, Relationship, Affordance, Action, System, and
Event. The main simplification is not fewer fields at any cost: it is fewer
competing authorities. One world owns domain state; one execution owns action
lifecycle; one local gate owns physical control; one journal owns committed
decisions. Scene, UI, attention, and replay are readers or projections of those
same objects. Missions and approval remain optional, not prerequisites for
moving a simulated entity.

Use established mechanisms at the edges: CloudEvents, JSON Schema/OpenAPI,
Problem Details, ROS units/frames/action semantics, JOSE, SQL transactions,
OS process supervision and sandboxing. Do not introduce Kafka, a workflow
engine, Kubernetes, or ROS as mandatory infrastructure for the small deployment.
The [standards matrix](./protocol.md#11-reuse-standards-and-operating-system-mechanisms)
distinguishes exact formats from semantic mappings and design patterns.

## Highest-priority findings

Priorities indicate implementation order. P0 means resolve before relying on this
path for unsupervised physical operation, not that a live robot was tested.

| Priority | Current evidence | Consequence | Revised contract and acceptance check |
| --- | --- | --- | --- |
| P0 | [Supervisor](../supervisor/src/supervisor-kernel.ts) relies on `tick()` for watchdog/deadline work; its HTTP server exposes `/tick`, while its interval forwards events. Duration expiry calls the completion path. | A deployment without an independent tick runner has no demonstrated deadline enforcement; timeout can be described as completion. | Local monotonic watchdog owned by gate, independent of agent/journal. Kill client, stop ticking remote API, and verify local safe-state attempt plus failed execution. |
| P0 | [Async capability host](../capability-host/src/process-isolated-capability.ts) awaits capability abort/stop before calling kernel stop. | Untrusted cleanup can delay the control stop path. | Revoke/latch locally before waiting for worker cleanup; test a worker that never resolves. |
| P0 | [Go2 driver](../driver-go2/src/go2-driver.ts) refreshes `lastStatusAt` when `status()` returns non-null transport state. | Polling a cached status can appear to refresh device liveness. | Timestamp actual device reception. Frozen transport plus repeated reads must become stale. Distinguish sent, acknowledged, and measured effects. |
| P0 | [Mission API](../mission-api/src/mission-api.ts), [mission server](../mission-server/src/mission-server.ts), and supervisor keep retry/consumption state in Maps. API caches only after awaiting dispatch. | Concurrent requests and process restarts have no durable common deduplication boundary. | Unique request receipt plus event transaction; durable local execution admission. Same request starts once; changed body conflicts; uncertain physical work is not auto-repeated. |
| P1 | [World Runtime](../world-runtime/src/world-runtime.ts) applies effects one by one and exposes the mutable runtime to action `perform`. | A later invalid effect leaves earlier changes committed; an executor can bypass staged effects. | Validate the prospective batch, then commit atomically. Executor returns changes instead of mutating the world. |
| P1 | [Scene projector](../scene/src/scene-projector.ts) falls back to `type:label` identity, requires a known first label, and replaces projected facets with each observation. | Two backpacks merge; geometry-only evidence is dropped; semantic-only updates can erase geometry. | Source-scoped tracks and explicit association; independent semantic/geometric facets and times. Test all three cases. |
| P1 | [Event log](../mission-server/src/event-log.ts) replaces the supplied timestamp with its clock; Scene derives observation time from that timestamp. | Delayed evidence can become artificially fresh; bridging changes original time. | Separate acquisition, event, and recording times. Replaying or polling must never refresh evidence. |
| P1 | [Geometry schema](../contracts/schemas/nem-suite.schema.json) requires only type/frame; [world twin](../world-twin/src/world-twin.ts) can invent a center and 0.2 m dimensions. | A missing measurement becomes a concrete collision object. | Discriminated required shapes with ROS semantics; unknown remains unknown. Reject incomplete boxes. |
| P1 | World Runtime journals changed component keys rather than full values; UI [world panel](../frontend/components/world/world-panel.tsx) creates a runtime during render. | Exact state reconstruction is unavailable; local identity/cursors are not session-stable. | Full committed `Change[]`, one session owner, snapshot and resume cursor read atomically. |
| P1 | [Canonical JSON](../contracts/src/canonical-json.ts) sorts keys with `localeCompare`; [contract checker](../contracts/scripts/check-contracts.ts) is a handwritten JSON Schema subset. | Standard names do not imply standard conformance; signing and validation can diverge across implementations. | Replace with maintained JOSE, JCS and JSON Schema libraries with official vectors; no old verifier or compatibility path. |
| P1 | World Runtime calls `available` through affordance discovery with an empty input object, then passes actual input only to execution. Target requirement is inferred from component-list length. | Input-dependent checks are not reliably enforced before side effects; target cardinality is implicit. | Recheck actual input at dispatch; explicit `none`/`required` target. Pin relevant component versions. |
| P2 | [Robot world projection](../frontend/lib/world/robot-world-runtime.ts) carries display labels/details/state in components and UI navigation as actions. | Domain logic depends on presentation conventions; opening a panel can look like physical completion. | Typed domain components; derive labels/colors in the view; route real manual motion through the same physical gate. |
| P2 | Scene reads a fixed first 10,000 events; [replay builder](../replay/src/replay-builder.ts) has a fixed large limit and counts both run and authorization completion. | Larger histories truncate silently; one attempt can be counted twice. | Incremental cursors, all pages, unique execution terminal states; cross the old limit in a fixture. |
| P2 | [Attention drain](../attention/src/attention-inbox.ts) updates an in-memory digest/cursor before journal append. | Restart or append failure can lose exact delivery bytes and progress. | Default to event cursor + formatter; if durable delivery is required, persist bytes and cursor in one transaction. |
| P2 | Scene derives affordances through ontology while policy/registry and World Runtime also decide applicability. | Multiple catalogs can disagree about the same action or revoked package. | One action catalog and one dispatch admission path; ontology supplies semantic hypotheses, not physical capability. |
| P2 | [World twin](../world-twin/src/world-twin.ts) labels a built-in AABB adapter `box3d-0.1.0`. | A descriptor can imply an engine integration or fidelity absent from this adapter. | Name the actual algorithm and coverage; keep prediction advisory and distinguish replay from resimulation. |

## Reproductions performed during review

Read-only local probes confirmed these four results; no robot commands or
network writes were involved:

```text
Two untracked backpack observations → one projected entity.
Action: set power to 10%, then reference a missing entity → failure, power remains 10%.
Append timestamp 00:00:01 with journal clock 00:00:10 → stored timestamp 00:00:10.
canonicalize({a:1,A:2}) → {"a":1,"A":2}; JCS ordering requires {"A":2,"a":1}.
```

These demonstrate present behavior. The other findings above come from static
source review and should receive regression tests during implementation.

## Replacement boundaries

| Existing protocol | Keep | Simplify or move |
| --- | --- | --- |
| Common | Identity, versions, strict boundaries | Standard errors and schema tools; one casing; delete old shapes and parsers. |
| NEM-1 · Event log | Append-only decisions, projections, replay | CloudEvents envelope + journal cursor; transaction receipts; no special log per service. |
| NEM-2 · Authorization | Enforceable bounded authority near hardware | Local admission by default; JOSE grant only for a remote trust boundary; no second run lifecycle. |
| NEM-3 · Missions/runs | Optional grouping and human approval | WorldService executions are primary; mission is grouping, approval is an admission state. |
| NEM-4 · Supervisor | Local watchdog, exclusivity, stop, bounds | ControlGate/Session; no agent-driven tick dependency or synthetic successful timeout. |
| NEM-5 · Driver | Vendor transport and normalized device evidence | RobotDriver; typed streams and sent/ack distinction; local profile owns configuration. |
| NEM-6 · Capability | Pinned implementation and restricted access | ActionExecutor Promise + AbortSignal + progress; OS process boundary when untrusted. |
| NEM-7 · Policy/registry | Admission and installed package pins | Local policy/config first; remote organization registry only when needed. |
| NEM-8 · Scene/twin | Evidence association, spatial views, prediction | Scene is a World view; ROS geometry mappings; pure optional predictor with honest coverage. |
| NEM-9 · Attention | Event selection and understandable delivery | Cursor + deterministic formatter first; durable delivery optional; no custom CEL subset. |
| NEM-10 · Conformance | Repeatable contracts, fixtures, qualified adapters | Generate schema tests; retain hardware tests separately; avoid a registry bureaucracy for local types. |

Cross-cutting modules: anomaly records are optional domain extensions; replay
and CLI are read adapters; conformance is verification tooling; the frontend
renders snapshots and dispatches through the same service. The current runtime
prototype packages are not rewritten by this specification change. They are
not compatibility obligations and should be deleted when their replacement lands.

## Deliberately not collapsed

- Observation is not an entity: uncertain evidence and associated belief have
  different identity and lifetime.
- Frame is not a retained resource: a live camera frame can expire without
  changing the historical fact that a detector used it.
- Action is not executor: meaning must survive moving from simulation to Go2
  or to a ROS action server.
- Event ID is not cursor: identity survives transport while order is local.
- World commit is not motor command: database rollback cannot undo motion.
- Stop latch is not safe-state confirmation: a software request is not proof
  of a physical result.

## Smallest implementation sequence

1. Generate one schema/API source and implement world commit + request receipts.
   Prove rollback, restart recovery, concurrent retries, and cursor resumption.
2. Replace the second Scene model with an incremental world projector. Prove
   identity, independent times/facets, transforms and removal semantics.
3. Bind one action to simulation and a qualified local physical executor. Prove
   cancellation, device staleness, watchdog, restart and stop failure behavior.
4. Adapt UI and CLI; then add approval, remote grants or durable attention only
   when a consumer requires them.

Open deployment choices are not extra protocol types: database deployment,
concrete schema generator/validator and JOSE package, resource retention,
trusted clock-error bounds, and per-robot qualified safe-state behavior. Select
and pin those in implementation after integration tests. The specification does not
pretend a TypeScript declaration resolves hardware or distributed failure modes.
