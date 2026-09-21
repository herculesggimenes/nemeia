import type { mockModel } from "eve/evals";
import { automaticReadCommand, awaitMarker, readMarker, writeMarker } from "./automatic-wake-protocol.ts";

// Derive callback types from the public export, not an Eve-internal module.
type Options = Exclude<NonNullable<Parameters<typeof mockModel>[0]>, string | ((...args: any[]) => any)>;
type Responder = Exclude<Options["respond"], string | undefined>;

export const respondAutomaticWake: Responder = async (request) => {
  const wake: unknown = JSON.parse(request.lastUserMessage ?? "null");
  if (!wake || typeof wake !== "object" || typeof (wake as Record<string, unknown>).wakeId !== "string") {
    throw new Error("automatic qualification only accepts production wake messages");
  }
  const wakeId = String((wake as Record<string, unknown>).wakeId);
  if (!readMarker("armed.json")) return "automatic-wake initial subscription baseline";
  const selected = readMarker<{ wakeId: string }>("thinking.json");
  const prefix = `auto-${wakeId}-`;
  const results = request.toolResults.filter((result) => result.id.startsWith(prefix));
  const measured = selected === undefined || selected.wakeId === wakeId;
  if (measured && results.length === 0) {
    writeMarker("thinking.json", { wakeId, model: "public-mockModel", at: new Date().toISOString() });
    await awaitMarker("release.json");
    return { toolCalls: [{ name: "bash", id: `${prefix}pinned`, input: { command: automaticReadCommand() } }] };
  }
  if ((!measured && results.length === 0) || (measured && results.length === 1)) {
    return { toolCalls: [{ name: "bash", id: `${prefix}fresh`, input: { command: automaticReadCommand() } }] };
  }
  return `automatic-contexts=${JSON.stringify({ wakeId, measured, results: results.map((result) => result.output) })}`;
};
