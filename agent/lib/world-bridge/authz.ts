import type { EveSessionAuthSnapshot, TrustedWorldBinding, WorldPrincipal } from "./types.ts";

export class WorldAuthorizationError extends Error {
  readonly code = "WORLD_AUTHORIZATION_DENIED";

  constructor(message = "world access denied") {
    super(message);
    this.name = "WorldAuthorizationError";
  }
}

export function principalFromSession(auth: EveSessionAuthSnapshot): WorldPrincipal | null {
  // The initiator describes session ownership only. Follow-up, internal, and
  // subagent deliveries may have no current caller and must not inherit the
  // initiator's authority for a world read or action.
  return auth.current;
}

export function requirePrincipal(auth: EveSessionAuthSnapshot): WorldPrincipal {
  const principal = principalFromSession(auth);
  if (principal === null) throw new WorldAuthorizationError("authenticated Eve principal is unavailable");
  return principal;
}

export function assertBindingMatches(
  binding: TrustedWorldBinding,
  expectedWorldId: string,
  expectedAgentId: string,
): void {
  if (binding.worldId !== expectedWorldId || binding.agentId !== expectedAgentId) {
    throw new WorldAuthorizationError("world or agent binding does not match the trusted channel");
  }
  if (binding.principal.principalId.length === 0 || binding.principal.authenticator.length === 0) {
    throw new WorldAuthorizationError("trusted binding has no authenticated principal");
  }
}

export function assertSamePrincipal(expected: WorldPrincipal, actual: WorldPrincipal): void {
  if (
    expected.principalId !== actual.principalId ||
    expected.principalType !== actual.principalType ||
    expected.authenticator !== actual.authenticator ||
    expected.issuer !== actual.issuer ||
    expected.subject !== actual.subject
  ) {
    throw new WorldAuthorizationError("active principal does not match the trusted world binding");
  }
}

/** Rejects any model-selected principal or scope flags before a read is attempted. */
export function rejectModelAuthorityFlags(args: readonly string[]): void {
  const forbidden = new Set(["--principal", "--principal-id", "--agent-id", "--world-id", "--token"]);
  if (args.some((arg) => forbidden.has(arg) || [...forbidden].some((flag) => arg.startsWith(`${flag}=`)))) {
    throw new WorldAuthorizationError("principal and world scope are not model-selectable");
  }
}
