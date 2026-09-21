import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { DeliveryLedger } from "../lib/world-bridge/delivery-ledger.ts";

// Independent OS processes: a synchronous SQLite waiter must not block the
// lock holder's event loop. No World connection, Eve server, or inherited auth.
const workerSource = `
  import { once } from "node:events";
  import { DatabaseSync } from "node:sqlite";
  const { DeliveryLedger } = await import(process.argv[1]);
  const { filename, mode, index = 0, operation = "write" } = JSON.parse(process.argv[2]);
  let ledger;
  let closed = 0;
  const close = DatabaseSync.prototype.close;
  DatabaseSync.prototype.close = function () { closed++; return close.call(this); };
  const send = (message) => process.send(message);
  try {
    if (mode !== "constructor") ledger = new DeliveryLedger(filename);
    send({ type: "ready" });
    await once(process, "message");
    const start = performance.now();
    if (mode === "holder") {
      ledger.db.exec("BEGIN IMMEDIATE");
      send({ type: "locked" });
      await once(process, "message");
      ledger.db.exec("COMMIT");
    } else {
      send({ type: "trying" });
      ledger ??= new DeliveryLedger(filename);
      if (operation === "accept") {
        ledger.acceptChannelWake("seed-wake", "candidate-session");
      } else {
        ledger.retainMustHandle("child-source-" + index);
        ledger.recordStepHook({
          sessionId: "child-session-" + index, turnId: "child-turn", stepIndex: 0,
          eventId: "child-hook-" + index, eventType: "step.started",
        });
      }
    }
    send({ type: "result", ok: true, elapsed: performance.now() - start,
      timeout: ledger.db.prepare("PRAGMA busy_timeout").get().timeout,
      journal: ledger.db.prepare("PRAGMA journal_mode").get().journal_mode });
  } catch (error) {
    send({ type: "result", ok: false, code: error.code, errcode: error.errcode,
      message: error.message, stack: error.stack, closed });
  } finally {
    ledger?.close();
    process.disconnect();
  }
`;

const childCleanups = new WeakMap();

function child(t, filename, options) {
  const processHandle = spawn(process.execPath, [
    "--experimental-strip-types", "--input-type=module", "-e", workerSource,
    new URL("../lib/world-bridge/delivery-ledger.ts", import.meta.url).href,
    JSON.stringify({ filename, ...options }),
  ], { env: { NODE_ENV: "test" }, stdio: ["ignore", "ignore", "pipe", "ipc"] });
  const messages = [];
  const waiters = new Map();
  let stderr = "";
  processHandle.stderr.on("data", (data) => { stderr += data; });
  processHandle.on("message", (message) => {
    const waiting = waiters.get(message.type);
    if (waiting) {
      waiters.delete(message.type);
      waiting.resolve(message);
    } else messages.push(message);
  });
  const completion = new Promise((resolve) => {
    processHandle.on("error", (error) => {
      for (const waiter of waiters.values()) waiter.reject(error);
    });
    processHandle.on("close", (code, signal) => {
      for (const waiter of waiters.values()) {
        waiter.reject(new Error(`child closed ${code ?? signal}: ${stderr}`));
      }
      waiters.clear();
      resolve({ code, signal, stderr });
    });
  });
  const deadline = setTimeout(() => processHandle.kill("SIGKILL"), 20_000);
  deadline.unref();
  childCleanups.get(t).push(async () => {
    clearTimeout(deadline);
    if (processHandle.exitCode === null && processHandle.signalCode === null) processHandle.kill();
    await completion;
  });
  return {
    send() { processHandle.send({ go: true }); },
    wait(type) {
      const index = messages.findIndex((message) => message.type === type);
      if (index !== -1) return Promise.resolve(messages.splice(index, 1)[0]);
      return new Promise((resolve, reject) => { waiters.set(type, { resolve, reject }); });
    },
    async finish() {
      const exit = await completion;
      clearTimeout(deadline);
      assert.equal(exit.code, 0, exit.stderr);
    },
  };
}

function temporaryLedger(t) {
  const directory = mkdtempSync(join(tmpdir(), "nemeia-wal-contention-"));
  // Remove only after every child has exited, including assertion failures.
  const cleanups = [];
  childCleanups.set(t, cleanups);
  t.after(async () => {
    for (const cleanup of cleanups) await cleanup();
    rmSync(directory, { recursive: true, force: true });
  });
  return { filename: join(directory, "ledger.sqlite") };
}

function seed(filename) {
  const ledger = new DeliveryLedger(filename);
  const context = {
    contextId: "context-retained", step: { sessionId: "seed-session", turnId: "seed-turn", stepIndex: 0 },
    preparedAt: "2026-01-01T00:00:00.000Z", worldRevision: "7", sourceIds: ["seed-source"],
    acquisitionTimes: [], files: [{ path: "/world/summary.json", content: "{}", byteLength: 2 }],
  };
  const wake = ledger.beginWake({
    wakeId: "seed-wake", worldId: "world", agentId: "agent", sourceIds: ["seed-source"],
    dirtyKeys: ["seed-key"], mustHandleIds: ["seed-source"], rescanRequired: false,
  });
  ledger.retainMustHandle("seed-source");
  ledger.saveContext(context);
  ledger.markTurnStarted("seed-session", "seed-turn");
  const action = ledger.beginTrustedAction({
    fingerprint: "seed-fingerprint", invocationSequence: 0, acceptBy: "2026-01-01T01:00:00.000Z",
  });
  ledger.updateTrustedAction({ executionId: action.executionId, status: "accepted", worldReceiptId: "world-receipt" });
  const actionReceipt = ledger.getTrustedAction(action.executionId);
  ledger.close();
  return { context, wake, actionReceipt };
}

function assertRetained(ledger, expected) {
  assert.deepEqual(ledger.getContext(expected.context.step), expected.context);
  assert.deepEqual(ledger.getWake(expected.wake.wakeId), expected.wake);
  assert.deepEqual(ledger.getTrustedAction(expected.actionReceipt.executionId), expected.actionReceipt);
  assert.equal(ledger.countActiveSessions(), 1, "opening a worker never clears busy");
  assert.ok(ledger.listPendingMustHandle().includes("seed-source"));
  assert.equal(ledger.db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
}

test("each ledger connection configures the production 5000ms timeout and WAL", (t) => {
  const { filename } = temporaryLedger(t);
  const native = new DatabaseSync(":memory:");
  assert.equal(native.prepare("PRAGMA busy_timeout").get().timeout, 0, "Node's default is not a contention policy");
  native.close();
  for (let index = 0; index < 2; index++) {
    const ledger = new DeliveryLedger(filename);
    assert.equal(ledger.db.prepare("PRAGMA busy_timeout").get().timeout, 5000);
    assert.equal(ledger.db.prepare("PRAGMA journal_mode").get().journal_mode, "wal");
    ledger.close();
  }
});

test("simultaneous fresh process constructors retain every independent receipt", { timeout: 20_000 }, async (t) => {
  const { filename } = temporaryLedger(t);
  const workers = Array.from({ length: 6 }, (_, index) => child(t, filename, { mode: "constructor", index }));
  await Promise.all(workers.map((worker) => worker.wait("ready")));
  for (const worker of workers) worker.send();
  const results = await Promise.all(workers.map((worker) => worker.wait("result")));
  await Promise.all(workers.map((worker) => worker.finish()));
  for (const result of results) assert.equal(result.ok, true, JSON.stringify(result));
  const ledger = new DeliveryLedger(filename);
  try {
    assert.equal(ledger.listPendingMustHandle().length, workers.length);
    for (let index = 0; index < workers.length; index++) {
      assert.deepEqual(ledger.listStepHooks({ sessionId: `child-session-${index}`, turnId: "child-turn", stepIndex: 0 }), [
        { eventId: `child-hook-${index}`, eventType: "step.started" },
      ]);
    }
  } finally { ledger.close(); }
});

test("cross-process writers and constructors wait for lock release without losing state", { timeout: 20_000 }, async (t) => {
  const { filename } = temporaryLedger(t);
  const retained = seed(filename);
  const holder = child(t, filename, { mode: "holder" });
  const writer = child(t, filename, { mode: "writer", index: 1 });
  const constructor = child(t, filename, { mode: "constructor", index: 2 });
  await Promise.all([holder, writer, constructor].map((worker) => worker.wait("ready")));
  holder.send();
  await holder.wait("locked");
  writer.send();
  constructor.send();
  await Promise.all([writer, constructor].map((worker) => worker.wait("trying")));
  const release = setTimeout(() => holder.send(), 250);
  t.after(() => clearTimeout(release));
  const results = await Promise.all([holder, writer, constructor].map((worker) => worker.wait("result")));
  await Promise.all([holder, writer, constructor].map((worker) => worker.finish()));
  for (const result of results) assert.equal(result.ok, true, JSON.stringify(result));
  for (const result of results.slice(1)) {
    assert.ok(result.elapsed >= 200, `writer did not wait: ${result.elapsed}ms`);
    assert.ok(result.elapsed < 5000, `writer exceeded timeout: ${result.elapsed}ms`);
  }
  const ledger = new DeliveryLedger(filename);
  try {
    assertRetained(ledger, retained);
    assert.deepEqual(ledger.listPendingMustHandle(), ["child-source-1", "child-source-2", "seed-source"]);
  } finally { ledger.close(); }
});

test("production timeout fails closed, then explicit retry succeeds after lock release", { timeout: 20_000 }, async (t) => {
  const { filename } = temporaryLedger(t);
  const retained = seed(filename);
  const holder = child(t, filename, { mode: "holder" });
  const writer = child(t, filename, { mode: "writer", operation: "accept" });
  const constructor = child(t, filename, { mode: "constructor", index: 3 });
  await Promise.all([holder, writer, constructor].map((worker) => worker.wait("ready")));
  holder.send();
  await holder.wait("locked");
  const start = performance.now();
  writer.send();
  constructor.send();
  const results = await Promise.all([writer, constructor].map((worker) => worker.wait("result")));
  const elapsed = performance.now() - start;
  await Promise.all([writer, constructor].map((worker) => worker.finish()));
  for (const result of results) {
    assert.equal(result.ok, false, "a timed-out acceptance/constructor must not be reported successful");
    assert.equal(result.code, "ERR_SQLITE_ERROR");
    assert.equal(result.errcode, 5, JSON.stringify(result)); // SQLITE_BUSY
  }
  assert.equal(results[1].closed, 1, "failed constructor closes its connection before throwing");
  assert.ok(elapsed >= 4500 && elapsed < 9000, `bounded production timeout: ${elapsed}ms`);
  // A plain read-only observer can read committed WAL state even while locked.
  const observer = new DatabaseSync(filename, { readOnly: true });
  assert.equal(observer.prepare("SELECT status FROM wake_delivery WHERE wake_id = 'seed-wake'").get().status, "pending");
  assert.equal(observer.prepare("SELECT COUNT(*) AS count FROM turn_activity").get().count, 1);
  observer.close();
  holder.send();
  assert.equal((await holder.wait("result")).ok, true);
  await holder.finish();
  const ledger = new DeliveryLedger(filename);
  try {
    assertRetained(ledger, retained);
    const accepted = ledger.acceptChannelWake(retained.wake.wakeId, "candidate-session");
    assert.equal(accepted.status, "accepted");
    assert.equal(accepted.sessionId, "candidate-session");
    assert.equal(ledger.countActiveSessions(), 2);
    assert.deepEqual(ledger.getContext(retained.context.step), retained.context);
    assert.deepEqual(ledger.getTrustedAction(retained.actionReceipt.executionId), retained.actionReceipt);
    assert.deepEqual(ledger.listPendingMustHandle(), ["seed-source"], "delivery is not domain acknowledgement");
  } finally { ledger.close(); }
});

test("non-BUSY constructor errors fail immediately and close without altering corrupt bytes", async (t) => {
  const { filename } = temporaryLedger(t);
  const bytes = Buffer.from("not a sqlite database; test-only corrupt fixture");
  writeFileSync(filename, bytes);
  const constructor = child(t, filename, { mode: "constructor" });
  await constructor.wait("ready");
  const start = performance.now();
  constructor.send();
  const result = await constructor.wait("result");
  await constructor.finish();
  assert.equal(result.ok, false);
  assert.equal(result.errcode, 26, JSON.stringify(result)); // SQLITE_NOTADB, not a retryable busy error
  assert.equal(result.closed, 1);
  assert.ok(performance.now() - start < 1000, "non-BUSY error was incorrectly retried");
  assert.deepEqual(readFileSync(filename), bytes);
});
