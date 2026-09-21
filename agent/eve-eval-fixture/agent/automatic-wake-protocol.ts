import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const AUTO_MISSION_DESCRIPTION = "Automatic wake action-free qualification";
export const AUTO_TIMEOUT_MS = 90_000;

export function automaticDirectory(): string {
  const directory = process.env.NEMEIA_AUTO_WAKE_DIRECTORY;
  if (!directory?.startsWith("/")) throw new Error("automatic wake qualification requires an absolute evidence directory");
  return directory;
}

export function readMarker<T = Record<string, unknown>>(name: string): T | undefined {
  try {
    const text = readFileSync(join(automaticDirectory(), name), "utf8");
    if (text.length > 128_000) throw new Error("automatic wake marker exceeds budget");
    return JSON.parse(text) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export function writeMarker(name: string, value: unknown): void {
  const pathname = join(automaticDirectory(), name);
  writeFileSync(`${pathname}.pending`, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  renameSync(`${pathname}.pending`, pathname);
}

export async function awaitMarker<T = Record<string, unknown>>(name: string): Promise<T> {
  const deadline = Date.now() + AUTO_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const marker = readMarker<T>(name);
    if (marker !== undefined) return marker;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`automatic wake marker timed out: ${name}`);
}

export function automaticMissionIds(): string[] {
  const ids: unknown = JSON.parse(process.env.NEMEIA_AUTO_MISSION_IDS ?? "null");
  if (!Array.isArray(ids) || ids.length !== 3 || ids.some((id) => typeof id !== "string" || !/^mission-g2-auto-[a-zA-Z0-9-]+$/u.test(id))) {
    throw new Error("automatic wake qualification requires exactly three owned mission IDs");
  }
  return ids as string[];
}

export function loopbackWakeUrl(target: string): string {
  const url = new URL(target);
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("automatic wake target must be a credential-free loopback HTTP origin");
  }
  return new URL("/wake", url).href;
}

function shellQuote(value: string): string { return `'${value.replaceAll("'", "'\"'\"'")}'`; }

/** Projection is performed by real Bash before Eve applies its output limit. */
export function automaticReadCommand(): string {
  const [a, b, c] = automaticMissionIds().map((id) => JSON.stringify(id));
  const entity = JSON.stringify(process.env.NEMEIA_G2_EXPECTED_ENTITY_ID);
  const map = JSON.stringify(process.env.NEMEIA_G2_EXPECTED_MAP_ID);
  if (!entity || !map) throw new Error("automatic wake generated evidence IDs are missing");
  const manifest = "cat /world/manifest.json | jq -c '{schema,contextId,worldRevision}'";
  const missions = `{missions:[.[] | select(.missionId == ${a} or .missionId == ${b} or .missionId == ${c}) | {missionId,description,lifecycle}]}`;
  const summary = `{worldId,agentId,localMaps:[.localMaps[] | select(.id == ${map}) | {id,unitId,headRevision}],objects:[.objects[] | select(.id == ${entity}) | {id,kind,supportObservationIds,semantic}]}`;
  return `${manifest} && cat /world/mission-log.json | jq -c ${shellQuote(missions)} && nemeia world summary | jq -c ${shellQuote(summary)} && ${manifest}`;
}

export function parseAutomaticRead(output: unknown): {
  contextId: string; worldRevision: string; missionIds: string[];
} {
  if (output === null || typeof output !== "object") throw new Error("missing automatic wake Bash result");
  const result = output as Record<string, unknown>;
  if (result.exitCode !== 0 || result.stderr !== "" || typeof result.stdout !== "string" ||
    result.truncated === true || result.stdout.includes("[truncated]") || Buffer.byteLength(result.stdout) > 3_900) {
    throw new Error("automatic wake Bash output failed or exceeded its intact output budget");
  }
  const lines = result.stdout.trim().split(/\r?\n/u);
  if (lines.length !== 4 || lines.some((line) => Buffer.byteLength(line) > 1_900)) throw new Error("unexpected automatic wake JSON framing/budget");
  const [first, log, summary, last] = lines.map((line) => JSON.parse(line) as Record<string, any>);
  if (first.schema !== "nemeia.world-context@1" || typeof first.contextId !== "string" ||
    typeof first.worldRevision !== "string" || first.contextId !== last.contextId || first.worldRevision !== last.worldRevision) {
    throw new Error("automatic wake mount was not pinned within its step");
  }
  if (summary.worldId !== process.env.NEMEIA_WORLD_ID || summary.agentId !== process.env.NEMEIA_AGENT_ID ||
    !Array.isArray(summary.localMaps) || !summary.localMaps.some((map: Record<string, unknown>) =>
      map.id === process.env.NEMEIA_G2_EXPECTED_MAP_ID && map.unitId === process.env.NEMEIA_G2_EXPECTED_UNIT_ID && map.headRevision != null) ||
    !Array.isArray(summary.objects) || !summary.objects.some((object: Record<string, any>) =>
      object.id === process.env.NEMEIA_G2_EXPECTED_ENTITY_ID && object.id !== process.env.NEMEIA_G2_EXPECTED_UNIT_ID && object.kind === "object" &&
      Array.isArray(object.semantic) && object.semantic.length > 0 && Array.isArray(object.supportObservationIds) &&
      object.supportObservationIds.includes(process.env.NEMEIA_G2_EXPECTED_OBSERVATION_ID))) {
    throw new Error("automatic wake output lacks meaningful native Unit/map/Object evidence");
  }
  if (!Array.isArray(log.missions) || log.missions.some((mission: Record<string, unknown>) =>
    !automaticMissionIds().includes(String(mission.missionId)) || mission.description !== AUTO_MISSION_DESCRIPTION || mission.lifecycle !== "active")) {
    throw new Error("automatic wake mission output is not an intact owned assignment projection");
  }
  return { contextId: first.contextId, worldRevision: first.worldRevision, missionIds: log.missions.map((mission: Record<string, string>) => mission.missionId).sort() };
}
