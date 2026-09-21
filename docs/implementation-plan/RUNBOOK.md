# Local validation runbook

The qualification commands below use synthetic evidence, an injected model,
and a no-motion controller. They never access a robot or paid provider. The
separate resident Eve startup section describes deployment configuration;
enabling its model requires separate authorization. Neither path qualifies or
enables physical action.

## Install once from the repository root

Use Node `24.19.0` or newer and the checked root lockfile:

```bash
npm run setup:software
```

Stop the owned composition before installing. Setup uses the standard hoisted
npm workspace layout and skips lifecycle scripts; it does not alter global
credentials or Git hooks. Do not use nested installation for Eve: its generated
Nitro hosts resolve runtime dependencies from the project root. Eve `0.63.0`,
AI SDK `7.0.105`, just-bash `3.1.0`, SpacetimeDB `2.10.1`, and the compatible
Zod peer `4.1.12` are exact root dependencies.

The repository root is the Eve project root; `agent/` contains its authored
files. Run discovery, build and startup checks from the root, not `cd agent`:

```bash
npm run check:eve:packaging
```

This check starts only owned loopback processes, requests health, and cleans
them up. It never sends a prompt or creates a session. `NEMEIA_PACKAGING_MODEL`
may override its installed-documentation model example; passing this check
does not qualify any model. Production `NEMEIA_EVE_MODEL` remains explicit
deployment configuration.

Packaging also checks **configured** `info` and `build` against
an owned rejecting loopback stub, with World/wake environment and a retained
busy ledger. Compiler imports must leave its bytes and busy state unchanged
and make no network attempts. The actual configured regression passed in
`eve-packaging/run-1639299-1789941747537/report.json`; the earlier zero-inference
packaging pass did not cover configured compiler imports. Reports use unique
`eve-packaging/run-*/report.json` paths and a path-only `latest.json` pointer,
leaving the earlier evidence intact.

## Testing

The default task is the root Playwright E2E flow:

```bash
npm test
```

`npm run check` is the same E2E alias. It uses the installed Playwright
`1.61.0` runner and `playwright.config.ts`; it does not add the lower-level
software checks. The E2E fixture starts the existing
`scripts/run-ui-composition.mjs --verify` as one isolated child with the native
no-motion world and fake model. Do not start another composition concurrently.

For Playwright's browser-based UI and report server:

```bash
npm run test:ui
npm run test:report
```

No Playwright plugin is part of this workflow. If interactive inspection is
needed, use Playwright's built-in UI mode.

The UI binds to `127.0.0.1:9324`; the report binds to `127.0.0.1:9323`.
Specifying the UI host and port makes Playwright open a browser tab instead of
requiring a desktop UI launch. UI mode can force tracing even when the checked-in
config disables it. The UI exposes safe phase/step labels, allowlisted JSON
summaries, and approved post-auth PNGs—not the full authenticated DOM or a
network trace. Only allowlisted summaries and approved screenshots are attached;
raw authenticated traces/logs are excluded.

The lower-level aggregate remains explicit:

```bash
npm run check:internal
```

`check:internal` retains the prior software, configured packaging, and native
safety-guard checks. A passing lower-level suite does not establish G1, G2, or
G3. The existing frontend credential-free smoke remains available as a separate
internal check, outside the default E2E gate.

`npm run dev` still selects `dev:ui:loopback`. The former prototype aggregate
and old MissionServer drill remain under explicit `check:legacy` commands, not
the default E2E or internal gate.

## Loopback qualification

The default local composition provisions the official project-local
SpacetimeDB `2.10.1` toolchain, chooses a verified free loopback port, builds,
publishes, generates the TypeScript client, attaches the real resource gateway
and perception adapter, then restarts the owned server over retained data:

```bash
npm run qualify:local-simulation
```

This lower-level command writes `composition.json`, `g1-loopback.json`, and
`g3-loopback.json` in a unique directory under
`.artifacts/qualification/local-simulation/`. It does not replace the full
sequence below. A nonzero exit requires inspection;
never convert a failed check into a pass. G1 is claimable only when its report says
`result: pass` and `claimable: true`. G1 evidence includes post-restart
reopening of the resource gateway, full bounded reads and SHA-256 checks for
the fixture image/PCD plus retained map references, same-body replay with no
new observation/map rows, changed-body immutable-identity rejection, and
missing/corrupt reference rejection.

The complete bounded software qualification is driven by the root E2E test:

```bash
node scripts/provision-spacetimedb.mjs
npm exec --workspace=frontend --no -- playwright install chromium
npm test
```

Provision tools separately from qualification. The E2E fixture invokes
`node scripts/run-ui-composition.mjs --verify`: actual G1 retained restart,
native no-motion safety startup, standard G2, action-free automatic wake, G3,
then guarded native browser E7
mutations. Each subprocess has a deadline; failure stops later gates and
triggers graceful cleanup of owned processes. It never changes a failed check
to pass. No robot or paid provider is involved.

The startup preflight preserves fail-closed module bootstrap. With zero
executions in a fresh Simulation world, it starts the enrolled no-motion
controller, confirms its native safe/unlatched state, closes its claim session,
and publishes a new stationary Unit observation through the gateway in the
retained frame. G1 acquisition times and map history are unchanged. No
controller claim loop remains active when G2 proposes its test request.

Current acceptance status is in [EXECUTION.md](EXECUTION.md#current-measured-state).
A public eval pass alone is insufficient: automatic wake must also pass its
bounded process-exit, owned-descendant and mission-cleanup checks before G3.

For an interactive UI retained after those core gates (without automatic browser
mutations), run:

```bash
npm run dev:ui:loopback
```

It writes `.artifacts/qualification/ui-composition/handoff.json` with the
loopback URI, database name, resource root, frontend URL, and private
mode-600 operator credential path. The credential itself is never placed in
`NEXT_PUBLIC_*`, a URL, a report, or process output; enter it manually in the
browser password field. The shared worker handoff is
`.artifacts/qualification/current-handoff.json`, also mode `600`, and contains
paths only. Do not change missions/grants before the `g3-complete-ui-ready`
phase. Stop the launcher with
`SIGINT`/`SIGTERM` so it cleans only its owned child processes and marks the
handoff unavailable. Fresh reports are under
`.artifacts/qualification/ui-composition/composition-<pid>-<time>/qualification/`; the
private sequencing marker is under that run directory and contains no
credentials.
The launcher is not a resident reasoner: its child Eve evaluations close after
their scenarios. Standard G2 still reports `automaticWakeTested: false`.
The separate `automatic-wake.json` must report `G2-automatic-wake`, pass,
claimable, `automaticWakeTested: true`, zero execution mutations, and all checks
true. Its adapter closes before any G3 release marker is written.

During a held debugging run, use `npm run qualify:g3:held` only after the G2
sequence has completed. It verifies a current-run `g2-complete.json`, reopens
both standard and automatic reports, and verifies their hashes and all checks.
A stale, failed, or manually bypassed marker cannot release G3. A manually
rerun standard G2 report alone does not update that marker. The held G3 command reuses the retained database, generated
bindings, credentials and resource gateway without republishing. G3 uses a new
synthetic acquisition; it never retimes retained G1 observations.

If a G2 run leaves a never-claimed request in `Cancelling`, its owner must first
release an exclusive cleanup window. Close only the explicitly allocated IDs:

```bash
node scripts/close-held-g2.mjs exec_<allocated-id>
```

This cleanup-only runner uses the current private handoff, the real scoped
controller and resource gateway, and a retained cancellation ledger. It never
runs Eve, G3, or an executor intent. It accepts only synthetic G2 missions in a
Simulation world. If the fake Unit has no pose, it records a new explicitly
synthetic stationary origin in the existing frame—not a target pose or a
historical measurement. After reconciliation and the committed observation,
it attests the stopped state again and samples actual wall-clock proof time.
The report is under the held run's `g2-cancellation/cleanup-report.json`.
Return the mutation window to G2 only after all checks pass and the controller
session has closed. Do not use this path for a claimed or unknown physical effect.

For the lower-level adapter harness, the module path is provided through
`NEMEIA_LOOPBACK_ADAPTER`; it must export `createLoopbackAdapter`. The adapter
starts the real local SpacetimeDB-backed world, exposes a loopback endpoint, and
performs process restart itself or through the supplied process supervisor.

```bash
NEMEIA_LOOPBACK_ADAPTER=/absolute/path/to/adapter.mjs \
NEMEIA_SPACETIMEDB_URI=http://127.0.0.1:3000 \
npm run qualify:loopback:adapter
```

The command rejects non-loopback endpoints, requires an explicit scoped
identity, writes reports under `.artifacts/qualification/`, and always cleans
up a process it started. It exits as blocked when the adapter or required
evidence is missing. Do not convert a blocked report to pass by editing JSON.

Fresh compositions and the current held fixture use separate persistent
publisher/admin, World Operator, agent, perception and controller credential
files under the run directory. The shared handoff includes distinct
`adminTokenFile` and `operatorTokenFile` paths. Only G2's permission
revocation/restore probe uses the admin client; mission/grant operations use
the World Operator, and G3's Eve action factory never opens an admin client.
Credential files are mode `600`
and only fingerprints are reported. It never sets a public operator-token
environment variable. An explicitly requested occupied port fails closed; the
default launcher selects a run-unique free loopback port and never kills an
unowned process.

## Resident Eve startup

This is the authored production application, not `dev:ui:loopback` or the
injected-model eval fixture. Run the resident Eve application and one explicit
world wake bridge under the host's process supervisor. Eve workers initialize
read/projection/action access lazily from authenticated session/step operations;
compiler imports and workers never start automatic dispatch. The bridge alone
owns that transport. Both must share the **same absolute local
`NEMEIA_AGENT_LEDGER` path**. This is a single-host deployment, not NFS or a
multi-host SQLite ownership scheme.

The Runtime handoff defines `bash agent/scripts/world-wake-bridge.sh` as the
operational entrypoint. Fresh configured packaging and core qualification
after the import/lifecycle fix remain release checks. The startup recipe is
not evidence of actual automatic waking, and must not be tried against the
held qualification world without its allocated mutation window.

Before starting, provision the persistent world and immutable resource storage.
Explicitly enroll an Agent identity in the module, configure that agent's read
scope, and let a World Operator assign missions and any Simulation Unit grant.
The Eve host receives only that agent's SpacetimeDB token—not the publisher,
World Operator, perception, or controller token. Perception, the controller,
and the operator's independent mission reconciliation timer remain separate
host responsibilities; `eve start` does not start them.

Prepare an OS-protected environment file outside the repository and model
filesystem, mode `600`. Replace every placeholder below with deployment
configuration; no credential values are supplied here:

```dotenv
NEMEIA_WORLD_URI=http://127.0.0.1:<WORLD_PORT>
NEMEIA_WORLD_DATABASE=<PERSISTENT_DATABASE_NAME>
NEMEIA_WORLD_ID=<ENROLLED_WORLD_ID>
NEMEIA_AGENT_ID=<ENROLLED_AGENT_ID>
NEMEIA_WORLD_TOKEN=<SCOPED_AGENT_SDK_TOKEN_FROM_PRIVATE_CREDENTIAL_STORE>
NEMEIA_AGENT_LEDGER=/absolute/private/persistent/nemeia-agent.sqlite

NEMEIA_AGENT_OWNER_PRINCIPAL_ID=<ISSUER>:<SUBJECT>
NEMEIA_AGENT_OWNER_ISSUER=<ISSUER>
NEMEIA_AGENT_OWNER_SUBJECT=<SUBJECT>
NEMEIA_WORLD_AUTH_ISSUER=<ISSUER>
NEMEIA_WORLD_AUTH_AUDIENCE=<APPROVED_WAKE_AUDIENCE>
NEMEIA_WORLD_AUTH_SUBJECT=<SUBJECT>
NEMEIA_WORLD_AUTH_SECRET=<PRIVATE_HMAC_SECRET>
NEMEIA_EVE_WAKE_URL=http://127.0.0.1:<EVE_PORT>/wake

NEMEIA_EVE_MODEL=<QUALIFIED_PROVIDER_MODEL_ID>
AI_GATEWAY_API_KEY=<APPROVED_GATEWAY_CREDENTIAL>
NEMEIA_INSTRUMENTATION_MODE=local-noop
EVE_TELEMETRY_DISABLED=1
EVE_TRACES=off
```

`NEMEIA_WORLD_TOKEN` currently accepts the token value in the protected host
environment, not a filename. Load it privately; never put it in a CLI argument,
browser bundle, report, or sandbox file. Eve's string model identifier uses AI
Gateway; model access is separate from both database and wake authentication.
No worker-only model alias is a deployment model. Diagnostic export stays off
in this example and is not a runtime safety dependency.

The wake URL must point to this same Eve service's HTTP loopback `/wake` route,
not the frontend, database, or `/eve/v1/session`. The dispatcher signs a
short-lived HS256 bearer token; the authored `nemeia-world` channel verifies
the configured issuer, audience and secret, then requires the exact configured
owner `issuer:subject`. Use the subject alone for `NEMEIA_WORLD_AUTH_SUBJECT`,
not the full owner principal or a SpacetimeDB identity. Starting the bridge
without its required URL/auth fails closed. Do not start the bridge when
automatic dispatch should remain off; setting a wake URL alone never makes
Eve workers dispatch.

The custom `/wake` route is the implemented self-hosted auth provider for world
delivery. It does not configure Eve's default session API. This repository has
no authored `agent/channels/eve.ts` login policy: the framework default rejects
unconfigured production callers, and its development principal is not the
configured Nemeia owner. Do not substitute anonymous auth or use a browser
session endpoint to bypass the owner check. Exposing interactive or remote
Eve access requires its own reviewed route policy; it is not provided by the
loopback qualification.

From the repository root, build and start the resident process with protected
configuration. Configured `info`/`build` must be side-effect free and must not
touch the ledger or contact World/wake endpoints; the packaging regression
checks that explicitly. The build command below needs only the selected model
identifier. These are configuration examples, not unattended test commands:
starting the operational bridge with provider access can initiate billable
inference as soon as useful world work is observed.

```bash
NEMEIA_EVE_MODEL='<QUALIFIED_PROVIDER_MODEL_ID>' node node_modules/eve/bin/eve.js build
node --env-file=/absolute/private/nemeia-agent.env node_modules/eve/bin/eve.js start --host 127.0.0.1 --port <EVE_PORT>
```

In a separate supervised process, load that same trusted environment and start
the bridge. For an interactive shell example, make the private environment file
shell-compatible (quote its values); do not source model-authored files:

```bash
set -a
. /absolute/private/nemeia-agent.env
set +a
bash agent/scripts/world-wake-bridge.sh
```

The launcher canonicalizes the absolute ledger path and holds its
`.wake-owner.lock` inode with nonblocking kernel `flock`. A second bridge exits
73 before opening SQLite or connecting. Kernel ownership ends on process exit
or crash; the lock file may remain and must not be unlinked while a bridge can
run. Eve workers share the WAL but never compete as automatic-wake owners.

Choose a free port and use it in both `--port` and the wake URL. Supervise the
Eve app and bridge separately, with the repository root as working directory. Retain
`.eve/.workflow-data` and the agent SQLite ledger (including WAL/SHM while
open); they have different purposes and must not be replaced by an eval's
temporary state. Use consistent, quiesced backups rather than copying an open
SQLite main file alone. Retain the world database, resources and controller
ledger independently. Stop the bridge and Eve app through their own supervisors;
SIGINT/SIGTERM closes the bridge's subscriptions/timers and settles its aborted
in-flight transport before closing the WAL. Neither process shutdown cancels
physical/domain work or stops the other services.

Ledger open/restart never clears busy state. A reservation is recorded before
channel `from.send`. Busy sessions remain visibly `held` until public Eve
turn/session lifecycle records a release. A lost send result or crash before
session binding leaves an uncertain reservation held, not resent; another
channel attempt gets HTTP 409. An old `session.waiting` tail is not proof that a
newer delivery finished. Investigate via Eve's authenticated public session
stream and deployment-owner intervention; there is no TTL, implicit reset,
stale-PID guess or automatic ambiguity-recovery API. Never clear WAL records
to make the bridge appear ready. Must-handle sources remain pending separately
from send acceptance. See the [bridge handoff](../../agent/scripts/world-wake-bridge.md).

In another terminal, a health probe performs no inference:

```bash
curl --fail http://127.0.0.1:<EVE_PORT>/eve/v1/health
```

A healthy server is not evidence of an authenticated turn or automatic waking.
The installed Eve docs describe local workflow persistence and route auth in
`node_modules/eve/docs/guides/deployment/self-hosting.md` and
`node_modules/eve/docs/guides/auth-and-route-protection.md`. Host egress and
remote exposure still require separate review; just-bash is not a network
isolation boundary. Action-free automatic waking is qualified for the local
software composition with its injected public/mock model; standard G2 still
reports `automaticWakeTested: false`. Paid providers, physical sensing/action,
and remote production wake remain unqualified.

## Reports and failure triage

Reports retain dependency versions, fixture digest, mode, evidence checks and
failure details. A report with `mode: mock-contract` is diagnostic evidence.
For G1/G3, a pass requires `mode: loopback-spacetimedb`, process restart,
retained data after restart, and identical scoped identity. G3 also requires
independent actual generated evidence for assignment, grant, trusted command,
controller admission/claim, durable measured receipt, reviewed progress,
subscription-driven safe cancellation, and idempotent retry. For G2, a pass
also requires the real Eve step lifecycle, authenticated just-bash reads,
same-step pinned context, next-step fresh context, revoked-access denial, and
a world change observed while the injected fake model is thinking.

The earlier preserved G1/G2/G3 reports have empty `versions` objects. Use
[EXECUTION.md](EXECUTION.md#evidence-provenance-without-rewriting-reports) for
the separately checked installed versions, root lock/manifest hashes and report
hashes. Do not edit an old proof file to fill missing provenance. Runtime
configuration documentation is not additional qualification evidence. Fresh
reports include actual installed Node/Eve/SDK/TypeScript/tool versions and link
an immutable mode-600 inventory containing lock, schema, generated-source and
module hashes. Existing proof files cannot be overwritten.

Fresh `--verify` browser logs, six screenshots and a machine report are retained
inside that composition directory, outside `frontend/test-results`. The original
E7 report/screenshots from run `29cd139f` were removed when Playwright cleaned its
old parent output directory. Its recovered summary is labeled historical; only
the fresh browser run can satisfy the final release evidence.

If the loopback command fails:

1. Check the adapter export and endpoint first.
2. Confirm that credentials are scoped and represented only by a fingerprint.
3. Confirm process cleanup before retrying; do not reuse a leftover service.
4. Record the concrete API mismatch in `EXECUTION.md` and return it to the
   World, Control, or Runtime owner.

## Safety gates

The software-only CI definition is `.github/workflows/software.yml`: manual
dispatch, read-only contents permission, Node 24.19.0 and separate dependency,
pinned CLI and Chromium provisioning. It calls `npm run check` once; that
command owns the bounded full-system Playwright E2E lane, and the workflow then
builds the frontend separately. The workflow has no secret inputs or artifact
upload step; private raw logs and evidence remain in local run directories. It
does not run legacy smoke tests. Remote execution requires manual dispatch.
Pages deployment is unchanged.

Normal configuration cannot enable an unqualified physical adapter. A physical
qualification requires separate supervised evidence for G3 and Q5. Resource
bytes must arrive through the authenticated resource gateway; a direct database
resource reference or caller-supplied URL is a conformance failure.
