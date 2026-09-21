import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { automaticFailureDetails, isSqliteBusy, readAutomaticLedger, readAutomaticLedgerOnce } from "./g2-automatic-wake.ts";

async function fixture(t) {
  const pathname = join(await mkdtemp(join(tmpdir(), "nemeia-auto-ledger-test-")), "temporary.sqlite");
  const writer = new DatabaseSync(pathname);
  t.after(() => writer.close());
  writer.exec(`CREATE TABLE turn_activity (accepted_count INTEGER);
    CREATE TABLE wake_delivery (wake_id TEXT, session_id TEXT, status TEXT, channel_send_started INTEGER, dirty_keys_json TEXT, created_at INTEGER);
    INSERT INTO turn_activity VALUES (1);
    INSERT INTO wake_delivery VALUES ('test-wake', 'test-session', 'accepted', 1, '["test-key"]', 1);`);
  return { pathname, writer };
}
const expected = { busy: 1, wakes: [{ id: "test-wake", sessionId: "test-session", status: "accepted", sent: true, dirtyKeys: ["test-key"] }] };

test("real startup-style exclusive lock reproduces Node SQLITE_BUSY at the read-only schema SELECT", async (t) => {
  const { pathname, writer } = await fixture(t);
  writer.exec("BEGIN EXCLUSIVE");
  try {
    assert.throws(() => readAutomaticLedgerOnce(pathname), (error) => {
      assert.equal(error.code, "ERR_SQLITE_ERROR");
      assert.equal(error.errcode, 5);
      assert.equal(error.errstr, "database is locked");
      assert.equal(error.ledgerOperation, "select-schema");
      assert.equal(isSqliteBusy(error), true);
      return true;
    });
    const release = setTimeout(() => writer.exec("COMMIT"), 40);
    try { assert.deepEqual(await readAutomaticLedger(pathname), expected); }
    finally { clearTimeout(release); }
  } finally { if (writer.isTransaction) writer.exec("ROLLBACK"); }
});

test("persistent busy fails within its finite budget and retains original SQLite fields/stack", async (t) => {
  const { pathname, writer } = await fixture(t);
  writer.exec("BEGIN EXCLUSIVE");
  try {
    await assert.rejects(readAutomaticLedger(pathname, 40), (error) => {
      const details = automaticFailureDetails(error, "initial-baseline-idle");
      assert.equal(details.phase, "initial-baseline-idle");
      assert.equal(details.busyTimeoutMs, 40);
      assert.ok(details.ledgerAttempts >= 2 && details.ledgerAttempts <= 5);
      assert.equal(details.cause.code, "ERR_SQLITE_ERROR");
      assert.equal(details.cause.errcode, 5);
      assert.equal(details.cause.ledgerOperation, "select-schema");
      assert.match(details.cause.stack, /readAutomaticLedgerOnce/u);
      return true;
    });
  } finally { writer.exec("ROLLBACK"); }
});

test("normal WAL writer does not block observation and observer never changes rows", async (t) => {
  const { pathname, writer } = await fixture(t);
  writer.exec("PRAGMA journal_mode=WAL; BEGIN IMMEDIATE; UPDATE turn_activity SET accepted_count=2;");
  try { assert.deepEqual(await readAutomaticLedger(pathname), expected); }
  finally { writer.exec("ROLLBACK"); }
  assert.equal(writer.prepare("SELECT accepted_count FROM turn_activity").get().accepted_count, 1);
  assert.equal(writer.prepare("SELECT COUNT(*) AS n FROM wake_delivery").get().n, 1);
});

test("non-busy schema/corruption errors propagate without retry or repair writes", async (t) => {
  const { pathname, writer } = await fixture(t);
  writer.exec("DROP TABLE wake_delivery"); // This test owns the temporary database only.
  await assert.rejects(readAutomaticLedger(pathname), (error) => error.code === "ERR_SQLITE_ERROR" && error.errcode === 1 && error.ledgerOperation === "select-wake-delivery");
  const corrupt = join(await mkdtemp(join(tmpdir(), "nemeia-auto-corrupt-test-")), "not-sqlite");
  const original = Buffer.from("temporary non-database input ".repeat(200));
  await writeFile(corrupt, original, { mode: 0o600 });
  await assert.rejects(readAutomaticLedger(corrupt), (error) => error.code === "ERR_SQLITE_ERROR" && error.errcode === 26);
  assert.deepEqual(await readFile(corrupt), original);
  assert.equal(await readAutomaticLedger(`${pathname}.absent`), undefined);
});

test("retry predicate is numeric SQLITE_BUSY only and failure diagnostics redact secrets", () => {
  for (const error of [new Error("database is locked"), { code: "EACCES", errcode: 5 }, { code: "ERR_SQLITE_ERROR", errcode: 6 }, { code: "ERR_SQLITE_ERROR", errcode: "5" }]) assert.equal(isSqliteBusy(error), false);
  assert.equal(isSqliteBusy({ code: "ERR_SQLITE_ERROR", errcode: 261 }), true);
  const secret = "temporary-test-hmac-secret";
  const error = new Error(`failure ${secret} Bearer temporary-bearer eyJhbGci.eyJzdWIi.signature`);
  const details = automaticFailureDetails(error, "readonly-ledger", { NEMEIA_WORLD_AUTH_SECRET: secret });
  assert.doesNotMatch(JSON.stringify(details), /temporary-test-hmac-secret|temporary-bearer|eyJhbGci/u);
  assert.match(details.stack, /redacted/u);
});
