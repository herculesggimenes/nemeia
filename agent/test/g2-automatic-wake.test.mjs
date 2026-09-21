import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Bash, defineCommand } from "just-bash";
import { automaticWakeEnvironment, busyBurstIsHeld, installedAutomaticWakeInventory, prepareAutomaticBaseline, automaticMissionsCancelled, executionMutationCount } from "./g2-automatic-wake.ts";
import { fileURLToPath } from "node:url";
import { AUTO_MISSION_DESCRIPTION, automaticReadCommand, loopbackWakeUrl, parseAutomaticRead, writeMarker } from "../eve-eval-fixture/agent/automatic-wake-protocol.ts";
import { respondAutomaticWake } from "../eve-eval-fixture/agent/automatic-wake-model.ts";

const ids = ["mission-g2-auto-a", "mission-g2-auto-b", "mission-g2-auto-c"];

test("fresh automatic baseline prepares the Unit grant before allocating and assigning its own distinct mission", async () => {
  const calls = [];
  const baselineMissionId = "mission-g2-auto-baseline";
  await prepareAutomaticBaseline({ baselineMissionId, measuredMissionIds: ids,
    prepareUnitGrant: async () => { calls.push("grant-confirmed"); return true; },
    recordAllocation: (id) => { calls.push(["allocated", id]); },
    createMission: async (id) => { calls.push(["created-and-assigned", id]); },
  });
  assert.deepEqual(calls, ["grant-confirmed", ["allocated", baselineMissionId], ["created-and-assigned", baselineMissionId]]);
});

test("baseline fails closed on missing grant and retains partial mission creation for cleanup", async () => {
  const baselineMissionId = "mission-g2-auto-baseline";
  const allocated = [];
  const ports = { baselineMissionId, measuredMissionIds: ids,
    recordAllocation: (id) => { allocated.push(id); },
    createMission: async () => { throw new Error("partial native creation failed"); },
  };
  await assert.rejects(prepareAutomaticBaseline({ ...ports, prepareUnitGrant: async () => false }), /current generated Unit grant/u);
  assert.deepEqual(allocated, []);
  await assert.rejects(prepareAutomaticBaseline({ ...ports, prepareUnitGrant: async () => true }), /partial native creation failed/u);
  assert.deepEqual(allocated, [baselineMissionId]);
  await assert.rejects(prepareAutomaticBaseline({ ...ports, baselineMissionId: ids[0], prepareUnitGrant: async () => true }), /distinct owned mission/u);
});

test("cleanup requires the baseline and all three measured missions, each cancelled with no execution", () => {
  const all = ["mission-g2-auto-baseline", ...ids];
  const cleanups = all.map((missionId) => ({ missionId, missionState: "Cancelled", executionIds: [] }));
  assert.equal(automaticMissionsCancelled(all, cleanups), true);
  assert.equal(automaticMissionsCancelled(all, cleanups.slice(1)), false);
  assert.equal(automaticMissionsCancelled(all, [...cleanups.slice(1), cleanups[1]]), false);
  assert.equal(automaticMissionsCancelled(all, cleanups.map((row, i) => i === 0 ? { ...row, missionState: "Active" } : row)), false);
  assert.equal(automaticMissionsCancelled(all, cleanups.map((row, i) => i === 0 ? { ...row, executionIds: ["unexpected-execution"] } : row)), false);
});

test("zero execution mutations checks row fingerprints, not merely unchanged IDs", () => {
  assert.equal(executionMutationCount({}, {}), 0);
  assert.equal(executionMutationCount({ existing: "accepted-fingerprint" }, { existing: "accepted-fingerprint" }), 0);
  assert.equal(executionMutationCount({ existing: "accepted-fingerprint" }, { existing: "cancelled-fingerprint" }), 1);
  assert.equal(executionMutationCount({}, { added: "new-fingerprint" }), 1);
});

test("new run inventory reads installed package versions and content hashes without changing old reports", async () => {
  const inventory = await installedAutomaticWakeInventory(fileURLToPath(new URL("../..", import.meta.url)));
  assert.equal(inventory.versions.node, process.version);
  for (const name of ["eve", "spacetimedb", "just-bash"]) {
    assert.match(inventory.versions[name], /^\d+\.\d+\.\d+/u);
    assert.match(inventory.packageFiles[name].sha256, /^[a-f0-9]{64}$/u);
    assert.ok(inventory.packageFiles[name].path.startsWith("/"));
  }
});
function configure(t) {
  const previous = { ...process.env };
  t.after(() => { process.env = previous; });
  Object.assign(process.env, {
    NEMEIA_AUTO_MISSION_IDS: JSON.stringify(ids), NEMEIA_WORLD_ID: "test-world", NEMEIA_AGENT_ID: "test-agent",
    NEMEIA_G2_EXPECTED_UNIT_ID: "test-unit", NEMEIA_G2_EXPECTED_MAP_ID: "test-map",
    NEMEIA_G2_EXPECTED_ENTITY_ID: "test-object", NEMEIA_G2_EXPECTED_OBSERVATION_ID: "test-observation",
  });
}
function nativeFixture() {
  return {
    manifest: { schema: "nemeia.world-context@1", contextId: "test-context", worldRevision: "test-revision" },
    missions: ids.map((missionId) => ({ missionId, description: AUTO_MISSION_DESCRIPTION, lifecycle: "active" })),
    summary: { worldId: "test-world", agentId: "test-agent", localMaps: [{ id: "test-map", unitId: "test-unit", headRevision: "1" }],
      objects: [{ id: "test-object", kind: "object", semantic: [{ observationId: "test-observation" }], supportObservationIds: ["test-observation"] }] },
  };
}
function output(fixture = nativeFixture()) {
  return { exitCode: 0, stderr: "", stdout: [fixture.manifest, { missions: fixture.missions }, fixture.summary, fixture.manifest].map(JSON.stringify).join("\n") + "\n", truncated: false };
}

test("automatic target accepts only credential-free HTTP loopback origins", () => {
  assert.equal(loopbackWakeUrl("http://127.0.0.1:3456"), "http://127.0.0.1:3456/wake");
  assert.equal(loopbackWakeUrl("http://[::1]:3456/"), "http://[::1]:3456/wake");
  for (const url of ["https://127.0.0.1:3456", "http://localhost.evil:3456", "http://user:password@localhost:3456", "http://127.0.0.1:3456/path", "http://127.0.0.1:3456/?token=test", "http://127.0.0.1:3456/#test"]) {
    assert.throws(() => loopbackWakeUrl(url), /loopback HTTP origin/u);
  }
});

test("automatic children receive agent-only authority and no ambient providers/exporters", () => {
  const env = automaticWakeEnvironment({
    PATH: "/usr/bin", HOME: "/tmp/test-only", NODE_OPTIONS: "--import=not-allowed", OPENAI_API_KEY: "not-allowed",
    ANTHROPIC_API_KEY: "not-allowed", VERCEL_AUTOMATION_BYPASS_SECRET: "not-allowed", LMNR_API_KEY: "not-allowed",
    OTEL_EXPORTER_OTLP_ENDPOINT: "https://not-allowed.invalid", NEMEIA_WORLD_TOKEN: "ambient-admin-not-allowed",
    NEMEIA_ADMIN_TOKEN_FILE: "/not-allowed", NEMEIA_QUALIFICATION_HANDOFF: "/not-allowed", NEMEIA_EVE_WAKE_URL: "http://not-allowed.invalid/wake",
  }, { NEMEIA_WORLD_TOKEN: "explicit-test-agent", NEMEIA_AGENT_LEDGER: "/tmp/test-only.sqlite", NEMEIA_WORLD_AUTH_SECRET: "test-only-hmac" });
  assert.deepEqual(Object.keys(env).sort(), ["PATH", "HOME", "NEMEIA_WORLD_TOKEN", "NEMEIA_AGENT_LEDGER", "NEMEIA_WORLD_AUTH_SECRET", "EVE_TELEMETRY_DISABLED", "OTEL_SDK_DISABLED", "NEMEIA_INSTRUMENTATION_MODE"].sort());
  assert.equal(env.NEMEIA_WORLD_TOKEN, "explicit-test-agent");
});

test("bounded real Bash jq projection remains intact and selects IDs, not array order", async (t) => {
  configure(t);
  const fixture = nativeFixture();
  const seen = [];
  const bash = new Bash({
    files: { "/world/manifest.json": JSON.stringify(fixture.manifest), "/world/mission-log.json": JSON.stringify([
      ...fixture.missions.toReversed(), { missionId: "unrelated", description: "x".repeat(6000) },
    ]) },
    customCommands: [defineCommand("nemeia", async (args) => {
      seen.push(args);
      return { exitCode: 0, stderr: "", stdout: JSON.stringify({ ...fixture.summary,
        objects: [...fixture.summary.objects, { id: "test-unit", kind: "unit", semantic: ["stop"] }],
      }) };
    })],
  });
  const result = await bash.exec(automaticReadCommand());
  assert.deepEqual(seen, [["world", "summary"]]);
  assert.deepEqual(parseAutomaticRead(result), { contextId: "test-context", worldRevision: "test-revision", missionIds: ids });
});

test("intact-context guard rejects truncation, empty evidence, Units, wrong observations and unpinned reads", (t) => {
  configure(t);
  assert.deepEqual(parseAutomaticRead(output()).missionIds, ids);
  for (const change of [
    (result) => { result.stdout = result.stdout.replace("test-world", "[truncated]"); },
    (result) => { result.truncated = true; },
    (result) => { result.exitCode = 1; },
    (result) => { result.stdout = result.stdout.replace('"test-observation"', '"wrong-observation"').replaceAll('"test-observation"', '"wrong-observation"'); },
    (result) => { result.stdout = result.stdout.replace('"objects":[', '"objects":[],"ignored":['); },
    (result) => { result.stdout = result.stdout.replace('"kind":"object"', '"kind":"unit"'); },
    (result) => { result.stdout = result.stdout.replace('"test-context"', '"different-context"'); },
    (result) => { result.stdout = result.stdout.replace(AUTO_MISSION_DESCRIPTION, "unexpected-description"); },
  ]) {
    const result = output(); change(result); assert.throws(() => parseAutomaticRead(result));
  }
});

test("busy gate requires one retained pending wake, unchanged accepted sends and unchanged turn count", () => {
  const accepted = { id: "wake-a", sent: true, status: "context_presented", sessionId: "session", dirtyKeys: [] };
  const pending = { id: "wake-b", sent: false, status: "dispatching", sessionId: null, dirtyKeys: [ids[1]] };
  const before = { busy: 1, wakes: [accepted] };
  const after = { busy: 1, wakes: [accepted, pending] };
  assert.equal(busyBurstIsHeld(before, after, 2, 2), true);
  assert.equal(busyBurstIsHeld(before, { ...after, busy: 0 }, 2, 2), false);
  assert.equal(busyBurstIsHeld(before, after, 2, 3), false);
  assert.equal(busyBurstIsHeld(before, before, 2, 2), false);
  assert.equal(busyBurstIsHeld(before, { ...after, wakes: [accepted, pending, { ...pending, id: "wake-c" }] }, 2, 2), false);
  assert.equal(busyBurstIsHeld(before, { ...after, wakes: [accepted, { ...pending, sent: true }] }, 2, 2), false);
});

test("automatic mock uses per-wake results across durable turns and never requests actions", async (t) => {
  configure(t);
  process.env.NEMEIA_AUTO_WAKE_DIRECTORY = await mkdtemp(join(tmpdir(), "nemeia-auto-model-test-"));
  const request = (wakeId, toolResults = []) => ({ lastUserMessage: JSON.stringify({ wakeId }), toolResults, messages: [], userMessages: [], userMessageCount: 1, tools: [] });
  assert.equal(await respondAutomaticWake(request("baseline")), "automatic-wake initial subscription baseline");
  writeMarker("armed.json", {}); writeMarker("release.json", {});
  const measured = await respondAutomaticWake(request("measured"));
  assert.equal(measured.toolCalls[0].id, "auto-measured-pinned");
  const oldResults = [{ id: "auto-measured-pinned", name: "bash", output: output(), isError: false }];
  const next = await respondAutomaticWake(request("measured", oldResults));
  assert.equal(next.toolCalls[0].id, "auto-measured-fresh");
  const idle = await respondAutomaticWake(request("idle", oldResults));
  assert.equal(idle.toolCalls[0].id, "auto-idle-fresh");
  for (const response of [measured, next, idle]) {
    assert.equal(response.toolCalls[0].name, "bash");
    assert.doesNotMatch(response.toolCalls[0].input.command, /world action/u);
  }
  const done = await respondAutomaticWake(request("idle", [...oldResults, { id: "auto-idle-fresh", name: "bash", output: output(), isError: false }]));
  assert.equal(JSON.parse(done.slice("automatic-contexts=".length)).results.length, 1);
});
