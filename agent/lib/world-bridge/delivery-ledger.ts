import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { canonicalJson, digestCanonical } from "./canonical.ts";
import type { JsonValue, PreparedWorldContext, StepIdentity } from "./types.ts";

export type WakeStatus =
  | "pending"
  | "dispatching"
  | "accepted"
  | "uncertain"
  | "context_presented"
  | "acknowledged"
  | "failed";

export interface WakeIntent {
  readonly wakeId: string;
  readonly worldId: string;
  readonly agentId: string;
  readonly sourceIds: readonly string[];
  readonly dirtyKeys: readonly string[];
  readonly mustHandleIds: readonly string[];
  readonly rescanRequired: boolean;
}

export interface WakeRecord extends WakeIntent {
  readonly channelSendStarted: boolean;
  readonly sessionId?: string;
  readonly status: WakeStatus;
  readonly attempts: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastError?: string;
}

export class LedgerConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerConflictError";
  }
}

function parseArray(value: unknown): string[] {
  const parsed: unknown = JSON.parse(String(value));
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
    throw new Error("corrupt ledger array");
  }
  return parsed;
}

function rowToWake(row: Record<string, unknown>): WakeRecord {
  return {
    wakeId: String(row.wake_id),
    channelSendStarted: Number(row.channel_send_started) === 1,
    worldId: String(row.world_id),
    agentId: String(row.agent_id),
    sourceIds: parseArray(row.source_ids_json),
    dirtyKeys: parseArray(row.dirty_keys_json),
    mustHandleIds: parseArray(row.must_handle_ids_json),
    rescanRequired: Number(row.rescan_required) === 1,
    ...(row.session_id === null || row.session_id === undefined ? {} : { sessionId: String(row.session_id) }),
    status: String(row.status) as WakeStatus,
    attempts: Number(row.attempts),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    ...(row.last_error === null ? {} : { lastError: String(row.last_error) }),
  };
}

export class DeliveryLedger {
  readonly db: DatabaseSync;

  constructor(filename: string) {
    this.db = new DatabaseSync(filename, { timeout: 5000 });
    const deadline = performance.now() + 5000;
    const pause = new Int32Array(new SharedArrayBuffer(4));
    const remainingTimeout = () => this.db.exec(
      `PRAGMA busy_timeout = ${Math.max(1, Math.ceil(deadline - performance.now()))}`,
    );
    try {
      for (;;) {
        let transaction = false;
        try {
          remainingTimeout();
          // SQLite may return BUSY without invoking its timeout when concurrent
          // fresh connections change journal mode. Retry only constructor BUSY,
          // within one deadline; never replay runtime actions or receipts.
          this.db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
          remainingTimeout();
          this.db.exec("BEGIN IMMEDIATE");
          transaction = true;
          // Serialize schema inspection + alteration across Eve/bridge starts.
          this.initializeSchema();
          this.db.exec("COMMIT");
          break;
        } catch (error) {
          if (transaction) this.db.exec("ROLLBACK");
          const remaining = deadline - performance.now();
          if (!(error instanceof Error) || !("errcode" in error) || error.errcode !== 5 || remaining <= 0) throw error;
          Atomics.wait(pause, 0, 0, Math.min(10, remaining));
        }
      }
      this.db.exec("PRAGMA busy_timeout = 5000");
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  private initializeSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS wake_delivery (
        wake_id TEXT PRIMARY KEY,
        world_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        intent_digest TEXT NOT NULL,
        source_ids_json TEXT NOT NULL,
        dirty_keys_json TEXT NOT NULL,
        must_handle_ids_json TEXT NOT NULL DEFAULT '[]',
        rescan_required INTEGER NOT NULL,
        session_id TEXT,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_error TEXT
      );
      CREATE INDEX IF NOT EXISTS wake_delivery_status_idx ON wake_delivery(status, updated_at);

      CREATE TABLE IF NOT EXISTS must_handle_pending (
        source_id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        handled_at TEXT
      );
      CREATE INDEX IF NOT EXISTS must_handle_pending_unhandled_idx
        ON must_handle_pending(handled_at, source_id);

      CREATE TABLE IF NOT EXISTS step_context (
        session_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        step_index INTEGER NOT NULL,
        context_id TEXT NOT NULL UNIQUE,
        prepared_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (session_id, turn_id, step_index)
      );

      CREATE TABLE IF NOT EXISTS action_receipt (
        intent_id TEXT PRIMARY KEY,
        fingerprint TEXT NOT NULL,
        invocation_sequence INTEGER NOT NULL,
        status TEXT NOT NULL,
        accept_by TEXT NOT NULL DEFAULT '',
        world_state TEXT,
        world_receipt_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (fingerprint, invocation_sequence)
      );

      CREATE TABLE IF NOT EXISTS step_hook_receipt (
        event_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        step_index INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        observed_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS turn_activity (
        session_id TEXT PRIMARY KEY,
        turn_id TEXT,
        accepted_count INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    const columns = this.db.prepare("PRAGMA table_info(wake_delivery)").all() as Record<string, unknown>[];
    if (!columns.some((column) => String(column.name) === "must_handle_ids_json")) {
      this.db.exec("ALTER TABLE wake_delivery ADD COLUMN must_handle_ids_json TEXT NOT NULL DEFAULT '[]'");
    }
    if (!columns.some((column) => String(column.name) === "session_id")) {
      this.db.exec("ALTER TABLE wake_delivery ADD COLUMN session_id TEXT");
    }
    if (!columns.some((column) => String(column.name) === "channel_send_started")) {
      this.db.exec("ALTER TABLE wake_delivery ADD COLUMN channel_send_started INTEGER NOT NULL DEFAULT 0");
      // Existing attempted deliveries have no proof they did NOT reach Eve.
      this.db.exec("UPDATE wake_delivery SET channel_send_started = 1 WHERE status IN ('dispatching', 'uncertain', 'accepted', 'context_presented', 'acknowledged')");
    }
    const actionColumns = this.db.prepare("PRAGMA table_info(action_receipt)").all() as Record<string, unknown>[];
    if (!actionColumns.some((column) => String(column.name) === "accept_by")) {
      this.db.exec("ALTER TABLE action_receipt ADD COLUMN accept_by TEXT NOT NULL DEFAULT ''");
    }
    if (!actionColumns.some((column) => String(column.name) === "world_state")) {
      this.db.exec("ALTER TABLE action_receipt ADD COLUMN world_state TEXT");
    }
    if (!actionColumns.some((column) => String(column.name) === "world_receipt_id")) {
      this.db.exec("ALTER TABLE action_receipt ADD COLUMN world_receipt_id TEXT");
    }
    // Opening this shared WAL says nothing about Eve's current activity.
    // Preserve reservations across readers, worker starts, and process death.
    // Only public Eve lifecycle evidence may release them; uncertainty holds.
  }

  beginWake(intent: Omit<WakeIntent, "wakeId"> & { readonly wakeId?: string }): WakeRecord {
    const wakeId = intent.wakeId ?? `wake_${randomUUID()}`;
    const normalized = {
      worldId: intent.worldId,
      agentId: intent.agentId,
      sourceIds: [...intent.sourceIds],
      dirtyKeys: [...intent.dirtyKeys],
      mustHandleIds: [...intent.mustHandleIds],
      rescanRequired: intent.rescanRequired,
    } satisfies JsonValue;
    const digest = digestCanonical(normalized);
    const existing = this.db
      .prepare("SELECT * FROM wake_delivery WHERE wake_id = ?")
      .get(wakeId) as Record<string, unknown> | undefined;
    if (existing !== undefined) {
      if (String(existing.intent_digest) !== digest) {
        throw new LedgerConflictError(`wake ${wakeId} was reused with different intent`);
      }
      return rowToWake(existing);
    }
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO wake_delivery
          (wake_id, world_id, agent_id, intent_digest, source_ids_json, dirty_keys_json,
           must_handle_ids_json, rescan_required, session_id, status, attempts, created_at, updated_at, last_error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 'pending', 0, ?, ?, NULL)`,
      )
      .run(
        wakeId,
        intent.worldId,
        intent.agentId,
        digest,
        JSON.stringify(intent.sourceIds),
        JSON.stringify(intent.dirtyKeys),
        JSON.stringify(intent.mustHandleIds),
        intent.rescanRequired ? 1 : 0,
        now,
        now,
      );
    return this.getWake(wakeId);
  }

  getWake(wakeId: string): WakeRecord {
    const row = this.db.prepare("SELECT * FROM wake_delivery WHERE wake_id = ?").get(wakeId) as
      | Record<string, unknown>
      | undefined;
    if (row === undefined) throw new Error(`unknown wake ${wakeId}`);
    return rowToWake(row);
  }

  /** Persist before from.send. A crash after this point is held, never resent. */
  reserveChannelSend(wakeId: string): boolean {
    const result = this.db.prepare(
      "UPDATE wake_delivery SET channel_send_started = 1 WHERE wake_id = ? AND channel_send_started = 0",
    ).run(wakeId);
    return result.changes === 1;
  }

  /** Public message.received binds the wake before the turn can complete. */
  observeChannelWake(wakeId: string, sessionId: string): void {
    const receipt = this.getWake(wakeId);
    if (!receipt.channelSendStarted) throw new Error("wake has no trusted send reservation");
    if (receipt.status === "acknowledged") return;
    this.bindWakeSession(wakeId, sessionId);
    this.transitionWake(wakeId, "context_presented");
  }

  /** Atomically join a late send response with stronger public lifecycle evidence. */
  acceptChannelWake(wakeId: string, candidateSessionId: string): WakeRecord {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const receipt = this.getWake(wakeId);
      if (receipt.status !== "acknowledged") {
        // Cold-start address races can return a candidate; message.received
        // identifies the canonical owner and must win over that candidate.
        const sessionId = receipt.sessionId ?? candidateSessionId;
        this.bindWakeSession(wakeId, sessionId);
        this.markSessionBusy(sessionId);
        this.transitionWake(wakeId, "accepted");
      }
      const result = this.getWake(wakeId);
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  transitionWake(wakeId: string, status: WakeStatus, error?: string): WakeRecord {
    const receipt = this.getWake(wakeId);
    // A fast public turn may complete before the HTTP acceptance returns.
    // Transport bookkeeping cannot regress that stronger lifecycle evidence.
    if ((status === "dispatching" || status === "uncertain" || status === "accepted")
        && ["acknowledged", "context_presented", "accepted"].includes(receipt.status)) return receipt;
    const now = new Date().toISOString();
    const existing = this.db
      .prepare("SELECT session_id FROM wake_delivery WHERE wake_id = ?")
      .get(wakeId) as Record<string, unknown> | undefined;
    const sessionId = existing?.session_id === null || existing?.session_id === undefined ? undefined : String(existing.session_id);
    const turnAlreadyStarted = status === "accepted" && sessionId !== undefined && this.db
      .prepare("SELECT 1 AS active FROM turn_activity WHERE session_id = ? AND turn_id IS NOT NULL")
      .get(sessionId) !== undefined;
    const persistedStatus: WakeStatus = turnAlreadyStarted ? "context_presented" : status;
    this.db
      .prepare(
        `UPDATE wake_delivery
         SET status = ?, attempts = attempts + ?, updated_at = ?, last_error = ?
         WHERE wake_id = ?`,
      )
      .run(persistedStatus, status === "dispatching" ? 1 : 0, now, error ?? null, wakeId);
    return this.getWake(wakeId);
  }

  /** Bind Eve's actual channel session after public-channel acceptance. */
  bindWakeSession(wakeId: string, sessionId: string): WakeRecord {
    if (sessionId.length === 0 || sessionId.length > 512) throw new Error("invalid wake session id");
    this.db
      .prepare("UPDATE wake_delivery SET session_id = ?, updated_at = ? WHERE wake_id = ?")
      .run(sessionId, new Date().toISOString(), wakeId);
    return this.getWake(wakeId);
  }

  /** Reserve one busy slot as soon as Eve accepts a delivery, before turn.started. */
  markSessionBusy(sessionId: string): void {
    if (sessionId.length === 0 || sessionId.length > 512) throw new Error("invalid active session id");
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO turn_activity (session_id, turn_id, accepted_count, updated_at)
         VALUES (?, NULL, 1, ?)
         ON CONFLICT (session_id) DO NOTHING`,
      )
      .run(sessionId, now);
  }

  /** Record the actual public Eve turn without changing its busy reservation count. */
  markTurnStarted(sessionId: string, turnId: string): void {
    if (sessionId.length === 0 || sessionId.length > 512 || turnId.length === 0 || turnId.length > 512) {
      throw new Error("invalid active turn identity");
    }
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO turn_activity (session_id, turn_id, accepted_count, updated_at)
         VALUES (?, ?, 1, ?)
         ON CONFLICT (session_id) DO UPDATE SET turn_id = excluded.turn_id, accepted_count = 1, updated_at = excluded.updated_at`,
      )
      .run(sessionId, turnId, now);
    // The public turn may begin before the channel's send promise returns and
    // before the route transitions its wake to accepted. If the wake is
    // already bound, advance it here; if not, transitionWake performs the
    // same check after bind/acceptance.
    this.db
      .prepare(
        `UPDATE wake_delivery
         SET status = 'context_presented', updated_at = ?, last_error = NULL
         WHERE session_id = ? AND status = 'accepted'`,
      )
      .run(now, sessionId);
  }

  /** Release one accepted/active turn slot after turn.completed/failed/cancelled. */
  markTurnIdle(sessionId: string, turnId: string): boolean {
    const row = this.db
      .prepare("SELECT turn_id, accepted_count FROM turn_activity WHERE session_id = ?")
      .get(sessionId) as Record<string, unknown> | undefined;
    if (row === undefined) return false;
    const currentTurnId = row.turn_id === null ? undefined : String(row.turn_id);
    if (currentTurnId !== undefined && currentTurnId !== turnId) return false;
    const count = Number(row.accepted_count);
    if (count !== 1) throw new Error("corrupt turn activity reservation");
    this.db.prepare("DELETE FROM turn_activity WHERE session_id = ?").run(sessionId);
    return true;
  }

  /** The public session lifecycle is the final idle authority after a turn. */
  clearSessionActivity(sessionId: string): boolean {
    const result = this.db.prepare("DELETE FROM turn_activity WHERE session_id = ?").run(sessionId);
    return result.changes === 1;
  }

  hasActiveTurn(): boolean {
    const row = this.db
      .prepare("SELECT 1 AS active FROM turn_activity WHERE accepted_count > 0 LIMIT 1")
      .get() as Record<string, unknown> | undefined;
    return row !== undefined;
  }

  /** Operational visibility only: unresolved reservations are never timed out. */
  countActiveSessions(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS count FROM turn_activity WHERE accepted_count > 0").get()!;
    return Number(row.count);
  }

  /** Mark accepted deliveries as presented when that Eve session really starts a step. */
  acknowledgeWakeForSession(sessionId: string): number {
    if (sessionId.length === 0 || sessionId.length > 512) throw new Error("invalid wake session id");
    const result = this.db
      .prepare(
        `UPDATE wake_delivery
         SET status = 'context_presented', updated_at = ?, last_error = NULL
         WHERE session_id = ? AND status = 'accepted'`,
      )
      .run(new Date().toISOString(), sessionId);
    return Number(result.changes);
  }

  /** A completed Eve step acknowledges delivery only; must-handle rows remain pending separately. */
  completeWakeForSession(sessionId: string): number {
    if (sessionId.length === 0 || sessionId.length > 512) throw new Error("invalid wake session id");
    const result = this.db
      .prepare(
        `UPDATE wake_delivery
         SET status = 'acknowledged', updated_at = ?, last_error = NULL
         WHERE session_id = ? AND status = 'context_presented'`,
      )
      .run(new Date().toISOString(), sessionId);
    return Number(result.changes);
  }

  listRecoverableWakes(): readonly WakeRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM wake_delivery WHERE status IN ('pending', 'dispatching', 'uncertain') ORDER BY created_at")
      .all() as Record<string, unknown>[];
    return rows.map(rowToWake);
  }

  /**
   * Retain a must-handle source before it enters any in-memory coalescer.
   * INSERT OR IGNORE makes repeated delivery of the same durable source safe.
   */
  retainMustHandle(sourceId: string): void {
    if (sourceId.length === 0 || sourceId.length > 512) throw new Error("invalid must-handle source id");
    this.db
      .prepare(
        `INSERT INTO must_handle_pending (source_id, created_at, handled_at)
         VALUES (?, ?, NULL)
         ON CONFLICT (source_id) DO NOTHING`,
      )
      .run(sourceId, new Date().toISOString());
  }

  listPendingMustHandle(input: { readonly limit?: number; readonly afterSourceId?: string } = {}): readonly string[] {
    const limit = input.limit ?? 128;
    if (!Number.isInteger(limit) || limit < 1 || limit > 1024) throw new Error("invalid pending page limit");
    const rows = input.afterSourceId === undefined
      ? this.db
          .prepare(
            `SELECT source_id FROM must_handle_pending
             WHERE handled_at IS NULL ORDER BY source_id LIMIT ?`,
          )
          .all(limit)
      : this.db
          .prepare(
            `SELECT source_id FROM must_handle_pending
             WHERE handled_at IS NULL AND source_id > ? ORDER BY source_id LIMIT ?`,
          )
          .all(input.afterSourceId, limit);
    return (rows as Record<string, unknown>[]).map((row) => String(row.source_id));
  }

  /** Acknowledge only after the source has been handled by the agent. */
  acknowledgeMustHandle(sourceId: string): boolean {
    const result = this.db
      .prepare("UPDATE must_handle_pending SET handled_at = ? WHERE source_id = ? AND handled_at IS NULL")
      .run(new Date().toISOString(), sourceId);
    return result.changes === 1;
  }

  saveContext(context: PreparedWorldContext): PreparedWorldContext {
    const existing = this.getContext(context.step);
    if (existing !== undefined) {
      if (existing.contextId !== context.contextId) {
        throw new LedgerConflictError("step context identity changed during retry");
      }
      return existing;
    }
    this.db
      .prepare(
        `INSERT INTO step_context
          (session_id, turn_id, step_index, context_id, prepared_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        context.step.sessionId,
        context.step.turnId,
        context.step.stepIndex,
        context.contextId,
        canonicalJson(context as unknown as JsonValue),
        context.preparedAt,
      );
    return context;
  }

  getContext(step: StepIdentity): PreparedWorldContext | undefined {
    const row = this.db
      .prepare(
        `SELECT prepared_json FROM step_context
         WHERE session_id = ? AND turn_id = ? AND step_index = ?`,
      )
      .get(step.sessionId, step.turnId, step.stepIndex) as Record<string, unknown> | undefined;
    return row === undefined ? undefined : (JSON.parse(String(row.prepared_json)) as PreparedWorldContext);
  }

  beginActionIntent(input: {
    readonly fingerprint: string;
    readonly invocationSequence: number;
  }): { readonly intentId: string; readonly status: string } {
    const existing = this.db
      .prepare(
        `SELECT intent_id, status FROM action_receipt
         WHERE fingerprint = ? AND invocation_sequence = ?`,
      )
      .get(input.fingerprint, input.invocationSequence) as Record<string, unknown> | undefined;
    if (existing !== undefined) {
      return { intentId: String(existing.intent_id), status: String(existing.status) };
    }
    const intentId = `intent_${randomUUID()}`;
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO action_receipt
         (intent_id, fingerprint, invocation_sequence, status, created_at, updated_at)
         VALUES (?, ?, ?, 'proposed', ?, ?)`,
      )
      .run(intentId, input.fingerprint, input.invocationSequence, now, now);
    return { intentId, status: "proposed" };
  }

  /** Allocate the stable world execution id before making the reducer call. */
  beginTrustedAction(input: {
    readonly fingerprint: string;
    readonly invocationSequence: number;
    readonly acceptBy: string;
  }): { readonly executionId: string; readonly status: string; readonly acceptBy: string } {
    if (!/^\d{4}-\d{2}-\d{2}T/u.test(input.acceptBy)) throw new Error("invalid action acceptance deadline");
    const existing = this.db
      .prepare(
        `SELECT intent_id, status, accept_by FROM action_receipt
         WHERE fingerprint = ? AND invocation_sequence = ?`,
      )
      .get(input.fingerprint, input.invocationSequence) as Record<string, unknown> | undefined;
    if (existing !== undefined) {
      const acceptBy = String(existing.accept_by);
      if (acceptBy.length === 0) throw new LedgerConflictError("action receipt has no persisted acceptance deadline");
      return { executionId: String(existing.intent_id), status: String(existing.status), acceptBy };
    }
    const executionId = `exec_${randomUUID()}`;
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO action_receipt
         (intent_id, fingerprint, invocation_sequence, status, accept_by, world_state, world_receipt_id, created_at, updated_at)
         VALUES (?, ?, ?, 'proposed', ?, NULL, NULL, ?, ?)`,
      )
      .run(executionId, input.fingerprint, input.invocationSequence, input.acceptBy, now, now);
    return { executionId, status: "proposed", acceptBy: input.acceptBy };
  }

  getTrustedAction(executionId: string): {
    readonly executionId: string;
    readonly fingerprint: string;
    readonly status: string;
    readonly acceptBy: string;
    readonly worldState?: string;
    readonly worldReceiptId?: string;
  } {
    const row = this.db
      .prepare("SELECT intent_id, fingerprint, status, accept_by, world_state, world_receipt_id FROM action_receipt WHERE intent_id = ?")
      .get(executionId) as Record<string, unknown> | undefined;
    if (row === undefined) throw new Error("unknown trusted action");
    return {
      executionId: String(row.intent_id),
      fingerprint: String(row.fingerprint),
      status: String(row.status),
      acceptBy: String(row.accept_by),
      ...(row.world_state === null ? {} : { worldState: String(row.world_state) }),
      ...(row.world_receipt_id === null ? {} : { worldReceiptId: String(row.world_receipt_id) }),
    };
  }

  updateTrustedAction(input: {
    readonly executionId: string;
    readonly status: string;
    readonly worldState?: string;
    readonly worldReceiptId?: string;
  }): void {
    this.db
      .prepare(
        `UPDATE action_receipt
         SET status = ?, world_state = ?, world_receipt_id = ?, updated_at = ?
         WHERE intent_id = ?`,
      )
      .run(input.status, input.worldState ?? null, input.worldReceiptId ?? null, new Date().toISOString(), input.executionId);
  }

  recordStepHook(input: {
    readonly eventId: string;
    readonly sessionId: string;
    readonly turnId: string;
    readonly stepIndex: number;
    readonly eventType: "step.started" | "step.completed" | "step.failed";
  }): void {
    this.db
      .prepare(
        `INSERT INTO step_hook_receipt
          (event_id, session_id, turn_id, step_index, event_type, observed_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (event_id) DO NOTHING`,
      )
      .run(
        input.eventId,
        input.sessionId,
        input.turnId,
        input.stepIndex,
        input.eventType,
        new Date().toISOString(),
      );
  }

  listStepHooks(step: StepIdentity): readonly { eventId: string; eventType: string }[] {
    const rows = this.db
      .prepare(
        `SELECT event_id, event_type FROM step_hook_receipt
         WHERE session_id = ? AND turn_id = ? AND step_index = ?
         ORDER BY rowid`,
      )
      .all(step.sessionId, step.turnId, step.stepIndex) as Record<string, unknown>[];
    return rows.map((row) => ({ eventId: String(row.event_id), eventType: String(row.event_type) }));
  }

  close(): void {
    this.db.close();
  }
}
