import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DeliveryLedger } from "../agent/lib/world-bridge/delivery-ledger.ts";

async function ledgerFingerprint(filename) {
  const hashes = {};
  for (const suffix of ["", "-wal", "-shm"]) {
    try { hashes[suffix || "main"] = createHash("sha256").update(await readFile(filename + suffix)).digest("hex"); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  return hashes;
}

export function compilerImportChecks({ before, after, busyRows, connections, requests, upgrades }) {
  return {
    retainedLedgerUnchanged: JSON.stringify(before) === JSON.stringify(after),
    retainedBusyStateUnchanged: busyRows.length === 1 && busyRows[0].session_id === "packaging-retained-busy" && busyRows[0].accepted_count === 1,
    noWorldConnection: connections === 0,
    noHttpOrWakeRequest: requests === 0,
    noWebSocketUpgrade: upgrades === 0,
  };
}

/** Actual Eve compiler commands, configured as a deployment but pointed only
 * at our rejecting loopback stub. Never open the held qualification database. */
export async function checkConfiguredCompilerImports({ artifactDirectory, run }) {
  const directory = join(artifactDirectory, "configured-compiler");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const ledgerPath = join(directory, "retained-agent.sqlite");
  const seed = new DeliveryLedger(ledgerPath);
  seed.markSessionBusy("packaging-retained-busy");
  seed.close();
  const sockets = new Set();
  let connections = 0, requests = 0, upgrades = 0;
  const server = createServer((_request, response) => {
    requests++;
    response.writeHead(503, { "content-type": "text/plain" });
    response.end("compiler imports must not contact the World or wake routes");
  });
  server.on("connection", (socket) => {
    connections++; sockets.add(socket); socket.once("close", () => sockets.delete(socket));
  });
  server.on("upgrade", (_request, socket) => { upgrades++; socket.destroy(); });
  await new Promise((resolveListen, reject) => {
    server.once("error", reject); server.listen(0, "127.0.0.1", resolveListen);
  });
  const uri = `http://127.0.0.1:${server.address().port}`;
  const configured = {
    NEMEIA_WORLD_URI: uri,
    NEMEIA_WORLD_DATABASE: "compiler-import-must-not-connect",
    NEMEIA_WORLD_ID: "packaging-world",
    NEMEIA_AGENT_ID: "packaging-agent",
    NEMEIA_WORLD_TOKEN: "synthetic-compiler-canary-not-a-credential",
    NEMEIA_AGENT_LEDGER: ledgerPath,
    NEMEIA_AGENT_OWNER_PRINCIPAL_ID: "packaging-issuer:packaging-owner",
    NEMEIA_AGENT_OWNER_ISSUER: "packaging-issuer",
    NEMEIA_AGENT_OWNER_SUBJECT: "packaging-owner",
    NEMEIA_WORLD_AUTH_ISSUER: "packaging-issuer",
    NEMEIA_WORLD_AUTH_AUDIENCE: "packaging-audience",
    NEMEIA_WORLD_AUTH_SUBJECT: "packaging-owner",
    NEMEIA_WORLD_AUTH_SECRET: randomUUID(),
    NEMEIA_EVE_WAKE_URL: `${uri}/wake`,
  };
  const stages = [];
  try {
    for (const [name, args] of [["configured-info", ["info", "--json"]], ["configured-build", ["build"]]]) {
      // A SQLite read-only diagnostic may create WAL/SHM sidecars. Attribute
      // changes to this compiler stage, not to our preceding diagnostic read.
      const before = await ledgerFingerprint(ledgerPath);
      const completion = await run(name, args, configured, 60_000);
      const after = await ledgerFingerprint(ledgerPath);
      // Read only after hashing so this diagnostic read cannot hide sidecar changes.
      const db = new DatabaseSync(ledgerPath, { readOnly: true });
      let busyRows;
      try { busyRows = db.prepare("SELECT session_id, accepted_count FROM turn_activity").all(); }
      finally { db.close(); }
      const checks = compilerImportChecks({ before, after, busyRows, connections, requests, upgrades });
      stages.push({ name, completion, checks, before, after, connections, requests, upgrades });
      if (completion.code !== 0 || Object.values(checks).some((value) => !value)) break;
    }
    return { result: stages.length === 2 && stages.every((stage) => stage.completion.code === 0 && Object.values(stage.checks).every(Boolean)) ? "pass" : "fail",
      worldAndWakeConfigured: true, endpoint: uri, ledgerPath, stages };
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  }
}
