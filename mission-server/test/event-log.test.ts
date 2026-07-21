import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { EventLog, EventLogError, FileEventLog } from "../src/event-log.ts";

test("EventLog append assigns monotonic seq and server timestamp", () => {
  const log = new EventLog({ clock: () => new Date("2026-07-07T17:00:00.000Z") });
  const first = log.append({
    source: "mission-server",
    event_type: "mission.created",
    severity: 0,
    payload: {}
  });
  const second = log.append({
    source: "mission-server",
    event_type: "run.proposed",
    severity: 0,
    mission_id: "msn_test",
    run_id: "run_test",
    payload: {}
  });

  assert.equal(first.seq, 1);
  assert.equal(second.seq, 2);
  assert.equal(first.timestamp, "2026-07-07T17:00:00.000Z");
  assert.throws(() => {
    first.payload.changed = true;
  }, TypeError);
});

test("EventLog read filters by run and paginates by seq", () => {
  const log = new EventLog({ clock: () => new Date("2026-07-07T17:00:00.000Z") });
  log.append({ source: "mission-server", event_type: "run.proposed", severity: 0, run_id: "run_a", payload: {} });
  log.append({ source: "mission-server", event_type: "run.proposed", severity: 0, run_id: "run_b", payload: {} });
  log.append({ source: "mission-server", event_type: "run.completed", severity: 0, run_id: "run_a", payload: {} });

  assert.deepEqual(
    log.read({ run_id: "run_a" }).items.map((event) => event.event_type),
    ["run.proposed", "run.completed"]
  );
  const page = log.read({}, { limit: 2 });
  assert.match(page.next, /^evtcur:/);
  assert.notEqual(page.next, "2");
  assert.equal(log.read({}, { after: page.next }).items[0].seq, 3);
  assert.equal(log.read({}, { after: 2 }).items[0].seq, 3);
});

test("FileEventLog appends durably and replays records on restart", () => {
  const dir = mkdtempSync(join(tmpdir(), "nemeia-event-log-"));
  const path = join(dir, "events.jsonl");
  try {
    const firstProcess = new FileEventLog({ path, clock: () => new Date("2026-07-07T17:00:00.000Z") });
    const first = firstProcess.append({
      source: "mission-server",
      event_type: "mission.created",
      severity: 0,
      mission_id: "msn_file",
      payload: { robot_ids: ["go2"] }
    });
    const second = firstProcess.append({
      source: "mission-server",
      event_type: "run.proposed",
      severity: 0,
      mission_id: "msn_file",
      run_id: "run_file",
      payload: {}
    });

    assert.equal(first.seq, 1);
    assert.equal(second.seq, 2);

    const restarted = new FileEventLog({ path, clock: () => new Date("2026-07-07T17:00:01.000Z") });
    assert.deepEqual(restarted.read({ mission_id: "msn_file" }).items.map((event) => event.event_type), [
      "mission.created",
      "run.proposed"
    ]);

    const third = restarted.append({
      source: "mission-server",
      event_type: "run.completed",
      severity: 0,
      mission_id: "msn_file",
      run_id: "run_file",
      payload: {}
    });
    assert.equal(third.seq, 3);
    assert.equal(third.timestamp, "2026-07-07T17:00:01.000Z");
    assert.equal(new FileEventLog({ path }).all().length, 3);
    assert.throws(() => {
      restarted.all()[0].payload.changed = true;
    }, TypeError);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("FileEventLog fails closed on corrupt persisted records", () => {
  const dir = mkdtempSync(join(tmpdir(), "nemeia-event-log-"));
  const path = join(dir, "events.jsonl");
  try {
    writeFileSync(path, "{\"seq\":1,\"event_type\":\"mission.created\"}\n", "utf8");
    assert.throws(
      () => new FileEventLog({ path }),
      (error) => error instanceof EventLogError && error.error_code === "EVENT_LOG_CORRUPT"
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("FileEventLog backs up and restores append-only records", () => {
  const dir = mkdtempSync(join(tmpdir(), "nemeia-event-log-"));
  const path = join(dir, "events.jsonl");
  const backupPath = join(dir, "backup", "events-backup.jsonl");
  const replacementPath = join(dir, "replacement.jsonl");
  try {
    const log = new FileEventLog({ path, clock: () => new Date("2026-07-07T17:00:00.000Z") });
    log.append({ source: "mission-server", event_type: "mission.created", severity: 0, mission_id: "msn_file", payload: {} });
    log.append({ source: "mission-server", event_type: "run.proposed", severity: 0, mission_id: "msn_file", run_id: "run_file", payload: {} });

    const backup = log.backup({ path: backupPath });
    assert.deepEqual(backup, { path: backupPath, event_count: 2, last_seq: 2 });
    assert.equal(readFileSync(backupPath, "utf8"), readFileSync(path, "utf8"));

    writeFileSync(
      replacementPath,
      `${JSON.stringify({ schema_version: 1, refs: [], seq: 5, timestamp: "2026-07-07T18:00:00.000Z", source: "mission-server", event_type: "mission.created", severity: 0, mission_id: "msn_restored", payload: {} })}\n`,
      "utf8"
    );
    const restored = log.restore({ path: replacementPath });
    assert.deepEqual(restored, { path, event_count: 1, last_seq: 5 });
    assert.deepEqual(log.read({ mission_id: "msn_restored" }).items.map((event) => event.seq), [5]);

    const next = log.append({
      source: "mission-server",
      event_type: "run.proposed",
      severity: 0,
      mission_id: "msn_restored",
      run_id: "run_restored",
      payload: {}
    });
    assert.equal(next.seq, 6);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("FileEventLog rejects restore sources with non-monotonic seq", () => {
  const dir = mkdtempSync(join(tmpdir(), "nemeia-event-log-"));
  const path = join(dir, "events.jsonl");
  const restorePath = join(dir, "bad-restore.jsonl");
  try {
    const log = new FileEventLog({ path });
    writeFileSync(
      restorePath,
      [
        JSON.stringify({ schema_version: 1, refs: [], seq: 2, timestamp: "2026-07-07T17:00:00.000Z", source: "mission-server", event_type: "mission.created", severity: 0, payload: {} }),
        JSON.stringify({ schema_version: 1, refs: [], seq: 2, timestamp: "2026-07-07T17:00:01.000Z", source: "mission-server", event_type: "mission.completed", severity: 0, payload: {} })
      ].join("\n"),
      "utf8"
    );

    assert.throws(
      () => log.restore({ path: restorePath }),
      (error) => error instanceof EventLogError && error.error_code === "EVENT_LOG_CORRUPT" && error.details.line === 2
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
