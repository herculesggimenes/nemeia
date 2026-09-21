import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { childFailureDetail, persistChildOutput, waitForChild, waitForMarker } from "./g2-loopback-adapter.ts";
import { waitForFixtureMarker } from "../eve-eval-fixture/evals/marker-wait.ts";

async function capture() {
  const directory = await mkdtemp(join(tmpdir(), "nemeia-g2-child-diagnostics-"));
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() });
  const result = waitForChild(child, { NEMEIA_WORLD_TOKEN: "test-opaque-agent-token", NEMEIA_WORLD_AUTH_SECRET: "test-private-hmac-secret" });
  return { child, result, marker: join(directory, "thinking"), files: { stdoutFile: join(directory, "stdout.log"), stderrFile: join(directory, "stderr.log") } };
}

test("marker wait detects process exit before inherited pipes close and retains eval errors", async () => {
  const { child, result, marker, files } = await capture();
  const waiting = waitForMarker(marker, "thinking", result, 1000, files);
  child.stdout.write(JSON.stringify({ failed: 1, results: [{ id: "world-runtime", verdict: "failed", error: "world_client_not_ready", assertions: [] }] }));
  child.emit("exit", 1, null); // Deliberately no close yet.
  await assert.rejects(waiting, /eve_eval_exited_before_thinking:code=1.*world_client_not_ready/u);
  assert.match(await readFile(`${files.stdoutFile}.diagnostics.json`, "utf8"), /world_client_not_ready/u);
  child.emit("close", 1, null);
  await result;
});

test("marker timeout persists partial output and finally persistence retains shutdown diagnostics", async () => {
  const { child, result, marker, files } = await capture();
  child.stdout.write("Eve target starting\n");
  await assert.rejects(waitForMarker(marker, "thinking", result, 20, files), /g2_loopback_timeout:marker:thinking.*Eve target starting/u);
  assert.match(await readFile(files.stdoutFile, "utf8"), /Eve target starting/u);
  child.stderr.write("shutdown diagnostic\n");
  child.emit("close", null, "SIGTERM");
  await persistChildOutput(await result, files);
  assert.equal(await readFile(files.stderrFile, "utf8"), "shutdown diagnostic\n");
  for (const path of [files.stdoutFile, files.stderrFile, `${files.stdoutFile}.diagnostics.json`]) {
    assert.equal((await stat(path)).mode & 0o777, 0o600);
  }
});

test("captured logs and error summaries redact configured secrets, JWTs and bearer credentials", async () => {
  const { child, result, files } = await capture();
  child.stdout.write("test-opaque-agent-");
  child.stdout.write("token test-private-hmac-secret Bearer opaque-secret eyJhbGci.eyJzdWIi.signature\n");
  child.emit("close", 1, null);
  const final = await result;
  await persistChildOutput(final, files);
  for (const value of [final.stdout, childFailureDetail(final), await readFile(files.stdoutFile, "utf8"), await readFile(`${files.stdoutFile}.diagnostics.json`, "utf8")]) {
    assert.doesNotMatch(value, /test-opaque-agent-token|test-private-hmac-secret|opaque-secret|eyJhbGci/u);
    assert.match(value, /redacted/u);
  }
});

test("spawn failure becomes diagnostic evidence instead of an unhandled promise rejection", async () => {
  const { child, result, marker, files } = await capture();
  child.emit("error", new Error("spawn ENOENT"));
  await assert.rejects(waitForMarker(marker, "thinking", result, 1000, files), /eve_eval_exited_before_thinking.*spawn ENOENT/u);
  assert.match((await result).stderr, /spawn ENOENT/u);
});

test("successful marker remains valid while the child is running", async () => {
  const { child, result, marker, files } = await capture();
  await writeFile(marker, "thinking\n", { mode: 0o600 });
  await waitForMarker(marker, "thinking", result, 1000, files);
  child.emit("close", 0, null);
  await result;
});

test("public failed turn interrupts the fixture barrier before model entry", async () => {
  const { child, result, marker } = await capture();
  await assert.rejects(waitForFixtureMarker(marker, "thinking", "mockModel callback", Promise.resolve({ events: [
    { type: "step.failed", data: { code: "EVENT_HANDLER_FAILED", message: "world_client_not_ready" } },
  ] }), 1000), /Eve turn settled before mockModel callback.*world_client_not_ready/u);
  child.emit("close", 0, null);
  await result;
});

test("public turn rejection is observed and a successful barrier still works", async () => {
  const { child, result, marker } = await capture();
  await assert.rejects(waitForFixtureMarker(marker, "thinking", "mockModel callback", Promise.reject(new Error("stream failed")), 1000), /observation failed.*stream failed/u);
  await writeFile(marker, "thinking\n", { mode: 0o600 });
  await waitForFixtureMarker(marker, "thinking", "mockModel callback", new Promise(() => {}), 1000);
  child.emit("close", 0, null);
  await result;
});
