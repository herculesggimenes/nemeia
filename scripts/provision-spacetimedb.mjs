import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join, resolve } from "node:path";

const execFileAsync = promisify(execFile);

export const SPACETIMEDB_VERSION = "2.10.1";
export const SPACETIMEDB_RELEASE_URL =
  "https://github.com/clockworklabs/SpacetimeDB/releases/download/v2.10.1/spacetime-x86_64-unknown-linux-gnu.tar.gz";
export const SPACETIMEDB_RELEASE_SHA256 =
  "8b8d1c63b71dcecb10e7c0c8a0a3e5eb56c0d7cb30ba746488caee225f809ba5";

const execRoot = resolve(new URL("..", import.meta.url).pathname);
const defaultCache = resolve(execRoot, ".artifacts/toolcache/spacetimedb-2.10.1");

async function sha256(pathname) {
  const digest = createHash("sha256");
  digest.update(await readFile(pathname));
  return digest.digest("hex");
}

async function exists(pathname) {
  try {
    await stat(pathname);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function downloadArchive(archivePath) {
  const temporaryPath = `${archivePath}.download`;
  const response = await fetch(SPACETIMEDB_RELEASE_URL);
  if (!response.ok || !response.body) {
    throw new Error(`SpacetimeDB ${SPACETIMEDB_VERSION} download failed: HTTP ${response.status}`);
  }
  await pipeline(response.body, createWriteStream(temporaryPath, { mode: 0o600 }));
  const digest = await sha256(temporaryPath);
  if (digest !== SPACETIMEDB_RELEASE_SHA256) {
    await rm(temporaryPath, { force: true });
    throw new Error(`SpacetimeDB release checksum mismatch: expected ${SPACETIMEDB_RELEASE_SHA256}, got ${digest}`);
  }
  await rename(temporaryPath, archivePath);
  await chmod(archivePath, 0o600);
}

async function ensureArchive(cacheDirectory) {
  const archivePath = join(cacheDirectory, "spacetime-x86_64-unknown-linux-gnu.tar.gz");
  if (!(await exists(archivePath)) || (await sha256(archivePath)) !== SPACETIMEDB_RELEASE_SHA256) {
    if (await exists(archivePath)) await rm(archivePath, { force: true });
    await downloadArchive(archivePath);
  }
  return archivePath;
}

async function ensureBinaries(cacheDirectory, archivePath) {
  const cliPath = join(cacheDirectory, "spacetimedb-cli");
  const standalonePath = join(cacheDirectory, "spacetimedb-standalone");
  if (!(await exists(cliPath)) || !(await exists(standalonePath))) {
    const extractDirectory = join(cacheDirectory, `.extract-${process.pid}`);
    await rm(extractDirectory, { recursive: true, force: true });
    await mkdir(extractDirectory, { recursive: true, mode: 0o700 });
    await execFileAsync("tar", ["-xzf", archivePath, "-C", extractDirectory]);
    const locate = async (name) => {
      const { stdout } = await execFileAsync("find", [extractDirectory, "-type", "f", "-name", name, "-print", "-quit"]);
      const found = stdout.trim();
      if (!found) throw new Error(`SpacetimeDB archive did not contain ${name}`);
      return found;
    };
    for (const [name, destination] of [["spacetimedb-cli", cliPath], ["spacetimedb-standalone", standalonePath]]) {
      const source = await locate(name);
      await rename(source, destination);
      await chmod(destination, 0o700);
    }
    await rm(extractDirectory, { recursive: true, force: true });
  }
  return { cliPath, standalonePath };
}

async function versionOf(binary) {
  const { stdout, stderr } = await execFileAsync(binary, ["--version"]);
  const text = `${stdout}\n${stderr}`;
  const match = text.match(/(?:tool|standalone) version\s+([0-9]+\.[0-9]+\.[0-9]+)/i);
  if (!match || match[1] !== SPACETIMEDB_VERSION) {
    throw new Error(`unexpected SpacetimeDB version from ${binary}: ${text.trim()}`);
  }
  return match[1];
}

export async function provisionSpacetimeDb({ cacheDirectory = defaultCache } = {}) {
  if (process.platform !== "linux" || process.arch !== "x64") {
    throw new Error("the pinned local SpacetimeDB asset is currently provisioned for linux-x86_64 only");
  }
  const cache = resolve(cacheDirectory);
  await mkdir(cache, { recursive: true, mode: 0o700 });
  const archivePath = await ensureArchive(cache);
  const { cliPath, standalonePath } = await ensureBinaries(cache, archivePath);
  const [cliVersion, standaloneVersion] = await Promise.all([versionOf(cliPath), versionOf(standalonePath)]);
  const manifest = {
    version: SPACETIMEDB_VERSION,
    releaseUrl: SPACETIMEDB_RELEASE_URL,
    releaseSha256: SPACETIMEDB_RELEASE_SHA256,
    archivePath,
    cliPath,
    standalonePath,
    cliVersion,
    standaloneVersion,
  };
  await writeFile(join(cache, "provisioning.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  return Object.freeze(manifest);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const manifest = await provisionSpacetimeDb();
    console.log(JSON.stringify({
      version: manifest.version,
      cliPath: manifest.cliPath,
      standalonePath: manifest.standalonePath,
      releaseSha256: manifest.releaseSha256,
    }));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
