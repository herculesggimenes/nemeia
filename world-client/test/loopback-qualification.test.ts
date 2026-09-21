import test from "node:test";
import {
  readTokenFile,
  runActualWorldQualification,
} from "./loopback-qualification-helper.ts";

const enabled = process.env.NEMEIA_ACTUAL_WORLD_QUALIFICATION === "1";

test("actual SpacetimeDB module E1/E2 auth, scope, duplicate, and history-tail qualification", {
  skip: !enabled,
  timeout: 120_000,
}, async () => {
  const uri = process.env.NEMEIA_SPACETIMEDB_URI;
  const tokenFile = process.env.NEMEIA_ADMIN_TOKEN_FILE ?? process.env.NEMEIA_SCOPED_IDENTITY_FILE;
  if (!uri || !tokenFile) throw new Error("actual qualification requires NEMEIA_SPACETIMEDB_URI and NEMEIA_ADMIN_TOKEN_FILE");
  const result = await runActualWorldQualification({
    uri,
    databaseName: process.env.NEMEIA_SPACETIMEDB_DATABASE ?? "nemeia-local-loopback",
    adminToken: await readTokenFile(tokenFile),
  });
  for (const [name, passed] of Object.entries(result.checks)) {
    if (!passed) throw new Error(`actual qualification check failed: ${name}`);
  }
  process.stdout.write(`${JSON.stringify({ gate: "E1/E2", mode: "loopback-spacetimedb", ...result })}\n`);
});
