# Action-free automatic wake qualification

Prepared for a coordinator-approved, exclusive mutation window. Offline tests
are not actual qualification. This case does not change the existing G2 report,
the G2 `automaticWakeTested: false` field, or G3's command callback.

## Invocation from the repository root

Use the available Integration handoff and an explicit Eve owner mapping. Do not
run during UI/G3 mutations. Existing useful Object evidence and a local-map head
must be present. The case explicitly establishes/renews the Agent's Unit grant
through the operator and creates its own active baseline mission before starting
Eve or the bridge; it never relies on old E7 missions or a still-active G2 mission.

```bash
NEMEIA_QUALIFICATION_HANDOFF=/absolute/path/to/current-handoff.json \
NEMEIA_AGENT_OWNER_PRINCIPAL_ID=nemeia-g2-loopback:eve-owner-g2-loopback \
node --experimental-strip-types --input-type=module -e '
  const { createEveQualificationAdapter } = await import("./agent/test/g2-loopback-adapter.ts");
  const adapter = await createEveQualificationAdapter();
  try {
    console.log(JSON.stringify(await adapter.runAutomaticWakeQualification()));
  } finally {
    await adapter.close();
  }
'
```

Handoff fields: `available`, `uri`, `databaseName`, `worldId`, `unitId`, `agentId`,
`agentTokenFile`, `operatorTokenFile`, `runDirectory`; credentials must be mode
0600. The existing adapter's optional generated-module override still applies.
This action-free case does not open the administrator client; fresh ordinary G2
permission qualification separately requires `adminTokenFile`.
The automatic case closes its adapter-owned Agent/operator/admin subscribers
before returning. Use a fresh adapter for subsequent G3; the documented final
`adapter.close()` remains safe and closes early-preparation failures too.

## Ownership and authority

The adapter creates an isolated public Eve eval project and absolute SQLite-WAL
path. It launches the existing `bash agent/scripts/world-wake-bridge.sh` once,
using that same WAL and the actual eval's validated `t.target.url + /wake`.
Only explicit agent credentials and matching JWT-HMAC owner configuration reach
these children. Ambient provider credentials, tracing endpoints, handoff paths,
admin/operator credentials, and inherited Node hooks are excluded.

The eval never posts `/wake`, sends a model message, or creates a session itself.
Public `watchTurn` with the retained stream cursor observes bridge-created
sessions. A fixture-only public hook records bounded lifecycle coordinates and
the `message.received` wake ID, without changing authorization or busy state.
SQLite observations are read-only; no test writes wake or busy receipts.

## Marker and report contract

The method allocates
`<runDirectory>/g2-eve-<run>/automatic-wake-<uuid>/`. It returns
`{automaticWakeTested:true, reportFile, checks}` only after all actual gates,
owned-process shutdown, and authorized mission cancellation pass. Failures
throw with `reportFile`; the distinct report has `claimable:false` and
`automaticWakeTested:false`. No prior G2/G3 report is overwritten.

Markers (private, atomic JSON files; no credentials):

| File | Writer | Meaning |
| --- | --- | --- |
| `baseline-prepared.json` | host | Unit grant confirmed and separate baseline mission actively assigned through native reducers |
| `target-ready.json` | eval | Public local target URL and validated `/wake` URL |
| `lifecycle.jsonl` | public observer hook | Actual session/turn/event/wake coordinates |
| `observe-baseline.json` / `baseline-observed.json` | host / eval | Initial delivery drained and consumed through public cursor |
| `armed.json` | host | Subsequent native trigger may be committed |
| `thinking.json` | mock model | Actual measured wake entered its blocked model callback |
| `observe-measured.json` | host | Correlated session and actual measured turn ID |
| `release.json` | host | Two native burst assignments committed; busy/coalescing checks passed |
| `measured-observed.json` | eval | Pinned old mission set and fresh next-step mission set passed |
| `observe-idle.json` | host | One or two bounded post-idle delivery turns to consume |
| `eval-observed.json` | eval | Public lifecycle, Bash and intact native-context evidence |
| `bridge-stopped.json` | host | Owned bridge exited cleanly before eval completion |
| `automatic-wake-report.json` | host | Combined actual gates and terminal mission cleanup |

Host logs: `automatic-eve.{stdout,stderr}.log` and
`operational-bridge.{stdout,stderr}.log`. Cleanup evidence is per owned mission.
`automatic-wake-inventory.json` is created once with the actual installed Node,
Eve, SpacetimeDB SDK and just-bash versions, executable/package paths, and package
manifest hashes. The report includes these versions and the inventory path; the
public eval's observed Node version must match. Old reports are never backfilled.

Failure reports retain `failure.phase`, bounded redacted stacks, and native
SQLite `code`/`errcode`/`errstr` (including causes). The host's read-only ledger
observer retries only numeric `SQLITE_BUSY`, for at most one second per read;
it closes each attempted handle and never writes PRAGMAs, repairs, or seeds rows.
Persistent busy and all other errors remain qualification failures.

Finalization requires the complete public CLI verdict and all its gates, then
a natural Eve parent exit with code 0 and no signal. It allows 35 seconds after
observing the verdict (Eve 0.63 prints it before its 15-second worker shutdown
grace). `processLifecycle` retains separate `exit` and `close` timestamps,
codes/signals, root PID/start time, and descendant cleanup provenance from the
existing `scripts/owned-process-tree.mjs` ancestry/start-time-fenced helper.
Pipe closure alone never proves descendants stopped. A passed verdict with a
hung or nonzero-exiting parent still fails; forced cleanup cannot promote it.

Initial subscription delivery with the explicitly owned baseline mission is
only baseline. After it settles, the operator
creates/assigns mission A. During its genuine mock-model wait, the operator
creates/assigns B and C. No additional accepted send/turn may appear while busy;
one pending wake must be retained beyond the production retry cap. The current
mounted step must show A but not B/C, the next step must show all three, and an
actual subsequent idle turn must expose the same intact useful native context.
Every read requires the observed Object/semantic ID, retained map head and known
Unit, with strict JSON parsing and output budgets. No action tool is requested;
the host also checks that no execution row was created.

The host stops only its owned bridge/Eve process groups before cancelling its
four missions (baseline plus A/B/C) through operator reducers. If shutdown cannot be confirmed, it
does not mutate cleanup state and reports the remaining owned IDs. Nothing is
deleted and no controller or hardware is started.

Root acceptance must require `gate === "G2-automatic-wake"`, `result === "pass"`,
`claimable === true`, `automaticWakeTested === true`, `executionMutationCount === 0`,
and every report check true. In particular, require `unitGrantPrepared`,
`explicitBaselineMissionAssigned`, `subsequentNativeUpdate`, `busyBurstCoalesced`,
`sameStepPinned`, `nextStepFresh`, `idleNextDelivery`, `actionFreeBash`,
`noExecutionCreated`, `noExecutionMutation`, `ownedMissionsCancelled`,
`ownedChildrenStopped`, `eveParentExitedNaturally`, and `qualificationSubscribersClosed`. The cleanup list
must contain the distinct `baselineMissionId` plus all three `missionIds`, each
`Cancelled` with an empty execution-ID list. Execution checks compare complete
native row fingerprints before setup, after the measured flow, and after cleanup;
existing rows changing is a failure even when no new ID was created.

Bounds: 90 seconds per host/marker phase, 180-second public eval timeout,
15 seconds for the final CLI verdict, 35 seconds for its natural parent exit,
then bounded owned-tree cleanup (10-second TERM plus 5-second KILL grace), four
initial baseline turns maximum, one measured turn, and at most two coalesced
idle turns. Exceeding a bound is a qualification failure, not a relaxed gate.

## Offline checks

```bash
node --experimental-strip-types --test agent/test/g2-administrator.test.mjs agent/test/g2-automatic-wake.test.mjs
node --experimental-strip-types --test agent/test/g2-automatic-ledger.test.mjs
node --experimental-strip-types --test agent/test/g2-owned-eval-process.test.mjs
./node_modules/.bin/tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution Bundler --allowImportingTsExtensions --verbatimModuleSyntax --esModuleInterop --skipLibCheck --types node agent/test/g2-loopback-adapter.ts agent/test/g2-automatic-wake.ts agent/eve-eval-fixture/agent/agent.ts agent/eve-eval-fixture/agent/hooks/automatic-wake-observer.ts agent/eve-eval-fixture/evals/automatic-wake.eval.ts
```
