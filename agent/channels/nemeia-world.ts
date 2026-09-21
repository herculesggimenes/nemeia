import { extractBearerToken, verifyJwtHmac } from "eve/channels/auth";
import { defineChannel, POST } from "eve/channels";
import type { SessionAuthContext } from "eve/context";
import { getRuntimeLedger } from "../lib/world-bridge/runtime-ledger.ts";
import type { WakeIntent } from "../lib/world-bridge/delivery-ledger.ts";
import type { WorldPrincipal } from "../lib/world-bridge/types.ts";

interface WakeBody {
  readonly wakeId: string;
  readonly worldId: string;
  readonly agentId: string;
  readonly sourceIds: readonly string[];
  readonly dirtyKeys: readonly string[];
  readonly mustHandleIds: readonly string[];
  readonly rescanRequired: boolean;
}

function configured(name: string): string | undefined {
  const value = process.env[name];
  return value === undefined || value.trim() === "" ? undefined : value;
}

function parseWakeBody(value: unknown): WakeBody {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid wake body");
  const body = value as Record<string, unknown>;
  const stringValue = (key: string): string => {
    const item = body[key];
    if (typeof item !== "string" || item.length === 0 || item.length > 512) throw new Error(`invalid ${key}`);
    return item;
  };
  const stringArray = (key: string): string[] => {
    const item = body[key];
    if (!Array.isArray(item) || item.some((entry) => typeof entry !== "string" || entry.length > 512)) {
      throw new Error(`invalid ${key}`);
    }
    return [...new Set(item)];
  };
  if (typeof body.rescanRequired !== "boolean") throw new Error("invalid rescanRequired");
  return {
    wakeId: stringValue("wakeId"),
    worldId: stringValue("worldId"),
    agentId: stringValue("agentId"),
    sourceIds: stringArray("sourceIds"),
    dirtyKeys: stringArray("dirtyKeys"),
    mustHandleIds: stringArray("mustHandleIds"),
    rescanRequired: body.rescanRequired,
  };
}

async function authenticate(request: Request): Promise<SessionAuthContext | Response> {
  const secret = configured("NEMEIA_WORLD_AUTH_SECRET");
  const issuer = configured("NEMEIA_WORLD_AUTH_ISSUER");
  const audience = configured("NEMEIA_WORLD_AUTH_AUDIENCE");
  if (secret === undefined || issuer === undefined || audience === undefined) {
    return Response.json({ ok: false, error: "world wake authentication is not configured" }, { status: 503 });
  }
  const result = await verifyJwtHmac(extractBearerToken(request.headers.get("authorization")), {
    algorithm: "HS256",
    issuer,
    audiences: [audience],
    secret,
  });
  return result.ok ? result.sessionAuth : Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
}

function wakeMessage(body: WakeIntent | WakeBody): string {
  return JSON.stringify({
    type: "nemeia.world.wake@1", wakeId: body.wakeId,
    sourceIds: body.sourceIds, dirtyKeys: body.dirtyKeys,
    mustHandleIds: body.mustHandleIds, rescanRequired: body.rescanRequired,
  });
}

/** Public message hook, not model output or an inferred idle timestamp. */
export function observeReceivedWorldWake(
  event: { readonly message: string; readonly kind?: string },
  sessionId: string,
  principal: SessionAuthContext | null,
): void {
  if (event.kind !== undefined || principal === null
      || principal.principalId !== configured("NEMEIA_AGENT_OWNER_PRINCIPAL_ID")) return;
  let body: unknown;
  try { body = JSON.parse(event.message); } catch { return; }
  if (body === null || typeof body !== "object" || !("type" in body) || body.type !== "nemeia.world.wake@1"
      || !("wakeId" in body) || typeof body.wakeId !== "string") return;
  const ledger = getRuntimeLedger();
  const receipt = ledger.getWake(body.wakeId);
  if (receipt.worldId !== configured("NEMEIA_WORLD_ID") || receipt.agentId !== configured("NEMEIA_AGENT_ID")
      || event.message !== wakeMessage(receipt)) throw new Error("wake message does not match trusted delivery");
  ledger.observeChannelWake(receipt.wakeId, sessionId);
}

export default defineChannel({
  turnPolicy: "queue",
  routes: [
    POST("/wake", async (request, { from }) => {
      const worldId = configured("NEMEIA_WORLD_ID");
      const agentId = configured("NEMEIA_AGENT_ID");
      if (worldId === undefined || agentId === undefined) {
        return Response.json({ ok: false, error: "world channel is not configured" }, { status: 503 });
      }
      const principal = await authenticate(request);
      if (principal instanceof Response) return principal;
      const ownerPrincipalId = configured("NEMEIA_AGENT_OWNER_PRINCIPAL_ID");
      if (ownerPrincipalId === undefined) {
        return Response.json({ ok: false, error: "world wake ownership is not configured" }, { status: 503 });
      }
      if (principal.principalId !== ownerPrincipalId) {
        return Response.json({ ok: false, error: "agent ownership denied" }, { status: 403 });
      }
      let body: WakeBody;
      try {
        body = parseWakeBody(await request.json());
      } catch {
        return Response.json({ ok: false, error: "invalid wake" }, { status: 400 });
      }
      if (body.worldId !== worldId || body.agentId !== agentId) {
        return Response.json({ ok: false, error: "world address mismatch" }, { status: 403 });
      }

      const ledger = getRuntimeLedger();
      // Must-handle sources are durable before the wake is coalesced or sent to Eve.
      for (const sourceId of body.mustHandleIds) ledger.retainMustHandle(sourceId);
      const wake = ledger.beginWake(body);
      if (wake.status === "acknowledged") return Response.json({ ok: true, wakeId: wake.wakeId, deduplicated: true });
      if (wake.status === "accepted" || wake.status === "context_presented") {
        return Response.json({ ok: true, wakeId: wake.wakeId, sessionId: wake.sessionId, deduplicated: true }, { status: 202 });
      }
      // Public from.send has no caller-supplied idempotency key. Once an
      // attempt might have reached Eve, only lifecycle evidence can resolve
      // it. Repeated requests/process restarts must not enqueue another turn.
      if (!ledger.reserveChannelSend(wake.wakeId)) {
        return Response.json({ ok: false, wakeId: wake.wakeId, error: "delivery held for reconciliation" }, { status: 409 });
      }
      ledger.transitionWake(wake.wakeId, "dispatching");
      try {
        const session = await from(`${worldId}:${agentId}`).send(
          wakeMessage(body),
          { auth: principal, turnPolicy: "queue" },
        );
        // A fast turn may already have completed. Public message/terminal
        // receipts win; a late response must never recreate its busy slot.
        const accepted = ledger.acceptChannelWake(wake.wakeId, session.id);
        return Response.json({ ok: true, wakeId: wake.wakeId, sessionId: accepted.sessionId }, { status: 202 });
      } catch {
        ledger.transitionWake(wake.wakeId, "uncertain", "channel delivery outcome is unknown");
        return Response.json({ ok: false, wakeId: wake.wakeId, error: "delivery outcome is uncertain" }, { status: 503 });
      }
    }),
  ],
  audience: ({ caller }) => (caller.type === "principal" ? "private" : "unknown"),
});
