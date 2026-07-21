# Nemeia NEM Suite Redesign Plan

This plan realigns Nemeia with the draft NEM Suite interface specification
version 0.2.1. It treats the specification as the product contract: components
may change implementation language or transport, but they must compose through
the NEM semantics, schemas, lifecycle rules, and conformance tests.

## Target Shape

Nemeia becomes a mission system with two distinct planes:

```text
Policy plane, seconds:
  clients -> Mission Server -> Event Log, Registry, Scene, Attention

Control plane, milliseconds:
  Mission Server -> signed Authorization -> Supervisor Kernel
  Supervisor Kernel -> Driver SPI -> hardware
  Capability Host -> ActionChunks -> Supervisor Kernel
```

The invariant is:

```text
The robot only ever does something bounded, authorized, stoppable, and provable.
```

The current web console remains the operator cockpit. The current Unitree Go2
integration becomes the first Driver. Agent-facing CLI work moves behind
`nemeiactl`, which is only a rendering of the Mission API.

## Architectural Reframe

| Current term | NEM role | Direction |
|---|---|---|
| App Server / Control Plane | Mission Server plus projections | Own policy, runs, registry, approval, replay, attention, and API. It does not tick robot commands. |
| Safety / Monitoring | Mission checks plus Supervisor Kernel | Policy checks issue Authorizations; kernel clamps, stops, watches heartbeats, and enters safe state locally. |
| Robot adapter | Driver SPI | Declare hard caps, streams, observables, native actions, safe-state behavior, and normalized status. |
| Runtime / Executive | Client of Mission API | Agent proposes runs and reads attention; it carries no robot authority. |
| Scene model / SSG | NEM-8 Scene projection and World Twin | Reproducible projections over the Event Log, not a separate source of truth. |
| Component queues | Event Log plus Attention drains | One append-only log, with materialized projections allowed only when reproducible. |
| Physical command records | Run plus Authorization plus events | The Authorization is the only artifact that can cause physical action. |

## Non-Negotiable Interfaces

1. `Log` is the only storage primitive.
   Stateful resources are pinned by log records. Projections such as Scene,
   Attention, Replay, and Reports must be reproducible from the log plus pinned
   versions.

2. `Authorization` is the only control-plane authority.
   Every physical action flows through one signed artifact with grant limits,
   enforcement modes, checks, expiry, abort triggers, streams, and capability
   binding.

3. `Supervisor Kernel` has a tiny frozen surface.
   It exposes only status, stop, execute, and events. It has no plugins, no scene
   access, no expression language, and no capability-provided configuration.

4. `Driver` declares hardware facts, not trust.
   Capabilities and drivers publish manifests; certification and maturity live
   in registry state and signed gauntlet reports.

5. `Capability` processes are untrusted.
   They bind to an Authorization, consume declared streams, emit ActionChunks and
   observations, and stop within one watchdog interval.

6. `Attention` is the agent's perceptual channel.
   The agent observes mission-relevant changes through pre-turn and wake drains,
   with persisted digests and prompt-injection rendering lint.

## Milestones

### M0: Freeze Contracts

Create source-controlled schemas and registries for NEM-0 and NEM-10 before
adding behavior.

Deliverables:

- JSON schemas for EventEnvelope, ErrorObject, Run, Authorization, CheckResult,
  DriverManifest, NormalizedStatus, CapabilityManifest, Observation, Preset,
  RegistryState, AttentionContract, Anomaly, and Replay.
- Registry files for error codes, event types, action spaces, safe-state kinds,
  abort triggers, check names, core ontology types, affordances, and attention
  themes.
- RFC 8785 canonicalization and Ed25519 signing helpers.
- Schema CI and fixture validation.

Implementation status:

- The event type registry now records `run_id_required` and
  `physical_consequence` metadata. Contract validation fails if a physical
  event type does not require `run_id`, if a fixture uses an unregistered event
  type, or if a fixture omits `run_id` for a registry-required event.
- Gate 1 conformance replay tests consume the same registry metadata and verify
  the simulated run-causal event chain satisfies the `run_id` requirement.

Acceptance:

- All mutating Mission API schemas include idempotency support.
- Every physical-consequence event shape requires `run_id`.
- All model-visible strings are routed through the NEM-9 rendering lint.

### M1: Event Log And Replay Spine

Implement NEM-1 as the first backend primitive.

Deliverables:

- Append-only log with monotonic `seq`.
- Durable append-before-ack behavior.
- Read and tail filters by type, theme, mission, run, robot, and time.
- Replay builder for one run.
- Anomaly state transitions represented by log events.

Implementation status:

- Added `anomaly/` as an Event Log projection for `anomaly.opened`,
  `anomaly.assigned`, `anomaly.updated`, and `anomaly.closed`.
- Transition timestamps remain in event envelopes; projected records contain
  the current `status`, owner, evidence refs, and closure fields.
- Open `safety` anomalies now block matching capability maturity promotion and
  preset-widening attempts through the policy package.
- Mission reports include opened, closed, and currently open anomaly counts.

Acceptance:

- Corrections append new events instead of mutating old events.
- Replay for a run returns ordered causal events and version pins.
- Existing UI event surfaces read from a projection instead of bespoke state.

### M2: Mission Server Core

Replace ad hoc command submission with NEM-3 Runs and policy issuance.

Deliverables:

- `POST /missions`, `GET /missions/{id}`, and mission completion.
- `POST /runs`, run state machine, approval, rejection, expiry, and replay.
- Server-side principal grants.
- Preset/rule matching, registry checks, and tightening lattice.
- Authorization issuance with write-before-execute.
- Idempotency keys on all mutating operations.

Implementation status:

- Added `mission-api/` as a transport-neutral HTTP+JSON reference binding
  handler over the existing Mission Server, Supervisor Kernel, Scene, Event Log,
  Replay, and Anomaly surfaces.
- Implemented `GET /health`, `POST /missions`, `GET /missions/{id}`,
  `POST /missions/{id}/complete`, `GET /robots`,
  `GET /robots/{id}/verbs`, `GET /robots/{id}/status`, `POST /robots/{id}/stop`,
  `POST /robots/{id}/clear-stop`, `POST /runs`, `GET /runs/{id}`,
  `POST /runs/{id}/approve`, `POST /runs/{id}/reject`,
  `GET /runs/{id}/replay`, `GET /scene`, `GET /entities/{id}`,
  `POST /anomalies`, `PATCH /anomalies/{id}`, and `GET /events`.
- Added server-side bearer token mapping to principals/grants; clients carry
  only tokens, not robot authority.
- Added an EventLog-projected session store for bearer tokens. Session issuance
  and revocation are persisted as `auth.session.*` records, token material is
  stored only as a hash, and Mission API authentication reconstructs
  `(principal, grants)` from that backend.
- Added a Node HTTP server adapter for the Mission API handler. It preserves API
  status codes and JSON response bodies, forwards request headers, parses JSON
  bodies, and returns structured malformed-JSON errors.
- `GET /events` now exposes append-log filtering by event type set, derived
  Attention theme, mission, run, robot, source, and timestamp range in addition
  to `{after, limit}` pagination with opaque `next` cursors; `nemeiactl events
  tail` forwards those filters byte-equivalently.
- Added principal-aware robot verb projection. `GET /robots/{id}/verbs` returns
  injected read/stop verbs by default and uses the configured preset policy plus
  driver manifest when policy is present.
- All mutating Mission API routes enforce `Idempotency-Key`. Mission/Run
  operations use the Mission Server idempotency table, and direct API mutations
  such as robot stop/clear-stop, registry writes, anomaly writes, and Attention
  drain/wait replay the original API response for the same principal, method,
  path, and key.
- Run proposals now fail closed if callers include freshness, scene-dependence,
  precomputed checks, grants, enforcement, streams, or other safety-relevant
  assertions. Scene binding thresholds are server-owned, not proposal args,
  matching NEM-3's requirement that proposals carry intent and context rather
  than safety claims.
- Run proposal args are type-checked before persistence. Non-number, non-finite,
  non-positive duration/watchdog, or non-positive stream-limit values return
  the registry-backed `ARG_OUT_OF_RANGE` error and do not append
  `run.proposed`.
- Run proposals fail before persistence when the requested `robot_id` is not in
  the mission's pinned `robot_ids`, returning the registry-backed
  `ROBOT_NOT_FOUND` error.
- When driver facts are available, run proposals also perform a bounds
  pre-check before persistence. Setpoints or requested stream limits beyond
  driver hard caps or matched policy grants return `COMMAND_BOUNDS_EXCEEDED`.
- Signed stream Authorizations now derive their `enforcement` map from the
  DriverManifest observables: measured or inferred velocity bounds are
  `enforcing`, while unavailable observables such as Go2 force are recorded as
  `advisory` inside the signed artifact.
- Run approval windows are enforced by the Mission Server for both approval and
  rejection decisions. Late decisions move the Run to `expired`, append
  `run.expired`, and return the registry-backed `APPROVAL_EXPIRED` error with
  the original `approval_expires_at` timestamp.
- Kernel authorization lifecycle events are projected back into Mission Server
  Run state. `authorization.accepted` moves a Run to `executing`,
  `authorization.completed` emits `run.completed`, and
  `authorization.aborted`/`authorization.stopped` emit `run.aborted`.
- Mission API approval dispatches the signed Authorization to the configured
  Supervisor and bridges resulting kernel lifecycle events through the Mission
  Server projection before returning the refreshed Run state.
- Run replay reads now enforce the NEM-3 grant boundary: operators may replay,
  and agents require the read grant; generic read-only sessions cannot access
  run replay.
- Mission lifecycle state is enforced at the Mission Server boundary. Completed
  missions reject new run proposals and repeated completion attempts under new
  idempotency keys with the registry-backed `MISSION_NOT_ACTIVE` error.
- Errors return structured JSON bodies with `error_code`, bounded `message`,
  `retryable`, and optional `details`/`recommended_action`; model-visible
  `recommended_action` text is capped at 500 characters and omitted if it fails
  the NEM-9 rendering lint.
- Added operator-only registry routes: `GET /registry`, `POST /registry`,
  `GET /registry/{package}`, and `POST /registry/{package}/{pin|enable|promote|demote|revoke}`.
- Registry operations append `registry.*` events and returned registry state
  includes history refs into the append-only log.
- Registry installs now validate the source-controlled registry-state contract:
  `cap:`/`driver:` SemVer package ids, boolean enable/pin state, maturity enum,
  `artifact:` gauntlet reports, and integer/string history refs.
- Registry installs can validate detached package bundles. When a bundle is
  supplied, the Mission API checks manifest/package identity, hash-pinned
  artifacts, gauntlet-report binding, and the Ed25519 signature against the
  configured trusted package key before writing registry state.
- Mission API error serialization now consults the NEM error-code registry for
  default transport status and retryability metadata.
- Agent principals are forbidden from reading registry state, and open `safety`
  anomalies block capability maturity promotion through the API.
- Added a file-backed append-only Event Log implementation. It replays JSONL
  records on startup, continues monotonic `seq`, deep-freezes reloaded events,
  fails closed on corrupt records, and fsyncs each append before returning.
- The file-backed Event Log now has a reference backup/restore path for local
  deployments. `backup()` validates the current JSONL log before making a
  byte-preserving durable copy, and `restore()` validates the source, rejects
  corrupt or non-monotonic `seq` records, atomically replaces the active log,
  reloads in-memory state, and continues `seq` from the restored tail.
- Added a file-backed Ed25519 signing-key store for Mission Server
  Authorizations. It creates the initial key, persists it across restarts,
  emits `config.signing_key.rotated` on rotation, and fails closed on corrupt
  key records.
- The file-backed signing-key store now enforces private key file permissions:
  newly created key files are `0600`, and loading an existing group/world
  readable, writable, or executable key file fails closed with
  `SIGNING_KEY_STORE_PERMISSIONS` before parsing the private key material.
- Remaining M2 work: none for the reference implementation; production
  deployment still needs operator-selected storage paths and an operational
  backup retention/export policy outside the test harness.

Acceptance:

- A rejected proposal is still a persisted Run.
- Issuance re-evaluates all checks after approval and immediately before
  dispatch.
- Agent principals cannot read registry internals or raw driver protocol.

### M3: Supervisor Kernel And Sim Driver

Build the small control-plane kernel before touching physical Go2 motion.

Deliverables:

- Kernel endpoints: `GET /status`, `POST /stop`, `POST /execute`, `WS /events`.
- Authorization verification in required order.
- Tick loop with clamp saturation and post-clamp `chunk_ack`.
- Watchdog, expiry, upstream-loss, heartbeat, concurrency, and stop handling.
- Sim driver implementing the Driver SPI.
- Kernel failure-injection tests.

Acceptance:

- Replayed, expired, duplicated, wrong-robot, stale-heartbeat, and stop-state
  authorizations are rejected.
- Clamp acks, logs, and driver inputs are byte-identical.
- A discrete grant behaves as a one-chunk stream.

Implementation status:

- Added `supervisor/` with a `SupervisorKernel` and `SimDriver`.
- The kernel verifies Mission Server signed Authorizations, rejects replayed,
  expired, wrong-robot, stale-heartbeat, stop-state, invalid-signature, and
  hard-cap-violating Authorizations, and enforces single active
  Authorization concurrency.
- Streaming grants open chunk channels, validate chunk auth/sequence/fields,
  clamp post-driver hard caps plus only grant limits marked `enforcing` in the
  signed Authorization, emit `kernel.chunk_applied`, and abort to safe state on
  watchdog starvation.
- Discrete grants execute as a one-chunk stream equivalent: bounded moves send
  the clamped setpoint, send zero/safe-state, and complete; native discrete
  actions dispatch through the driver and return to safe state.
- `stop` is idempotent, invalidates active streams, emits stop-state events,
  and remains available independent of Mission API state.
- Stop-state events emitted while an Authorization is active now carry the
  active `mission_id`, `run_id`, and Authorization ref so the run-causal
  control-plane chain remains replayable.
- Idle stop-state events are represented as kernel stop-state state changes
  without claiming run causality. Run-causal Driver SPI events such as
  `driver.safe_state_commanded`, `driver.setpoint_applied`, and
  `driver.native_action` are surfaced only when an active Authorization provides
  `mission_id`, `run_id`, and Authorization refs.
- `upstreamLost` gives the Supervisor host boundary an explicit Mission Server
  connection-loss hook; during an active Authorization it commands safe state,
  emits `authorization.aborted` with `trigger: "upstream_loss"`, and rejects
  subsequent chunks.
- Kernel ticks emit `kernel.status_sample` events at the configured heartbeat
  cadence, using the same NEM-5 plus kernel-state shape as `GET /status`, so
  event streams carry at least one status sample per heartbeat interval.
- Added a small Node HTTP host binding for the Supervisor Kernel. It exposes
  `GET /status`, `POST /stop`, `POST /clear-stop`, `POST /execute`,
  `POST /chunks`, `POST /tick`, `POST /upstream-lost`, and `GET /events?after=N`
  over the same in-memory kernel surface, preserving structured kernel errors
  and post-clamp chunk acknowledgements.
- Added `WS /events` on the same Supervisor host binding. It streams new
  Supervisor events after the requested cursor, including normalized Driver SPI
  events with Supervisor-level sequence numbers. Driver events emitted during an
  active Authorization are annotated with `mission_id`, `run_id`, and the
  Authorization ref.
- Remaining M3 work: none for the reference host implementation.

### M4: Go2 Driver Qualification

Turn the current Go2 integration into a conforming Driver.

Deliverables:

- Go2 `DriverManifest` with action spaces, hard caps, observables, native
  actions, streams, and safe-state facts.
- NormalizedStatus from Go2 telemetry.
- Driver streams for camera and any verified telemetry streams.
- Safe-state implementation for idle, mid-motion, and interruptible native
  actions.
- D1-D7 hardware-in-loop gauntlet report.

Acceptance:

- `status()` stops being fresh when Go2 stops talking.
- Stop and safe state are reachable without Mission Server, Scene, or
  Capability participation.
- The manifest contains measurements; trust status appears only in registry
  state.

Implementation status:

- Added the conforming `SimDriver` reference manifest with measured hard caps,
  normalized status, `camera_front` stream declaration, native `damp`, and
  safe-state facts.
- Added `driver-go2/` as a physical Go2 Driver SPI package with a stable
  transport boundary for Unitree WebRTC/DDS/SDK adapters. It exposes a NEM-5
  `DriverManifest`, normalized Go2 status, `base_velocity_3d` setpoints,
  native sport actions including `damp`, safe-state routing independent of
  Mission Server/Scene/Capability paths, declared Go2 streams, and a D1-D7
  driver gauntlet report builder.
- The Go2 package is covered with a fake Unitree transport that verifies
  heartbeat freshness loss when telemetry stops, safe-state/native-action
  routing, Supervisor Kernel stream integration, stream declarations, and
  deterministic driver report hashing.
- Added a guarded D1-D7 hardware gauntlet runner and report signer. It refuses
  to run without the explicit Go2 motion-risk acknowledgement, requires
  hardware probe hooks for preflight, safe-state timing, command-loss,
  Supervisor-kill behavior, observables audit, telemetry drop, and stream-rate
  verification, and emits a signed-report-ready `GAUNTLET_REPORT` artifact.
- Added `go2-driver-gauntlet`, a small artifact CLI that emits the Go2 driver
  manifest and converts measured D1-D7 outcome JSON plus an Ed25519 private key
  into the signed `GAUNTLET_REPORT` JSON needed by registry evidence.
- Registry package validation now accepts signed driver bundles with embedded
  signed DR `GAUNTLET_REPORT` artifacts. The report package, conformance class,
  required D1-D7 case coverage, result for trusted installs, report digest, and
  Ed25519 signature are validated before registry state is written.
- Added a source-controlled `gauntletReport` contract schema and fixture so
  published DR/CP evidence has the same schema-validation path as the rest of
  the NEM Suite interface records.
- Documented the physical gauntlet procedure in `docs/go2-driver-gauntlet.md`.
- Live read-only Go2 validation reached the powered robot over SSH as `root`
  on `unitree.local`, `10.0.0.78`, and `192.168.123.161`. The robot reported
  Ubuntu 20.04.5 LTS, kernel `5.10.176-rt86+`, `aarch64`, no failed systemd
  units, `wlan0` at `10.0.0.78/24`, `eth0` configured as
  `192.168.123.161/24` with link down, Unitree services including
  `master_service`, `basic_service`, `motion_switcher`,
  `robot_state_service`, WebRTC bridge, video hub, lidar/SLAM/mapping
  processes, and DDS listeners on UDP 7400/7401. This proves non-motion
  connectivity and runtime presence only.
- Frontend Unitree/Go2 integration keeps the real Go2 WebRTC/proxy, status,
  camera, LiDAR, audio, and operator control surfaces isolated in the cockpit
  layer rather than exposing raw Go2 authority to the agent.
- The existing frontend workbench UI shape is preserved while emergency stop,
  reconnect/status badges, media stream props, joystick movement, safe stop,
  obstacle-avoidance toggles, native action dispatch, and file-audio playback
  now route through `frontend/lib/robots/standard/robot-runtime.ts` before
  reaching the Go2 adapter.
- The connection/settings panel now uses the same standard runtime boundary for
  config save/test/connect/disconnect, stream power toggles, obstacle avoidance,
  and low-activity motor state shortcuts while preserving the previous UI.
- The stats panel now builds its normalized telemetry snapshot and visible
  connection, battery, stream, audio, obstacle-avoidance, emergency-stop, and
  error fields from the standard runtime adapter, keeping only pose/motor and
  LiDAR byte diagnostics as driver-specific internals.
- The workbench renderer and stats panel no longer import the Go2 store
  directly. Pose, motor, LiDAR frame, microphone, and byte-count diagnostics are
  exposed through the same standard runtime boundary; the remaining
  driver-specific point-cloud component consumes typed diagnostics as render
  inputs.
- The frontend architecture check now enforces the boundary: direct Go2 store
  imports and `useGo2Store`/`initializeGo2Store` symbols are allowed only inside
  the standard runtime adapter or the driver implementation folder, not in
  operator components.
- Operator-facing robot labels now use the NEM standard surface (`Robot`,
  `Robot Control`, `Robot Config`, normalized telemetry) while Go2/Unitree
  identifiers remain only in adapter internals, driver package names, transport
  paths, and non-user-facing layout keys. Smoke tests guard the default
  workbench, robot settings, and telemetry panels against visible vendor/model
  leakage.
- Added a browser-side standard runtime command recorder behind
  `frontend/lib/robots/standard/`. It records mode selection, native actions,
  stream toggles, obstacle-avoidance requests, safe stop, and joystick state as
  Nemeia-level robot operations before delegating to the vendor adapter, giving
  operator validation and smoke tests an observable standard boundary without
  changing the cockpit UI.
- Go2 transport and UI integration docs live in `docs/unitree-integration.md`.
- Remaining M4 work: run the guarded D1-D7 hardware-in-loop gauntlet on the
  physical Go2 and publish the signed `GAUNTLET_REPORT`; fake-transport tests
  are not hardware certification evidence.

### M5: CLI And Cockpit Rebinding

Make the existing frontend and CLI clients of the Mission API.

Deliverables:

- `nemeiactl` groups: health, robot, scene, entity, mission, run, events,
  replay, anomaly.
- Byte-equivalent `--json` CLI output for API responses.
- Cockpit run approval panel showing evidence refs, predicted sweep, checks,
  enforcement modes, expiry, and abort triggers.
- Always-visible stop and stop-state recovery.
- Replay and anomaly filing views.

Acceptance:

- `nemeiactl robot stop` works whenever Mission Server or Supervisor is
  reachable.
- Approval-required verbs return `awaiting_approval` instead of becoming
  interactive.
- The UI never exposes raw Go2 transport commands as agent-facing authority.

Implementation status:

- Added `cli/` with a `nemeiactl` parser/runner and executable entrypoint.
- Implemented the Gate-1 CLI slice: `health`, `robot list`, `robot status`,
  `robot stop`, `robot clear-stop`, `robot move`, `robot action`,
  `scene get/refresh`, `mission get`, `mission rule get`, `entity get`,
  `run get/approve/reject/replay`, `events tail`, `replay command`, and
  `anomaly create/list/close`.
- Every invocation appends a `tool.call` event carrying argv, principal,
  `turn_id`, and `command_id`.
- API-backed CLI invocations pass that tool-call context to Mission API, which
  authenticates the principal server-side and records one `tool.call` per
  `command_id`; synthetic local commands still append locally.
- `robot stop` routes directly to the Supervisor Kernel and persists a stop
  event in the append-only log; `robot clear-stop` routes through the operator
  recovery API and byte-matches the API body.
- `robot stop` also supports an explicitly configured direct Supervisor
  fallback through `--supervisor-url` / `NEMEIA_SUPERVISOR_URL` when the Mission
  API is unreachable. The fallback records the normal `tool.call` event followed
  by `stop_via_fallback` with the Supervisor response, preserving the Appendix A
  audit trail.
- Approval-required verbs are non-interactive; `robot move` and `robot action`
  call `POST /runs` and return `awaiting_approval` unless `--approve` is
  supplied in local test mode, where the CLI follows with the API approval
  request and returns that API body.
- `nemeiactl` now routes implemented commands through `mission-api/` rather than
  duplicating Mission Server and Supervisor calls.
- Local CLI sim mode wires the sim DriverManifest into Mission Server proposal
  validation, so `nemeiactl robot move` gets the same driver hard-cap
  pre-checks as the Mission API sim path.
- Added HTTP-backed Mission API mode for `nemeiactl` via `NEMEIA_API_URL` or
  `--api-url`; the CLI uses the same `handle()` contract locally and over the
  network.
- Added the frontend Mission Cockpit panel with approval cards, check results,
  grant limits, abort triggers, replay timeline, Attention digest refs, and
  anomaly triage over Mission API projection data.
- Added a Next-hosted Mission Cockpit projection route backed by the reference
  `MissionApi.handle()` contract. It seeds a log-backed Gate-1 reference
  mission, pending approval Run, completed replay Run, scene observations,
  Attention contract, and anomaly through the Mission API, and the cockpit
  panel now fetches that projection instead of static mission fixtures.
- Cockpit approval cards now call the Mission API decision path through
  `POST /api/mission/cockpit/runs/{run_id}/decision`. Approving the pending
  Run issues and dispatches the signed Authorization through the reference
  Supervisor path, refreshes the cockpit projection, and moves replay to that
  Run's causal chain.
- The cockpit Stop controls now call `POST /api/mission/cockpit/robots/{robot_id}/stop`,
  which routes through the Mission API's Supervisor stop path. Mission API now
  bridges `authorization.stopped` Supervisor events back into Run projection and
  replay, so stopping an active stream Run moves it to `aborted` with a
  run-causal event chain.
- The cockpit also exposes operator stop-state recovery through
  `POST /api/mission/cockpit/robots/{robot_id}/clear-stop`, routed to Mission
  API `robot clear-stop`; the recovery control is disabled until the Supervisor
  reports `kernel.stop_state = true`.
- Frontend smoke tests now assert `/api/mission/cockpit` returns Mission API
  health, robot list, pending run, replay events, scene entities, anomalies,
  and Attention contract data, then approve the pending Run and verify the
  refreshed projection reports execution plus replay for that Run, and finally
  stop and clear-stop the robot through Mission API while verifying stop-state,
  aborted Run projection, and recovery.
- Frontend smoke tests also click the operator control mode buttons and verify
  the standard runtime recorder receives only Nemeia `native_action` mode
  records, with no raw vendor transport method or numeric vendor command
  leakage in the validation surface.
- Root `npm run check` now includes the operator frontend check, so the standard
  cockpit boundary, build, architecture rules, and Playwright smoke validation
  are part of the repository conformance gate rather than a separate manual
  step.
- The frontend architecture check now also rejects visible operator/app text
  that exposes vendor/model terms such as Go2 or Unitree outside the driver
  adapter and proxy surfaces. Asset paths and driver internals remain allowed,
  but the cockpit must present the standard `Robot` interface.
- CLI tests include explicit compact JSON byte equivalence against the Mission
  API for implemented API-backed commands, plus the synthetic mission-rule
  command.
- Remaining M5 work: none for the in-memory reference implementation.

### M6: Scene, Ontology, And Binding

Convert the current scene work into NEM-8 log projections.

Deliverables:

- Versioned `label_map.json` and `types.json`.
- `scene.observation` event payloads.
- Scene snapshot projection with robots, hazards, entities, affordances,
  freshness, and provenance.
- Entity details with policy-gated crops.
- Binding checks for entity, affordance confidence, and freshness.
- Initial deterministic World Twin tuple.

Implementation status:

- Scene snapshots now carry per-entity geometry, physics proxy, and physical
  schema (`rigid` or `deformable`) when observations provide geometric facets.
- Added `world-twin/` with deterministic NEM-8 tuple construction and
  `world_ref = sha256(canonical tuple)`.
- Added deterministic AABB body derivation from scene geometry.
- Added `sim.clearance` check output with suite-conformant
  `advisory|enforcing` mode selection per physical-schema class.
- Added `GET /scene?since=ssg_N` projection support that compares the
  historical and current reduced snapshots and classifies `added` and `changed`
  entities instead of treating every post-cursor observation as an addition.
- Added explicit `scene.tombstone` events so removals are log-backed and
  `GET /scene?since=ssg_N` can report removed entities.
- Added v2 relation projection support with explicit `scene.relation` events,
  relation provenance, relation diff counts, and freshness inherited from the
  least-fresh relation endpoint.
- Added `sim.clearance.graduation` evidence reduction. Repeated clearance check
  evidence now produces per-physical-schema `advisory|enforcing` mode maps that
  can feed subsequent `sim.clearance` checks.
- Added a World Twin physics adapter seam. The default deterministic AABB
  adapter remains the reference path, and a precise deterministic 2D adapter
  derives circle/capsule bodies from pose geometry for tighter clearance
  calculations. The selected adapter's engine version is included in the
  deterministic World Twin tuple.
- Remaining M6 work: none for the in-memory reference implementation.

Acceptance:

- Observations never assert entity identity directly.
- Fusion observations reference constituent event `seq` values and avoid
  double-counting.
- Run targets pin only `(entity_id, snapshot_id)` in Authorizations; evidence
  refs stay on the Run.

### M7: Capability Host

Introduce untrusted execution for verbs such as `follow`.

Deliverables:

- Capability package format and manifest validation.
- Sandbox host with read-only package, scratch dir, declared streams, denied
  network by default, and resource limits.
- Lifecycle SPI: describe, bind, start, frames, chunks, observations, abort,
  stop, terminate.
- Capability gauntlet harness in sim.

Acceptance:

- Capabilities cannot call Mission API, registry, or log append directly.
- Malformed chunks are rejected by the kernel.
- Target loss, stream starvation, stop, and stale scene abort through local
  capability-host or kernel paths, not through agent attention.

Implementation status:

- Added `capability-host/` with a host lifecycle over `describe`, `bind`,
  `start`, `on_frame`, `emit_chunk`, `emit_observation`, `emit_event`, `abort`,
  `stop`, and `terminate`.
- The host binds only stream Authorizations that name the installed capability
  package/version and rejects missing capability bindings, implementation
  mismatches, and ungranted required streams.
- Chunks emitted by capabilities are forwarded only to the Supervisor Kernel;
  malformed chunks are rejected by kernel validation.
- Host `stop` and `abort` command the kernel safe state and prevent further
  chunk emission.
- Added a reference `CapabilitySandbox` context passed to capabilities at bind
  time. It enforces read-only package reads, scratch-only writes with byte
  limits, denied network by default, declared network allowlists, and network
  request limits.
- Added a deterministic CP gauntlet report runner for the NEM-10.2 capability
  cases: target vanishes, obstacle enters workspace, stop during contact,
  stream starvation, stale scene, and malformed-chunk fuzzing. The runner uses
  Mission Server issued stream Authorizations, the Capability Host lifecycle,
  and the Supervisor Kernel/Sim Driver enforcement path, then emits a
  replayable report hash.
- Added an async process-isolated capability host and JSON-lines worker
  protocol. Capabilities can run in a separate Node process with a sanitized
  environment, Node permission flags, no child-process or worker-thread grants,
  bounded V8 heap, lifecycle IPC timeouts that kill the worker, and sandbox
  context methods for package reads, scratch writes, and declared network
  accounting.
- The isolated launcher probes for a usable `bwrap` profile and, when
  available, adds an OS network namespace, read-only root bind, empty `/tmp`,
  and die-with-parent process lifetime. Hosts without a working namespace
  primitive fall back to Node permission isolation and must not claim
  OS-level network isolation.
- Remaining M7 work: none for the reference implementation; production
  deployment must verify the selected OS sandbox primitive on the target host
  before promoting third-party capabilities.

### M8: Attention

Replace broad component event prompting with NEM-9 inbox drains.

Deliverables:

- Attention contract materialized from the mission preset.
- CEL predicate compile/type/cost checks.
- Pre-turn and wake seams.
- Deterministic digest rendering with T0 join and T1 coalesce.
- Persisted digest bytes and seam records.
- Rendering lint at package ingest and render time.

Implementation status:

- Added Mission API routes for `GET /missions/{id}/attention`,
  `POST /missions/{id}/drain`, and `POST /missions/{id}/wait`.
- Attention inboxes are keyed by `(mission_id, principal)` and remain
  server-side projections over the Event Log.
- `GET /attention` returns the materialized contract plus pending state.
- `drain` persists an `attention.seam` record and returns the delivered bytes.
- `wait` evaluates the wake predicate and drains with `cause:
  predicate_fired(term|timer)` when it fires; timeout returns pending state
  without advancing the cursor.
- Added a typed bounded CEL subset compiler for wake predicates. Contracts now
  compile predicates at materialization time, reject unknown fields/type
  mismatches, enforce a static cost ceiling, and evaluate compound `&&`/`||`
  predicates over the NEM-9 event/inbox/mission environment.
- Added timer analysis for `inbox.pending_age` predicates. False evaluations
  arm one earliest deadline, Mission API long-poll waits on that deadline, and
  timer wakes are recorded as `predicate_fired(timer)`.
- Predicate runtime errors now evaluate to false and open a warning anomaly
  once per affected event/error while leaving the event for the next scheduled
  seam.
- Presets can now declare an Attention contract template. Mission API
  materializes it with the mission id and principal at inbox creation, and
  preset validation compiles the declared wake predicate before use.
- Remaining M8 work: none for the in-memory reference implementation.

Acceptance:

- Run outcomes, aborts, operator messages, and protected-class advisories are
  delivered verbatim and never condensed.
- Predicate runtime errors create anomalies and do not drop events.
- Replay shows exactly what the agent saw, from persisted digest bytes.

## First Gate Demo

Gate 1 should prove one safe, replayable, bounded physical command on Go2:

```text
1. Operator creates a mission with a preset pinned.
2. Agent proposes a Run for a bounded move or stop-safe native action.
3. Mission Server validates grant, policy, args, bounds, status freshness, and
   approval route.
4. Operator approves from the cockpit.
5. Mission Server re-evaluates checks, persists signed Authorization, and
   dispatches.
6. Supervisor verifies, accepts, clamps, ticks, and sends the Driver setpoints.
7. Stop remains live throughout.
8. Watchdog or duration returns the Driver to safe state.
9. Event Log records the complete causal chain.
10. Replay reconstructs the run and any anomaly can be filed with evidence.
```

Definition of done:

- The physical command cannot execute without a signed Authorization.
- Stop works during execution and blocks future motion until operator recovery.
- Every event in the causal chain carries `run_id`.
- The replay is reproducible from the log plus pins.
- The Go2 driver has at least a provisional gauntlet report for the exercised
  action space.

Reference evidence:

- Added `conformance/` with a Gate 1 simulation drill. It creates a mission,
  proposes and approves a stream Run, executes the signed Authorization through
  the Supervisor Kernel and Sim Driver, verifies post-grant clamp behavior,
  stops while execution is active, bridges kernel events back into the Event
  Log, and proves Replay reconstructs the full run-causal chain from log events
  plus the pinned Authorization.
- This is simulation evidence only; the physical Gate 1 proof still depends on
  running the guarded Go2 D1-D7 gauntlet and a supervised Go2 command.

## Repository Restructure

The repo should move toward this layout:

```text
nemeia/
  contracts/              NEM schemas, registries, fixtures, conformance docs
  conformance/            Gate drills and cross-package NEM proof harnesses
  mission-server/         Mission API, log, projections, registry, issuance
  supervisor/             kernel and driver host boundary
  drivers/
    sim/
    go2/
  capabilities/
    examples/
  cli/                    nemeiactl
  frontend/               operator cockpit
  tools/
    conformance/
    vision/
  docs/
```

Near-term, this can be incremental: add `contracts/`, then introduce
`mission-server/` and `supervisor/` without moving the current frontend until
the API boundaries stabilize.

## Immediate Issue Breakdown

1. Add `contracts/` with initial NEM schemas and registry stubs.
2. Add canonical JSON and Ed25519 signing fixtures.
3. Implement append-only Event Log with monotonic `seq`.
4. Implement Run and Authorization records with lifecycle events.
5. Implement Mission API health, missions, runs, approval, robots, stop, and
   replay skeletons.
6. Implement a sim Driver and Supervisor Kernel tick loop.
7. Add kernel failure-injection tests.
8. Wrap current Go2 status as `NormalizedStatus`.
9. Define the Go2 DriverManifest from measured facts.
10. Add `nemeiactl` as a Mission API renderer.
11. Rebind cockpit status, stop, approval, and replay surfaces to Mission API.
12. Convert perception outputs into `scene.observation` events.
13. Add Scene projection and entity binding checks.
14. Add registry state and preset matching.
15. Add initial Attention pre-turn drain and persisted digest records.

## Open Design Decisions

- Backend language/runtime for Mission Server and Supervisor Kernel.
- Whether the first durable log is Postgres, SQLite, or an embedded append-only
  file plus projection database.
- Exact process boundary between Supervisor Kernel and Driver on the local
  machine.
- Signing key storage and rotation mechanism for local development versus
  deployed robots.
- Which Go2 action space gets Gate-1 qualification first:
  `base_velocity_3d` bounded move or a safer native action such as `damp`.
- Whether the first World Twin is purely geometric and advisory, or absent until
  after Gate 1.

## Migration From Current Plan

The existing refreshed architecture plan should be treated as pre-NEM context.
Its phases map roughly as follows:

| Existing phase | New home |
|---|---|
| Contract Baseline | M0 Contracts and registries |
| App Server / Control Plane Skeleton | M1 Event Log and M2 Mission Server |
| Go2 Read-Only Integration | M4 Go2 Driver status and streams |
| Independent Safety Path | M3 Supervisor Kernel plus M4 Driver safe state |
| Scene State V0 | M6 Scene, ontology, binding |
| Mission Rules And Turn Context | M2 Mission Server presets and runs |
| Bounded Motion With Approval | Gate 1 demo |
| Replay, Mission Evaluation, Anomaly Closure | M1 replay spine plus M5 cockpit |
| Simulation And Operator Drills | M3 sim driver and conformance tests |
| Perception Integration | M6 observations and scene projection |
| Policy / Behavior Executive | M7 Capability Host and later capabilities |
