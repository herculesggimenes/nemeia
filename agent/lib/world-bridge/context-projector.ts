import { randomUUID } from "node:crypto";
import { DeliveryLedger } from "./delivery-ledger.ts";
import type {
  PreparedWorldContext,
  StepIdentity,
  WorldPrincipal,
  WorldReadPort,
} from "./types.ts";

const DEFAULT_MAX_CONTEXT_BYTES = 96 * 1024;

export class ContextLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContextLimitError";
  }
}

function jsonFile(path: `/world/${string}`, value: unknown, maxBytes: number) {
  const content = `${JSON.stringify(value)}\n`;
  const byteLength = Buffer.byteLength(content, "utf8");
  if (byteLength > maxBytes) throw new ContextLimitError(`context file ${path} exceeds its byte limit`);
  return { path, content, byteLength } as const;
}

export class WorldContextProjector {
  private readonly input: {
    readonly ledger: DeliveryLedger;
    readonly world: WorldReadPort;
    readonly worldId: string;
    readonly agentId: string;
    readonly maxContextBytes?: number;
  };

  constructor(
    input: {
      readonly ledger: DeliveryLedger;
      readonly world: WorldReadPort;
      readonly worldId: string;
      readonly agentId: string;
      readonly maxContextBytes?: number;
    },
  ) {
    this.input = input;
  }

  async prepare(
    step: StepIdentity,
    principal: WorldPrincipal,
    options: { readonly now?: () => Date } = {},
  ): Promise<PreparedWorldContext> {
    // Re-authorize every retry before consulting pinned bytes. The ledger
    // preserves same-step identity/content, but it is not an authorization
    // cache and must never let a revoked or cross-principal caller reuse it.
    const projection = await this.input.world.readProjection({
      worldId: this.input.worldId,
      agentId: this.input.agentId,
      principal,
      operation: "summary",
      maxBytes: this.input.maxContextBytes ?? DEFAULT_MAX_CONTEXT_BYTES,
    });
    if (projection.worldId !== this.input.worldId || projection.agentId !== this.input.agentId) {
      throw new Error("world-client returned a projection for the wrong world or agent");
    }
    const retained = this.input.ledger.getContext(step);
    if (retained !== undefined) return retained;

    const maxBytes = this.input.maxContextBytes ?? DEFAULT_MAX_CONTEXT_BYTES;
    const preparedAt = (options.now ?? (() => new Date()))().toISOString();
    const context: PreparedWorldContext = {
      contextId: `ctx_${randomUUID()}`,
      step,
      preparedAt,
      worldRevision: projection.worldRevision,
      files: [
        jsonFile(
          "/world/manifest.json",
          {
            schema: "nemeia.world-context@1",
            contextId: "pending",
            worldId: projection.worldId,
            agentId: projection.agentId,
            worldRevision: projection.worldRevision,
            preparedAt,
            sourceIds: projection.sourceIds,
            acquisitionTimes: projection.acquisitionTimes,
            dirtyKeys: projection.dirtyKeys,
            mustHandleIds: projection.mustHandleIds,
            rescanRequired: projection.rescanRequired,
          },
          maxBytes,
        ),
        jsonFile("/world/mission-log.json", projection.missionLog, maxBytes),
        jsonFile("/world/summary.json", projection.summary, maxBytes),
      ],
      sourceIds: projection.sourceIds,
      acquisitionTimes: projection.acquisitionTimes,
    };
    const files = context.files.map((file) =>
      file.path === "/world/manifest.json"
        ? jsonFile(
            "/world/manifest.json",
            {
              schema: "nemeia.world-context@1",
              contextId: context.contextId,
              worldId: projection.worldId,
              agentId: projection.agentId,
              worldRevision: projection.worldRevision,
              preparedAt,
              sourceIds: projection.sourceIds,
              acquisitionTimes: projection.acquisitionTimes,
              dirtyKeys: projection.dirtyKeys,
              mustHandleIds: projection.mustHandleIds,
              rescanRequired: projection.rescanRequired,
            },
            maxBytes,
          )
        : file,
    );
    const totalBytes = files.reduce((total, file) => total + file.byteLength, 0);
    if (totalBytes > maxBytes) throw new ContextLimitError("projected world context exceeds its total byte limit");
    const saved = this.input.ledger.saveContext({ ...context, files });
    // Retire only replaceable changes observed by this pinned projection. A
    // newer subscription update remains pending; must-handle rows are never
    // acknowledged merely because a context was presented.
    if (projection.attentionGeneration !== undefined) {
      await this.input.world.acknowledgeProjection?.(projection.attentionGeneration);
    }
    return saved;
  }
}
