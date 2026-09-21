import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { canonicalJson } from "../world-client/src/json.ts";

const projectRoot = resolve(new URL("..", import.meta.url).pathname);
const execute = promisify(execFile);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function fileHash(pathname) {
  try { return hash(await readFile(pathname)); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

async function sourceTree(directory) {
  const files = {};
  async function visit(pathname, prefix = "") {
    for (const entry of (await readdir(pathname, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      const relative = prefix + entry.name;
      if (entry.isDirectory()) await visit(join(pathname, entry.name), relative + "/");
      else if (entry.isFile() && entry.name.endsWith(".ts")) files[relative] = await fileHash(join(pathname, entry.name));
    }
  }
  await visit(directory);
  return { sha256: hash(canonicalJson(files)), files };
}

async function installedVersion(name) {
  return JSON.parse(await readFile(join(projectRoot, "node_modules", name, "package.json"), "utf8")).version;
}

async function binaryVersion(pathname) {
  try {
    const { stdout, stderr } = await execute(pathname, ["--version"], { timeout: 5000, maxBuffer: 16 * 1024 });
    const output = `${stdout}\n${stderr}`.trim();
    return { path: pathname, version: output.match(/(?:tool|standalone) version\s+([0-9]+\.[0-9]+\.[0-9]+)/i)?.[1] ?? "unrecognized", output,
      sha256: await fileHash(pathname) };
  } catch (error) {
    return { path: pathname, version: "unavailable", reason: error.code ?? "version-command-failed" };
  }
}

export async function captureQualificationProvenance(directory) {
  const versions = { node: process.versions.node };
  for (const name of ["eve", "spacetimedb", "typescript", "jiti", "just-bash", "ai", "zod"]) versions[name] = await installedVersion(name);
  const cache = join(projectRoot, ".artifacts/toolcache/spacetimedb-2.10.1");
  const [cli, server] = await Promise.all([
    binaryVersion(join(cache, "spacetimedb-cli")), binaryVersion(join(cache, "spacetimedb-standalone")),
  ]);
  versions.spacetimedbCli = cli.version;
  versions.spacetimedbServer = server.version;
  const inventory = {
    schemaVersion: 1, capturedAt: new Date().toISOString(), projectRoot,
    platform: process.platform, architecture: process.arch, versions, cli, server,
    rootLockSha256: await fileHash(join(projectRoot, "package-lock.json")),
    contractManifestSha256: await fileHash(join(projectRoot, "conformance/contract-manifest.json")),
    schemaSourceSha256: await fileHash(join(projectRoot, "contracts/spacetimedb/src/schema.ts")),
    moduleArtifactSha256: await fileHash(join(projectRoot, "contracts/spacetimedb/dist/bundle.js")),
    moduleSources: await sourceTree(join(projectRoot, "contracts/spacetimedb/src")),
    generatedSources: await sourceTree(join(projectRoot, "world-client/src/generated")),
  };
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const pathname = join(directory, `inventory-${Date.now()}-${randomUUID()}.json`);
  const bytes = `${canonicalJson(inventory)}\n`;
  await writeFile(pathname, bytes, { mode: 0o600, flag: "wx" });
  return { versions, path: pathname, sha256: hash(bytes) };
}

/** Fresh proof files are immutable. Callers must select a new run directory;
 * an existing report is never silently replaced by a later pass or failure. */
export async function writeQualificationReport(pathname, report) {
  const target = resolve(pathname);
  const provenance = await captureQualificationProvenance(join(dirname(target), "provenance"));
  const enriched = { ...report, versions: { ...report.versions, ...provenance.versions },
    details: { ...report.details, qualificationProvenance: { path: provenance.path, sha256: provenance.sha256 } } };
  await writeFile(target, `${canonicalJson(enriched)}\n`, { mode: 0o600, flag: "wx" });
  return target;
}
