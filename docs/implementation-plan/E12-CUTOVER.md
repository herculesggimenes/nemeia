# E12 root cutover preparation

Status: **E12 software-only cutover complete locally**. The accepted fresh
composition `composition-1679973-1789946537584` passes G1, G2, action-free
automatic wake, G3 and native E7 with `claimable: true` and verified owned
cleanup. Native default routes/APIs are retired. Root lock reconciliation,
authorized clean setup, configured Eve packaging, the frontend production build,
and the fresh read-only native smoke all pass. Remote CI, physical operation,
paid providers and deployment remain unrun and unqualified.

## Applied root change

[`e12-root-cutover.patch`](e12-root-cutover.patch) is retained as the reviewed
pre-application diff, not a second command to run. Its changes were applied
with `apply_patch` after E7 acceptance and explicit coordinator release:

- Root `npm run check` → the selected strict TypeScript/runtime checks, configured
  Eve packaging regression and offline native safety-guard tests; root
  `npm run dev` → `dev:ui:loopback`.
- Default workspaces limited to module, generated client, resources,
  perception, Eve application/eval fixture, local controller, conformance and
  frontend. This stops installing the prototype CLI as a root workspace.
- The former aggregate check and simulation drill retained under explicit
  `check:legacy` names, outside software gate evidence. Their source/tests are
  not deleted. These commands have not been run as part of cutover preparation.
- `qualify:loopback` uses the concrete local simulation; the opt-in external
  adapter diagnostic is explicitly named `qualify:loopback:adapter`.
- Old protocol/review pages become short retirement notices pointing to the
  selected module/protocol and evidence. No compatibility transport is added.

The historical patch does not contain the subsequent lockfile reconciliation.
That clean setup passed at 22:15 UTC, after validated owned services stopped.
It retained exact dependency versions and removed installed legacy workspace
links and the `nemeiactl` bin. Source packages, driver primitives, stored data
and Git history were preserved. No files have been staged or committed.

## Read-only inbound audit

A TypeScript AST traversal of import/export declarations and literal dynamic
imports found **zero legacy-domain imports in 125 selected production files**:
module `src`, world-client `src`, resources `src`, perception `src`, controller
`src`, and the authored agent root/lib/channels/instrumentation. Agent eval
fixtures and old conformance diagnostics are not counted as production.

| Remaining inbound path | Current behavior | Cutover responsibility |
| --- | --- | --- |
| Root `package.json` check chain | Now selects strict software checks, packaging and native guard. | Applied; former aggregate is explicitly historical. |
| Root workspaces → `cli/package.json` bin | Prototype CLI imports MissionApi, MissionServer, EventLog, SceneProjector and SupervisorKernel. | Removed from default workspace metadata; verify installed bin absence after authorized clean setup. No CLI compatibility wrapper. |
| `conformance/src/gate1-sim-drill.ts` | Imports prototype MissionServer/EventLog. | Retained under `check:legacy`, removed from selected mock/default checks. It cannot prove G1. |
| Frontend dependency and legacy components | Canonical world-client/resources dependencies now replace world-runtime; selected startup redirects to `/missions`. | UI owner completed lint/type/build, 22 units and 5 safe smoke tests. Root reconciled the lock. |
| Frontend legacy `/api/mission/cockpit` and `/api/robots/go2/proxy` | Retired handlers are absent. | UI owner verified eight empty retired probes return 404; no robot host/action request was sent. |
| `docs/protocol.md`, `docs/protocol-review.md` | Now concise retirement notices. | Applied; old text remains in Git history. |
| `docs/web-app.md` | Archived prototype note still links the superseded protocol. | Retarget the archival notice; do not present it as native UI instructions. |

Before cutover, the root listed 13 prototype workspaces: contracts, cli, anomaly,
attention, capability-host, mission-api, mission-server, policy, replay, scene,
supervisor, world-twin and world-runtime. `driver-go2` is also omitted from the
selected software-only default workspace set; its source/tests remain untouched.
The clean installed dependency tree no longer exposes those legacy workspace
links; useful old source remains outside selected execution paths.

## Release sequence

Runtime subsequently identified a compiler-import side effect: configured
discovery/build could open the delivery ledger and start world/wake work.
The agent owner corrected runtime initialization. Prior G2/G3 proofs remain
valid for their tested source, but fresh configured packaging and core G2/G3
qualification are now required after that fix before completed cutover is claimed.
The root regression command remains `npm run check:eve:packaging`; no agent
source or held-world mutation is part of its implementation.

1. Completed: actual E7 run `29cd139f` and explicit coordinator release were
   observed. Original artifacts are unavailable after Playwright cleanup;
   a recovered summary is historical only and does not replace fresh E7.
2. Completed for root: checked and applied the root switch and protocol-page
   retirement with `apply_patch`. UI route/dependency retirement stays with its
   owner; the held database and frontend are unchanged by Integration.
3. Completed: reconcile root lock/workspaces and confirm absent installed legacy
   CLI exposure. Preserve recordings, resource bytes, databases,
   all ledgers, credential files, fixtures, driver primitives and Git history.
4. Completed: run the selected software check, authority/manifest checks, and UI's native
   retirement checks. Do not run the unfiltered legacy browser smoke suite.
5. Released, not completed: run `npm run qualify:software`. Verify `/missions`,
   scoped admin/operator separation, G1→G2→automatic wake→G3→native E7 ordering,
   synthetic/no-motion labels and owned-process cleanup. A held
   pass is not substituted for this fresh-launch check.

Automatic world-triggered waking has a separate action-free qualification
report; standard G2 never claims it. Physical sensing/action, remote deployment
and paid model behavior remain outside software gate claims.

## CI audit

The preexisting `.github/workflows/pages.yml` has no Node setup or software
checks. It is unchanged and was not triggered. After explicit coordinator
instruction, `.github/workflows/software.yml` adds a separate manual-only
software job: contents-read permission, checkout without persisted Git
credentials, Node `24.19.0`, root lock installation, pinned SpacetimeDB tools
and lockfile-selected Chromium provisioned separately, then `npm run check` and
frontend build. It receives no secrets, deploys nothing and uploads no data.

The workflow is structurally checked locally; remote execution is not run.
Actual loopback/browser qualification is intentionally not represented by a
passing/skipped CI step: it awaits validation of the supported bounded fresh
composition after the runtime fix. No held dev command or old browser smoke
is substituted for that gate.

Prepared CI addition, to apply only after `npm run qualify:software` passes the
complete actual chain locally (not active in the workflow yet):

```yaml
      - name: Actual loopback, automatic wake and native browser qualification
        timeout-minutes: 25
        run: npm run qualify:software
```

Place it after separately provisioned tools, selected root checks and frontend
build, and raise the job budget to cover the bounded phases. Keep manual-only
dispatch, read-only contents and no artifact-directory uploads. Local success
does not claim remote CI execution.
