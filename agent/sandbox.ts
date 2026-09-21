import { defineSandbox } from "eve/sandbox";
import { createHash } from "node:crypto";
import {
  createNemeiaSandboxBackend,
  principalFromSandboxAuth,
} from "./lib/world-bridge/sandbox-backend.ts";
import {
  createReadyNemeiaWorldHost,
  type NemeiaConnectedWorldHostRuntime,
} from "./lib/world-bridge/host-bootstrap.ts";
import { getRuntimeLedger } from "./lib/world-bridge/runtime-ledger.ts";
import { WorldContextProjector } from "./lib/world-bridge/context-projector.ts";
import type { TrustedActionPort } from "./lib/world-bridge/action-boundary.ts";
import type { ContextFile, StepIdentity, TrustedWorldBinding, WorldPrincipal } from "./lib/world-bridge/types.ts";
import { canonicalJson } from "../world-client/src/json.ts";
export {
  createNemeiaWorldHost,
  createConnectedNemeiaWorldHost,
  type NemeiaWorldHostOptions,
  type NemeiaWorldHostRuntime,
  type NemeiaConnectedWorldHostOptions,
  type NemeiaConnectedWorldHostRuntime,
} from "./lib/world-bridge/host-bootstrap.ts";

const configuredWorldId = process.env.NEMEIA_WORLD_ID ?? "unconfigured-world";
const configuredAgentId = process.env.NEMEIA_AGENT_ID ?? "unconfigured-agent";
const configuredWorldUri = process.env.NEMEIA_WORLD_URI?.trim();
const configuredWorldDatabase = process.env.NEMEIA_WORLD_DATABASE?.trim();

function ownerPrincipalGuard(principal: WorldPrincipal): void {
  const ownerId = process.env.NEMEIA_AGENT_OWNER_PRINCIPAL_ID?.trim();
  if (ownerId === undefined || ownerId.length === 0 || principal.principalId !== ownerId) {
    throw new Error("Nemeia sandbox principal is not the configured agent owner");
  }
  const issuer = process.env.NEMEIA_AGENT_OWNER_ISSUER?.trim();
  if (issuer !== undefined && principal.issuer !== issuer) throw new Error("Nemeia sandbox principal issuer is not configured owner");
  const subject = process.env.NEMEIA_AGENT_OWNER_SUBJECT?.trim();
  if (subject !== undefined && principal.subject !== subject) throw new Error("Nemeia sandbox principal subject is not configured owner");
}

// Eve compiles these declarations in info/build and imports them again in
// workers. No ledger, network connection, or dispatcher may start on import.
const preparedContextBySession = new Map<string, { readonly principalId: string; readonly files: readonly ContextFile[] }>();
const frameworkSessionBySandboxId = new Map<string, string>();
const stepBySandboxId = new Map<string, StepIdentity>();
const actionPortBySandboxId = new Map<string, TrustedActionPort>();
let connectedWorldHost: NemeiaConnectedWorldHostRuntime | undefined;
let contextProjector: WorldContextProjector | undefined;
let createTrustedActionPort: typeof import("./lib/world-bridge/action-boundary.ts")["createTrustedActionPort"] | undefined;

let initialization: Promise<void> | undefined;

/** Called only from authenticated public onSession/step operations, never compilation. */
export async function initializeNemeiaWorldRuntime(principal: WorldPrincipal): Promise<void> {
  ownerPrincipalGuard(principal);
  if (!configuredWorldUri || !configuredWorldDatabase) return;
  if (initialization === undefined) {
    initialization = initializeConnectedHost().catch((error: unknown) => {
      connectedWorldHost?.close();
      connectedWorldHost = undefined;
      contextProjector = undefined;
      initialization = undefined;
      throw error;
    });
  }
  await initialization;
  ownerPrincipalGuard(principal);
}

async function initializeConnectedHost(): Promise<void> {
  const runtimeLedger = getRuntimeLedger();
  const { WorldClient } = await import("../world-client/src/index.ts");
  connectedWorldHost = await createReadyNemeiaWorldHost({
    uri: configuredWorldUri!,
    databaseName: configuredWorldDatabase!,
    worldClientFactory: (clientOptions) => new WorldClient(clientOptions),
    token: process.env.NEMEIA_WORLD_TOKEN?.trim() || undefined,
    worldId: configuredWorldId,
    agentId: configuredAgentId,
    ledger: runtimeLedger,
    snapshotRevision: (snapshot) => createHash("sha256").update(canonicalJson(snapshot)).digest("hex"),
    // Reads/actions are authorized by the current sandbox binding and the
    // configured owner guard; no process-global last-step principal exists.
    currentPrincipal: () => null,
    authorizePrincipal: ownerPrincipalGuard,
    // Read/projection workers NEVER dispatch. The explicit operational bridge
    // is the sole automatic-wake owner, even when this process has a wake URL.
    maxOutputBytes: 96 * 1024,
  });
  ({ createTrustedActionPort } = await import("./lib/world-bridge/action-boundary.ts"));
  // Use the generated read port; there is no request-time fallback world.
  contextProjector = new WorldContextProjector({
    ledger: runtimeLedger,
    world: connectedWorldHost.world,
    worldId: configuredWorldId,
    agentId: configuredAgentId,
    maxContextBytes: 96 * 1024,
  });
}

function currentWorldHost(): NemeiaConnectedWorldHostRuntime {
  if (connectedWorldHost === undefined) throw new Error("authenticated Nemeia world runtime is unavailable");
  return connectedWorldHost;
}

// Eve creates the backend handle BEFORE calling onSession. Keep one stable
// binding registry and late-bound read/action closures; never swap backends
// after a handle already captured their filesystem/customCommands callbacks.
export const nemeiaSandbox = createNemeiaSandboxBackend({
  worldId: configuredWorldId,
  agentId: configuredAgentId,
  authorizePrincipal: ownerPrincipalGuard,
  world: {
    readProjection: (request) => currentWorldHost().world.readProjection(request),
    readDetail: (request) => currentWorldHost().world.readDetail!(request),
    acknowledgeProjection: (generation) => currentWorldHost().world.acknowledgeProjection?.(generation),
  },
  contextProvider: (binding, sandboxId) => {
    const frameworkSessionId = frameworkSessionBySandboxId.get(sandboxId);
    if (frameworkSessionId === undefined) return null;
    const prepared = preparedContextBySession.get(frameworkSessionId);
    return prepared !== undefined && prepared.principalId === binding.principal.principalId ? prepared.files : null;
  },
  actionProvider: (_binding, sandboxId) => {
    if (connectedWorldHost === undefined || createTrustedActionPort === undefined) return undefined;
    const existing = actionPortBySandboxId.get(sandboxId);
    if (existing !== undefined) return existing;
    const action = createTrustedActionPort({
      ledger: getRuntimeLedger(),
      world: connectedWorldHost.worldClient,
      hostContext: (): { readonly binding: TrustedWorldBinding; readonly step: StepIdentity } => {
        const binding = nemeiaSandbox.bindingFor(sandboxId);
        const step = stepBySandboxId.get(sandboxId);
        if (binding === null || step === undefined) throw new Error("Nemeia action step context is unavailable");
        return { binding, step };
      },
      authorizeCurrentPrincipal: (binding) => ownerPrincipalGuard(binding.principal),
    });
    actionPortBySandboxId.set(sandboxId, action);
    return action;
  },
  maxOutputBytes: 96 * 1024,
});

export async function prepareNemeiaWorldContext(
  sessionId: string,
  turnId: string,
  stepIndex: number,
  principal: WorldPrincipal,
): Promise<void> {
  await initializeNemeiaWorldRuntime(principal);
  if (contextProjector === undefined) return;
  const context = await contextProjector.prepare({ sessionId, turnId, stepIndex } satisfies StepIdentity, principal);
  preparedContextBySession.set(sessionId, { principalId: principal.principalId, files: context.files });
}

export function clearNemeiaWorldContext(sessionId: string): void {
  preparedContextBySession.delete(sessionId);
}

export function clearNemeiaSessionBindings(frameworkSessionId: string): void {
  for (const [sandboxId, sessionId] of frameworkSessionBySandboxId) {
    if (sessionId !== frameworkSessionId) continue;
    nemeiaSandbox.clearBinding(sandboxId);
    clearNemeiaSandboxSession(sandboxId);
  }
  clearNemeiaWorldContext(frameworkSessionId);
}

export function bindNemeiaSandboxSession(sandboxId: string, frameworkSessionId: string): void {
  frameworkSessionBySandboxId.set(sandboxId, frameworkSessionId);
}

export function clearNemeiaSandboxSession(sandboxId: string): void {
  frameworkSessionBySandboxId.delete(sandboxId);
  stepBySandboxId.delete(sandboxId);
  actionPortBySandboxId.delete(sandboxId);
}

export function setNemeiaStepContext(sandboxId: string, step: StepIdentity): void {
  stepBySandboxId.set(sandboxId, step);
}

export default defineSandbox({
  backend: nemeiaSandbox.backend,
  async onSession({ use, ctx }) {
    const principal = principalFromSandboxAuth(ctx.session.auth);
    clearNemeiaSessionBindings(ctx.session.id);
    nemeiaSandbox.clearBinding(ctx.session.id);
    clearNemeiaSandboxSession(ctx.session.id);
    if (principal === null) {
      throw new Error("Nemeia sandbox requires an authenticated Eve session principal");
    }
    await initializeNemeiaWorldRuntime(principal);
    const session = await use();
    try {
      nemeiaSandbox.registerBinding(session.id, principal);
      bindNemeiaSandboxSession(session.id, ctx.session.id);
    } catch (error) {
      nemeiaSandbox.clearBinding(session.id);
      clearNemeiaSandboxSession(session.id);
      throw error;
    }
  },
});
