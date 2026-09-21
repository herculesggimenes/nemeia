import { spawn } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const handoffPath = fileURLToPath(new URL("../../.artifacts/qualification/current-handoff.json", import.meta.url));
if ((statSync(handoffPath).mode & 0o777) !== 0o600) { throw new Error("handoff_must_be_private"); }
const handoff = JSON.parse(readFileSync(handoffPath, "utf8"));
if (handoff.available !== true) { throw new Error("integration_fixture_unavailable"); }
if (new URL(handoff.uri).hostname !== "127.0.0.1") { throw new Error("fixture_must_be_loopback"); }
const port = process.env.NEMEIA_UI_PORT ?? "5183";
const nextCli = createRequire(import.meta.url).resolve("next/dist/bin/next");
const child = spawn(process.execPath, [nextCli, "dev", "-H", "127.0.0.1", "-p", port], {
  cwd: fileURLToPath(new URL("..", import.meta.url)),
  env: {
    ...process.env,
    NEMEIA_ISOLATED_UI: "1",
    NEXT_PUBLIC_NEMEIA_SPACETIMEDB_URI: handoff.uri,
    NEXT_PUBLIC_NEMEIA_SPACETIMEDB_DATABASE: handoff.databaseName,
    NEMEIA_SPACETIMEDB_URI: handoff.uri,
    NEMEIA_SPACETIMEDB_DATABASE: handoff.databaseName,
    NEMEIA_WORLD_RESOURCE_ROOT: handoff.resourceRoot,
  },
  stdio: "inherit",
});
process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
child.on("exit", (code) => { process.exitCode = code ?? 1; });
