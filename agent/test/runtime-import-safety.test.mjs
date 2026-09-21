import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { cp, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { DeliveryLedger } from "../lib/world-bridge/delivery-ledger.ts";

const root = fileURLToPath(new URL("../..", import.meta.url));
const cleanEnv = {
  PATH: process.env.PATH, NODE_ENV: "production", EVE_TELEMETRY_DISABLED: "1",
  EVE_TRACES: "off", NEMEIA_INSTRUMENTATION_MODE: "local-noop", OTEL_SDK_DISABLED: "true",
  // Inspection-only installed-doc example; no session or model invocation.
  NEMEIA_EVE_MODEL: "openai/gpt-5.5",
};

async function run(args, cwd, env) {
  const child = spawn(process.execPath, args, { cwd, env: { ...cleanEnv, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  const timer = setTimeout(() => child.kill("SIGKILL"), 90_000);
  try {
    const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
    assert.equal(code, 0, output.slice(-6000));
  } finally { clearTimeout(timer); }
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "nemeia-import-safety-"));
  const sockets = new Set();
  let contacts = 0;
  const server = createServer((_req, res) => { res.writeHead(503); res.end(); });
  server.on("connection", (socket) => { contacts++; sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
  server.on("upgrade", (_req, socket) => socket.destroy());
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  const env = {
    NEMEIA_WORLD_URI: endpoint, NEMEIA_WORLD_DATABASE: "must-not-connect",
    NEMEIA_WORLD_ID: "world-import", NEMEIA_AGENT_ID: "agent-import",
    NEMEIA_AGENT_LEDGER: join(directory, "runtime.sqlite"),
    NEMEIA_EVE_WAKE_URL: `${endpoint}/wake`,
    NEMEIA_WORLD_AUTH_SECRET: "synthetic-test-only-not-a-real-secret",
    NEMEIA_WORLD_AUTH_ISSUER: "test-issuer", NEMEIA_WORLD_AUTH_AUDIENCE: "test-audience",
    NEMEIA_WORLD_AUTH_SUBJECT: "owner", NEMEIA_AGENT_OWNER_PRINCIPAL_ID: "test-issuer:owner",
  };
  return { directory, env, contacts: () => contacts, async close() {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  } };
}

test("configured production imports and rejected current auth perform no world/WAL/wake I/O", async () => {
  const f = await fixture();
  try {
    await run(["--experimental-strip-types", "--input-type=module", "-e", `
      import assert from 'node:assert/strict';
      const { default: sandbox, initializeNemeiaWorldRuntime } = await import('./agent/sandbox.ts');
      await import('./agent/hooks/world-step-receipts.ts');
      await import('./agent/channels/nemeia-world.ts');
      await import('./agent/lib/world-bridge/operational-bridge.ts');
      const owner = { principalId: 'test-issuer:owner', principalType: 'service', authenticator: 'test' };
      await assert.rejects(sandbox.onSession({ use: () => { throw Error('must not use'); },
        ctx: { session: { id: 'session-denied', auth: { current: null, initiator: owner } } } }), /authenticated/);
      await assert.rejects(initializeNemeiaWorldRuntime({ ...owner, principalId: 'other' }), /configured agent owner/);
    `], root, f.env);
    assert.equal(f.contacts(), 0);
    await assert.rejects(stat(f.env.NEMEIA_AGENT_LEDGER), { code: "ENOENT" });
  } finally { await f.close(); }
});

// Opt in because actual Eve bundling is slower than the unit suite. This
// copies ONLY production definitions into an isolated project, not the G2 tree.
test("actual configured Eve info/build leave retained WAL bytes and endpoint untouched", {
  skip: process.env.NEMEIA_TEST_COMPILER !== "1", timeout: 180_000,
}, async () => {
  const f = await fixture();
  try {
    const app = join(f.directory, "app");
    await mkdir(join(app, "agent"), { recursive: true });
    for (const entry of ["agent.ts", "sandbox.ts", "instructions.md", "channels", "hooks", "instrumentation", "lib"]) {
      await cp(join(root, "agent", entry), join(app, "agent", entry), { recursive: true });
    }
    await symlink(join(root, "node_modules"), join(app, "node_modules"));
    await symlink(join(root, "world-client"), join(app, "world-client"));
    await writeFile(join(app, "package.json"), JSON.stringify({ name: "nemeia-import-qualification", private: true, type: "module", dependencies: { eve: "0.63.0", "just-bash": "3.1.0" } }));
    const ledger = new DeliveryLedger(f.env.NEMEIA_AGENT_LEDGER);
    ledger.markTurnStarted("retained-session", "retained-turn");
    ledger.close();
    const before = await readFile(f.env.NEMEIA_AGENT_LEDGER);
    for (const args of [["info", "--json"], ["build"]]) {
      await run([join(root, "node_modules/eve/bin/eve.js"), ...args], app, f.env);
      assert.deepEqual(await readFile(f.env.NEMEIA_AGENT_LEDGER), before, `${args[0]} changed ledger bytes`);
      for (const suffix of ["-wal", "-shm"]) await assert.rejects(stat(f.env.NEMEIA_AGENT_LEDGER + suffix), { code: "ENOENT" });
      assert.equal(f.contacts(), 0, `${args[0]} contacted world/wake stub`);
    }
  } finally { await f.close(); }
});
