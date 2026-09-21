import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { ownedProcessTree, signalOwnedGroup } from "../owned-process-tree.mjs";

test("group cleanup refuses reused, exited, missing or unrecorded root identities", async () => {
  const saved = { pid: 12345, started: "100", state: "S" };
  const signals = [];
  const send = (...args) => signals.push(args);
  for (const current of [undefined, { ...saved, started: "101" }, { ...saved, state: "Z" }]) {
    assert.equal(await signalOwnedGroup(saved, "SIGTERM", { inspect: async () => current, send }), false);
  }
  assert.equal(await signalOwnedGroup(undefined, "SIGKILL", { send }), false);
  assert.deepEqual(signals, []);
  assert.equal(await signalOwnedGroup(saved, "SIGTERM", { inspect: async () => saved, send }), true);
  assert.deepEqual(signals, [[-12345, "SIGTERM"]]);
});

test("owned lifecycle tracking closes only its explicitly spawned child", async () => {
  const child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore" });
  const exited = once(child, "exit");
  const tree = ownedProcessTree();
  try {
    await tree.add(child.pid);
    await tree.capture();
    const result = await tree.close();
    assert.equal(result.verifiedStopped, true);
    assert.deepEqual(result.observedPids, [child.pid]);
    assert.equal((await exited)[1], "SIGTERM");
    assert.doesNotThrow(() => process.kill(process.pid, 0));
  } finally { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); }
});
