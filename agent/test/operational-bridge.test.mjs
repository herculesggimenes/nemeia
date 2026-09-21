import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { DeliveryLedger } from "../lib/world-bridge/delivery-ledger.ts";
import { createOperationalWakeDispatcher, wakeBridgeConfiguration } from "../lib/world-bridge/operational-bridge.ts";
import { createConnectedNemeiaWorldHost } from "../lib/world-bridge/host-bootstrap.ts";
import { generatedWorldSnapshot } from "./generated-world-fixture.ts";

const root = fileURLToPath(new URL("../..", import.meta.url));
const childEnv = { PATH: process.env.PATH, NODE_ENV: "test", EVE_TELEMETRY_DISABLED: "1" };
const ledgerModule = new URL("../lib/world-bridge/delivery-ledger.ts", import.meta.url).href;
const wakeInput = { worldId: "world-1", agentId: "agent-1", sourceIds: ["world.snapshot"], dirtyKeys: [], mustHandleIds: [], rescanRequired: false };

function inOtherProcess(filename, body) {
  return execFileSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e",
    `import { DeliveryLedger } from ${JSON.stringify(ledgerModule)}; const ledger = new DeliveryLedger(process.argv[1]); try { ${body} } finally { ledger.close(); }`, filename],
  { env: childEnv, encoding: "utf8" });
}

test("second process preserves active turn and send reservation; uncertainty cannot be retried", () => {
  const directory = mkdtempSync(join(tmpdir(), "nemeia-cross-process-"));
  const filename = join(directory, "ledger.sqlite");
  const ledger = new DeliveryLedger(filename);
  try {
    ledger.markTurnStarted("session-1", "turn-1");
    const wake = ledger.beginWake(wakeInput);
    assert.equal(ledger.reserveChannelSend(wake.wakeId), true);
    ledger.transitionWake(wake.wakeId, "uncertain");
    const state = JSON.parse(inOtherProcess(filename, `console.log(JSON.stringify({ busy: ledger.hasActiveTurn(), reserved: ledger.reserveChannelSend(${JSON.stringify(wake.wakeId)}) }));`));
    assert.deepEqual(state, { busy: true, reserved: false });
    assert.equal(ledger.hasActiveTurn(), true);
    inOtherProcess(filename, 'ledger.markTurnIdle("session-1", "turn-1");');
    assert.equal(ledger.hasActiveTurn(), false, "public turn receipt is visible across processes");
    assert.equal(ledger.getWake(wake.wakeId).channelSendStarted, true, "idle alone cannot prove an uncertain send was accepted");
  } finally { ledger.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("launcher fails closed before opening WAL when another process owns its lock; crash releases ownership", async () => {
  const directory = mkdtempSync(join(tmpdir(), "nemeia-owner-lock-"));
  const filename = join(directory, "ledger.sqlite");
  const lock = filename + ".wake-owner.lock";
  const owner = spawn("flock", ["--exclusive", "--nonblock", "--no-fork", lock, process.execPath, "-e", 'process.stdout.write("locked\\n"); setInterval(() => {}, 1000);'], { env: childEnv, stdio: ["ignore", "pipe", "pipe"] });
  try {
    await once(owner.stdout, "data");
    const blocked = spawn("bash", [join(root, "agent/scripts/world-wake-bridge.sh")], { env: { ...childEnv, NEMEIA_AGENT_LEDGER: filename }, stdio: "ignore" });
    assert.equal((await once(blocked, "exit"))[0], 73);
    assert.equal(existsSync(filename), false, "second owner cannot open/migrate SQLite");
    const exited = once(owner, "exit");
    owner.kill("SIGKILL");
    await exited;
    execFileSync("flock", ["--exclusive", "--nonblock", lock, "true"], { env: childEnv });
  } finally { owner.kill("SIGKILL"); rmSync(directory, { recursive: true, force: true }); }
});

test("explicit relay uses authenticated loopback transport, holds uncertainty, and cannot follow redirects", async () => {
  const directory = mkdtempSync(join(tmpdir(), "nemeia-relay-"));
  const filename = join(directory, "ledger.sqlite");
  const ledger = new DeliveryLedger(filename);
  const requests = [];
  let redirect = false;
  const server = createServer((request, response) => {
    requests.push({ url: request.url, authorized: /^Bearer /.test(request.headers.authorization ?? "") });
    request.resume();
    response.writeHead(redirect ? 302 : 202, redirect ? { location: "/must-not-follow" } : {});
    response.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const env = {
    NEMEIA_AGENT_LEDGER: filename, NEMEIA_EVE_WAKE_URL: `http://127.0.0.1:${server.address().port}/wake`,
    NEMEIA_WORLD_AUTH_ISSUER: "issuer", NEMEIA_AGENT_OWNER_PRINCIPAL_ID: "issuer:owner",
    NEMEIA_WORLD_AUTH_SECRET: "synthetic-test-only", NEMEIA_WORLD_AUTH_AUDIENCE: "audience",
    NEMEIA_WORLD_ID: "world-1", NEMEIA_AGENT_ID: "agent-1", NEMEIA_WORLD_URI: "http://127.0.0.1:1", NEMEIA_WORLD_DATABASE: "stub",
  };
  const statuses = [];
  const dispatcher = createOperationalWakeDispatcher({ config: wakeBridgeConfiguration(env), ledger, signal: new AbortController().signal, report: (status) => statuses.push(status) });
  try {
    const first = ledger.beginWake(wakeInput);
    ledger.markSessionBusy("session");
    assert.equal(await dispatcher({ ...first, generation: 1 }), "deferred");
    assert.equal(requests.length, 0);
    ledger.clearSessionActivity("session");
    assert.equal(await dispatcher({ ...first, generation: 1 }), "accepted");
    assert.deepEqual(requests, [{ url: "/wake", authorized: true }]);
    const uncertain = ledger.beginWake(wakeInput);
    ledger.reserveChannelSend(uncertain.wakeId);
    ledger.transitionWake(uncertain.wakeId, "uncertain");
    assert.equal(await dispatcher({ ...uncertain, generation: 2 }), "deferred");
    assert.equal(requests.length, 1, "possible accepted send is not posted again");
    assert.ok(statuses.includes("held"));
    redirect = true;
    await assert.rejects(dispatcher({ ...ledger.beginWake(wakeInput), generation: 3 }));
    assert.equal(requests.filter((request) => request.url === "/must-not-follow").length, 0);
    assert.throws(() => wakeBridgeConfiguration({ ...env, NEMEIA_EVE_WAKE_URL: "http://example.com/wake" }), /loopback/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    ledger.close(); rmSync(directory, { recursive: true, force: true });
  }
});

test("capped transport retry observes a cross-process idle receipt without another world change", async () => {
  const directory = mkdtempSync(join(tmpdir(), "nemeia-external-idle-"));
  const filename = join(directory, "ledger.sqlite");
  const ledger = new DeliveryLedger(filename);
  ledger.markTurnStarted("session", "turn");
  let sent = 0;
  const snapshot = generatedWorldSnapshot();
  const host = createConnectedNemeiaWorldHost({
    uri: "http://127.0.0.1:1", databaseName: "stub", worldId: "world-1", agentId: "agent-1", ledger,
    currentPrincipal: () => null, snapshotRevision: () => "1", wakeRetryBaseDelayMs: 5, wakeRetryCapDelayMs: 10,
    worldClientFactory: ({ onSnapshotChange }) => ({
      connect: () => onSnapshotChange(snapshot), subscribeCurrentWorld() {}, disconnect() {}, snapshot: () => snapshot,
      requestExecution: async () => {},
    }),
    wakeDispatcher: () => { if (ledger.hasActiveTurn()) return "deferred"; sent++; return "accepted"; },
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 35));
    assert.equal(sent, 0);
    inOtherProcess(filename, 'ledger.clearSessionActivity("session");');
    for (let n = 0; n < 40 && sent === 0; n++) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(sent, 1);
  } finally { host.close(); await host.settled(); ledger.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("shutdown drains an interrupted send before the WAL closes and never starts a retry", async () => {
  const directory = mkdtempSync(join(tmpdir(), "nemeia-shutdown-"));
  const ledger = new DeliveryLedger(join(directory, "ledger.sqlite"));
  let rejectSend;
  let sends = 0;
  const snapshot = generatedWorldSnapshot();
  const host = createConnectedNemeiaWorldHost({
    uri: "http://127.0.0.1:1", databaseName: "stub", worldId: "world-1", agentId: "agent-1", ledger,
    currentPrincipal: () => null, snapshotRevision: () => "1", wakeRetryBaseDelayMs: 1,
    worldClientFactory: ({ onSnapshotChange }) => ({
      connect: () => onSnapshotChange(snapshot), subscribeCurrentWorld() {}, disconnect() {}, snapshot: () => snapshot,
      requestExecution: async () => {},
    }),
    wakeDispatcher: () => { sends++; return new Promise((_resolve, reject) => { rejectSend = reject; }); },
  });
  try {
    host.close();
    let drained = false;
    const drain = host.settled().then(() => { drained = true; });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(drained, false);
    rejectSend(new Error("synthetic shutdown abort"));
    await drain;
    assert.equal(ledger.listRecoverableWakes()[0].status, "uncertain");
    await new Promise((resolve) => setTimeout(resolve, 15));
    assert.equal(sends, 1);
  } finally { host.close(); await host.settled(); ledger.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("authenticated channel retains an ambiguous send across processes without calling Eve twice", async () => {
  const directory = mkdtempSync(join(tmpdir(), "nemeia-channel-uncertain-"));
  const filename = join(directory, "ledger.sqlite");
  const env = {
    ...childEnv, NEMEIA_AGENT_LEDGER: filename, NEMEIA_WORLD_ID: "world-1", NEMEIA_AGENT_ID: "agent-1",
    NEMEIA_WORLD_AUTH_SECRET: "synthetic-test-only", NEMEIA_WORLD_AUTH_ISSUER: "issuer",
    NEMEIA_WORLD_AUTH_AUDIENCE: "audience", NEMEIA_AGENT_OWNER_PRINCIPAL_ID: "issuer:owner",
  };
  const probe = `
    import assert from 'node:assert/strict';
    import { createHmac } from 'node:crypto';
    import channel from './agent/channels/nemeia-world.ts';
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const unsigned = encode({alg:'HS256',typ:'JWT'}) + '.' + encode({iss:'issuer',aud:'audience',sub:'owner',exp:Math.floor(Date.now()/1000)+60});
    const token = unsigned + '.' + createHmac('sha256', process.env.NEMEIA_WORLD_AUTH_SECRET).update(unsigned).digest('base64url');
    let sends = 0;
    const request = new Request('http://127.0.0.1/wake', {method:'POST', headers:{authorization:'Bearer '+token,'content-type':'application/json'}, body:JSON.stringify(${JSON.stringify({ ...wakeInput, wakeId: "wake-uncertain" })})});
    const result = await channel.routes[0].handler(request, {from:()=>({send:async()=>{sends++;throw Error('synthetic acceptance reply lost');}})});
    assert.equal(result.status, Number(process.env.EXPECT_STATUS));
    assert.equal(sends, Number(process.env.EXPECT_SENDS));
  `;
  try {
    for (const [status, sends] of [[503, 1], [409, 0], [409, 0]]) {
      execFileSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", probe], {
        cwd: root, env: { ...env, EXPECT_STATUS: String(status), EXPECT_SENDS: String(sends) }, encoding: "utf8",
      });
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("full fast turn completes before send resolves without recreating busy or losing the canonical session", () => {
  const directory = mkdtempSync(join(tmpdir(), "nemeia-fast-turn-"));
  const filename = join(directory, "ledger.sqlite");
  const env = {
    ...childEnv, NEMEIA_AGENT_LEDGER: filename, NEMEIA_WORLD_ID: "world-1", NEMEIA_AGENT_ID: "agent-1",
    NEMEIA_WORLD_AUTH_SECRET: "synthetic-test-only", NEMEIA_WORLD_AUTH_ISSUER: "issuer",
    NEMEIA_WORLD_AUTH_AUDIENCE: "audience", NEMEIA_AGENT_OWNER_PRINCIPAL_ID: "issuer:owner",
  };
  const probe = `
    import assert from 'node:assert/strict';
    import { createHmac } from 'node:crypto';
    import channel from './agent/channels/nemeia-world.ts';
    import hooks from './agent/hooks/world-step-receipts.ts';
    import { getRuntimeLedger } from './agent/lib/world-bridge/runtime-ledger.ts';
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const unsigned = encode({alg:'HS256',typ:'JWT'}) + '.' + encode({iss:'issuer',aud:'audience',sub:'owner',exp:Math.floor(Date.now()/1000)+60});
    const token = unsigned + '.' + createHmac('sha256', process.env.NEMEIA_WORLD_AUTH_SECRET).update(unsigned).digest('base64url');
    const body = ${JSON.stringify({ ...wakeInput, wakeId: "wake-fast", mustHandleIds: ["must-handle-fast"] })};
    const request = () => new Request('http://127.0.0.1/wake', {method:'POST', headers:{authorization:'Bearer '+token,'content-type':'application/json'}, body:JSON.stringify(body)});
    let sends = 0;
    const operations = {from:()=>({send:async(message, options)=>{
      sends++;
      const ctx = {session:{id:'canonical-session',auth:{current:options.auth,initiator:options.auth}},channel:{kind:'http'}};
      const ledger = getRuntimeLedger();
      await hooks.events['turn.started']({type:'turn.started',meta:{id:'event-start'},data:{turnId:'turn-fast'}},ctx);
      assert.equal(ledger.hasActiveTurn(),true);
      const received = {type:'message.received',meta:{id:'event-message'},data:{turnId:'turn-fast',sequence:0,message}};
      await hooks.events['message.received'](received,{...ctx,session:{...ctx.session,auth:{current:{...options.auth,principalId:'other'},initiator:options.auth}}});
      assert.equal(ledger.getWake(body.wakeId).sessionId,undefined,'another current principal cannot bind this wake');
      await hooks.events['message.received'](received,ctx);
      assert.equal(ledger.getWake(body.wakeId).status,'context_presented');
      await hooks.events['turn.completed']({type:'turn.completed',meta:{id:'event-completed'},data:{turnId:'turn-fast'}},ctx);
      await hooks.events['session.waiting']({type:'session.waiting',meta:{id:'event-waiting'}},ctx);
      assert.equal(ledger.hasActiveTurn(),false,'turn finished while send is still unresolved');
      assert.equal(ledger.getWake(body.wakeId).status,'acknowledged');
      await hooks.events['message.received'](received,ctx);
      assert.equal(ledger.getWake(body.wakeId).status,'acknowledged','duplicate message cannot regress completion');
      return {id:'cold-start-candidate'};
    }})};
    const response = await channel.routes[0].handler(request(),operations);
    assert.equal(response.status,202);
    assert.equal((await response.json()).sessionId,'canonical-session');
    const ledger = getRuntimeLedger();
    assert.equal(ledger.hasActiveTurn(),false,'late acceptance does not recreate busy');
    assert.equal(ledger.getWake(body.wakeId).status,'acknowledged');
    ledger.transitionWake(body.wakeId,'accepted');
    assert.equal(ledger.getWake(body.wakeId).status,'acknowledged','late bridge HTTP bookkeeping cannot regress completion');
    assert.deepEqual(ledger.listPendingMustHandle(),['must-handle-fast'],'delivery completion is not domain acknowledgement');
    const retry = await channel.routes[0].handler(request(),operations);
    assert.equal(retry.status,200);
    assert.equal(sends,1);
    ledger.close();
  `;
  try {
    execFileSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", probe], { cwd: root, env, encoding: "utf8" });
    const ledger = new DeliveryLedger(filename);
    try {
      assert.equal(ledger.hasActiveTurn(), false);
      assert.equal(ledger.getWake("wake-fast").status, "acknowledged");
    } finally { ledger.close(); }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("explicit launcher loads native generated client and releases ownership on shutdown", { timeout: 15_000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "nemeia-launcher-"));
  const filename = join(directory, "ledger.sqlite");
  const sockets = new Set();
  const server = createServer();
  // Deliberately leave a local fake WebSocket handshake pending. No WorldDB
  // exists here and no native subscription or domain mutation is accepted.
  server.on("connection", (socket) => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
  server.on("upgrade", () => {});
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  const env = {
    ...childEnv, NEMEIA_AGENT_LEDGER: filename, NEMEIA_EVE_WAKE_URL: `${endpoint}/wake`,
    NEMEIA_WORLD_URI: endpoint, NEMEIA_WORLD_DATABASE: "stub", NEMEIA_WORLD_ID: "world-1", NEMEIA_AGENT_ID: "agent-1",
    NEMEIA_WORLD_AUTH_SECRET: "synthetic-test-only", NEMEIA_WORLD_AUTH_ISSUER: "issuer", NEMEIA_WORLD_AUTH_AUDIENCE: "audience",
    NEMEIA_AGENT_OWNER_PRINCIPAL_ID: "issuer:owner",
  };
  const child = spawn("bash", [join(root, "agent/scripts/world-wake-bridge.sh")], { env, stdio: ["ignore", "pipe", "pipe"] });
  const completion = once(child, "exit");
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  try {
    for (let n = 0; n < 100 && !output.includes('"component":"nemeia-world-wake-bridge"'); n++) {
      if (child.exitCode !== null) assert.fail(output);
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    assert.ok(output.includes('"component":"nemeia-world-wake-bridge"'), output);
    const blocked = spawn("bash", [join(root, "agent/scripts/world-wake-bridge.sh")], { env, stdio: "ignore" });
    assert.equal((await once(blocked, "exit"))[0], 73);
    child.kill("SIGTERM");
    const timeout = setTimeout(() => child.kill("SIGKILL"), 4000);
    const [code] = await completion;
    clearTimeout(timeout);
    assert.equal(code, 0, output);
    execFileSync("flock", ["--exclusive", "--nonblock", `${filename}.wake-owner.lock`, "true"], { env: childEnv });
  } finally {
    child.kill("SIGKILL");
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
    rmSync(directory, { recursive: true, force: true });
  }
});
