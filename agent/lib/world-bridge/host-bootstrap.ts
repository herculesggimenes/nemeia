import { WorldAuthorizationError, assertSamePrincipal } from "./authz.ts";
import {
  createGeneratedWorldReadPort,
  type GeneratedWorldAttention,
  type GeneratedWorldClient,
  type GeneratedWorldWake,
} from "./generated-world.ts";
import { createNemeiaSandboxBackend, type NemeiaSandboxBackendOptions, type NemeiaSandboxBackendRuntime } from "./sandbox-backend.ts";
import { BoundedWakeCoalescer } from "./coalescer.ts";
import type { DeliveryLedger, WakeRecord } from "./delivery-ledger.ts";
import type { ContextFile, WorldPrincipal, WorldReadPort } from "./types.ts";
import type { CurrentWorldSnapshot } from "./generated-world.ts";
import type { RequestExecutionParams } from "../../../world-client/src/generated/types/reducers.ts";
import { canonicalJson } from "../../../world-client/src/json.ts";

/** Runtime-free subset used by the host factory; the generated SDK remains the
 * sole implementation of the WorldClient protocol. */
export interface WorldClientBootstrapOptions {
  readonly uri: string | URL;
  readonly databaseName: string;
  readonly token?: string;
  readonly onStateChange?: (state: string, error?: Error) => void;
  readonly onSnapshotChange?: (snapshot: CurrentWorldSnapshot) => void;
}

type WorldClientRuntime = GeneratedWorldClient & {
  connect(): void;
  subscribeCurrentWorld(): unknown;
  disconnect(): void;
  requestExecution(params: RequestExecutionParams): Promise<void>;
};

export interface NemeiaWorldHostOptions {
  readonly worldClient: GeneratedWorldClient;
  readonly worldId: string;
  readonly agentId: string;
  readonly snapshotRevision: (snapshot: CurrentWorldSnapshot) => string;
  readonly attention: () => GeneratedWorldAttention;
  readonly acknowledgeAttention?: (generation: number) => void | Promise<void>;
  /** Bound by Eve step/onSession context; never populated from model input or env identity. */
  readonly currentPrincipal: () => WorldPrincipal | null;
  readonly contextProvider?: NemeiaSandboxBackendOptions["contextProvider"];
  readonly maxOutputBytes?: number;
  readonly authorizePrincipal?: (principal: WorldPrincipal) => void;
  readonly actionProvider?: NemeiaSandboxBackendOptions["actionProvider"];
}

export interface NemeiaWorldHostRuntime {
  readonly world: WorldReadPort;
  readonly sandbox: NemeiaSandboxBackendRuntime;
}

export interface NemeiaConnectedWorldHostOptions
  extends Omit<WorldClientBootstrapOptions, "onSnapshotChange" | "onStateChange"> {
  readonly worldId: string;
  readonly agentId: string;
  readonly worldClientFactory: (options: WorldClientBootstrapOptions) => WorldClientRuntime;
  readonly snapshotRevision: (snapshot: CurrentWorldSnapshot) => string;
  readonly currentPrincipal: () => WorldPrincipal | null;
  readonly contextProvider?: NemeiaWorldHostOptions["contextProvider"];
  readonly authorizePrincipal?: NemeiaWorldHostOptions["authorizePrincipal"];
  readonly actionProvider?: NemeiaWorldHostOptions["actionProvider"];
  readonly ledger: Pick<
    DeliveryLedger,
    | "beginWake"
    | "listRecoverableWakes"
    | "transitionWake"
    | "retainMustHandle"
    | "listPendingMustHandle"
    | "acknowledgeMustHandle"
  >;
  readonly wakeLimits?: {
    readonly maxSourceIds: number;
    readonly maxDirtyKeys: number;
    readonly maxMustHandleIds: number;
  };
  readonly maxAttentionPage?: number;
  readonly wakeRetryBaseDelayMs?: number;
  readonly wakeRetryCapDelayMs?: number;
  readonly maxOutputBytes?: number;
  readonly onStateChange?: WorldClientBootstrapOptions["onStateChange"];
  readonly onSnapshotChange?: (snapshot: CurrentWorldSnapshot, attention: GeneratedWorldAttention) => void;
  /** Public Eve-channel bridge. The host never starts an inference loop. */
  readonly wakeDispatcher?: (wake: GeneratedWorldWake) => "accepted" | "deferred" | void | Promise<"accepted" | "deferred" | void>;
  readonly onWakeDispatchError?: (error: unknown, wake: GeneratedWorldWake) => void;
}

export interface NemeiaConnectedWorldHostRuntime extends NemeiaWorldHostRuntime {
  readonly worldClient: WorldClientRuntime;
  readonly attention: () => GeneratedWorldAttention;
  readonly acknowledgeMustHandle: (sourceId: string) => boolean;
  /** Event-driven retry point after Eve leaves an active step. */
  flushPendingWake(): void;
  close(): void;
  /** After close, drain the sole in-flight transport before closing its WAL. */
  settled(): Promise<void>;
}

/**
 * Authenticated read-host startup, not a compiler-time factory or dispatcher.
 * WorldClient emits ready only after native onApplied validates readiness;
 * wait for its initial snapshot too so the first projection includes attention.
 */
export async function createReadyNemeiaWorldHost(
  options: Omit<NemeiaConnectedWorldHostOptions, "wakeDispatcher">,
  timeoutMs = 10_000,
): Promise<NemeiaConnectedWorldHostRuntime> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw new RangeError("invalid world startup timeout");
  }
  let state = "connecting";
  let initialSnapshot: CurrentWorldSnapshot | undefined;
  let resolveReady!: () => void;
  let rejectReady!: (error: unknown) => void;
  const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  // A synchronous connection failure may precede the await below.
  void ready.catch(() => {});
  const timer = setTimeout(() => rejectReady(new Error("world_client_ready_timeout")), timeoutMs);
  const checkReady = (): void => {
    if (state !== "ready" || initialSnapshot === undefined) return;
    if (!initialSnapshot.readiness.some((row) => row.worldId === options.worldId && row.authorized && row.synchronized)) {
      rejectReady(new Error("world_client_not_authorized"));
      return;
    }
    resolveReady();
  };
  let host: NemeiaConnectedWorldHostRuntime | undefined;
  try {
    host = createConnectedNemeiaWorldHost({
      ...options,
      // Even a JavaScript caller cannot accidentally start inference here.
      wakeDispatcher: undefined,
      onStateChange: (next, error) => {
        state = next;
        if (next === "error" || next === "disconnected") {
          rejectReady(error ?? new Error(`world_client_${next}`));
        }
        options.onStateChange?.(next, error);
        checkReady();
      },
      onSnapshotChange: (snapshot, attention) => {
        initialSnapshot = snapshot;
        options.onSnapshotChange?.(snapshot, attention);
        checkReady();
      },
    });
    await ready;
    // A disconnect/revocation can race the promise continuation. Re-read the
    // actual native cache; a formerly ready signal never grants stale access.
    if (state !== "ready") throw new Error("world_client_not_ready");
    const current = host.worldClient.snapshot();
    if (!current.readiness.some((row) => row.worldId === options.worldId && row.authorized && row.synchronized)) {
      throw new Error("world_client_not_authorized");
    }
    return host;
  } catch (error) {
    host?.close();
    await host?.settled();
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Host composition for the actual generated WorldClient. The host supplies
 * the subscribed client and current Eve principal; this module owns neither a
 * second database nor a fallback world DTO.
 */
export function createNemeiaWorldHost(options: NemeiaWorldHostOptions): NemeiaWorldHostRuntime {
  const authorizeCurrentPrincipal = (request: { readonly worldId: string; readonly agentId: string; readonly principal: WorldPrincipal }): void => {
    if (request.worldId !== options.worldId || request.agentId !== options.agentId) {
      throw new WorldAuthorizationError("world host binding mismatch");
    }
    // The sandbox command supplies the principal from the current Eve
    // session/handle binding. Connected production hosts additionally apply a
    // configured owner guard. There is no process-global fallback authority.
    options.authorizePrincipal?.(request.principal);
    const current = options.currentPrincipal();
    if (current === null) {
      if (options.authorizePrincipal === undefined) {
        throw new WorldAuthorizationError("current Eve principal is unavailable");
      }
      return;
    }
    assertSamePrincipal(request.principal, current);
  };
  const world = createGeneratedWorldReadPort({
    client: options.worldClient,
    snapshotRevision: options.snapshotRevision,
    attention: options.attention,
    acknowledgeAttention: options.acknowledgeAttention,
    authorizeCurrentPrincipal,
  });
  const sandboxOptions: NemeiaSandboxBackendOptions = {
    worldId: options.worldId,
    agentId: options.agentId,
    world,
    contextProvider: options.contextProvider,
    maxOutputBytes: options.maxOutputBytes,
    authorizePrincipal: options.authorizePrincipal,
    actionProvider: options.actionProvider,
  };
  return { world, sandbox: createNemeiaSandboxBackend(sandboxOptions) };
}

const SNAPSHOT_FEEDS = [
  ["world.addressed_messages", (snapshot: CurrentWorldSnapshot) => snapshot.addressedMessages, true],
  ["world.assigned_missions", (snapshot: CurrentWorldSnapshot) => snapshot.assignedMissions, false],
  ["world.relevant_action_bindings", (snapshot: CurrentWorldSnapshot) => snapshot.relevantActionBindings, false],
  ["world.relevant_agents", (snapshot: CurrentWorldSnapshot) => snapshot.relevantAgents, false],
  ["world.relevant_entities", (snapshot: CurrentWorldSnapshot) => snapshot.relevantEntities, false],
  ["world.relevant_executions", (snapshot: CurrentWorldSnapshot) => snapshot.relevantExecutions, false],
  ["world.relevant_feedback_watermarks", (snapshot: CurrentWorldSnapshot) => snapshot.relevantFeedbackWatermarks ?? [], true],
  ["world.relevant_geometry", (snapshot: CurrentWorldSnapshot) => snapshot.relevantGeometry, false],
  ["world.relevant_local_maps", (snapshot: CurrentWorldSnapshot) => snapshot.relevantLocalMaps, false],
  ["world.relevant_mission_agents", (snapshot: CurrentWorldSnapshot) => snapshot.relevantMissionAgents, false],
  ["world.relevant_mission_objective_progress", (snapshot: CurrentWorldSnapshot) => snapshot.relevantMissionObjectiveProgress, false],
  ["world.relevant_poses", (snapshot: CurrentWorldSnapshot) => snapshot.relevantPoses, false],
  ["world.relevant_semantic", (snapshot: CurrentWorldSnapshot) => snapshot.relevantSemantic, false],
  ["world.relevant_unit_assignments", (snapshot: CurrentWorldSnapshot) => snapshot.relevantUnitAssignments, false],
  ["world.relevant_unit_controls", (snapshot: CurrentWorldSnapshot) => snapshot.relevantUnitControls, false],
] as const;

type SnapshotFeedRow = Record<string, unknown>;

function rowKey(row: SnapshotFeedRow): string {
  if (typeof row.missionId === "string" && (typeof row.sequence === "bigint" || typeof row.sequence === "number")) {
    return `${row.missionId}:${String(row.sequence)}`;
  }
  for (const candidate of ["id", "key", "eventId", "unitId", "entityId", "missionId", "sequence"]) {
    const value = row[candidate];
    if (typeof value === "string" && value.length > 0) return value;
    if (typeof value === "bigint") return value.toString(10);
  }
  return canonicalJson(row);
}

function changedSnapshotRows(
  previous: CurrentWorldSnapshot | undefined,
  current: CurrentWorldSnapshot,
): readonly { readonly sourceId: string; readonly dirtyKeys: readonly string[]; readonly mustHandleIds: readonly string[] }[] {
  const changes: Array<{ sourceId: string; dirtyKeys: string[]; mustHandleIds: string[] }> = [];
  for (const [sourceId, select, mustHandle] of SNAPSHOT_FEEDS) {
    const before = new Map((previous === undefined ? [] : select(previous) as readonly SnapshotFeedRow[]).map((row) => [rowKey(row), canonicalJson(row)]));
    const after = new Map((select(current) as readonly SnapshotFeedRow[]).map((row) => [rowKey(row), canonicalJson(row)]));
    const changed = [...new Set([...before.keys(), ...after.keys()])].filter((key) => before.get(key) !== after.get(key));
    const changedCurrentRows = [...after.keys()].filter((key) => before.get(key) !== after.get(key));
    if (changed.length === 0) continue;
    changes.push({
      sourceId,
      dirtyKeys: changed.map((key) => `${sourceId}:${key}`),
      mustHandleIds: mustHandle ? changedCurrentRows.map((key) => `${sourceId}:${key}`) : [],
    });
  }
  if (previous === undefined && changes.length === 0) {
    changes.push({ sourceId: "world.subscription.initial", dirtyKeys: ["world.snapshot"], mustHandleIds: [] });
  }
  return changes;
}

function attentionFrom(
  coalescer: BoundedWakeCoalescer,
  ledger: NemeiaConnectedWorldHostOptions["ledger"],
  maxAttentionPage: number,
): GeneratedWorldAttention {
  const pending = coalescer.snapshot();
  const durableMustHandleIds = ledger.listPendingMustHandle({ limit: maxAttentionPage });
  return {
    generation: pending?.generation ?? 0,
    sourceIds: pending?.sourceIds ?? [],
    dirtyKeys: pending?.dirtyKeys ?? [],
    mustHandleIds: [...new Set([...(pending?.mustHandleIds ?? []), ...durableMustHandleIds])].slice(0, maxAttentionPage),
    rescanRequired: pending?.rescanRequired ?? false,
  };
}

function hasDispatchableAttention(attention: GeneratedWorldAttention): boolean {
  return (
    attention.sourceIds.length > 0 ||
    attention.dirtyKeys.length > 0 ||
    attention.mustHandleIds.length > 0 ||
    attention.rescanRequired
  );
}

const MEANINGFUL_WITHOUT_MISSION = new Set([
  "world.addressed_messages",
  "world.assigned_missions",
  "world.relevant_agents",
  "world.relevant_action_bindings",
  "world.relevant_executions",
  "world.relevant_feedback_watermarks",
  "world.relevant_mission_agents",
  "world.relevant_mission_objective_progress",
  "world.relevant_unit_assignments",
  "world.relevant_unit_controls",
]);

function automaticWakeEligible(
  snapshot: CurrentWorldSnapshot | undefined,
  agentId: string,
  attention: GeneratedWorldAttention,
): boolean {
  if (snapshot === undefined) return false;
  const agent = snapshot.relevantAgents.find((row) => row.id === agentId);
  // Missing authorization/availability and an explicit pause retain all
  // coalesced work but never start model inference.
  if (agent === undefined || agent.paused) return false;
  const activeMissionIds = new Set(
    snapshot.assignedMissions.filter((mission) => mission.state.tag === "Active").map((mission) => mission.id),
  );
  const hasActiveMission = snapshot.relevantMissionAgents.some(
    (row) => row.agentId === agentId && row.active && activeMissionIds.has(row.missionId),
  );
  if (hasActiveMission) return hasDispatchableAttention(attention);
  // Without an active assignment, ordinary sensor/heartbeat rows are useful
  // for the next projection but do not wake a reasoning turn. Messages,
  // assignments, outcomes, and availability changes do.
  return (
    attention.sourceIds.some((sourceId) => MEANINGFUL_WITHOUT_MISSION.has(sourceId)) ||
    attention.mustHandleIds.some((id) => [...MEANINGFUL_WITHOUT_MISSION].some((sourceId) => id.startsWith(`${sourceId}:`)))
  );
}

function recoveredWake(record: WakeRecord): GeneratedWorldWake {
  return {
    wakeId: record.wakeId,
    generation: 0,
    sourceIds: record.sourceIds,
    dirtyKeys: record.dirtyKeys,
    mustHandleIds: record.mustHandleIds,
    rescanRequired: record.rescanRequired,
  };
}

/**
 * Build the real generated WorldClient, subscribe to the authorized views, and
 * retain bounded changes in the same durable delivery ledger used by wakes.
 * The host deliberately exposes attention instead of starting an inference
 * scheduler: Eve/custom-channel ownership remains at the application edge.
 */
export function createConnectedNemeiaWorldHost(
  options: NemeiaConnectedWorldHostOptions,
): NemeiaConnectedWorldHostRuntime {
  const maxAttentionPage = options.maxAttentionPage ?? options.wakeLimits?.maxMustHandleIds ?? 128;
  if (!Number.isSafeInteger(maxAttentionPage) || maxAttentionPage < 1 || maxAttentionPage > 1024) {
    throw new RangeError("invalid world attention page size");
  }
  const coalescer = new BoundedWakeCoalescer(
    options.wakeLimits,
    (sourceId) => options.ledger.retainMustHandle(sourceId),
  );
  // These ids have been delivered in this process but remain unhandled in the
  // durable ledger. They stay visible to context readers, but must not create
  // an endless replacement wake after one accepted delivery. A restart starts
  // with an empty set and therefore replays every still-pending durable row.
  const deliveredMustHandleIds = new Set<string>();
  const attention = (): GeneratedWorldAttention => attentionFrom(coalescer, options.ledger, maxAttentionPage);
  const dispatchAttention = (): GeneratedWorldAttention => {
    const value = attention();
    return {
      ...value,
      mustHandleIds: value.mustHandleIds.filter((sourceId) => !deliveredMustHandleIds.has(sourceId)),
    };
  };
  const recoverable = options.ledger.listRecoverableWakes();
  let pendingWake: { readonly wake: GeneratedWorldWake; readonly record: WakeRecord } | undefined = recoverable[0] === undefined
    ? undefined
    : { wake: recoveredWake(recoverable[0]), record: recoverable[0] };
  let recoveredWakeNeedsGenerationPin = pendingWake !== undefined;
  let latestSnapshot: CurrentWorldSnapshot | undefined;
  let wakeDispatchBusy = false;
  let dispatchPromise: Promise<void> | undefined;
  let wakeDispatchPending = false;
  let closed = false;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let retryCount = 0;
  const retryBaseDelayMs = options.wakeRetryBaseDelayMs ?? 100;
  const retryCapDelayMs = options.wakeRetryCapDelayMs ?? 2_000;
  const clearRetryTimer = (): void => {
    if (retryTimer !== undefined) {
      clearTimeout(retryTimer);
      retryTimer = undefined;
    }
  };
  const scheduleRetry = (): void => {
    if (closed || retryTimer !== undefined) return;
    const delay = Math.min(retryCapDelayMs, retryBaseDelayMs * (retryCount < 31 ? 2 ** retryCount : 2 ** 31));
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      retryCount += 1;
      wakeDispatchPending = true;
      dispatchPendingWake();
    }, delay);
    // The timer only keeps transport delivery alive; it must not keep process
    // shutdown or test teardown alive after the host is closed.
    retryTimer.unref?.();
  };
  const ensurePendingWake = (): { readonly wake: GeneratedWorldWake; readonly record: WakeRecord } | undefined => {
    if (pendingWake !== undefined) {
      return automaticWakeEligible(latestSnapshot, options.agentId, dispatchAttention()) ? pendingWake : undefined;
    }
    const candidate = dispatchAttention();
    if (!automaticWakeEligible(latestSnapshot, options.agentId, candidate)) return undefined;
    const record = options.ledger.beginWake({
      worldId: options.worldId,
      agentId: options.agentId,
      sourceIds: candidate.sourceIds,
      dirtyKeys: candidate.dirtyKeys,
      mustHandleIds: candidate.mustHandleIds,
      rescanRequired: candidate.rescanRequired,
    });
    pendingWake = { wake: { ...candidate, wakeId: record.wakeId }, record };
    return pendingWake;
  };
  const dispatchPendingWake = (): void => {
    if (options.wakeDispatcher === undefined || closed) return;
    if (retryTimer !== undefined) return;
    wakeDispatchPending = true;
    if (wakeDispatchBusy) return;
    wakeDispatchBusy = true;
    dispatchPromise = (async () => {
      try {
        while (wakeDispatchPending && !closed) {
          wakeDispatchPending = false;
          const pending = ensurePendingWake();
          if (pending === undefined) continue;
          const { wake } = pending;
          try {
            options.ledger.transitionWake(wake.wakeId, "dispatching");
            const result = await options.wakeDispatcher?.(wake);
            if (result === "deferred") {
              // Eve has accepted no turn yet; leave this exact WAL row and
              // payload pending. The sole external bridge observes public
              // hook receipts through the shared WAL, not process globals.
              scheduleRetry();
              continue;
            }
            options.ledger.transitionWake(wake.wakeId, "accepted");
            // Retire only replaceable coalesced work observed by this wake.
            // Must-handle rows remain durable until explicit agent handling.
            coalescer.acknowledgeReplaceable(wake.generation);
            for (const sourceId of wake.mustHandleIds) deliveredMustHandleIds.add(sourceId);
            pendingWake = undefined;
            retryCount = 0;
            clearRetryTimer();
            const recoveredAfterAccept = options.ledger.listRecoverableWakes()[0];
            if (recoveredAfterAccept !== undefined) {
              pendingWake = { wake: recoveredWake(recoveredAfterAccept), record: recoveredAfterAccept };
              wakeDispatchPending = true;
            }
            // A newer subscription generation may have arrived while this
            // payload was waiting for Eve to become idle. Preserve it as the
            // next coalesced wake, never as a second queued turn in advance.
            if (hasDispatchableAttention(dispatchAttention())) wakeDispatchPending = true;
          } catch (error) {
            // The coalescer and durable must-handle ledger remain pending. Do
            // not turn an operational channel failure into an unhandled
            // rejection or a false delivery acknowledgement.
            try {
              options.ledger.transitionWake(wake.wakeId, "uncertain", "world wake dispatch failed");
            } catch (ledgerError) {
              options.onWakeDispatchError?.(ledgerError, wake);
            }
            options.onWakeDispatchError?.(error, wake);
            options.onStateChange?.(
              "error",
              error instanceof Error ? error : new Error("world wake dispatch failed"),
            );
            scheduleRetry();
          }
        }
      } finally {
        wakeDispatchBusy = false;
        if (wakeDispatchPending && !closed && retryTimer === undefined) dispatchPendingWake();
      }
    })();
  };
  let previousSnapshot: CurrentWorldSnapshot | undefined;
  const onSnapshotChange = (snapshot: CurrentWorldSnapshot): void => {
    if (closed) return;
    for (const change of changedSnapshotRows(previousSnapshot, snapshot)) {
      coalescer.enqueue({
        sourceId: change.sourceId,
        dirtyKeys: change.dirtyKeys,
        requiresRescan: change.sourceId === "world.subscription.initial",
      });
      for (const mustHandleId of change.mustHandleIds) {
        deliveredMustHandleIds.delete(mustHandleId);
        coalescer.enqueue({ sourceId: change.sourceId, mustHandleId });
      }
    }
    previousSnapshot = snapshot;
    latestSnapshot = snapshot;
    if (recoveredWakeNeedsGenerationPin && pendingWake !== undefined) {
      // The recovered payload predates this process. Pin replaceable
      // acknowledgement to the first subscribed generation; any later
      // subscription event remains newer work and is not cleared with it.
      pendingWake = {
        ...pendingWake,
        wake: { ...pendingWake.wake, generation: coalescer.snapshot()?.generation ?? 0 },
      };
      recoveredWakeNeedsGenerationPin = false;
    }
    options.onSnapshotChange?.(snapshot, attention());
    // This is a single bounded handoff to Eve's public channel.  While a
    // request is in flight, later snapshots only set one pending bit and are
    // represented by the next attention snapshot; no turn scheduler or frame
    // queue is introduced here.
    dispatchPendingWake();
  };
  const worldClient = options.worldClientFactory({
    ...options,
    onSnapshotChange,
    onStateChange: options.onStateChange,
  });
  const host = createNemeiaWorldHost({
    worldClient,
    worldId: options.worldId,
    agentId: options.agentId,
    snapshotRevision: options.snapshotRevision,
    attention,
    acknowledgeAttention: (generation) => coalescer.acknowledgeReplaceable(generation),
    currentPrincipal: options.currentPrincipal,
    contextProvider: options.contextProvider,
    maxOutputBytes: options.maxOutputBytes,
    authorizePrincipal: options.authorizePrincipal,
    actionProvider: options.actionProvider,
  });
  const close = (): void => {
    if (closed) return;
    closed = true;
    wakeDispatchPending = false;
    clearRetryTimer();
    worldClient.disconnect();
  };
  try {
    worldClient.connect();
    worldClient.subscribeCurrentWorld();
  } catch (error) {
    close();
    throw error;
  }
  // Replayed WAL rows and an initial subscription snapshot must not depend on
  // a later world mutation to become deliverable.
  dispatchPendingWake();
  return {
    ...host,
    worldClient,
    attention,
    acknowledgeMustHandle: (sourceId) => {
      const acknowledged = options.ledger.acknowledgeMustHandle(sourceId);
      if (acknowledged) {
        coalescer.acknowledgeMustHandle(sourceId);
        deliveredMustHandleIds.delete(sourceId);
      }
      return acknowledged;
    },
    flushPendingWake: () => { clearRetryTimer(); dispatchPendingWake(); },
    close,
    settled: async () => { await dispatchPromise; },
  };
}
