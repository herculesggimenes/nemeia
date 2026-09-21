import assert from "node:assert/strict";
import test from "node:test";
import { startOwned, finishAutomaticEval } from "./g2-owned-eval-process.ts";

// Synthetic process protocol tests only: these reports never qualify Eve/World.
const targetUrl = "http://127.0.0.1:12345/";
const report = { target: { kind: "local", url: targetUrl }, passed: 1, failed: 0, scored: 0, skipped: 0, errored: 0,
  completedAt: "2026-09-20T00:00:00.000Z", results: [{ id: "automatic-wake", verdict: "passed", assertions: [
    { name: "succeeded", severity: "gate", passed: true },
    { name: "calledTool(bash)", severity: "gate", passed: true, metadata: { matchingCalls: 2 } },
  ] }] };
const print = `process.stdout.write(${JSON.stringify(JSON.stringify(report, null, 2) + "\n")});`;
const options = { targetUrl, bashCalls: 2, verdictTimeoutMs: 1000 };

test("post-verdict delayed natural exit retains code 0, exit/close times and verified ownership", async () => {
  const owned = await startOwned(process.execPath, ["-e", `${print} setTimeout(()=>process.exit(0),250);`], process.cwd(), {});
  try {
    const completion = await finishAutomaticEval(owned, options);
    assert.equal(completion.shutdownTimeoutMs, 35_000);
    assert.equal(completion.result.code, 0);
    assert.equal(completion.result.signal, null);
    const lifecycle = owned.lifecycle();
    assert.equal(lifecycle.exit.code, 0);
    assert.equal(lifecycle.close.code, 0);
    assert.ok(Date.parse(lifecycle.exit.at) >= Date.parse(completion.verdictObservedAt));
    assert.ok(Date.parse(lifecycle.close.at) >= Date.parse(lifecycle.exit.at));
    assert.equal(lifecycle.stopProof.verifiedStopped, true);
    assert.deepEqual(lifecycle.stopProof.observedPids, [owned.child.pid]);
    assert.ok(lifecycle.rootIdentity.started);
    assert.equal(owned.stopped(), true);
  } finally { await owned.stop(); }
});

test("natural parent exit 0 with descendant-held stdout requires fenced descendant cleanup before close", async () => {
  const script = `require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:['ignore',process.stdout,process.stderr]}); ${print} setTimeout(()=>process.exit(0),400);`;
  const owned = await startOwned(process.execPath, ["-e", script], process.cwd(), {});
  try {
    assert.equal((await owned.parentExit).code, 0);
    assert.equal(owned.exited(), undefined, "descendant still retains the pipe after parent exit");
    assert.equal(owned.stopped(), false);
    const completion = await finishAutomaticEval(owned, options);
    assert.equal(completion.result.code, 0);
    const lifecycle = owned.lifecycle();
    assert.equal(lifecycle.stopProof.verifiedStopped, true);
    assert.equal(lifecycle.stopProof.observedPids.length, 2);
    assert.ok(lifecycle.stopProof.observedPids.includes(owned.child.pid));
    assert.ok(Date.parse(lifecycle.close.at) >= Date.parse(lifecycle.cleanupStartedAt));
    assert.equal(lifecycle.exit.signal, null);
    assert.doesNotThrow(() => process.kill(process.pid, 0), "test process was never in the owned tree");
  } finally { await owned.stop(); }
});

test("passed public JSON plus nonzero natural parent exit cannot pass", async () => {
  const owned = await startOwned(process.execPath, ["-e", `${print} setTimeout(()=>process.exit(7),150);`], process.cwd(), {});
  try {
    await assert.rejects(finishAutomaticEval(owned, options), /did not exit naturally with code 0.*code=7/u);
    assert.equal(owned.lifecycle().exit.code, 7);
  } finally { await owned.stop(); }
  assert.equal(owned.stopped(), true);
});

test("passed public JSON plus genuinely hung parent fails; later cleanup cannot turn failure into pass", async () => {
  const owned = await startOwned(process.execPath, ["-e", `${print} setInterval(()=>{},1000);`], process.cwd(), {});
  try {
    await assert.rejects(finishAutomaticEval(owned, { ...options, shutdownTimeoutMs: 75 }), /parent did not exit within post-verdict shutdown budget/u);
    assert.equal(owned.lifecycle().exit, undefined);
    assert.equal(owned.lifecycle().cleanupStartedAt, undefined);
  } finally { await owned.stop(); }
  assert.equal(owned.stopped(), true);
  assert.equal(owned.lifecycle().exit.signal, "SIGTERM");
  await assert.rejects(finishAutomaticEval(owned, options), /did not exit naturally with code 0/u);
});
