# Implementation execution status

Final software qualification passed. The fresh bounded chain completed G1,
simulation startup, standard G2, separate action-free automatic wake, G3 and
native E7, then stopped its owned services. Final root checks, configured Eve
packaging, frontend lint/build and safe smoke also passed. Physical operation,
paid inference and remote CI are not qualified by these results.

The final frontend closeout was rerun on 2026-09-20 after the retained
qualification evidence: `npm --prefix frontend run build` passed, and
`CI=1 timeout 180s npm --prefix frontend run e2e:smoke` passed 4 native cutover
tests plus 5 Chromium smoke tests. The smoke marker is
`frontend/test-results/smoke/.last-run.json`; no Nemeia process or smoke port
remained active afterward.

## Current measured state

Accepted fresh run: `composition-1679973-1789946537584` under
`.artifacts/qualification/ui-composition/`. Paths below are relative to that
directory unless stated otherwise.

| Gate | Result | Evidence |
| --- | --- | --- |
| G1 retained world | PASS, 15/15 | `qualification/g1-loopback.json`: real module/generated client, retained restart with identical scoped identity, reopened gateway byte/hash verification, replay/conflict and missing/corrupt-reference checks. |
| Simulation startup | PASS, 7/7 | `qualification/g2-simulation-preflight.json`: enrolled no-motion controller confirmed safety and cleared stop; a new gateway-backed Unit pose is visible to the agent in the retained frame. Zero execute calls/receipts. Controller session closed before G2. |
| Standard G2 | PASS, 9/9 | `qualification/g2-eve.json`: actual Eve lifecycle, native subscription, useful authenticated Bash context, world change during thinking, same-step pinning, next-step freshness and revocation denial. This report still declares automatic waking untested. |
| Automatic wake | PASS, 22/22 | `qualification/automatic-wake.json`: actual public lifecycle, native updates, busy-burst coalescing, pinned/fresh context, next idle delivery, natural process exit and owned cleanup. `automaticWakeTested: true`; zero execution mutations. |
| G3 software loop | PASS, 18/18 | `qualification/g3-held-1681506-1789946615781.json`: actual Eve trusted command, assignment/grant, claim, durable measured no-motion receipt, reviewed progress, subscription cancellation, retry and zero-execution mission expiry. |
| Native E7 | PASS | `qualification/native-e7.json` and `native-e7.log`: create/multi-mission assignment/grant/review, accepted proof/rejection feedback, stale conflict, disconnect/reconnect, immutable-byte authorization/hash/ranges and responsive layouts. All four aggregate checks passed. |
| Owned cleanup | PASS | `verification.json`: all five gate checks true, result pass, claimable true and verified owned cleanup. DB/UI ports 37833/40937 closed and both handoffs unavailable. Retained files were not deleted. |

`npm run qualify:software` exited 0 at 23:24:42 UTC on 2026-09-20. The six
screenshots are retained under `native-e7/`, outside Playwright's cleaned output:
`readonly-1440.png`, `readonly-evidence-1440.png`, `readonly-390.png`,
`readonly-evidence-390.png`, `review-1440.png` and `review-390.png`.
The machine report records their hashes. The coordinator reviewed both review
layouts. No service is retained for this bounded run; no further retry is needed.

## Checks and cutover

| Item | State and evidence |
| --- | --- |
| Root full check | Final `npm run check` exited 0: software 19/19, configured packaging, native guards 3/3. Reports: `software-checks/run-1682747-1789946731531/report.json` and `eve-packaging/run-1684285-1789946754224/report.json` under the qualification root. |
| Frontend closeout | Retained lint/build/smoke report: `final-checks/run-1685957-1789946973874/report.json`. Fresh final rerun: frontend build passed and safe smoke passed 4 native cutover tests plus 5 Chromium tests; marker: `frontend/test-results/smoke/.last-run.json`. |
| Runtime coverage | Final root checks include strict TypeScript, runtime tests, lifecycle tests and bounded multiprocess startup regressions. Configured actual info/build preserved busy ledger bytes and made zero World/wake contacts. |
| Root focused checks | PID/start-time-fenced cleanup 2/2; simulation preflight fixture/local-controller tests 2/2. Fixture-only sequence/archive checks cannot establish actual gates. |
| E0 authority | Canonical scanner and strict manifest passed: 22 tables, 13 boundaries, generated schema authority and shared lossless ResourceRef byteLength. |
| E12 defaults | `npm run check` selects new software/packaging/native guards; `npm run dev` selects the loopback mission UI. Prototype source/tests remain outside selected defaults. |
| Native UI retirement | Default / redirects to /missions; robot proxy/cockpit routes are removed. Final safe smoke and fresh native E7 passed; original deleted E7 screenshots are not used as release evidence. |
| Clean install | `install-1789942501834/report.json`: exact pins preserved; legacy workspace links and nemeiactl bin absent. Owned services stopped before installation; storage, credentials, driver source and Git history preserved. |
| CI | Manual-only, contents-read, Node 24.19.0, separate dependency/tool/Chromium provisioning, root checks, frontend build and bounded full qualifier. Structurally tested locally after actual acceptance. Pages permissions unchanged; no remote trigger, upload or deployment. |

See [RUNBOOK.md](RUNBOOK.md) for executable setup, bounded qualification,
held UI use, failure handling and resident Eve/bridge configuration.
[E12-CUTOVER.md](E12-CUTOVER.md) records the inbound-authority audit.

## Version and dependency inventory

| Component | Installed / pinned version |
| --- | --- |
| Node / npm | 24.19.0 / 11.17.0 |
| SpacetimeDB SDK, CLI and server | 2.10.1; official binaries under .artifacts/toolcache/spacetimedb-2.10.1/ |
| Eve / just-bash | 0.63.0 / 3.1.0 |
| AI SDK / Zod | 7.0.105 / 4.1.12 |
| TypeScript / Jiti | 5.9.3 / 2.7.0 |

Root lock SHA-256 after clean cutover:
`61f0d3ebb0239dd7fc67b9c2abc4b8255db9e03ada4cf8935a5866c7c66cd51c`.
Current accepted provenance (all fresh gate inventories agree):

| Artifact | SHA-256 |
| --- | --- |
| Published module artifact | `9a2a283a21a292fc0c26f5fcc49879573f52b8a619c97924fda3327cf86b8d3c` |
| Module source tree | `6f8c03182a8231243674a8ad589cecebca076a0dd62fc27e96fac98acee25bc4` |
| Schema source | `0a917a04d0df1faf73168522fd68d87e1a10763eb797a87ecdf971c6bff5dc40` |
| Generated source tree | `49f72a71d4c678c6428bdc423ebf74a57b7dbd65fc966087f774c5ad607de226` |

These values come from the immutable inventory linked by the fresh
`verification.json`, not a new rebuild. The previously recorded module
`3286e8cfd205af49ad68a4bc0abdbff39a4093573a144bab2d7e47b47a49b107`
is historical; byte identity with the accepted artifact is not claimed. Source
tree digests use the inventory's sorted relative-path/file-hash map.

The repository root is the Eve project root; agent/ is its authored agent.
Standard hoisted workspaces resolve generated Eve host dependencies. Selected
SQLite files are delivery/controller ledgers, not another world DB.

### Evidence provenance without rewriting reports

Fresh reports use unique directories and immutable writes. Each links a mode-600
inventory containing actual installed versions, tool executable hashes, root
lock, contract manifest, module sources/artifact and generated-source hashes.
Old proof files are never backfilled. Earlier held G1/G2/G3 reports had empty
versions objects; their independent checkpoint is preserved below.

## Historical evidence appendix

These attempts describe tested source at their own time, not the latest full-
chain result. Relative paths use `.artifacts/qualification/`.

| Attempt | Result / retained evidence |
| --- | --- |
| ui-composition/composition-1654230-1789943196942 | G1 passed. G2 actionAccepted failed because initial Unit control was correctly fail-closed. Its mission cancelled with no executions. Later native simulation preflight addresses fixture setup without weakening admission. |
| ui-composition/composition-1658304-1789943727959 | G1/preflight passed. G2 timed out waiting for thinking; timeout child logs were not persisted. Marker/app evidence remains. Owner fixes added readiness waiting and all-failure diagnostics. |
| ui-composition/composition-1666366-1789944821952 | G1/preflight/G2 passed. Automatic wake failed with SQLite lock contention before baseline observation. One allocated mission cancelled, zero execution mutations. Runtime/observer startup fixes followed. |
| ui-composition/composition-1673435-1789945641687 | G1/preflight/G2 passed. Automatic public eval assertions passed, but its process-exit qualification failed. G3/E7 did not run. Owner's bounded exit/close qualification fix preceded the accepted fresh run; the failed evidence is preserved. |
| Original held G1 / G2 / G3 | ui-composition/qualification/g1-loopback.json, g2-eve.json at the qualification root, and ui-composition/qualification/g3-loopback.json: actual 15/9/18 checks passed. G3 covered actual Eve, measured no-motion receipt, review, subscription cancellation, retry and independent zero-execution mission expiry. |
| Original G2 cleanup | ui-composition/run-1533714/g2-cancellation/cleanup-report.json: six safety checks passed; cleanup is not a G2/G3 gate. |
| Failed original G3 and recovery | ui-composition/run-1533714/g3-attempt-1601182-1789937689822/: g3-failure.json preserved; recovery-1789938231647.json passed eight checks using the original Failed receipt, fresh stop evidence, epoch advance and no execution/reservation. No watchdog was relaxed. |
| Corrected original G3 | ui-composition/run-1533714/g3-attempt-1610933-1789938815452: success plus running/pre-claim cancellations; all 18 checks passed. |
| Original E7 run 29cd139f | Actual mutation pass was directly reviewed. Playwright later deleted its original report and six PNGs from the old parent output directory. Recovered summary is historical only; no DB/data loss observed. The accepted fresh run now archives browser evidence outside tool-cleaned directories. |
| Earlier checks | software-checks/run-1569782-1789935294977/report.json passed 19/19; eve-packaging/report.json passed zero-inference packaging. eve-packaging/run-1639299-1789941747537/report.json subsequently passed configured compiler purity. |

Original read-only provenance checkpoint:

| Artifact | SHA-256 |
| --- | --- |
| Pre-E12 root lock | `c60402dd06cb5e95b2443dc6ecb86886d5a949004953acc6bf69669c4f25e71c` |
| Contract manifest | `b9c1d04a602c3b03268e78f6c684396e56d9cecffa7c213f0b9ff623c3d3caff` |
| Original g2-eve.json | `5903139c11a8b1eda0378704f09078c350bcf1c58cccf2414161fd5007515a76` |
| Held G1 | `df60d5b3c4f6aae3c94e1c1040897fc3e3729dfecf36e60715dc5b4632662479` |
| Held G3 | `3a225aad955fd784c3f0afdc0f3422069b73246c9ccf2ea33f6b85eb2e695e91` |
| Original packaging | `e38463c871f6e8fed5148fb7a1eab6181d3f1fed59102fe2e9d2eb368e895669` |

## Evidence boundaries

SpacetimeDB/generated subscriptions own domain state; the gateway retains
immutable bytes. Simulation uses explicitly synthetic standard PNG/PCD and new
stationary Unit samples; it does not retime G1 acquisitions or claim native
robot capture. Scoped publisher/admin, World Operator, agent, perception and
controller credentials remain separate, private and absent from reports.

Standard G2 does not prove automatic dispatch; the separate action-free
automatic-wake report now does for the tested local configuration. The explicit resident bridge
shares the same absolute local WAL with Eve and owns wake transport through
kernel flock; workers do not auto-dispatch. Busy/ambiguous delivery stays held
until public lifecycle evidence, without TTL or implicit reset. Configured
compiler purity is not automatic-wake qualification.

Every required check and owned cleanup must pass. Mock-contract tests cannot
claim G1–G3, and passed eval assertions cannot override failed process-exit
qualification. Physical sensing/action, paid providers, remote deployment and
Site publication remain unqualified and unused.
