import { createHash, createHmac } from "node:crypto";
import { isAbsolute } from "node:path";
import { canonicalJson } from "../../../world-client/src/json.ts";
import { DeliveryLedger } from "./delivery-ledger.ts";
import { createConnectedNemeiaWorldHost } from "./host-bootstrap.ts";
import type { GeneratedWorldWake } from "./generated-world.ts";

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(`missing ${key}`);
  return value;
}

/** Configuration is read only when the explicit operational launcher calls it. */
export function wakeBridgeConfiguration(env: NodeJS.ProcessEnv) {
  const ledgerPath = required(env, "NEMEIA_AGENT_LEDGER");
  if (!isAbsolute(ledgerPath)) throw new Error("NEMEIA_AGENT_LEDGER must be an absolute shared WAL path");
  const wakeUrl = new URL(required(env, "NEMEIA_EVE_WAKE_URL"));
  if (wakeUrl.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(wakeUrl.hostname)
      || wakeUrl.username || wakeUrl.password || wakeUrl.search || wakeUrl.hash || wakeUrl.pathname !== "/wake") {
    throw new Error("wake bridge requires the credential-free loopback http /wake endpoint");
  }
  const issuer = required(env, "NEMEIA_WORLD_AUTH_ISSUER");
  const owner = required(env, "NEMEIA_AGENT_OWNER_PRINCIPAL_ID");
  const subject = env.NEMEIA_WORLD_AUTH_SUBJECT?.trim()
    || (owner.startsWith(`${issuer}:`) ? owner.slice(issuer.length + 1) : "");
  if (!subject || owner !== `${issuer}:${subject}`) throw new Error("wake credential must match configured agent owner");
  return {
    ledgerPath, wakeUrl, issuer, subject,
    secret: required(env, "NEMEIA_WORLD_AUTH_SECRET"),
    audience: required(env, "NEMEIA_WORLD_AUTH_AUDIENCE"),
    worldId: required(env, "NEMEIA_WORLD_ID"),
    agentId: required(env, "NEMEIA_AGENT_ID"),
    uri: required(env, "NEMEIA_WORLD_URI"),
    databaseName: required(env, "NEMEIA_WORLD_DATABASE"),
    token: env.NEMEIA_WORLD_TOKEN?.trim() || undefined,
  };
}

/** Only the explicitly supervised, flock-owned bridge installs this transport. */
export function createOperationalWakeDispatcher(options: {
  readonly config: ReturnType<typeof wakeBridgeConfiguration>;
  readonly ledger: Pick<DeliveryLedger, "hasActiveTurn" | "countActiveSessions" | "getWake">;
  readonly signal: AbortSignal;
  readonly report?: (status: "held" | "ready", heldSessions: number) => void;
}) {
  let previousStatus: "held" | "ready" | undefined;
  const { config, ledger } = options;
  return async (wake: GeneratedWorldWake): Promise<"accepted" | "deferred"> => {
    options.signal.throwIfAborted();
    const receipt = ledger.getWake(wake.wakeId);
    if (["accepted", "context_presented", "acknowledged"].includes(receipt.status)) return "accepted";
    const busy = ledger.hasActiveTurn() || receipt.channelSendStarted;
    const status = busy ? "held" : "ready";
    if (status !== previousStatus) {
      previousStatus = status;
      options.report?.(status, ledger.countActiveSessions());
    }
    // No TTL, ledger-open reset, or old stream-tail guess may free this slot.
    if (busy) return "deferred";
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const now = Math.floor(Date.now() / 1000);
    const unsigned = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
      iss: config.issuer, aud: config.audience, sub: config.subject, iat: now, exp: now + 300,
    })}`;
    const token = `${unsigned}.${createHmac("sha256", config.secret).update(unsigned).digest("base64url")}`;
    const response = await fetch(config.wakeUrl, {
      method: "POST",
      redirect: "error",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        wakeId: wake.wakeId, worldId: config.worldId, agentId: config.agentId,
        sourceIds: wake.sourceIds, dirtyKeys: wake.dirtyKeys,
        mustHandleIds: wake.mustHandleIds, rescanRequired: wake.rescanRequired,
      }),
      signal: AbortSignal.any([options.signal, AbortSignal.timeout(5_000)]),
    });
    // The authenticated channel owns the session/busy receipt in this same
    // WAL. Never infer handling from the body or manufacture a session here.
    await response.body?.cancel();
    if (!response.ok) throw new Error(`world wake returned HTTP ${response.status}`);
    return "accepted";
  };
}

/** Explicit entrypoint only; importing this module performs no I/O. */
export async function runOperationalBridge(): Promise<void> {
  const config = wakeBridgeConfiguration(process.env);
  const { WorldClient } = await import("../../../world-client/src/index.ts");
  const ledger = new DeliveryLedger(config.ledgerPath);
  const abort = new AbortController();
  let stop!: () => void;
  const stopped = new Promise<void>((resolve) => { stop = resolve; });
  const report = (status: "held" | "ready", heldSessions: number) => {
    console.info(JSON.stringify({ component: "nemeia-world-wake-bridge", status, heldSessions }));
  };
  const shutdown = () => { abort.abort(); stop(); };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  let host: ReturnType<typeof createConnectedNemeiaWorldHost> | undefined;
  try {
    report(ledger.hasActiveTurn() ? "held" : "ready", ledger.countActiveSessions());
    host = createConnectedNemeiaWorldHost({
      uri: config.uri, databaseName: config.databaseName, token: config.token,
      worldId: config.worldId, agentId: config.agentId, ledger,
      worldClientFactory: (options) => new WorldClient(options),
      snapshotRevision: (snapshot) => createHash("sha256").update(canonicalJson(snapshot)).digest("hex"),
      // This bridge never serves model reads or actions.
      currentPrincipal: () => null,
      wakeDispatcher: createOperationalWakeDispatcher({ config, ledger, signal: abort.signal, report }),
      onWakeDispatchError: () => console.error("Nemeia wake transport failed; durable delivery retained"),
    });
    await stopped;
  } finally {
    abort.abort();
    host?.close();
    // Let the aborted in-flight transport finish its uncertain WAL receipt.
    await host?.settled();
    ledger.close();
    process.removeListener("SIGTERM", shutdown);
    process.removeListener("SIGINT", shutdown);
  }
}
