import { justbash } from "eve/sandbox/just-bash";
import type {
  SandboxBackend,
  SandboxBackendHandle,
  SandboxSession,
} from "eve/sandbox";
import {
  createDeniedNetworkCommand,
  createNemeiaCommand,
  createWorldFilesystem,
} from "./command-boundary.ts";
import type { TrustedActionPort } from "./action-boundary.ts";
import { assertBindingMatches } from "./authz.ts";
import type { ContextFile, TrustedWorldBinding, WorldPrincipal, WorldReadPort } from "./types.ts";

export interface NemeiaSandboxBackendOptions {
  readonly worldId: string;
  readonly agentId: string;
  readonly world?: WorldReadPort;
  readonly action?: TrustedActionPort;
  readonly actionProvider?: (binding: TrustedWorldBinding, sessionId: string) => TrustedActionPort | undefined;
  /** Context files are resolved against the currently registered principal on every read. */
  readonly contextProvider?: (binding: TrustedWorldBinding, sessionId: string) => readonly ContextFile[] | null;
  readonly maxOutputBytes?: number;
  readonly autoInstall?: boolean;
  /** Optional deployment owner guard; tests may omit it, production wiring may not. */
  readonly authorizePrincipal?: (principal: WorldPrincipal) => void;
}

export interface NemeiaSandboxBackendRuntime {
  readonly backend: SandboxBackend;
  registerBinding(sessionId: string, principal: WorldPrincipal): void;
  clearBinding(sessionId: string): void;
  bindingFor(sessionId: string): TrustedWorldBinding | null;
}

/**
 * Public-Eve composition seam for principal-bound just-bash sessions.
 *
 * Eve's callbacks intentionally do not pass SessionContext into
 * customCommands/filesystem. We therefore create one delegated backend per
 * `create()` call, close it over the framework session id, and let the
 * authenticated `onSession`/step hook register the binding. The closure is
 * never populated from model input, tags, or environment identity.
 */
export function createNemeiaSandboxBackend(options: NemeiaSandboxBackendOptions): NemeiaSandboxBackendRuntime {
  const bindings = new Map<string, TrustedWorldBinding>();

  const registerBinding = (sessionId: string, principal: WorldPrincipal): void => {
    if (sessionId.length === 0 || sessionId.length > 512) throw new Error("invalid sandbox session id");
    options.authorizePrincipal?.(principal);
    const binding = { worldId: options.worldId, agentId: options.agentId, principal } satisfies TrustedWorldBinding;
    assertBindingMatches(binding, options.worldId, options.agentId);
    bindings.set(sessionId, binding);
  };

  const clearBinding = (sessionId: string): void => {
    bindings.delete(sessionId);
  };

  const bindingFor = (sessionId: string): TrustedWorldBinding | null => bindings.get(sessionId) ?? null;

  const prewarmBackend = justbash({ autoInstall: options.autoInstall ?? false });

  const backend: SandboxBackend = {
    name: "nemeia-just-bash-principal-bound",
    prewarm(input) {
      return prewarmBackend.prewarm(input);
    },
    async create(input) {
      // A reconnect must re-authenticate before its first read/action. Do not
      // let a previous principal survive the framework's reopen boundary.
      bindings.delete(input.sessionKey);
      let liveSessionId: string | undefined;
      const bindingProvider = (): TrustedWorldBinding | null =>
        liveSessionId === undefined ? null : bindingFor(liveSessionId);
      const delegate = justbash({
        autoInstall: options.autoInstall ?? false,
        customCommands: [
          createDeniedNetworkCommand(),
          createNemeiaCommand({
            worldId: options.worldId,
            agentId: options.agentId,
            world: options.world,
            action: options.action,
            actionProvider: (binding) => options.actionProvider?.(binding, liveSessionId ?? input.sessionKey),
            bindingProvider,
            maxOutputBytes: options.maxOutputBytes,
          }),
        ],
        filesystem: ({ defaultFilesystem }) =>
          createWorldFilesystem(defaultFilesystem, () => {
            const binding = bindingProvider();
            return binding === null ? null : options.contextProvider?.(binding, liveSessionId ?? input.sessionKey) ?? null;
          }),
      });
      const handle = await delegate.create(input);
      liveSessionId = handle.session.id;
      // Ensure a stale id variant cannot accidentally retain another
      // principal; the authenticated runtime callback must register it.
      if (liveSessionId !== input.sessionKey) bindings.delete(liveSessionId);
      return wrapHandle(handle);
    },
  };

  return { backend, registerBinding, clearBinding, bindingFor };
}

function wrapHandle(handle: SandboxBackendHandle): SandboxBackendHandle {
  // Keep every lifecycle operation delegated to Eve's handle. In particular,
  // stop/reopen state and captureState are not reimplemented by this seam.
  return {
    session: handle.session,
    useSessionFn: handle.useSessionFn,
    captureState: () => handle.captureState(),
    delete: (options) => handle.delete(options),
    stop: () => handle.stop(),
    shutdown: () => handle.shutdown(),
  };
}

export function principalFromSandboxAuth(
  auth: { readonly current: WorldPrincipal | null; readonly initiator: WorldPrincipal | null },
): WorldPrincipal | null {
  // `initiator` is session ownership metadata, never read/action authority.
  return auth.current;
}

export function sessionIdOfSandbox(session: Pick<SandboxSession, "id">): string {
  return session.id;
}
