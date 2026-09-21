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
for retained qualification evidence. The default test command is the root
Playwright E2E flow. Lower-level software, packaging, and safety checks remain
available under explicit `internal` commands. Remote CI is separate.

## Software-only setup

Use Node `24.19.0` or newer. Install from the repository root while no owned
composition is running:

```bash
npm run setup:software
npm test
```

Setup uses the checked root lockfile and standard hoisted npm workspaces.
The pinned runtime is SpacetimeDB `2.10.1`, Eve `0.63.0`, just-bash `3.1.0`,
AI SDK `7.0.105`, and Zod `4.1.12`. The repository is the Eve project root;
`agent/` contains the authored application. Do not run Eve from `agent/` as
though it were a separate application.

`npm test` and `npm run check` run the installed Playwright `1.61.0` runner with
the root `playwright.config.ts`. The E2E fixture starts the existing
`run-ui-composition.mjs --verify` as an isolated child with the native no-motion
world and fake model. It owns its services and cleans them up.

For interactive Playwright UI mode and the saved HTML report:

```bash
npm run test:ui
npm run test:report
```

UI mode serves only on `127.0.0.1:9324`; the report serves only on
`127.0.0.1:9323`. UI mode may force tracing even though the checked-in config
disables tracing. The UI shows safe phase/step labels, allowlisted JSON
summaries, and approved post-auth PNGs. Only allowlisted summaries and approved
screenshots are attached; raw authenticated traces/logs are excluded.

The lower-level aggregate stays separate:

```bash
npm run check:internal
```

It runs the existing software, configured Eve packaging, and native safety
guards. `check:software` still runs the selected strict TypeScript and
deterministic checks for the module, clients, resources, perception, agent,
controller, UI, and conformance helpers. It does not contact a robot or paid
model. Packaging can be checked without inference:

```bash
npm run check:eve:packaging
```

The old aggregate is retained only as `check:legacy`, outside software gate
evidence. Do not use its old browser/hardware-oriented checks for the native demo.
The existing frontend credential-free smoke remains a separate lower-level
check.

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

The root E2E test is the bounded, one-shot qualification path. It starts the
same isolated composition, waits for each safe phase, checks the allowlisted
reports, attaches the approved post-auth PNGs, and verifies cleanup:

```bash
npm test
```

The underlying `node scripts/run-ui-composition.mjs --verify` launcher remains
an implementation detail for the E2E fixture. Do not start it as a concurrent
second run. Reports must say `result: pass` and `claimable: true`; a diagnostic
or failed check is not a completed gate. See the
[runbook](./docs/implementation-plan/RUNBOOK.md) for cancellation cleanup,
report locations, and recovery.
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
