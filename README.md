# Nemeia

Nemeia gives agents a retained local world: maps, observed objects, supporting
evidence, missions, and execution results. A World Operator assigns missions
and Unit permissions. Perception updates the world independently of reasoning;
Eve owns agent sessions and steps; a local controller owns execution and stop.

SpacetimeDB is the domain authority. Immutable evidence bytes live behind the
local resource gateway. Agent and controller SQLite ledgers retain delivery and
effect receipts, not another copy of the world.

The [protocol](./docs/protocol-spacetimedb.md),
[module schema](./contracts/spacetimedb/src/schema.ts), and
[generated client](./world-client/src/generated/index.ts) define the current
implementation. See [execution status](./docs/implementation-plan/EXECUTION.md)
for the fresh passing software chain: G1 retention, actual G2 agent access,
separate action-free automatic wake, G3's no-motion loop and E7 browser
write/review. Browser evidence is archived outside Playwright cleanup. Final
root checks already passed: software 19/19, configured Eve packaging, and
native guards 3/3. On 2026-09-20, the frontend production build passed and a
fresh safe smoke passed 4 cutover checks plus 5 Chromium checks. Native route
retirement and clean installation are complete; remote CI has not run.

## Software-only setup

Use Node `24.19.0` or newer. Install from the repository root while no owned
composition is running:

```bash
npm run setup:software
npm run check
```

Setup uses the checked root lockfile and standard hoisted npm workspaces.
The pinned runtime is SpacetimeDB `2.10.1`, Eve `0.63.0`, just-bash `3.1.0`,
AI SDK `7.0.105`, and Zod `4.1.12`. The repository is the Eve project root;
`agent/` contains the authored application. Do not run Eve from `agent/` as
though it were a separate application.

`npm run check` runs `check:software`, the zero-inference Eve packaging regression,
and offline native safety-guard tests. `check:software` runs strict TypeScript
and deterministic tests for the selected
module, clients, resources, perception, agent, controller, UI, and conformance
helpers. It does not contact a robot or paid model. Packaging can be checked
without inference:

```bash
npm run check:eve:packaging
```

The old aggregate is retained only as `check:legacy`, outside software gate
evidence. Do not use its old browser/hardware-oriented checks for the native demo.

## Local simulation and mission UI

```bash
npm run dev
```

`dev` selects `dev:ui:loopback`. Open the printed `/missions` URL. This command owns a loopback SpacetimeDB
server, publishes the module, uses generated clients and the resource gateway,
and starts the native mission UI. Its PNG/PCD inputs are explicitly synthetic;
the controller has no physical effect and each Eve evaluation is a short-lived
child using an injected fake model; this is not a resident paid agent.
Software gates run in order: G1 retention/restart, standard G2, action-free
automatic wake, and G3. Browser writes are released only after these pass.
Do not change grants or missions while a qualification phase owns the fixture.
This is a qualification UI, not a resident reasoner: its child Eve evaluations
close after each scenario. Automatic wake has its own report; a standard G2 pass
does not qualify it.

The private `.artifacts/qualification/ui-composition/handoff.json` contains
the URL and scoped operator token-file path, never the token. Enter the token
in the browser's password field; authentication stays in tab memory. Do not put
credentials in a public environment variable, URL, screenshot, or report.

Stop with Ctrl-C. The launcher stops only its owned children, marks its
handoffs unavailable, and retains evidence and database files. It never kills
an existing service to free a port.

For bounded, one-shot qualification including native browser writes and cleanup:

```bash
npm run qualify:software
```

This is `node scripts/run-ui-composition.mjs --verify`. It runs the same sequence,
then the guarded native E7 mutation flow, archives browser evidence outside
Playwright's output directory, and stops its owned services on success or failure.
Reports must say `result: pass` and `claimable: true`; a diagnostic or failed
check is not a completed gate. See the [runbook](./docs/implementation-plan/RUNBOOK.md)
for held-run sequencing, cancellation cleanup, report locations, and recovery.
Native robot recordings, live sensing, physical navigation, remote deployment,
and paid inference each require separate qualification and authorization.

## Resident Eve application

The production application is separate from the qualification launcher. From
the repository root, build with the pinned Eve CLI and run the built app as a
long-lived loopback service. Configure the enrolled agent's database token,
world/agent IDs, a persistent delivery ledger, an explicitly selected model and
approved provider access. Administrator and World Operator tokens do not belong
in the agent process.

Eve workers lazily initialize authenticated reads/actions and never dispatch
automatic wakes. Start the separate, supervised bridge explicitly with
`bash agent/scripts/world-wake-bridge.sh`. It requires the **same absolute local
`NEMEIA_AGENT_LEDGER` path** as Eve, a loopback
`NEMEIA_EVE_WAKE_URL=http://127.0.0.1:<EVE_PORT>/wake`, matching HMAC configuration
and an owner principal of `issuer:subject`. A kernel `flock` permits only one
bridge for that ledger. Busy or ambiguous deliveries remain visibly held until
public Eve lifecycle evidence resolves them; no TTL or restart clears them. The
[resident startup instructions](./docs/implementation-plan/RUNBOOK.md#resident-eve-startup)
list the required environment and storage. Starting this mode can initiate model
calls; it is not part of the no-paid-inference demo. The separate local,
action-free automatic-wake report passed with an injected model. Standard G2
still reports `automaticWakeTested: false`; neither report qualifies a paid
provider or physical deployment.

## Implementation layout

| Path | Responsibility |
| --- | --- |
| `contracts/spacetimedb/src/` | Private tables, authorized views/procedures, reducers and shared values. |
| `world-client/` | Generated native client, scoped subscriptions and lossless JSON projections. |
| `world-resources/` | Bounded immutable-byte publication/read and reference-closure verification. |
| `perception/` | Acquisition/replay, map products and evidence publication. |
| `agent/` | Eve application, world context, trusted just-bash commands and delivery ledger. |
| `local-controller/` | Execution reconciliation, stop/watchdog and durable effect receipts. |
| `frontend/` | Native World Operator mission, object, map and evidence views at `/missions`. |
| `conformance/`, `scripts/` | Separate fixture diagnostics and actual loopback qualification. |

Legacy prototype packages remain on disk, outside the selected root workspaces,
pending separately reviewed source retirement. They are
not a second authority or compatibility layer for the selected implementation.
No legacy cockpit or robot-proxy route belongs in the software-only workflow.

## License

[Apache License 2.0](./LICENSE).
