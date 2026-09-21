import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { archiveNativeBrowserEvidence } from "../browser-evidence.mjs";

test("fixture-only browser archiving refuses failed or stale output and preserves its copy", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "nemeia-browser-archive-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const logPath = join(directory, "browser.log");
  await writeFile(logPath, [
    "PASS native authorized PNG: digest, partial range, missing auth, wrong ref/context and invalid range",
    "PASS native subscription, retained image decode, desktop/mobile layout and reconnect",
    "PASS create, same-Agent multi-mission assignment, grant, stable evidence selection and persistent rejection history",
    "PASS native accept with connected identity, durable proof, mobile review, revision conflict and disconnect/reconnect",
    JSON.stringify({ missions: ["fixture-only"], selectedEvidence: {}, conflict: {} }),
  ].join("\n"));
  for (const name of ["readonly-1440.png", "readonly-evidence-1440.png", "readonly-390.png", "readonly-evidence-390.png", "review-390.png", "review-1440.png"]) await writeFile(join(directory, name), "fixture-only artifact");
  const options = { logPath, sourceDirectory: directory, destination: join(directory, "archive"), startedAt: 0, exitCode: 0 };
  await assert.rejects(archiveNativeBrowserEvidence({ ...options, exitCode: 1 }), /unsuccessfully/);
  await assert.rejects(archiveNativeBrowserEvidence({ ...options, startedAt: Date.now() + 1000 }), /stale/);
  const result = await archiveNativeBrowserEvidence(options);
  assert.equal(result.artifacts.length, 6);
  assert.equal((await stat(result.artifacts[0].path)).mode & 0o777, 0o600);
  await writeFile(join(directory, "readonly-1440.png"), "replaced");
  assert.equal(await readFile(result.artifacts[0].path, "utf8"), "fixture-only artifact");
  await assert.rejects(archiveNativeBrowserEvidence(options), { code: "EEXIST" });
});
