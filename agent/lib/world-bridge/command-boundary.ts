import { defineCommand, InMemoryFs, MountableFs, type ByteString, type Command, type IFileSystem } from "just-bash";
import { canonicalJson } from "../../../world-client/src/json.ts";
import type { TrustedActionPort, TrustedActionProposal } from "./action-boundary.ts";
import { assertBindingMatches, rejectModelAuthorityFlags, WorldAuthorizationError } from "./authz.ts";
import type { ContextFile, TrustedWorldBinding, WorldDetailOperation, WorldDetailRequest, WorldReadPort } from "./types.ts";

const READ_ONLY_ERROR = "nemeia: /world is read-only; writes, links, renames, and traversal are denied\n";
const BINDING_ERROR = "nemeia: active Eve principal binding is unavailable; world read denied\n";

function denyMutation(): never {
  throw new Error(READ_ONLY_ERROR.trim());
}

function rejectTraversal(path: string): void {
  const pieces = path.replaceAll("\\", "/").split("/");
  if (pieces.some((piece) => piece === "." || piece === "..")) {
    throw new Error("world path traversal denied");
  }
}

function rejectMountedWorldTraversal(path: string): void {
  const normalized = path.replaceAll("\\", "/");
  if (/^\/?world(?:\/|$)/u.test(normalized)) rejectTraversal(path);
}

class ReadOnlyFs implements IFileSystem {
  private readonly innerProvider: () => IFileSystem;

  constructor(innerProvider: () => IFileSystem) {
    this.innerProvider = innerProvider;
  }

  private inner(): IFileSystem {
    return this.innerProvider();
  }

  private path(path: string): string {
    rejectTraversal(path);
    return path;
  }

  readFile(path: string, options?: Parameters<IFileSystem["readFile"]>[1]): ReturnType<IFileSystem["readFile"]> {
    return this.inner().readFile(this.path(path), options);
  }
  readFileBytes(path: string): Promise<ByteString> {
    const inner = this.inner();
    if (inner.readFileBytes === undefined) throw new Error("raw file reads are unavailable");
    return inner.readFileBytes(this.path(path));
  }
  readFileBuffer(path: string): Promise<Uint8Array> {
    return this.inner().readFileBuffer(this.path(path));
  }
  writeFile(): Promise<void> {
    return Promise.reject(new Error(READ_ONLY_ERROR.trim()));
  }
  appendFile(): Promise<void> {
    return Promise.reject(new Error(READ_ONLY_ERROR.trim()));
  }
  exists(path: string): Promise<boolean> {
    return this.inner().exists(this.path(path));
  }
  stat(path: string) {
    return this.inner().stat(this.path(path));
  }
  mkdir(): Promise<void> {
    return Promise.reject(new Error(READ_ONLY_ERROR.trim()));
  }
  readdir(path: string): Promise<string[]> {
    return this.inner().readdir(this.path(path));
  }
  readdirWithFileTypes(path: string) {
    return this.inner().readdirWithFileTypes?.(this.path(path)) ?? Promise.reject(new Error("directory reads unavailable"));
  }
  rm(): Promise<void> {
    return Promise.reject(new Error(READ_ONLY_ERROR.trim()));
  }
  cp(): Promise<void> {
    return Promise.reject(new Error(READ_ONLY_ERROR.trim()));
  }
  mv(): Promise<void> {
    return Promise.reject(new Error(READ_ONLY_ERROR.trim()));
  }
  resolvePath(base: string, path: string): string {
    rejectTraversal(base);
    rejectTraversal(path);
    return this.inner().resolvePath(base, path);
  }
  getAllPaths(): string[] {
    return this.inner().getAllPaths();
  }
  chmod(): Promise<void> {
    return Promise.reject(new Error(READ_ONLY_ERROR.trim()));
  }
  symlink(): Promise<void> {
    return Promise.reject(new Error(READ_ONLY_ERROR.trim()));
  }
  link(): Promise<void> {
    return Promise.reject(new Error(READ_ONLY_ERROR.trim()));
  }
  readlink(path: string): Promise<string> {
    return this.inner().readlink(this.path(path));
  }
  lstat(path: string) {
    return this.inner().lstat(this.path(path));
  }
  realpath(path: string): Promise<string> {
    return this.inner().realpath(this.path(path));
  }
  utimes(): Promise<void> {
    return Promise.reject(new Error(READ_ONLY_ERROR.trim()));
  }
}

export interface TrustedCommandOptions {
  readonly worldId: string;
  readonly agentId: string;
  readonly world?: WorldReadPort;
  readonly action?: TrustedActionPort;
  readonly actionProvider?: (binding: TrustedWorldBinding) => TrustedActionPort | undefined;
  readonly bindingProvider: () => TrustedWorldBinding | null;
  readonly maxOutputBytes?: number;
}

function parseActionProposal(value: string): TrustedActionProposal {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error("nemeia: action proposal must be valid JSON");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("nemeia: action proposal must be a JSON object");
  }
  const proposal = parsed as { readonly kind?: unknown };
  if (proposal.kind !== "navigate" && proposal.kind !== "approach") {
    throw new Error("nemeia: action kind must be navigate or approach");
  }
  // The generated-world action adapter performs the complete bounded shape,
  // finite-number, u64, assignment, and mission validation.
  return parsed as TrustedActionProposal;
}

function parseDetailInput(operation: string, value: string): Omit<WorldDetailRequest, "worldId" | "agentId" | "principal" | "maxBytes"> {
  const operations = new Set<WorldDetailOperation>([
    "observation-detail", "observation-history", "geometry-detail", "map-history", "event-history", "spatial-frame-detail",
  ]);
  if (!operations.has(operation as WorldDetailOperation)) throw new Error("nemeia: unsupported world detail operation");
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error("nemeia: world detail arguments must be valid JSON");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("nemeia: world detail arguments must be a JSON object");
  const fields = parsed as Record<string, unknown>;
  const stringField = (name: string): string | undefined => {
    const field = fields[name];
    if (field === undefined) return undefined;
    if (typeof field !== "string" || field.length === 0 || field.length > 512) throw new Error(`nemeia: invalid ${name}`);
    return field;
  };
  const limitValue = fields.limit;
  if (limitValue !== undefined && (!Number.isSafeInteger(limitValue) || Number(limitValue) < 1 || Number(limitValue) > 128)) {
    throw new Error("nemeia: detail limit is outside its bounded range");
  }
  return {
    operation: operation as WorldDetailOperation,
    key: stringField("key"),
    observationId: stringField("observationId"),
    mapId: stringField("mapId"),
    subjectId: stringField("subjectId"),
    frameId: stringField("frameId"),
    afterSequence: stringField("afterSequence"),
    afterRevision: stringField("afterRevision"),
    limit: limitValue as number | undefined,
  };
}

function formatWorldResult(value: unknown, maxBytes: number): string {
  // Keep CLI output on the same lossless boundary as generated ResourceRef:
  // native u64 values become decimal strings instead of being coerced or lost.
  const output = `${canonicalJson(value)}\n`;
  if (Buffer.byteLength(output, "utf8") > maxBytes) throw new Error("nemeia: output limit exceeded");
  return output;
}

export function createNemeiaCommand(options: TrustedCommandOptions): Command {
  const maxOutputBytes = options.maxOutputBytes ?? 32 * 1024;
  return defineCommand("nemeia", async (args) => {
    try {
      rejectModelAuthorityFlags(args);
      const isRead = args.length === 2 && args[0] === "world" && ["summary", "mission-log"].includes(args[1] ?? "");
      const isDetail = args.length === 4 && args[0] === "world" && args[1] === "detail";
      const isProposal = args.length === 4 && args[0] === "world" && args[1] === "action" && args[2] === "propose";
      const isReconcile = args.length === 3 && args[0] === "world" && args[1] === "action" && args[2] === "reconcile";
      if (!isRead && !isDetail && !isProposal && !isReconcile) {
        return {
          stdout: "",
          stderr: "nemeia: usage: nemeia world {summary|mission-log} | nemeia world detail <operation> <json> | nemeia world action {propose <json>|reconcile}\n",
          exitCode: 2,
        };
      }
      const binding = options.bindingProvider();
      if (binding === null) return { stdout: "", stderr: BINDING_ERROR, exitCode: 1 };
      assertBindingMatches(binding, options.worldId, options.agentId);
      if (isProposal || isReconcile) {
        const action = options.actionProvider?.(binding) ?? options.action;
        if (action === undefined) return { stdout: "", stderr: BINDING_ERROR, exitCode: 1 };
        const receipt = isProposal
          ? await action.propose(parseActionProposal(args[3] ?? ""), binding)
          : await action.reconcile(binding);
        return { stdout: formatWorldResult(receipt, maxOutputBytes), stderr: "", exitCode: 0 };
      }
      if (isDetail) {
        if (options.world?.readDetail === undefined) return { stdout: "", stderr: BINDING_ERROR, exitCode: 1 };
        const detail = await options.world.readDetail({
          worldId: options.worldId,
          agentId: options.agentId,
          principal: binding.principal,
          ...parseDetailInput(args[2] ?? "", args[3] ?? ""),
          maxBytes: maxOutputBytes,
        });
        return { stdout: formatWorldResult(detail, maxOutputBytes), stderr: "", exitCode: 0 };
      }
      if (options.world === undefined) return { stdout: "", stderr: BINDING_ERROR, exitCode: 1 };
      const projection = await options.world.readProjection({
        worldId: options.worldId,
        agentId: options.agentId,
        principal: binding.principal,
        operation: args[1] === "summary" ? "summary" : "mission-log",
        maxBytes: maxOutputBytes,
      });
      const result = args[1] === "summary" ? projection.summary : projection.missionLog;
      return { stdout: formatWorldResult(result, maxOutputBytes), stderr: "", exitCode: 0 };
    } catch (error) {
      const message = error instanceof WorldAuthorizationError ? error.message : "world read failed";
      return { stdout: "", stderr: `nemeia: ${message}\n`, exitCode: 1 };
    }
  });
}

/**
 * just-bash 3.1 exposes curl with a live fetch implementation, while Eve's
 * public just-bash backend rejects setNetworkPolicy(). Override that one
 * network command in the interpreter so untrusted shell code has no raw
 * egress path. Trusted HTTP must use an allowlisted application adapter.
 */
export function createDeniedNetworkCommand(): Command {
  return defineCommand("curl", async () => ({
    stdout: "",
    stderr: "nemeia: raw network egress is unavailable; use an allowlisted adapter\n",
    exitCode: 126,
  }));
}

export function createWorldFilesystem(
  defaultFilesystem: IFileSystem,
  filesProvider: () => readonly ContextFile[] | null,
): IFileSystem {
  const fallback = [
    {
      path: "/world/README.json" as const,
      content: `${JSON.stringify({ schema: "nemeia.world-context@1", status: "principal-binding-required" })}\n`,
      byteLength: 88,
    },
  ];
  const mounted = new MountableFs({ base: defaultFilesystem });
  mounted.mount(
    "/world",
    new ReadOnlyFs(() => {
      const files = filesProvider() ?? fallback;
      return new InMemoryFs(
        Object.fromEntries(files.map((file) => [file.path.replace(/^\/world(?=\/|$)/u, "") || "/", file.content])),
      );
    }),
  );
  // MountableFs normalizes a path before handing it to the mounted child. Guard
  // the mount boundary too, otherwise `/world/../...` could evade the child
  // filesystem's traversal check while still being denied by its contents.
  const guarded = new Proxy(mounted, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        const pathIndexes = new Set([
          "readFile", "readFileBytes", "readFileBuffer", "writeFile", "appendFile", "exists", "stat",
          "mkdir", "readdir", "readdirWithFileTypes", "rm", "chmod", "readlink", "lstat", "realpath",
          "utimes", "resolvePath",
        ]).has(String(property)) ? [0, 1] : [];
        for (const index of pathIndexes) {
          const arg = args[index];
          if (typeof arg === "string") rejectMountedWorldTraversal(arg);
        }
        return Reflect.apply(value, target, args);
      };
    },
  });
  return guarded;
}
