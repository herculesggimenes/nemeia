import { access, mkdir, readFile, symlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const root = resolve(new URL("..", import.meta.url).pathname);
const require = createRequire(pathToFileURL(join(root, "package.json")));

export async function linkSoftwareTools() {
  // npm may hoist identical workspace dependencies even with nested placement.
  // Existing package scripts and generated-host fixtures use these explicit
  // local tool paths; link them to the one root-pinned installation.
  const packages = {
    "spacetimedb": ["contracts/spacetimedb", "world-client", "agent", "local-controller", "agent/eve-eval-fixture"],
    "eve": ["agent", "agent/eve-eval-fixture"],
    "just-bash": ["agent", "agent/eve-eval-fixture"],
    "ai": ["agent"],
    "typescript": ["frontend", "agent"],
    "jiti": ["frontend"],
  };
  for (const [name, consumers] of Object.entries(packages)) {
    let target;
    try { target = dirname(require.resolve(`${name}/package.json`)); }
    catch {
      target = join(root, "node_modules", name);
      await access(join(target, "package.json"));
    }
    for (const consumer of consumers) {
      const destination = join(root, consumer, "node_modules", name);
      try { await access(join(destination, "package.json")); continue; } catch (error) { if (error.code !== "ENOENT") throw error; }
      await mkdir(dirname(destination), { recursive: true });
      await symlink(target, destination, "dir");
    }
    const version = JSON.parse(await readFile(join(target, "package.json"), "utf8")).version;
    console.log(`[software-tools] ${name}@${version}`);
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await linkSoftwareTools();
