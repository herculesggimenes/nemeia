# Nemeia Interface Specifications (NEM Suite)

**Status:** Draft (pre-Gate-1 · living until Gate 1 · frozen at Gate 2)
**Suite version:** 0.2.1

This suite defines every interface in Nemeia precisely enough that each part can be implemented by an independent team, in any technology, and composed by contract. It specifies *semantics and normative data shapes*, not implementations: HTTP+JSON is the reference binding; any transport preserving the stated semantics, ordering, and error behavior conforms.

## Overview

Nemeia is a mission system for operating robots with AI agents in the loop: the authorization, safety-interlock, and evidence layer between an agent that proposes actions and hardware that performs them. It maintains one invariant:

```text
The robot only ever does something bounded, authorized, stoppable,
and provable.
```

### System shape

```text
   Agent (CLI)          Operator (cockpit)
        └────────┬────────┘
                 │  Mission API (NEM-3)                    POLICY PLANE
        ┌────────▼─────────┐                               (seconds)
        │  MISSION SERVER   │◄──► Scene / World Twin (NEM-8)
        │  runs · policy    │◄──► Attention (NEM-9)
        │  authorizations   │◄──► Event Log (NEM-1)
        └────────┬─────────┘
                 │  signed Authorization (NEM-2)
        ┌────────▼─────────┐     ┌──────────────────┐     CONTROL PLANE
        │    SUPERVISOR     │◄────│ CAPABILITY HOSTS  │    (milliseconds)
        │  kernel (NEM-4)   │chunks  planners · VLAs   │
        └────────┬─────────┘     │  teleop (NEM-6)    │
                 │  Driver SPI    └──────────────────┘
        ┌────────▼─────────┐
        │  DRIVER (NEM-5)   │
        └────────┬─────────┘
               Hardware
```

Two planes with different clock speeds; the only artifact crossing between them is a signed Authorization.

### Trust model

| Layer | Trust | Basis |
|---|---|---|
| Agent | untrusted proposer | proposals carry zero authority; verbs are policy-projected |
| Capabilities | untrusted executors | sandboxed; every chunk clamped; certified by gauntlet |
| Mission Server | trusted policy authority | issues authorizations; all client authority lives here |
| Kernel (Supervisor) | trusted computing base | small, frozen, no plugin path; holds even if everything above is compromised |
| Driver | trusted computing base | hardware-in-loop certified (D1–D7) |

The agent speaks only entity-level verbs (`approach`, `follow`, `fold`) and never authors motion numbers. Learned policies and planners execute only inside per-tick clamps and declared bounds. Humans approve intents, not milliseconds. The kernel enforces limits it reads from no one.

### Life of a run

```text
1  agent:      POST /runs  {verb: "follow", target: ent_person_01}
2  server:     policy rule → affordance binding → arg/bounds checks
3  operator:   approves (evidence crop + predicted sweep on panel)
4  server:     evaluates all checks NOW, persists the signed
               Authorization, then dispatches        (write-before-execute)
5  kernel:     verifies signature/expiry/single-use; opens chunk channel
6  capability: consumes streams, emits setpoint chunks
7  kernel:     clamps every chunk per tick; feeds watchdog; driver actuates
8  any fault:  watchdog silence, abort trigger, stop, upstream loss
               → driver's declared safe state
9  log:        every step above is an event carrying run_id
10 anyone:     GET /runs/{id}/replay reconstructs the whole chain
```

### Reading guide

| You are implementing | Read |
|---|---|
| Mission Server | NEM-0–3, 7–9 |
| Supervisor kernel | NEM-0, 2 (§2.4), 4 |
| A driver | NEM-0, 5 |
| A capability | NEM-0, 6, 8 (§8.4), 9 (§9.5) |
| A client / the CLI | NEM-0, 3 (+ Appendix A) |
| Certification / QA | NEM-10 + the D-matrix (NEM-5 §5.5) |

The companion architecture document is narrative and explanatory; where the two differ, this suite is normative.

## The noun ledger (normative orientation)

One noun per question; everything else in this suite is a field, a state, or a projection of one of these:

```text
Log            what happened?
Run            what is being attempted?
Authorization  what may physically occur right now?
Preset         who may ask which robot for what?
Scene          what do we believe?            (projection of Log)
Twin           what do we predict?            (derivation of Scene)
Attention      when must the agent notice?    (projection of Log)
Driver         what is this machine?
Capability     how is this verb performed?
Kernel         what can never happen?
```

---

# NEM-0 · Common Conventions

The key words **MUST**, **MUST NOT**, **SHALL**, **SHOULD**, **MAY** are per RFC 2119/8174.

Layout conventions borrowed deliberately: IETF RFC (numbered parts, keywords, registries, security considerations), OpenAPI 3.x (operation tables; machine-readable docs are per-part annexes), AsyncAPI (stream channels), JSON Schema (payload annexes), ABNF/RFC 5234 (CLI grammar), W3C-style numbered conformance sections, IANA-style registries.

## 0.1 Primitives

```text
ID          "<prefix>_<opaque>". Prefix is a naming convention, not a
            registry. Generation SHOULD be ULID/UUIDv7 (sortable).
TIMESTAMP   RFC 3339 UTC, millisecond precision.
DURATION    integer milliseconds unless the field name says otherwise.
UNITS       SI, encoded in field names: _mps, _rps, _ms, _m, _n, _pct.
VERSION     records: integer schema_version. Packages (capabilities,
            drivers, presets): SemVer 2.0.0.
CANONICAL   signed/hashed JSON is canonicalized per RFC 8785 (JCS).
SIGNATURE   Ed25519 over canonical JSON: "ed25519:<base64>".
PRINCIPAL   operator | agent | capability | system.
```

## 0.2 Error object

```json
{
  "error_code": "STALE_ROBOT_STATUS",          // NEM-10 §R1
  "message": "Robot status is 2400 ms old; required <= 500 ms.",
  "details": { "check": "freshness.robot_status", "age_ms": 2400 },
  "recommended_action": "Re-read status and retry."
}
```

Success responses have no `ok` flag; an error is signaled by transport status + presence of `error_code`. `retryable` is a column of the error-code registry (NEM-10 §R1). `message` ≤ 500 chars. `recommended_action` is agent-visible and MUST pass the NEM-9 §9.5 rendering lint.

## 0.3 Mechanics

**Idempotency:** every mutating Mission API operation MUST accept an idempotency key; replays return the original result. **Pagination:** `{limit, after}` → `{items, next}`, `next` opaque. **Time authority:** the Mission Server timestamps policy-plane records; the Supervisor timestamps control-plane records; source-device times live in payloads only. **Auth:** bearer tokens mapping server-side to `(principal, grants)`; clients carry no authority. **Extensions:** unknown fields ignored on read, preserved on round-trip; new required fields bump `schema_version`.

## 0.4 One storage primitive

The append-only Log (NEM-1) is the only storage primitive in the suite. Every other stateful surface is either a **state machine pinned by log records** (Run, Mission, Anomaly, Authorization) or a **projection over the log** (Scene, Inbox/Attention, Replay, Reports). Implementations MAY materialize projections; they MUST be reproducible from the log plus pinned versions.

## 0.5 Vocabulary rule

Every non-blocking evaluation mode in the suite uses one word pair: `advisory | enforcing`. (`advisory` = evaluated, logged, surfaced, never blocks; `enforcing` = may block or clamp.) No synonyms (`shadow`, `soft`, etc.) are conformant.

## 0.6 Field admission rules (normative for spec changes)

A field enters or survives a schema only if some component makes a different decision because of it. Standing rejections:

```text
DERIVABLE DUPLICATE   computable from another field → only the source
                      of truth ships (exception: a signed artifact MAY
                      embed a derivable field required for it to serve
                      as self-contained evidence; this MUST be noted)
SELF-LICENSING        trust states (maturity, verified) never live in
                      manifests; only where the org writes them
OPINION               manifests declare measurements; policy makes
                      judgments (no risk/quality fields in manifests)
TWO NAMES, ONE THING  every duality gets one spelling suite-wide
PREMATURE DIAGNOSTIC  observability fields wait in a diagnostics annex
                      until a consumer exists
VENDOR LEAKAGE        a normalized shape contains nothing a second
                      robot could not populate identically
```

---

# NEM-1 · Event Log, Projections, and Replay

**Purpose.** The system's source of truth and every consumer's substrate.

## 1.1 Envelope

```json
{
  "seq": 48211,                       // per-log monotonic; THE identity
  "schema_version": 1,
  "source": "kernel:go2",             // one attribution string:
                                      // kernel:<robot> | driver:<id>@<ver>
                                      // cap:<id>@<ver> | perception:<id>@<ver>
                                      // mission-server | operator:<id> | agent:<mission>
  "event_type": "kernel.zero_command_sent",   // namespaced; NEM-10 §R2
  "severity": 0,                      // 0 info · 1 warning · 2 critical
  "timestamp": "…",
  "robot_id": "go2",                  // optional
  "mission_id": "msn_…",              // optional
  "run_id": "run_…",                  // REQUIRED on any event in a run's
                                      // causal chain (incl. rejections)
  "refs": [48190, "auth_…", "artifact:crop_…"],
  "payload": { }
}
```

## 1.2 Operations

| Op | Semantics |
|---|---|
| `append(event)` | assigns `seq` + `timestamp`; durable before return |
| `read(filter, cursor, limit)` | by themes/types/run/mission/robot/time; ordered by `seq` |
| `tail(filter)` | server-push stream |

## 1.3 Projections (normative definitions)

```text
Scene      reduction of perception/operator/sim/capability observation
           events → belief snapshots (NEM-8)
Inbox      per-(mission, principal) themed cursor + digest tiers
           (NEM-9)
Replay     all events where run_id = X, ordered, joined to the run's
           Authorization(s), with every version pin needed to re-derive
           derived artifacts bit-for-bit
Report     counts/summary over a mission's events; generated on demand
```

## 1.4 Anomaly record (the one stateful record beside Run/Mission/Authorization)

```json
{ "id": "anm_…", "schema_version": 1,
  "severity": "info|warning|safety",
  "mission_id": "…", "run_id": "…",
  "capability": "cap:…@…", "driver": "go2@1.4.0",
  "expected": "…", "observed": "…", "evidence_refs": [ … ],
  "suspected_cause": "…", "owner": "…",
  "closure_criteria": "…", "status": "open|closed" }
```

Timestamps of transitions live in the log events, not the record. Open `safety` anomalies MUST block preset widening and maturity promotion; MUST NOT block stop/abort paths.

## 1.5 Conformance

1. `seq` strictly monotonic, never reused; events immutable (corrections are new events with `refs`).
2. Append durable before acknowledgment (backs write-before-execute).
3. Every physical-consequence event carries `run_id`.
4. `source` is populated by the emitting plane, never by clients.
5. Replay output MUST be reproducible: same log + same pins → same bytes.

---

# NEM-2 · Authorization

**Purpose.** The single artifact that can cause physical action. A discrete command is a stream of length one whose watchdog equals its duration; the artifact therefore has one shape and one lifecycle.

## 2.1 Schema

```json
{
  "id": "auth_…",
  "schema_version": 1,
  "robot_id": "go2",
  "run_id": "run_…",
  "mission_id": "msn_…",
  "grant": {
    // exactly one of:
    "stream": {
      "action_space": "base_velocity_3d",        // NEM-10 §R3
      "limits": { "max_speed_mps": 0.15, "max_yaw_rps": 0.2 },
      "geofence": { "frame_id": "map", "polygon": [[x,y], …] },
      "watchdog_ms": 100,
      "max_duration_ms": 120000
    },
    "discrete": {                                 // = one embedded chunk
      "type": "bounded_move | native:<name>",
      "setpoint": { "vx_mps": 0.15 },
      "duration_ms": 400
    }
  },
  "enforcement": { "max_speed_mps": "enforcing",
                   "max_force_n": "advisory" },   // §2.3
  "target": { "entity_id": "ent_…", "snapshot_id": "ssg_…" },  // pin only;
                                                  // evidence refs live on the Run
  "streams_granted": ["camera_front"],            // consent inside the signature
  "abort_triggers": [ { "target_stale": { "max_ms": 700 } },
                      "geofence_exit", "battery_low",
                      "stream_silence", "operator_stop" ],      // NEM-10 §R4
  "capability": { "verb": "follow", "impl": "cap:follow-entity@0.3.2" },
  "checks": [ /* §2.2 — this IS the safety-decision record */ ],
  "issued_at": "…",                               // signed evidence
  "expires_at": "…",                              // enforced bound
  "signature": "ed25519:…"
}
```

## 2.2 CheckResult

```json
{ "name": "policy.approval",            // NEM-10 §R5
  "result": "pass|fail",
  "mode": "advisory|enforcing",
  "details": { "approval": { "operator": "op_…", "decided_at": "…" } } }
```

`advisory` checks MUST NOT block issuance and MUST be persisted identically.

## 2.3 Enforceability (observables rule)

For every field in `grant.stream.limits`, the issuer MUST consult the driver's `observables` (NEM-5 §5.2):

```text
measured                → "enforcing" (clamped per tick)
inferred_from_current   → "enforcing", declared error band recorded in checks
none                    → the bound MUST be refused, OR issued as
                          "advisory" AND surfaced on the approval panel
                          before consent
```

The `enforcement` map MUST be embedded in the artifact: a signed authorization is self-contained evidence of which bounds were enforceable.

## 2.4 Lifecycle (one state machine)

```text
issued → dispatched → accepted → active → completed
            │             │        ├─► aborted(trigger)
            │             │        ├─► stopped(operator)
            │             └─► rejected(reason)
            └─► expired                    (invalidated = stopped|expired)
```

1. `issued` MUST be durably persisted (write-before-execute) before `dispatched`.
2. Single use: the kernel remembers consumed ids ≥ 24 h; re-presentation → `AUTHZ_REPLAYED`.
3. Every transition emits an event carrying `run_id`.
4. Kernel verification order: signature → expiry → single-use → robot match → hard caps → heartbeat → stop state → concurrency.
5. Clock-skew tolerance for expiry: configurable, ≤ 250 ms.

---

# NEM-3 · Mission API and Runs

**Purpose.** The single client-facing API. UI, CLI, and agent are clients of the same surface; server-side grants differ.

## 3.1 The Run

One resource carries an attempt from proposal to result:

```text
states: proposed → awaiting_approval → authorized → executing
        → completed | rejected(reason) | aborted(trigger) | expired
```

```json
{ "id": "run_…", "schema_version": 1,
  "mission_id": "msn_…", "robot_id": "go2",
  "verb": "follow", "args": { "standoff_m": 1.5 },
  "target": { "entity_id": "ent_…", "snapshot_id": "ssg_…",
              "evidence_refs": ["obs_…", "artifact:crop_…"] },
  "reason": "…", "expected_result": "…",          // human context; optional
  "proposed_by": "agent",
  "state": "executing",
  "approval": { "operator": "op_…", "decided_at": "…",
                "expires_at": "…" },
  "authorization_ids": ["auth_…"],
  "result": { "summary": "…", "observed": { … } } // terminal states only
}
```

`run_id` is the causal chain key for the entire suite. A rejected proposal is a run in state `rejected` and is counted in mission reports.

## 3.2 Resources

| Method & path | Grants | Semantics |
|---|---|---|
| `POST /missions` / `GET /missions/{id}` / `POST /missions/{id}/complete` | operator / any / operator | lifecycle; pinned `(preset_id, version)` |
| `GET /robots` · `GET /robots/{id}/status` | any | NEM-5 §5.4 shape, cached |
| `GET /robots/{id}/verbs` | any | projection: pinned preset ∩ caller's principal; server-injected `stop` + read verbs always present; excluded verbs absent, not marked |
| `POST /runs` | agent, operator | propose (§3.3) |
| `GET /runs/{id}` | any | full run state |
| `POST /runs/{id}/approve` · `/reject` | operator | body `{reason?}`; idempotent; `APPROVAL_EXPIRED` after expiry |
| `GET /runs/{id}/replay` | operator, agent(read) | NEM-1 §1.3 reconstruction |
| `POST /robots/{id}/stop` | **any principal** | never queued; ack ≤ 100 ms (state-set, not robot confirmation) |
| `POST /robots/{id}/clear-stop` | operator | explicit recovery |
| `GET /scene` · `GET /scene?since=ssg_N` | any | NEM-8 projections |
| `GET /entities/{id}` (`?include=crop` policy-gated) | any | entity + provenance |
| `GET /missions/{id}/attention` | owning principal | read-only contract (NEM-9) |
| `POST /missions/{id}/drain` · `/wait` | owning principal | inbox drain; long-poll (predicate ∪ extra terms, timeout) |
| `POST /anomalies` · `PATCH /anomalies/{id}` | operator | file / own / close |
| `/registry/**` | operator | install/pin/enable/promote/demote/revoke; **no agent read** |

## 3.3 Proposal processing (normative order)

principal grant → verb-in-policy → affordance binding (NEM-8 §8.4) → arg schema → bounds pre-check → approval routing. First failure returns the registered error (`VERB_NOT_IN_POLICY`, `VERB_NOT_APPLICABLE`, `ENTITY_NOT_IN_SCENE`, `AFFORDANCE_LOW_CONFIDENCE`, `SCENE_STALE`, `ARG_OUT_OF_RANGE`, `COMMAND_BOUNDS_EXCEEDED`).

Proposals MUST carry zero safety-relevant assertions; any freshness/scene-dependence field → `UNKNOWN_FIELD_FORBIDDEN`.

## 3.4 Conformance

1. Identical requests under different tokens yield grant-appropriate results (all authority server-side).
2. Issuance (run → authorized) re-evaluates all checks at that moment; approval time is spent **before** validation.
3. The API MUST NOT expose raw driver protocol or registry contents to `agent` principals.

## Appendix A · `nemeiactl` binding

The CLI has no semantics of its own; it is a rendering of NEM-3.

```abnf
invocation = "nemeiactl" SP group [SP verb] *(SP positional) *(SP flag)
group      = "robot" / "scene" / "entity" / "mission" / "run" /
             "events" / "replay" / "anomaly" / "health"
flag       = "--" 1*(ALPHA / "-") ["=" value / SP value]
```

Rules: (A1) `--json` output is byte-equivalent to the API response body. (A2) Never interactive; approval-required verbs return `awaiting_approval` immediately. (A3) Unknown verbs/args are validated server-side, not locally. (A4) Every invocation emits a tool-call event with argv, principal, `turn_id`. (A5) `nemeiactl robot stop` works whenever the Mission Server or Supervisor is reachable; a direct-Supervisor fallback, if configured, logs `stop_via_fallback`. (A6) Exit codes (frozen): `0` ok · `3` blocked · `4` invalid · `5` infra · `6` timeout · `7` auth.

---

# NEM-4 · Supervisor Kernel

**Purpose.** The safety kernel's complete surface: four endpoints, nothing else.

## 4.1 Operations

| Op | Semantics |
|---|---|
| `GET /status` | NEM-5 §5.4 status + kernel state (stop flag, active authorization, heartbeat age, safe-state condition) |
| `POST /stop` | set stop state; idempotent; never queued |
| `POST /execute` | body: Authorization; verifies per NEM-2 §2.4.4; a `stream` grant opens the chunk channel |
| `WS /events` | kernel + driver events; ≥ one status sample per heartbeat interval |

Chunk channel: capability host publishes ActionChunks to `chunks/{auth_id}`; kernel publishes `chunk_ack {seq, applied_setpoint}` (post-clamp values) back.

## 4.2 ActionChunk (3 fields)

```json
{ "auth_id": "auth_…", "seq": 141,
  "setpoint": { "vx_mps": 0.12, "vy_mps": 0.0, "yaw_rps": 0.05 } }
```

The action space is fixed by the grant. Receipt time at the kernel is the authoritative time. `seq` strictly increasing; only the latest valid chunk is held; unknown setpoint fields → `CHUNK_MALFORMED`. A chunk is advice: the applied setpoint is the kernel's post-clamp ack, and capabilities SHOULD consume acks to observe their own clamping.

## 4.3 Kernel semantics

1. **Tick loop** (tick ≤ 20 ms for continuous spaces): read stop flag → validate active authorization live → select latest valid chunk (or the embedded discrete setpoint) → clamp every field against `min(kernel hard caps, driver caps, grant limits)` in kernel units → forward to driver → feed watchdog.
2. **Clamping** is saturation, not rejection; post-clamp values are what's logged and acked, bit-identical to what the driver received.
3. **Watchdog/deadman**: no valid chunk within `watchdog_ms`, or `duration_ms` elapsed, or authorization expired → command the driver's **declared safe state** (NEM-5 §5.3). Local timer; zero upstream dependency.
4. **Stop**: flag checked every tick; when set: drive safe state, reject all authorizations, invalidate the active one, keep emitting events. Clearing requires the operator-granted Mission API call.
5. **Heartbeat**: driver status older than the kernel's configured threshold → unsafe → reject/abort.
6. **Upstream loss**: Mission Server connection lost while an authorization is active → safe state.
7. **Prohibitions**: no expression languages; no scene/world consultation; no configuration from capabilities; no endpoints beyond §4.1; no plugins.

## 4.4 Conformance

Kernel invariants I1–I8 (architecture §6) verbatim, accepted by the failure-injection suite (NEM-10 §10.2). Plus: ack/log/driver-input byte-identity for applied setpoints.

---

# NEM-5 · Driver SPI and Manifest

**Purpose.** The hardware boundary: translate the kernel ISA to one vendor's machine; declare the facts the safety case consumes.

## 5.1 SPI

```text
manifest() → DriverManifest
connect(config) / disconnect()
status() → NormalizedStatus              // §5.4
set_setpoint(action_space, setpoint)     // applied ≤ 1 kernel tick
execute_discrete(action, params, deadline_ms) → ack|fault
command_safe_state() → ack|fault         // begins actuating ≤ 1 tick;
                                         // kernel retries until ack
open_stream(name) → frames
events() → DriverEvent*                  // acks, faults, vendor warnings
```

## 5.2 DriverManifest

```json
{
  "driver": "go2", "version": "1.4.0",
  "action_spaces": [{
      "name": "base_velocity_3d", "kind": "continuous",
      "hard_caps": { "vx_mps": 0.25, "yaw_rps": 0.35 },
      "observables": { "velocity": "measured", "force": "none" }
      // measured | inferred_from_current | none; velocity and force
      // MUST be enumerated for every action space
  }],
  "native_actions": [
      { "name": "sit",  "interruptible": true },
      { "name": "damp", "interruptible": true, "safety_action": true },
      { "name": "flip", "interruptible": false, "duration_ms": 1800 } ],
      // discrete by definition
  "streams": [
      { "name": "camera_front", "type": "rgb", "hz": 30 },
      { "name": "microphone", "type": "audio", "hz": 16000,
        "sensitive": true } ],
  "safe_state": {
      "kind": "zero_velocity | hold_posture | vendor:<name>",   // kernel-coupled, NEM-10 §R3
      "balance_loop": "not_required | vendor_onboard | driver_maintained",
      "max_entry_ms": 300,
      "on_total_loss": { "behavior": "decays_to_zero | holds_last | vendor:<name>",
                         "within_ms": 300 }        // measured hardware fact
  }
}
```

## 5.3 Safe-state contract

1. Entering the safe state MUST NOT require Mission Server, scene, or capability participation.
2. `hold_posture` platforms MUST keep the balance loop alive in the safe state; zero-torque output is a nonconforming implementation of the safe state on a `hold_posture` platform.
3. `max_entry_ms` is measured; the kernel's worst-case-motion arithmetic consumes it.
4. `on_total_loss` describes the true hardware behavior when the driver process itself dies, measured, and is the residual-risk statement of the safety case.

## 5.4 NormalizedStatus

```json
{ "robot_id": "go2", "heartbeat_age_ms": 120,
  "battery": { "pct": 82, "power_headroom": "nominal|reduced|critical" },
  "safe_state_active": false,
  "pose": { "frame_id": "map", "position": [x,y,z],
            "rotation_xyzw": […], "age_ms": 120 },
  "faults": [],
  "vendor_display": { "mode": "balance_stand" } }   // optional passthrough;
                                                    // non-normative, display only
```

`power_headroom` reflects burst-power capacity (stumble recovery), distinct from remaining runtime; the `battery_low` abort trigger keys off it.

## 5.5 Certification (hardware-in-loop; the driver badge)

```text
D1  safe state from idle, from mid-motion, from every interruptible
    native action
D2  safe state under command loss (kill the setpoint stream)
D3  process kill (kill -9 the Supervisor); observed behavior matches
    safe_state.on_total_loss; dynamically stable platforms end upright
D4  measured safe-state entry ≤ declared max_entry_ms
D5  observables audit: "measured"/"inferred" channels agree with
    instrumented ground truth within declared error bands
D6  heartbeat honesty: status stops when the robot stops talking
D7  stream declarations (rates, sensitivity) verified
```

Certification outcomes live in the signed `GAUNTLET_REPORT` (NEM-7 §7.3), never in the manifest.

---

# NEM-6 · Capability SPI and Manifest

**Purpose.** Untrusted executors: sandboxed processes turning (authorization + target + declared streams) into action chunks.

## 6.1 Lifecycle SPI (host ↔️ capability, local IPC)

```text
describe() → CapabilityManifest
bind(authorization, target, stream_endpoints) → ready | refuse(reason)
start()                                  // chunks may flow
on_frame(stream, frame)
emit_chunk(ActionChunk)                  // → kernel channel
emit_observation(Observation)            // → log; evidence only (NEM-8)
emit_event(type, payload)                // themed, attributed, templated
abort(trigger) / stop()                  // host-invoked; chunks MUST cease
                                         // within one watchdog interval
terminate() → RunResult
```

## 6.2 CapabilityManifest

```json
{
  "capability": "follow-entity", "version": "0.3.2",
  "publisher": "community:roboflow-labs",
  "verbs": [{ "verb": "follow",
      "args": { "standoff_m": { "type": "float", "min": 1.0, "max": 3.0 } },
      "applies_to": ["person", "trackable"],
      "doc": "Follow an entity at a standoff distance." }],   // linted, §9.5
  "requires": { "action_spaces": ["base_velocity_3d"],
                "streams": ["rgb@>=15hz"] },
  "dependencies": [ { "name": "sort-tracker.onnx",
                      "sha256": "9be1…" } ],
  "network": "none",                              // or enumerated host:port,
                                                 // policy-gated
  "grant_defaults": { "limits": { "max_speed_mps": 0.2 },
                      "abort": [ { "target_stale": { "max_ms": 700 } } ] }
}
```

Maturity is a registry column (NEM-7 §7.2); manifests carry no trust state.

## 6.3 Sandbox contract (host-enforced)

Read-only package + scratch dir; network deny-all unless declared and policy-allowed; exactly the declared streams (sensitive ones need the org-policy row); no Mission API, no registry, no log writes except `emit_*`; declared resource limits — starvation trips the stream watchdog, which is the designed failure mode.

---

# NEM-7 · Policy, Presets, and Registry

## 7.1 Preset

As architecture §4/§8: immutable versions (`name` is a mutable pointer); `min_capability_maturity`; `rules[]` each with `verb, robots, principals, impl {capability, version(exact)}, applies_to, args, grant {limits, watchdog_ms, max_duration_ms}, freshness, streams, network, approval {required, scope}, abort_triggers`; provenance + signature. Server-injected invariants at projection time: `stop` for every principal and the read verbs; presets cannot remove them.

## 7.2 Registry state (org-written; the only home of trust)

```json
{ "package": "cap:follow-entity@0.3.2",
  "enabled": true, "pinned": true,
  "maturity": "experimental | trusted",     // enum widens at Gate 7
  "gauntlet_report": "artifact:…",          // signed conformance run
  "history": "…log refs…" }
```

Issuance MUST check maturity ≥ preset minimum **live** (revocation/demotion is instant, no preset edits). Installed ≠ authorized: issuance independently verifies org-enabled + policy rule + active mission + approval.

## 7.3 Package format

`manifest.json + artifacts/ (hash-pinned) + SIGNATURE + GAUNTLET_REPORT`. Registry ops: `install, pin, enable, promote, demote, revoke`.

## 7.4 Tightening lattice (write-time enforced)

```text
numeric limits min() · durations min() · sets subset-only · network
narrow-only · maturity raise-only · approval escalate-only ·
abort_triggers add-only
```

Violations → `LATTICE_VIOLATION` at write time, never at issuance. Mandatory lint: *no rule grants a continuous pass-through action space to the `agent` principal.*

## 7.5 Matching

verb materializes on a robot iff a rule exists for (verb, robot, principal) AND capability `requires` ⊆ driver declarations AND live maturity ≥ preset minimum.

---

# NEM-8 · Scene, Ontology, and World Twin

**Purpose.** Belief in, projections out, physics derived. The Scene is a projection of the Log (NEM-0 §0.4); there is no scene store.

## 8.1 Ontology (two versioned tables)

```text
label_map.json   detector label → type; versioned with the perception
                 config that emits the labels
types.json       one row per type: identity + affordances + physics
```

```json
{ "type": "core.garment",
  "affordances": ["graspable", "foldable", "deformable"],
  "physics": { "proxy": "convex_hull", "dynamic": true,
               "deformable": true, "dim_priors_m": [0.5, 0.4, 0.1] },
  "protected": false }
```

Rules: verbs bind to affordances only; capabilities MAY require, MUST NOT assign affordances; protected classes (`core.person`, `core.animal`, `core.fragile|hot|hazard`) are non-extensible and policy-referable; an entry is admitted only if a verb, a policy rule, or the physics builder binds to it. **Relations** (`on_top_of`, `visible_from`, …) are a v2 extension; v2 relations carry provenance (`observed | derived:sim`) and inherit the minimum freshness of their inputs.

## 8.2 Observation (an event payload, `event_type: scene.observation`)

```json
{
  "streams": ["camera_front"],
  "labels": ["hoodie"], "confidence": 0.81,
  "geometry": { "type": "bbox_2d | bbox_3d | pose_3d | pointcloud_ref | mesh_ref",
                "frame_id": "camera_front", … },
  "artifact_refs": ["artifact:frame_…"]
}
```

An observation carries one or both facets; at least one MUST be present:

```text
semantic     labels + confidence        (RGB detectors, segmentation)
geometric    geometry + frame_id        (LiDAR clusters, depth cameras,
                                         3D detectors)
```

`streams` names the driver-declared input streams (NEM-5 §5.2). `geometry.frame_id` is the coordinate frame of the geometry; transformation to the map frame is the emitting source's responsibility, pinned for replay by the `source` version.

**Fusion sources** (e.g., a LiDAR + RGB-projection + segmentation pipeline) are perception sources like any other: `source: "perception:fusion-rgb-lidar@1.2"`, emitting observations that MAY carry both facets. A fused observation MUST list the `seq` of each constituent observation in the envelope `refs`; the scene reduction MUST NOT double-count a constituent superseded by a fusion that references it.

`source` on the envelope is the attribution (perception, operator, `cap:…`, sim). Entity association is performed by the scene reduction; observations do not assert identity. The reduction merges facets per entity: type and affordance confidence derive from semantic facets; pose, shape, and the twin's collision proxies derive from geometric facets. Facets carry independent freshness — binding (§8.4) evaluates the semantic facet's freshness; the twin (§8.5) evaluates the geometric facet's. Writers: perception, operator tags, sim derivations, capability observations; all enter as observations; the agent writes nothing.

## 8.3 Projections

`GET /scene` → `{scene_snapshot_id, ontology_version, label_map_version, freshness_ms, robots[], hazards[], entities[{id, type, affordances(conf), freshness_ms}]}` — compact, model-facing.
`GET /scene?since=ssg_N` → `{added, changed, removed, coalesced_counts}` — the same cursor-and-reduce primitive as the attention drain.
Entity identity MUST be stable across snapshots (tracking/re-ID; Gate-4 acceptance). Id churn is a defect class.

## 8.4 Binding

At proposal: entity in current snapshot → verb's required affordance present with confidence ≥ threshold and freshness ≤ limit → pin `(entity_id, snapshot_id)` into the run's target (evidence refs on the Run; pin only in the Authorization). Failures: `ENTITY_NOT_IN_SCENE | VERB_NOT_APPLICABLE | AFFORDANCE_LOW_CONFIDENCE | SCENE_STALE`.

## 8.5 World twin

```json
{ "scene_snapshot_id": "ssg_…", "ontology_version": 7,
  "label_map_version": 12, "builder_version": 3,
  "engine_version": "box3d-0.1.x",
  "inflation_policy": "conf_linear_v1", "seed": 42 }
```

`world_ref` is defined as the content hash of this tuple (an alias, never stored independently). Builder is a pure function: identical tuple → identical world, bit-for-bit. `sim.clearance` is a check whose `mode` graduates `advisory → enforcing` **per physical-schema class** (rigid may graduate while deformable stays advisory).

---

# NEM-9 · Attention

**Purpose.** The agent's perceptual channel: one inbox, one CEL wake predicate, seam-scheduled digests. Keyed by `(mission, principal)` — there is no session resource.

## 9.1 Contract (materialized from the preset at mission bind)

```json
{ "mission_id": "msn_…", "principal": "agent",
  "state_filter": ["run.own", "mission.lifecycle", "entity.bound",
                   "scene.affordance_match:foldable",
                   "proximity.advisory"],          // NEM-10 §R8
  "wake_predicate_cel": "…",
  "budget": { "max_pending": 50 },
  "digest_version": 2, "predicate_env_version": 1 }
```

`run.own` and `mission.lifecycle` are server-injected and irremovable. Introspection is read-only; no mutation surface exists for agent principals.

## 9.2 CEL environment

Variables: `event {theme, type, severity, robot_id, entity_id, source, at, attrs}`, `inbox {pending_count, pending_age, themes, max_severity}`, `mission {id, principal, turn_active, bound_entity}`. Constants `INFO=0, WARNING=1, CRITICAL=2`. Compiled + type-checked at preset install; static cost ceiling; no custom functions. Runtime error → `false` + anomaly + the event still drains at the next scheduled seam. Time-dependent terms: after each false evaluation, arm exactly one timer at the earliest instant the predicate could flip.

## 9.3 Seams

```text
pre-turn    unconditional drain at every turn start        REQUIRED
wake        predicate-created turn for idle sessions        REQUIRED
agent-step  earliest mid-turn tool boundary                 OPTIONAL (v1)
```

Classes are urgency floors over one cursor; drains are idempotent; spurious wakes drain empty and cost nothing; `wait` = long-poll on (predicate ∪ extra terms). Seam record (logged): `{seam_at, cause: scheduled | predicate_fired(term|timer) | manual, cursor_range, digest_version, digest_ref}`. Predicate identity is derivable from the mission's pinned preset version.

## 9.4 Digest

One digest per drain. Three tiers, applied in order, each only when needed:

```text
T0 join        default: all pending events rendered verbatim, one
               block, newest last. No summarization.
T1 coalesce    applied per high-rate theme only when the digest would
               exceed budget: latest value + count + first/last
               timestamps. Deterministic; the rendering templates and
               coalesce rules are versioned together as digest_version.
T2 condense    optional, per-deployment: a fast model condenses T1
               output that still exceeds budget.
```

Invariants across all tiers:

1. **Verbatim class.** Run outcomes, aborts, operator messages, and protected-class advisories are delivered word-for-word, first in the digest, and MUST NOT pass through T2.
2. **Delivered bytes are the record.** The rendered digest is persisted with its seam record; replay reproduces what the agent read from the persisted digest, not by re-derivation.
3. **T2 containment.** The condenser receives only lint-passed input, runs with no tools, and its output passes the §9.5 lint before delivery; its output is data, never instruction.
4. **Nothing silent.** `cursor_range` and coalesce/drop counts are always present; raw events remain in the log; every digest line resolves to its constituent events.

## 9.5 Rendering lint

Applies to every third-party or system string that reaches a model context: verb `doc`, event detail, digests, `recommended_action`. Templated slots only; length caps; no imperatives addressed to the agent's instructions or identity; no executable markup; attribution preserved. Runs at package ingest and at render. This is a conformance surface: an attention channel is a prompt-injection channel unless built not to be.

## 9.6 The advisory guarantee

For every registered abort trigger, the triggering path MUST be capability-host or kernel local, and the corresponding theme event MUST be emitted *after* the reaction's state change. No control-plane reaction may depend on delivery through this part.

---

# NEM-10 · Conformance, Registries, Change Control

## 10.1 Conformance classes

```text
MS  Mission Server   NEM-0..3, 7..9
SV  Supervisor       NEM-2 §2.4, NEM-4
DR  Driver           NEM-5 (incl. D1–D7 on hardware)
CP  Capability       NEM-6 + NEM-9 §9.5 (doc lint)
CL  Client           NEM-3 Appendix A, or the NEM-3 client subset
```

Conformance is claimed by publishing class + suite version + signed `GAUNTLET_REPORT`.

## 10.2 Test suites

**Kernel failure-injection (SV):** process kill mid-motion; watchdog starvation; replayed/expired/duplicated authorizations; stop races; heartbeat staleness; clamp saturation vectors; discrete-as-stream equivalence (a discrete grant behaves exactly as a one-chunk stream). **Capability gauntlet (CP):** target vanishes; obstacle enters workspace; stop during contact; stream starvation; stale scene; malformed-chunk fuzzing — deterministic in the twin, seeded, replayable. **Driver matrix (DR):** §5.5 D1–D7.

## 10.3 Registries (IANA-style; additions by RFC; values never reused)

```text
R1 error codes (with retryable column)   R2 event types (namespaced)
R3 kernel-coupled: action spaces, safe-state kinds
   (additions require a kernel qualification cycle)
R4 abort triggers (with parameter schemas)
R5 check names                            R6 ontology core types
R7 affordances                            R8 attention themes
```

## 10.4 Versioning and change control

Suite SemVer; parts independently versioned; records carry integer `schema_version`. Pre-Gate-1: living drafts. Gate 1→2: changes require updated tests. Post-Gate-2: public RFC + replay-impact statement + migration note + operator changelog. Any change making a historical replay non-reconstructible is rejected by definition. Every schema change MUST cite NEM-0 §0.6 for each field added.

## 10.5 Security considerations

Authority is server-side per-principal; clients are formatters. Signed artifacts use JCS; key rotation is a Supervisor config event. All third-party text reaching a model context passes §9.5. Sandboxes are deny-by-default. Manifests may not self-license (§0.6). The kernel has no plugin path, no expression evaluator, no scene dependency; its threat model is "everything above me is compromised," and clamps, safe state, single-use, and stop MUST hold in that condition.

---

# Annex A · Implementation packets (delegation map)

| Packet | Parts | Depends on | Acceptance |
|---|---|---|---|
| P1 Contracts & annexes (schemas, registries) | NEM-0, 10 | — | schema CI |
| P2 Event log + projections engine | NEM-1 | P1 | §1.5 tests |
| P3 Kernel | NEM-4, NEM-2 verify path | P1 | failure-injection suite |
| P4 Sim driver | NEM-5 (fake impl) | P3 | D-matrix in sim |
| P5 Mission core (Runs, issuance, lattice) | NEM-3, 7, NEM-2 issue path | P1, P2 | issuance + lattice tests |
| P6 CLI | NEM-3 App. A | P5 | byte-equivalence tests |
| P7 Go2 driver | NEM-5 | P3 | D1–D7 on hardware |
| P8 Scene + ontology | NEM-8 | P2, P5 | binding + identity tests |
| P9 World twin | NEM-8 §8.5 | P8 | determinism tests |
| P10 Attention | NEM-9 | P2, P5 | seam + injection red-team |
| P11 Capability host | NEM-6 | P3, P8 | gauntlet harness |
| P12 Replay & reports | NEM-1 §1.3 | P2, P5 | reconstruction tests |

P1–P6 = Gate 1 · P7 = Gate 2 · P8–P9 = Gate 4 · P10 = Gate 5 · P11 = Gate 7 substrate.