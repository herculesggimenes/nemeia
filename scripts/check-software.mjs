import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { mkdir, open, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(new URL("..", import.meta.url).pathname);
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const node = process.execPath;
const typeScript = fileURLToPath(import.meta.resolve("typescript/bin/tsc"));
const tsSpecifierLoader = resolve(root, "scripts/resolve-ts-specifiers.mjs");
const artifactDirectory = resolve(root, ".artifacts/qualification/software-checks", `run-${process.pid}-${Date.now()}`);
await mkdir(artifactDirectory, { recursive: true, mode: 0o700 });
// This command is deterministic software validation, never an opt-in actual
// fixture runner. Do not inherit a held database token or qualification flag.
const checkEnvironment = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
  !name.startsWith("NEMEIA_") && ![
    "AI_GATEWAY_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "VERCEL_OIDC_TOKEN",
  ].includes(name)));
checkEnvironment.NEMEIA_ACTUAL_WORLD_QUALIFICATION = "0";
const agentRuntimeTestFiles = readdirSync(resolve(root, "agent/test"))
  .filter((name) => name.endsWith(".test.mjs") && name !== "eve-sandbox-lifecycle.test.mjs")
  .sort()
  .map((name) => join("agent/test", name));

const checks = [
  ["canonical authority", npm, ["run", "check:authority"]],
  ["strict generated contract manifest", npm, ["run", "check:contract-manifest:strict"]],
  ["SpacetimeDB module strict TypeScript", node, [typeScript, "-p", "contracts/spacetimedb/tsconfig.json"]],
  ["world-client strict TypeScript", npm, ["--prefix", "world-client", "run", "check"]],
  ["world-client runtime tests", npm, ["--prefix", "world-client", "run", "test"]],
  ["world-resources strict TypeScript and runtime tests", npm, ["--prefix", "world-resources", "run", "check"]],
  ["perception strict TypeScript", node, [typeScript, "-p", "perception/tsconfig.json"]],
  ["perception runtime tests", node, ["--test", "perception/test/*.test.ts"]],
  ["agent strict TypeScript", npm, ["--prefix", "agent", "run", "check"]],
  ["agent runtime tests", node, ["--experimental-strip-types", "--test", ...agentRuntimeTestFiles]],
  ["agent Eve sandbox lifecycle test", node, ["--experimental-strip-types", "--experimental-loader", tsSpecifierLoader, "--test", "agent/test/eve-sandbox-lifecycle.test.mjs"]],
  ["local-controller strict TypeScript", node, [typeScript, "-p", "local-controller/tsconfig.json", "--typeRoots", "node_modules/@types"]],
  ["local-controller runtime tests", node, ["--experimental-loader", tsSpecifierLoader, "--test", "local-controller/test/*.test.ts"]],
  ["frontend strict TypeScript", npm, ["--prefix", "frontend", "run", "type-check"]],
  ["frontend unit tests", npm, ["--prefix", "frontend", "run", "test:unit"]],
  ["G3 actual composition strict TypeScript", npm, ["run", "check:conformance:g3"]],
  ["G3 helper fixture tests", node, ["--experimental-loader", tsSpecifierLoader, "--test", "conformance/test/g3-flow.test.ts"]],
  ["composition fixture tests", node, ["--experimental-loader", tsSpecifierLoader, "--test", "scripts/test/*.test.mjs"]],
  ["conformance fixture-only tests", npm, ["run", "check:conformance:mock"]],
];

async function run(label, command, args, extraEnvironment = {}) {
  const logfile = join(artifactDirectory, `${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.log`);
  const log = await open(logfile, "w", 0o600);
  const startedAt = new Date().toISOString();
  return new Promise((resolveResult, reject) => {
    process.stdout.write(`\n[check-software] ${label}\n`);
    const child = spawn(command, args, { cwd: root, env: { ...checkEnvironment, ...extraEnvironment }, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (chunk) => { process.stdout.write(chunk); log.write(chunk).catch(reject); });
    child.stderr.on("data", (chunk) => { process.stderr.write(chunk); log.write(chunk).catch(reject); });
    child.once("error", reject);
    child.once("close", (code, signal) => resolveResult({ label, code: code ?? 1, signal, logfile, startedAt, completedAt: new Date().toISOString() }));
  }).finally(() => log.close());
}

const failures = [];
const results = [];
for (const [label, command, args, extraEnvironment] of checks) {
  const result = await run(label, command, args, extraEnvironment);
  results.push(result);
  if (result.code !== 0) {
    process.stderr.write(`[check-software] failed: ${label} (exit=${result.code}${result.signal ? `, signal=${result.signal}` : ""})\n`);
    process.exitCode = result.code;
    failures.push(label);
  }
}
const reportPath = join(artifactDirectory, "report.json");
await writeFile(reportPath, `${JSON.stringify({ result: failures.length === 0 ? "pass" : "fail", checks: results, failures }, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(`\n[check-software] ${checks.length - failures.length}/${checks.length} checks passed\n`);
process.stdout.write(`[check-software] report: ${reportPath}\n`);
for (const failure of failures) process.stderr.write(`[check-software] unresolved: ${failure}\n`);
