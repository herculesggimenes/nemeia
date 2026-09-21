import { defineAgent } from "eve";
import { mockModel } from "eve/evals";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { respondAutomaticWake } from "./automatic-wake-model.ts";

const defaultActionProposal = JSON.stringify({
  kind: "navigate",
  missionId: "mission-g2-eve-001",
  objectiveId: "objective-g2-eve-001",
  mapId: "local-map-go2-001",
  targetFrameId: "frame-go2-local-001",
  target: {
    positionM: { x: 1, y: 2, z: 0 },
    orientation: { x: 0, y: 0, z: 0, w: 1 },
  },
});

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function boundedWorldSummaryCommand(): string {
  const entityId = process.env.NEMEIA_G2_EXPECTED_ENTITY_ID;
  const mapId = process.env.NEMEIA_G2_EXPECTED_MAP_ID;
  if (entityId === undefined || mapId === undefined || entityId.length === 0 || mapId.length === 0) {
    throw new Error("fixture generated target ids are not configured");
  }
  const filter = `{worldId,agentId,worldRevision,localMaps: [.localMaps[] | select(.id == ${JSON.stringify(mapId)})],objects: [.objects[] | select(.id == ${JSON.stringify(entityId)})]}`;
  return `nemeia world summary | jq -c ${shellQuote(filter)}`;
}

const boundedManifestCommand = "cat /world/manifest.json | jq -c '{schema,contextId,worldId,agentId,worldRevision}'";

function boundedWorldRefreshCommand(): string {
  const missionId = process.env.NEMEIA_G2_EXPECTED_MISSION_ID;
  if (missionId === undefined || missionId.length === 0) throw new Error("fixture expected mission id is not configured");
  const missionFilter = `[.[] | select(.missionId == ${JSON.stringify(missionId)})]`;
  return `${boundedWorldSummaryCommand()} && nemeia world mission-log | jq -c ${shellQuote(missionFilter)} && ${boundedManifestCommand}`;
}

function pinnedAfterMutationCommand(): string {
  const missionId = process.env.NEMEIA_G2_EXPECTED_MISSION_ID;
  if (!missionId) throw new Error("fixture expected mission id is not configured");
  const filter = `{missionMatches: [.[] | select(.missionId == ${JSON.stringify(missionId)})]}`;
  return `${boundedManifestCommand} && cat /world/mission-log.json | jq -c ${shellQuote(filter)} && ${boundedManifestCommand}`;
}

function noteModelCall(toolResultCount: number): void {
  const path = process.env.NEMEIA_EVAL_MODEL_CALL_FILE;
  if (path === undefined) return;
  appendFileSync(path, `${JSON.stringify({ toolResultCount, at: new Date().toISOString() })}\n`);
}

function waitForRelease(): Promise<void> {
  const releaseFile = process.env.NEMEIA_EVAL_RELEASE_FILE;
  const markerFile = process.env.NEMEIA_EVAL_THINKING_FILE;
  if (releaseFile === undefined || markerFile === undefined) throw new Error("fixture barrier is not configured");
  writeFileSync(markerFile, "thinking\n");
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (Date.now() - started > 10_000) {
        reject(new Error("fixture model barrier timed out"));
        return;
      }
      try {
        if (readRelease(releaseFile)) {
          resolve();
          return;
        }
      } catch {
        // The eval writes the release marker atomically after updating state.
      }
      setTimeout(poll, 10).unref();
    };
    poll();
  });
}

function readRelease(path: string): boolean {
  return readFileSync(path, "utf8").trim() === "release";
}

function notePermissionFirstResult(toolResults: readonly unknown[]): void {
  const marker = process.env.NEMEIA_EVAL_PERMISSION_FIRST_RESULT_FILE;
  if (marker === undefined) return;
  const first = toolResults[0];
  const wrapper = first !== null && typeof first === "object" ? first as Record<string, unknown> : {};
  const result = wrapper.output !== null && typeof wrapper.output === "object" ? wrapper.output as Record<string, unknown> : wrapper;
  const exitCode = result.exitCode;
  const stderr = result.stderr;
  let parsed: Record<string, unknown> = {};
  try { parsed = JSON.parse(String(result.stdout)); } catch { /* A truncated or failed read is not success. */ }
  writeFileSync(marker, `${JSON.stringify({
    success: exitCode === 0 && (stderr === undefined || stderr === "") &&
      parsed.worldId === process.env.NEMEIA_WORLD_ID && Array.isArray(parsed.objects) && parsed.objects.length > 0,
  })}\n`);
}

export default defineAgent({
  model: mockModel({
    modelId: "nemeia-eval-fixture",
    provider: "nemeia-fixtures",
    respond: async (request) => {
      if (process.env.NEMEIA_AUTO_WAKE_DIRECTORY) return respondAutomaticWake(request);
      const { toolResults } = request;
      noteModelCall(toolResults.length);
      if (process.env.NEMEIA_EVAL_DEFAULT_API_ONLY === "1") {
        return toolResults.length === 0
          ? { toolCalls: [{ name: "bash", id: "other-principal-read", input: { command: "nemeia world summary" } }] }
          : `contexts=${JSON.stringify(toolResults.map((result) => result.output))}`;
      }
      if (process.env.NEMEIA_EVAL_ACTION_ONLY === "1" && toolResults.length === 0) {
        const actionMarker = process.env.NEMEIA_EVAL_ACTION_CALL_FILE;
        if (actionMarker !== undefined) writeFileSync(actionMarker, "nemeia world action propose\n");
        return {
          toolCalls: [
            {
              name: "bash",
              id: "g3-action-a",
              input: {
                command: `nemeia world action propose ${shellQuote(process.env.NEMEIA_G2_ACTION_PROPOSAL_JSON ?? defaultActionProposal)}`,
              },
            },
            {
              name: "bash",
              id: "g3-action-b",
              input: {
                command: `nemeia world action propose ${shellQuote(process.env.NEMEIA_G2_ACTION_PROPOSAL_JSON ?? defaultActionProposal)}`,
              },
            },
          ],
        };
      }
      if (process.env.NEMEIA_EVAL_ACTION_ONLY === "1") {
        return "public Eve action command completed";
      }
      if (process.env.NEMEIA_EVAL_PERMISSION_ONLY === "1") {
        if (toolResults.length === 0) {
          return { toolCalls: [{ name: "bash", id: "permission-before", input: { command: boundedWorldSummaryCommand() } }] };
        }
        if (toolResults.length === 1) {
          notePermissionFirstResult(toolResults);
          await waitForRelease();
          const observationId = process.env.NEMEIA_G2_PERMISSION_OBSERVATION_ID;
          if (observationId === undefined || observationId.length === 0) throw new Error("permission probe observation id is not configured");
          return {
            toolCalls: [{
              name: "bash",
              id: "permission-after-revoke",
              input: { command: `nemeia world detail observation-detail ${shellQuote(JSON.stringify({ observationId }))}` },
            }],
          };
        }
        return `contexts=${JSON.stringify(toolResults.map((result) => result.output))}`;
      }
      if (toolResults.length === 0) {
        return {
          toolCalls: [
            { name: "bash", id: "same-step-a", input: { command: boundedWorldSummaryCommand() } },
            { name: "bash", id: "same-step-b", input: { command: `${boundedManifestCommand} && ${boundedManifestCommand}` } },
          ],
        };
      }
      if (toolResults.length === 2) {
        await waitForRelease();
        const actionMarker = process.env.NEMEIA_EVAL_ACTION_CALL_FILE;
        if (actionMarker !== undefined) writeFileSync(actionMarker, "nemeia world action propose\n");
        return {
          toolCalls: [{
            name: "bash",
            id: "g2-action",
            input: {
              command: `nemeia world action propose ${shellQuote(process.env.NEMEIA_G2_ACTION_PROPOSAL_JSON ?? defaultActionProposal)}`,
            },
          }, {
            name: "bash",
            id: "pinned-after-change",
            input: { command: pinnedAfterMutationCommand() },
          }],
        };
      }
      if (toolResults.length === 4) {
        return {
          toolCalls: [{
            name: "bash",
            id: "next-step",
            // Keep each public Bash result lossless and model-readable.  The
            // projection selects the current generated-world evidence before
            // Eve's public Bash output budget is applied.
            input: { command: boundedWorldRefreshCommand() },
          }],
        };
      }
      return `contexts=${JSON.stringify(toolResults.map((result) => result.output))}`;
    },
  }),
  modelContextWindowTokens: 20_000,
  reasoning: "none",
  limits: {
    maxInputTokensPerSession: 20_000,
    maxOutputTokensPerSession: 8_000,
    maxTokenCostUsdPerSession: false,
  },
});
