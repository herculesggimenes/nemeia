import { Timestamp, type Identity } from "spacetimedb";
import { DbConnection } from "../../world-client/src/generated/index.ts";
import type { SubscriptionHandle } from "../../world-client/src/generated/index.ts";
import type {
  Execution as GeneratedExecution,
  ExecutionResult as GeneratedExecutionResultValue,
  ExecutionSafetyProof as GeneratedExecutionSafetyProofValue,
} from "../../world-client/src/generated/types.ts";
import {
  adaptGeneratedExecutionClaim,
  adaptGeneratedExecutionCancellation,
  type CanonicalWorldDbConnection,
} from "./generated-execution-adapter.ts";
import {
  LocalController,
  type DiagnosticSink,
  type LocalControllerStatus,
  type LocalReceipt,
} from "./local-controller.ts";

export type GeneratedExecutionResult = GeneratedExecutionResultValue;
export type GeneratedExecutionSafetyProof = GeneratedExecutionSafetyProofValue;

export type GeneratedControllerSessionOptions = {
  connection: CanonicalWorldDbConnection;
  controller: LocalController;
  unitId: string;
  claimWaitMs?: number;
  claimPollMs?: number;
  /** Supplies the canonical result from live integration feedback. */
  resultFor?: (
    execution: GeneratedExecution,
    receipt: LocalReceipt,
  ) => GeneratedExecutionResultValue | undefined | Promise<GeneratedExecutionResultValue | undefined>;
  /** Supplies a canonical measured-safe observation; the module validates it. */
  safeProofFor?: (
    execution: GeneratedExecution,
    receipt: LocalReceipt,
  ) => GeneratedExecutionSafetyProofValue | undefined | Promise<GeneratedExecutionSafetyProofValue | undefined>;
  diagnostics?: DiagnosticSink;
};

type ExecutionRow = GeneratedExecution;

const TERMINAL_STATES = new Set(["Succeeded", "Cancelled", "Failed"]);

function isTerminal(row: ExecutionRow): boolean {
  return TERMINAL_STATES.has(row.state.tag);
}

function isActive(row: ExecutionRow): boolean {
  return row.state.tag === "Accepted" || row.state.tag === "Running" || row.state.tag === "Cancelling";
}

function defaultResult(receipt: LocalReceipt): GeneratedExecutionResultValue | undefined {
  if (receipt.outcome === "cancelled") {
    return { tag: "Cancelled", value: { localReceiptId: receipt.id } };
  }
  if (receipt.outcome === "failed") {
    return {
      tag: "Failed",
      value: {
        code: "local_controller_failed",
        detail: receipt.completion && "detail" in receipt.completion && receipt.completion.detail
          ? receipt.completion.detail
          : "No-motion local controller reported a failed safe closure",
        localReceiptId: receipt.id,
      },
    };
  }
  if (receipt.outcome !== "succeeded" || !receipt.completion || receipt.completion.action !== "approach@1" ||
      receipt.completion.outcome !== "succeeded" || receipt.completion.distanceM === undefined ||
      !receipt.completion.unitObservationId || !receipt.completion.targetObservationId) {
    return undefined;
  }
  return {
    tag: "Succeeded",
    value: {
      completion: {
        tag: "Approach",
        value: {
          measuredDistanceM: receipt.completion.distanceM,
          unitObservationId: receipt.completion.unitObservationId,
          targetObservationId: receipt.completion.targetObservationId,
          localReceiptId: receipt.id,
        },
      },
    },
  };
}

function sameIdentity(left: Identity | undefined, right: Identity | undefined): boolean {
  return !!left && !!right && left.isEqual(right);
}

function safeProofMatches(row: ExecutionRow, proof: GeneratedExecutionSafetyProofValue): boolean {
  return row.controllerEpoch !== undefined && proof.executionId === row.id && proof.unitId === row.unitId &&
    proof.controllerEpoch === row.controllerEpoch;
}

/**
 * Host-side composition for one controller Unit. The module remains the
 * authority: this class only consumes the scoped view and calls generated
 * reducers. It never manufactures claims, epochs, observations, or roles.
 */
export class GeneratedControllerSession {
  readonly #connection: CanonicalWorldDbConnection;
  readonly #controller: LocalController;
  readonly #unitId: string;
  readonly #claimWaitMs: number;
  readonly #claimPollMs: number;
  readonly #resultFor?: GeneratedControllerSessionOptions["resultFor"];
  readonly #safeProofFor?: GeneratedControllerSessionOptions["safeProofFor"];
  readonly #diagnostics?: DiagnosticSink;
  readonly #work = new Map<string, Promise<void>>();
  readonly #cancellationWork = new Map<string, Promise<void>>();
  readonly #cancellationClose = new Map<string, Promise<void>>();
  readonly #dirty = new Set<string>();
  #subscription?: SubscriptionHandle;
  #started = false;
  #closed = false;
  #subscriptionApplied = false;
  #recoveryDone = false;
  #readyResolve?: () => void;
  #readyReject?: (error: unknown) => void;
  readonly #ready = new Promise<void>((resolve, reject) => {
    this.#readyResolve = resolve;
    this.#readyReject = reject;
  });

  constructor(options: GeneratedControllerSessionOptions) {
    if (!options.unitId.trim()) throw new Error("unit_id_required");
    if (options.claimWaitMs !== undefined && options.claimWaitMs <= 0) throw new Error("invalid_claim_wait");
    if (options.claimPollMs !== undefined && options.claimPollMs <= 0) throw new Error("invalid_claim_poll");
    this.#connection = options.connection;
    this.#controller = options.controller;
    this.#unitId = options.unitId;
    this.#claimWaitMs = options.claimWaitMs ?? 5_000;
    this.#claimPollMs = options.claimPollMs ?? 25;
    this.#resultFor = options.resultFor;
    this.#safeProofFor = options.safeProofFor;
    this.#diagnostics = options.diagnostics;
  }

  get connection(): CanonicalWorldDbConnection { return this.#connection; }
  get controller(): LocalController { return this.#controller; }

  async start(): Promise<void> {
    if (this.#started) return this.#ready;
    this.#started = true;
    if (!this.#connection.isActive) throw new Error("world_connection_inactive");
    this.#wireExecutionEvents();
    try {
      this.#subscription = this.#connection.subscriptionBuilder()
        .onApplied(() => { void this.#onSubscriptionApplied(); })
        .onError((ctx) => {
          this.#diagnostic("controller.subscription_error", { detail: String(ctx.event ?? "unknown") });
          this.#readyReject?.(new Error("relevant_executions_subscription_failed"));
        })
        .subscribe(["SELECT * FROM relevant_executions", "SELECT * FROM relevant_unit_controls"]);
    } catch (error) {
      this.#readyReject?.(error);
      throw error;
    }
    return this.#ready;
  }

  async stop(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#subscription && !this.#subscription.isEnded()) this.#subscription.unsubscribe();
    await Promise.allSettled([
      ...this.#work.values(),
      ...this.#cancellationWork.values(),
      ...this.#cancellationClose.values(),
    ]);
  }

  #wireExecutionEvents(): void {
    const table = this.#connection.db.relevantExecutions;
    table.onInsert((_ctx, row) => this.#observeRow(row));
    table.onUpdate((_ctx, _oldRow, row) => this.#observeRow(row));
  }

  #observeRow(row: ExecutionRow): void {
    if (this.#closed || row.unitId !== this.#unitId) return;
    if (this.#work.has(row.id)) this.#dirty.add(row.id);
    if (row.state.tag === "Cancelling") void this.#interruptCancellation(row);
    this.#queue(row.id);
  }

  async #onSubscriptionApplied(): Promise<void> {
    if (this.#closed || this.#subscriptionApplied) return;
    this.#subscriptionApplied = true;
    try {
      await this.#recoverAfterRestart();
      for (const row of this.#rows()) this.#queue(row.id);
      this.#readyResolve?.();
    } catch (error) {
      this.#readyReject?.(error);
      this.#diagnostic("controller.start_failed", { detail: String(error) });
    }
  }

  #rows(): ExecutionRow[] {
    return Array.from(this.#connection.db.relevantExecutions).filter((row) => row.unitId === this.#unitId);
  }

  #moduleControl() {
    return this.#connection.db.relevantUnitControls.unitId.find(this.#unitId);
  }

  #row(executionId: string): ExecutionRow | undefined {
    const row = this.#connection.db.relevantExecutions.id.find(executionId);
    return row && row.unitId === this.#unitId ? row : undefined;
  }

  #queue(executionId: string): void {
    if (this.#closed) return;
    if (this.#work.has(executionId)) {
      this.#dirty.add(executionId);
      return;
    }
    const task = Promise.resolve().then(() => this.#handle(executionId)).catch((error) => {
      this.#diagnostic("controller.execution_error", { executionId, detail: String(error) });
    }).finally(() => {
      this.#work.delete(executionId);
      if (this.#dirty.delete(executionId) && !this.#closed) this.#queue(executionId);
    });
    this.#work.set(executionId, task);
  }

  async #handle(executionId: string): Promise<void> {
    const row = this.#row(executionId);
    if (!row || isTerminal(row)) return;
    if (row.state.tag === "Accepted") {
      await this.#claim(row);
      return;
    }
    if (row.state.tag === "Running") {
      await this.#runConfirmed(row);
      return;
    }
    if (row.state.tag === "Cancelling") {
      await this.#closeCancellation(row);
    }
  }

  async #claim(row: ExecutionRow): Promise<void> {
    const status = await this.#ensureArmed();
    await this.#connection.reducers.claimExecution({ executionId: row.id, expectedEpoch: status.controllerEpoch });
    const claimed = await this.#waitForRow(row.id, (candidate) => candidate.state.tag === "Running" &&
      sameIdentity(candidate.controller, this.#connection.identity) && candidate.controllerEpoch !== undefined);
    if (claimed) await this.#runConfirmed(claimed);
    else this.#diagnostic("controller.claim_not_confirmed", { executionId: row.id });
  }

  async #runConfirmed(row: ExecutionRow): Promise<void> {
    const identity = this.#connection.identity;
    if (!sameIdentity(row.controller, identity) || row.controllerEpoch === undefined) return;
    const current = this.#row(row.id) ?? row;
    if (current.state.tag === "Cancelling") {
      await this.#closeCancellation(current);
      return;
    }
    if (isTerminal(current)) return;
    let receipt = this.#controller.receipt(row.id);
    if (!receipt) {
      const command = adaptGeneratedExecutionClaim({
        execution: current,
        claim: { executionId: row.id, unitId: row.unitId, controllerEpoch: row.controllerEpoch },
      });
      try {
        receipt = await this.#controller.start(command);
      } catch (error) {
        this.#diagnostic("controller.local_admission_failed", { executionId: row.id, detail: String(error) });
        await this.#requestCancellation(row);
        return;
      }
    }
    await this.#settle(row, receipt);
  }

  /**
   * Consume a cancellation update independently of the execution work queue.
   * In particular, this may call LocalController.cancel while execute() is
   * still awaiting a feedback promise; the queue recheck handles the later
   * completion without issuing another local stop.
   */
  #interruptCancellation(row: ExecutionRow): void {
    if (this.#closed || row.unitId !== this.#unitId || isTerminal(row) || row.state.tag !== "Cancelling") return;
    if (this.#cancellationWork.has(row.id)) return;
    const task = Promise.resolve().then(async () => {
      const current = this.#row(row.id) ?? row;
      if (current.state.tag !== "Cancelling" || isTerminal(current)) return;
      const receipt = this.#controller.receipt(current.id);
      if (!receipt) {
        if (current.controllerEpoch === undefined) await this.#closeCancellation(current);
        return;
      }
      if (receipt.outcome === "succeeded" || receipt.outcome === "cancelled" || receipt.outcome === "failed") {
        await this.#closeCancellation(current, receipt);
        return;
      }
      const activeExecutionId = this.#controller.status().activeExecutionId;
      if (activeExecutionId && activeExecutionId !== current.id) {
        this.#diagnostic("controller.local_reservation_mismatch", { executionId: current.id });
        await this.#reportState(current, true, false, this.#moduleControl()?.epoch);
        return;
      }
      try {
        const cancelled = await this.#controller.cancel(current.id);
        const latest = this.#row(current.id) ?? current;
        if (cancelled.safeState === "confirmed") await this.#closeCancellation(latest, cancelled);
        else await this.#reportState(latest, true, false, this.#moduleControl()?.epoch);
      } catch (error) {
        this.#diagnostic("controller.cancellation_interrupt_failed", { executionId: current.id, detail: String(error) });
      }
    }).finally(() => this.#cancellationWork.delete(row.id));
    this.#cancellationWork.set(row.id, task);
  }

  async #settle(row: ExecutionRow, initialReceipt: LocalReceipt): Promise<void> {
    let receipt = initialReceipt;
    if (receipt.outcome === "unknown" || receipt.outcome === "running" || receipt.outcome === "notStarted") {
      const activeExecutionId = this.#controller.status().activeExecutionId;
      if (activeExecutionId && activeExecutionId !== row.id) {
        this.#diagnostic("controller.local_reservation_mismatch", { executionId: row.id });
        await this.#requestCancellation(row);
        await this.#reportState(row, true, false);
        return;
      }
      await this.#controller.stop("module_completion_recovery");
      receipt = this.#controller.receipt(row.id) ?? receipt;
    }
    if (receipt.safeState !== "confirmed") {
      await this.#requestCancellation(row);
      await this.#reportState(row, false, false);
      return;
    }
    if (receipt.cancellationRequested || receipt.outcome === "cancelled") {
      await this.#requestCancellation(row);
      await this.#closeCancellation(this.#row(row.id) ?? row, receipt);
      return;
    }
    await this.#finish(row, receipt);
  }

  async #closeCancellation(row: ExecutionRow, suppliedReceipt?: LocalReceipt): Promise<void> {
    const existing = this.#cancellationClose.get(row.id);
    if (existing) {
      await existing;
      return;
    }
    const task = this.#closeCancellationInternal(row, suppliedReceipt).finally(() => this.#cancellationClose.delete(row.id));
    this.#cancellationClose.set(row.id, task);
    await task;
  }

  async #closeCancellationInternal(row: ExecutionRow, suppliedReceipt?: LocalReceipt): Promise<void> {
    const currentRow = this.#row(row.id) ?? row;
    let receipt = suppliedReceipt ?? this.#controller.receipt(row.id);
    if (receipt && (receipt.outcome === "unknown" || receipt.outcome === "running" || receipt.outcome === "notStarted")) {
      const activeExecutionId = this.#controller.status().activeExecutionId;
      if (activeExecutionId && activeExecutionId !== row.id) {
        this.#diagnostic("controller.local_reservation_mismatch", { executionId: row.id });
        await this.#reportState(currentRow, true, false, this.#moduleControl()?.epoch);
        return;
      }
      await this.#controller.stop("module_cancellation");
      receipt = this.#controller.receipt(row.id) ?? receipt;
    }
    if (!receipt) {
      if (currentRow.controllerEpoch !== undefined) {
        this.#diagnostic("controller.cancellation_receipt_missing", { executionId: row.id });
        return;
      }
      const control = this.#moduleControl();
      if (!control || !sameIdentity(control.controller, this.#connection.identity)) {
        this.#diagnostic("controller.cancellation_control_missing", { executionId: row.id });
        return;
      }
      const activeExecutionId = this.#controller.status().activeExecutionId;
      if (activeExecutionId && activeExecutionId !== row.id) {
        this.#diagnostic("controller.local_reservation_mismatch", { executionId: row.id });
        await this.#reportState(currentRow, true, false, control.epoch);
        return;
      }
      await this.#controller.stop("cancel_before_claim");
      const localStatus = this.#controller.status();
      if (localStatus.safeState !== "confirmed") {
        await this.#reportState(currentRow, true, false, control.epoch);
        return;
      }
      const command = adaptGeneratedExecutionCancellation({ execution: currentRow, controllerEpoch: control.epoch });
      receipt = this.#controller.recordNotStartedCancellation(command);
    }
    if (receipt.safeState !== "confirmed") {
      await this.#reportState(currentRow, true, false, this.#moduleControl()?.epoch);
      return;
    }
    const control = this.#moduleControl();
    if (!control || !sameIdentity(control.controller, this.#connection.identity)) {
      this.#diagnostic("controller.cancellation_control_missing", { executionId: currentRow.id });
      return;
    }
    await this.#reportState(currentRow, true, true, control.epoch);
    await this.#connection.reducers.reconcileExecution({ executionId: currentRow.id, expectedEpoch: control.epoch });
    const reconciled = await this.#waitForRow(currentRow.id, (candidate) => candidate.state.tag === "Cancelling" &&
      candidate.controllerEpoch !== undefined && sameIdentity(candidate.controller, this.#connection.identity));
    await this.#finish(reconciled ?? this.#row(currentRow.id) ?? currentRow, receipt);
  }

  async #finish(row: ExecutionRow, receipt: LocalReceipt): Promise<void> {
    const beforeProof = this.#row(row.id) ?? row;
    if (isTerminal(beforeProof) || beforeProof.controllerEpoch === undefined) return;
    const proof = await this.#safeProofFor?.(beforeProof, receipt);
    if (!proof || !safeProofMatches(beforeProof, proof)) {
      this.#diagnostic("controller.safe_proof_missing", { executionId: beforeProof.id });
      return;
    }
    // The proof is acquired first. reportControl stamps the module's
    // unit-control observation, so reporting before the callback can leave
    // observedAt older than the proof and make an otherwise valid finish
    // remain in cancelling.
    const current = this.#row(row.id) ?? beforeProof;
    if (isTerminal(current) || current.controllerEpoch === undefined || current.controllerEpoch !== proof.controllerEpoch) return;
    await this.#reportState(current, true, true, proof.controllerEpoch);
    const reported = this.#row(row.id) ?? current;
    if (isTerminal(reported) || reported.controllerEpoch === undefined || reported.controllerEpoch !== proof.controllerEpoch) return;
    const result = await (this.#resultFor?.(reported, receipt) ?? defaultResult(receipt));
    if (!result) {
      this.#diagnostic("controller.result_evidence_missing", { executionId: reported.id });
      return;
    }
    await this.#connection.reducers.finishExecution({
      executionId: reported.id,
      controllerEpoch: reported.controllerEpoch,
      result,
      safeProof: proof,
    });
    const terminal = await this.#waitForRow(reported.id, (candidate) => isTerminal(candidate));
    if (terminal) await this.#armAfterClosure();
  }

  async #requestCancellation(row: ExecutionRow): Promise<void> {
    const current = this.#row(row.id) ?? row;
    if (current.state.tag === "Accepted" || current.state.tag === "Running") {
      await this.#connection.reducers.requestExecutionCancel({ executionId: current.id });
    }
  }

  async #ensureArmed(): Promise<LocalControllerStatus> {
    let status = this.#controller.status();
    if (status.activeExecutionId) throw new Error("local_unit_reserved");
    if (status.stopLatched || status.safeState !== "confirmed") status = await this.#controller.clearStop();
    await this.#reportState(undefined, status.stopLatched, status.safeState === "confirmed", status.controllerEpoch);
    return this.#controller.status();
  }

  async #armAfterClosure(): Promise<void> {
    const status = await this.#controller.clearStop();
    await this.#reportState(undefined, status.stopLatched, status.safeState === "confirmed", status.controllerEpoch);
  }

  async #reportState(
    row: ExecutionRow | undefined,
    stopLatched: boolean,
    safeStateConfirmed: boolean,
    explicitEpoch?: bigint,
  ): Promise<void> {
    const epoch = explicitEpoch ?? row?.controllerEpoch ?? this.#controller.status().controllerEpoch;
    await this.#connection.reducers.reportControl({
      unitId: this.#unitId,
      epoch,
      stopLatched,
      safeStateConfirmed,
    });
  }

  async #recoverAfterRestart(): Promise<void> {
    if (this.#recoveryDone) return;
    this.#recoveryDone = true;
    const receipts = new Map(this.#controller.receipts().map((receipt) => [receipt.executionId, receipt]));
    for (const receipt of receipts.values()) {
      if (receipt.safeState === "confirmed" && (receipt.outcome === "succeeded" || receipt.outcome === "cancelled" || receipt.outcome === "failed")) {
        // Clear a crash-window reservation before reporting the immutable terminal receipt again.
        this.#controller.reconcile(receipt.executionId);
      }
    }
    for (const row of this.#rows()) {
      if (row.state.tag === "Accepted") continue;
      const receipt = receipts.get(row.id);
      if (row.state.tag === "Running" || row.state.tag === "Cancelling") {
        if (receipt && (receipt.outcome === "unknown" || receipt.outcome === "running" || receipt.outcome === "notStarted")) {
          await this.#controller.stop("session_restart");
        }
        const recovered = this.#controller.receipt(row.id) ?? receipt;
        if (recovered) await this.#settle(this.#row(row.id) ?? row, recovered);
        else await this.#recoverMissingReceipt(row);
      }
    }
    const active = this.#rows().some((row) => isActive(row) && row.state.tag !== "Accepted");
    if (!active && !this.#controller.status().activeExecutionId) await this.#armAfterClosure();
  }

  async #recoverMissingReceipt(row: ExecutionRow): Promise<void> {
    if (row.state.tag === "Cancelling" && row.controllerEpoch === undefined) {
      await this.#closeCancellation(row);
      return;
    }
    await this.#requestCancellation(row);
    const control = this.#moduleControl();
    if (!control || !sameIdentity(control.controller, this.#connection.identity)) {
      this.#diagnostic("controller.recovery_control_missing", { executionId: row.id });
      return;
    }
    const beforeStop = this.#controller.status();
    if (beforeStop.activeExecutionId) {
      // The durable receipt is absent, so an unrelated local reservation must
      // never be stopped or represented as safe closure for this execution.
      await this.#reportState(row, true, false, control.epoch);
      return;
    }
    await this.#controller.stop("session_restart_missing_receipt");
    const afterStop = this.#controller.status();
    const safe = afterStop.safeState === "confirmed" && !afterStop.activeExecutionId;
    await this.#reportState(row, true, safe, control.epoch);
  }

  async #waitForRow(
    executionId: string,
    predicate: (row: ExecutionRow) => boolean,
  ): Promise<ExecutionRow | undefined> {
    const deadline = Date.now() + this.#claimWaitMs;
    while (!this.#closed && Date.now() <= deadline) {
      const row = this.#row(executionId);
      if (row && predicate(row)) return row;
      await new Promise<void>((resolve) => setTimeout(resolve, this.#claimPollMs));
    }
    return undefined;
  }

  #diagnostic(name: string, fields?: Readonly<Record<string, string | number | boolean>>): void {
    try {
      this.#diagnostics?.({ name, unitId: this.#unitId, fields });
    } catch {
      // Diagnostics are deliberately unable to affect controller safety.
    }
  }
}

export type GeneratedControllerConnectionConfig = {
  uri: string | URL;
  databaseName: string;
  token?: string;
  confirmedReads?: boolean;
};

/** Build the canonical generated connection; credentials remain opaque. */
export function buildGeneratedControllerConnection(
  config: GeneratedControllerConnectionConfig,
  onConnect: (connection: CanonicalWorldDbConnection, identity: Identity, token: string) => void,
  onConnectError: (error: Error) => void,
  onDisconnect?: (error?: Error) => void,
): CanonicalWorldDbConnection {
  const builder = DbConnection.builder()
    .withUri(config.uri)
    .withDatabaseName(config.databaseName)
    .withConfirmedReads(config.confirmedReads ?? true)
    .onConnect((connection, identity, token) => onConnect(connection, identity, token))
    .onConnectError((_ctx, error) => onConnectError(error));
  if (onDisconnect) builder.onDisconnect((_ctx, error) => onDisconnect(error));
  if (config.token !== undefined) builder.withToken(config.token);
  return builder.build();
}

export function timestampFromDate(date: Date): Timestamp {
  return Timestamp.fromDate(date);
}
