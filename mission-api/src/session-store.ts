import { createHash, randomBytes } from "node:crypto";
import { MissionApiError } from "./mission-api-errors.ts";

export class EventLogSessionStore {
  #eventLog;
  #seedSessions;
  #clock;

  constructor({ eventLog, sessions = [], clock = () => new Date() }) {
    this.#eventLog = eventLog;
    this.#seedSessions = sessions.map(normalizeSession);
    this.#clock = clock;
  }

  issue({ token = makeToken(), principal, grants, expires_at = null, source = "mission-api" }) {
    const session = normalizeSession({ token, principal, grants, expires_at });
    this.#eventLog.append({
      schema_version: 1,
      source,
      event_type: "auth.session.issued",
      severity: 0,
      payload: {
        token_hash: tokenHash(token),
        principal: session.principal,
        grants: session.grants,
        ...(session.expires_at ? { expires_at: session.expires_at } : {})
      }
    });
    return session;
  }

  revoke({ token, source = "mission-api" }) {
    const token_hash = tokenHash(token);
    this.#eventLog.append({
      schema_version: 1,
      source,
      event_type: "auth.session.revoked",
      severity: 0,
      payload: { token_hash }
    });
    return { token_hash, revoked: true };
  }

  authenticate(token, { at = this.#clock() } = {}) {
    const session = this.#sessions().get(tokenHash(token));
    if (!session) {
      throw new MissionApiError("AUTH_INVALID", "Bearer token is not recognized.");
    }
    if (session.revoked) {
      throw new MissionApiError("AUTH_INVALID", "Bearer token has been revoked.");
    }
    if (session.expires_at && new Date(session.expires_at).getTime() <= at.getTime()) {
      throw new MissionApiError("AUTH_INVALID", "Bearer token has expired.");
    }
    return { principal: session.principal, grants: [...session.grants] };
  }

  #sessions() {
    const sessions = new Map();
    for (const seed of this.#seedSessions) {
      sessions.set(tokenHash(seed.token), { ...seed, grants: [...seed.grants] });
    }
    for (const event of this.#eventLog.read({ event_types: ["auth.session.issued", "auth.session.revoked"] }, { limit: 10_000 }).items) {
      const token_hash = event.payload?.token_hash;
      if (!token_hash) {
        continue;
      }
      if (event.event_type === "auth.session.revoked") {
        const current = sessions.get(token_hash);
        sessions.set(token_hash, { ...(current ?? {}), revoked: true });
        continue;
      }
      sessions.set(token_hash, {
        principal: event.payload.principal,
        grants: [...(event.payload.grants ?? [])],
        expires_at: event.payload.expires_at ?? null,
        revoked: false
      });
    }
    return sessions;
  }
}

export function sessionsFromTokens(tokens) {
  return Object.entries(tokens).map(([token, principal]) => ({ token, ...principal }));
}

function normalizeSession(session) {
  if (!session?.token) {
    throw new MissionApiError("AUTH_INVALID", "Session token is required.");
  }
  if (!session.principal) {
    throw new MissionApiError("AUTH_INVALID", "Session principal is required.");
  }
  if (!Array.isArray(session.grants)) {
    throw new MissionApiError("AUTH_INVALID", "Session grants must be an array.");
  }
  return {
    token: session.token,
    principal: session.principal,
    grants: [...new Set(session.grants)].sort(),
    expires_at: session.expires_at ?? null
  };
}

function tokenHash(token) {
  return `sha256:${createHash("sha256").update(String(token)).digest("hex")}`;
}

function makeToken() {
  return `sess_${randomBytes(24).toString("base64url")}`;
}
