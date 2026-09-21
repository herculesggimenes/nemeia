import { Identity, Timestamp } from "spacetimedb";
import type { Infer } from "spacetimedb";
import {
  DbConnection,
  type SubscriptionHandle,
  tables,
} from "./generated/index.ts";
import { procedures, reducers } from "./generated/index.ts";
import type {
  AssignMissionParams,
  AssignUnitParams,
  CancelMissionParams,
  ClaimExecutionParams,
  CommitMapCheckpointParams,
  ConfigureAgentParams,
  ConfigureMemberParams,
  ConfigureUnitParams,
  CreateMissionParams,
  FinishExecutionParams,
  IngestObservationParams,
  InitializeLocalMapParams,
  PauseAgentParams,
  ReconcileExecutionParams,
  ReconcileMissionParams,
  RecordObjectiveProgressParams,
  RejectObjectiveFindingParams,
  RegisterSpatialFrameParams,
  ReportControlParams,
  RequestExecutionCancelParams,
  RequestExecutionParams,
  RevokeMissionParams,
  SetActionBindingParams,
} from "./generated/types/reducers.ts";
import type {
  ReadEventHistoryArgs,
  ReadEventHistoryResult,
  ReadGeometryDetailArgs,
  ReadGeometryDetailResult,
  ReadMapHistoryArgs,
  ReadMapHistoryResult,
  ReadObservationDetailArgs,
  ReadObservationDetailResult,
  ReadObservationHistoryArgs,
  ReadObservationHistoryResult,
  ReadSpatialFrameDetailArgs,
  ReadSpatialFrameDetailResult,
} from "./generated/types/procedures.ts";
import ReadinessTable from "./generated/readiness_table.ts";
import AddressedMessagesTable from "./generated/addressed_messages_table.ts";
import AssignedMissionsTable from "./generated/assigned_missions_table.ts";
import RelevantActionBindingsTable from "./generated/relevant_action_bindings_table.ts";
import RelevantAgentsTable from "./generated/relevant_agents_table.ts";
import RelevantEntitiesTable from "./generated/relevant_entities_table.ts";
import RelevantExecutionsTable from "./generated/relevant_executions_table.ts";
import RelevantFeedbackWatermarksTable from "./generated/relevant_feedback_watermarks_table.ts";
import RelevantGeometryTable from "./generated/relevant_geometry_table.ts";
import RelevantLocalMapsTable from "./generated/relevant_local_maps_table.ts";
import RelevantMissionAgentsTable from "./generated/relevant_mission_agents_table.ts";
import RelevantMissionObjectiveProgressTable from "./generated/relevant_mission_objective_progress_table.ts";
import RelevantPosesTable from "./generated/relevant_poses_table.ts";
import RelevantSemanticTable from "./generated/relevant_semantic_table.ts";
import RelevantUnitAssignmentsTable from "./generated/relevant_unit_assignments_table.ts";
import RelevantUnitControlsTable from "./generated/relevant_unit_controls_table.ts";

export type WorldConnection = InstanceType<typeof DbConnection>;
type RowEventCallback = (...args: never[]) => void;
type ObservableClientTable = {
  onInsert(callback: RowEventCallback): void;
  removeOnInsert(callback: RowEventCallback): void;
  onDelete(callback: RowEventCallback): void;
  removeOnDelete(callback: RowEventCallback): void;
  onUpdate?: (callback: RowEventCallback) => void;
  removeOnUpdate?: (callback: RowEventCallback) => void;
};

export * from "./generated/types.ts";
export * from "./json.ts";
export { DbConnection, procedures, reducers, tables } from "./generated/index.ts";
export type {
  AssignMissionParams,
  AssignUnitParams,
  CancelMissionParams,
  ClaimExecutionParams,
  CommitMapCheckpointParams,
  ConfigureAgentParams,
  ConfigureMemberParams,
  ConfigureUnitParams,
  CreateMissionParams,
  FinishExecutionParams,
  IngestObservationParams,
  InitializeLocalMapParams,
  PauseAgentParams,
  ReconcileExecutionParams,
  ReconcileMissionParams,
  RecordObjectiveProgressParams,
  RejectObjectiveFindingParams,
  RegisterSpatialFrameParams,
  ReportControlParams,
  RequestExecutionCancelParams,
  RequestExecutionParams,
  RevokeMissionParams,
  SetActionBindingParams,
  ReadEventHistoryArgs,
  ReadEventHistoryResult,
  ReadGeometryDetailArgs,
  ReadGeometryDetailResult,
  ReadMapHistoryArgs,
  ReadMapHistoryResult,
  ReadObservationDetailArgs,
  ReadObservationDetailResult,
  ReadObservationHistoryArgs,
  ReadObservationHistoryResult,
  ReadSpatialFrameDetailArgs,
  ReadSpatialFrameDetailResult,
};

export type ReadinessRow = Infer<typeof ReadinessTable>;
export type AddressedMessageRow = Infer<typeof AddressedMessagesTable>;
export type AssignedMissionRow = Infer<typeof AssignedMissionsTable>;
export type RelevantActionBindingRow = Infer<typeof RelevantActionBindingsTable>;
export type RelevantAgentRow = Infer<typeof RelevantAgentsTable>;
export type RelevantEntityRow = Infer<typeof RelevantEntitiesTable>;
export type RelevantExecutionRow = Infer<typeof RelevantExecutionsTable>;
export type RelevantFeedbackWatermarkRow = Infer<typeof RelevantFeedbackWatermarksTable>;
export type RelevantGeometryRow = Infer<typeof RelevantGeometryTable>;
export type RelevantLocalMapRow = Infer<typeof RelevantLocalMapsTable>;
export type RelevantMissionAgentRow = Infer<typeof RelevantMissionAgentsTable>;
export type RelevantMissionObjectiveProgressRow = Infer<typeof RelevantMissionObjectiveProgressTable>;
export type RelevantPoseRow = Infer<typeof RelevantPosesTable>;
export type RelevantSemanticRow = Infer<typeof RelevantSemanticTable>;
export type RelevantUnitAssignmentRow = Infer<typeof RelevantUnitAssignmentsTable>;
export type RelevantUnitControlRow = Infer<typeof RelevantUnitControlsTable>;

export type ConnectionState = "disconnected" | "connecting" | "ready" | "error";

export type CurrentWorldSnapshot = Readonly<{
  readiness: ReadonlyArray<ReadinessRow>;
  addressedMessages: ReadonlyArray<AddressedMessageRow>;
  assignedMissions: ReadonlyArray<AssignedMissionRow>;
  relevantActionBindings: ReadonlyArray<RelevantActionBindingRow>;
  relevantAgents: ReadonlyArray<RelevantAgentRow>;
  relevantEntities: ReadonlyArray<RelevantEntityRow>;
  relevantExecutions: ReadonlyArray<RelevantExecutionRow>;
  /** Optional for source-compatible snapshot fixtures; live clients always populate it. */
  relevantFeedbackWatermarks?: ReadonlyArray<RelevantFeedbackWatermarkRow>;
  relevantGeometry: ReadonlyArray<RelevantGeometryRow>;
  relevantLocalMaps: ReadonlyArray<RelevantLocalMapRow>;
  relevantMissionAgents: ReadonlyArray<RelevantMissionAgentRow>;
  relevantMissionObjectiveProgress: ReadonlyArray<RelevantMissionObjectiveProgressRow>;
  relevantPoses: ReadonlyArray<RelevantPoseRow>;
  relevantSemantic: ReadonlyArray<RelevantSemanticRow>;
  relevantUnitAssignments: ReadonlyArray<RelevantUnitAssignmentRow>;
  relevantUnitControls: ReadonlyArray<RelevantUnitControlRow>;
}>;

export type WorldClientOptions = {
  uri: string | URL;
  databaseName: string;
  token?: string;
  onStateChange?: (state: ConnectionState, error?: Error) => void;
  onSnapshotChange?: (snapshot: CurrentWorldSnapshot) => void;
  /** Deterministic connection seam for tests and host adapters. */
  connectionFactory?: (callbacks: WorldConnectionCallbacks) => WorldConnection;
};

export type WorldConnectionCallbacks = {
  onConnect: (connection: WorldConnection) => void;
  onConnectError: (error: Error) => void;
  onDisconnect: (error?: Error) => void;
};

export class WorldClient {
  readonly #options: WorldClientOptions;
  #connection: InstanceType<typeof DbConnection> | undefined;
  #subscription: SubscriptionHandle | undefined;
  #state: ConnectionState = "disconnected";
  #ready = false;
  #subscriptionRequested = false;
  #snapshotNotificationQueued = false;
  #rowListenerRemovers: Array<() => void> = [];
  #generation = 0;

  constructor(options: WorldClientOptions) {
    this.#options = options;
  }

  get state(): ConnectionState {
    return this.#state;
  }

  get connection(): InstanceType<typeof DbConnection> | undefined {
    return this.#connection;
  }

  connect(): InstanceType<typeof DbConnection> {
    if (this.#connection && this.#connection.isActive && !this.#connection.isDisconnectRequested) {
      if (this.#subscriptionRequested && !this.#subscription && !this.#ready) {
        this.subscribeCurrentWorld();
      }
      return this.#connection;
    }
    const generation = ++this.#generation;
    this.#setState("connecting");
    const callbacks: WorldConnectionCallbacks = {
      onConnect: (connection) => {
        if (generation !== this.#generation) return;
        this.#connection = connection;
        this.#setState("connecting");
        if (this.#subscriptionRequested) {
          try {
            this.subscribeCurrentWorld();
          } catch (error) {
            this.#ready = false;
            this.#setState("error", asError(error));
          }
        }
      },
      onConnectError: (error) => {
        if (generation !== this.#generation) return;
        this.#ready = false;
        this.#setState("error", error);
      },
      onDisconnect: (error) => {
        if (generation !== this.#generation) return;
        this.#ready = false;
        this.#stopSubscription();
        this.#connection = undefined;
        this.#setState(error ? "error" : "disconnected", error);
      },
    };
    try {
      const connection = this.#options.connectionFactory
        ? this.#options.connectionFactory(callbacks)
        : this.#buildConnection(callbacks);
      if (generation === this.#generation) this.#connection = connection;
      return connection;
    } catch (error) {
      this.#ready = false;
      this.#setState("error", asError(error));
      throw error;
    }
  }

  disconnect(): void {
    ++this.#generation;
    this.#subscriptionRequested = false;
    this.#ready = false;
    this.#stopSubscription();
    const connection = this.#connection;
    this.#connection = undefined;
    connection?.disconnect();
    this.#setState("disconnected");
  }

  subscribeCurrentWorld(onApplied?: (snapshot: CurrentWorldSnapshot) => void): SubscriptionHandle | undefined {
    this.#subscriptionRequested = true;
    const connection = this.#connection;
    if (!connection || !connection.isActive || connection.isDisconnectRequested) {
      // DbConnection establishes its websocket asynchronously. Record the
      // request now; connect()'s onConnect callback will attach the native
      // subscription once the SDK marks the connection active.
      if (!connection) this.connect();
      return this.#subscription;
    }
    this.#ready = false;
    this.#stopSubscription();
    this.#setState("connecting");
    this.#bindSnapshotEvents(connection);
    this.#subscription = connection.subscriptionBuilder()
      .onApplied(() => {
        const snapshot = this.#readSnapshot(connection);
        const readiness = snapshot.readiness;
        if (!readiness.some((row) => row.authorized && row.synchronized)) {
          this.#ready = false;
          this.#setState("error", new Error("world_client_not_authorized"));
          return;
        }
        this.#ready = true;
        this.#setState("ready");
        onApplied?.(snapshot);
        this.#queueSnapshotNotification();
      })
      .onError((context) => {
        this.#ready = false;
        this.#stopSubscription();
        const error = context.event instanceof Error ? context.event : new Error("world_subscription_failed");
        this.#setState("error", error);
      })
      .subscribe((viewTables) => [
        viewTables.readiness,
        viewTables.addressedMessages,
        viewTables.assignedMissions,
        viewTables.relevantActionBindings,
        viewTables.relevantAgents,
        viewTables.relevantEntities,
        viewTables.relevantExecutions,
        viewTables.relevantFeedbackWatermarks,
        viewTables.relevantGeometry,
        viewTables.relevantLocalMaps,
        viewTables.relevantMissionAgents,
        viewTables.relevantMissionObjectiveProgress,
        viewTables.relevantPoses,
        viewTables.relevantSemantic,
        viewTables.relevantUnitAssignments,
        viewTables.relevantUnitControls,
      ]);
    return this.#subscription;
  }

  snapshot(): CurrentWorldSnapshot {
    if (!this.#ready) throw new Error("world_client_not_ready");
    return this.#readSnapshot(this.#requireConnection());
  }

  configureUnit(params: ConfigureUnitParams): Promise<void> {
    return this.#requireConnection().reducers.configureUnit(params);
  }

  configureMember(params: ConfigureMemberParams): Promise<void> {
    return this.#requireConnection().reducers.configureMember(params);
  }

  ingestObservation(params: IngestObservationParams): Promise<void> {
    return this.#requireConnection().reducers.ingestObservation(params);
  }

  initializeLocalMap(params: InitializeLocalMapParams): Promise<void> {
    return this.#requireConnection().reducers.initializeLocalMap(params);
  }

  registerSpatialFrame(params: RegisterSpatialFrameParams): Promise<void> {
    return this.#requireConnection().reducers.registerSpatialFrame(params);
  }

  commitMapCheckpoint(params: CommitMapCheckpointParams): Promise<void> {
    return this.#requireConnection().reducers.commitMapCheckpoint(params);
  }

  setActionBinding(params: SetActionBindingParams): Promise<void> {
    return this.#requireConnection().reducers.setActionBinding(params);
  }

  assignMission(params: AssignMissionParams): Promise<void> {
    return this.#requireConnection().reducers.assignMission(params);
  }

  assignUnit(params: AssignUnitParams): Promise<void> {
    return this.#requireConnection().reducers.assignUnit(params);
  }

  cancelMission(params: CancelMissionParams): Promise<void> {
    return this.#requireConnection().reducers.cancelMission(params);
  }

  claimExecution(params: ClaimExecutionParams): Promise<void> {
    return this.#requireConnection().reducers.claimExecution(params);
  }

  configureAgent(params: ConfigureAgentParams): Promise<void> {
    return this.#requireConnection().reducers.configureAgent(params);
  }

  createMission(params: CreateMissionParams): Promise<void> {
    return this.#requireConnection().reducers.createMission(params);
  }

  finishExecution(params: FinishExecutionParams): Promise<void> {
    return this.#requireConnection().reducers.finishExecution(params);
  }

  pauseAgent(params: PauseAgentParams): Promise<void> {
    return this.#requireConnection().reducers.pauseAgent(params);
  }

  reconcileExecution(params: ReconcileExecutionParams): Promise<void> {
    return this.#requireConnection().reducers.reconcileExecution(params);
  }

  reconcileMission(params: ReconcileMissionParams): Promise<void> {
    return this.#requireConnection().reducers.reconcileMission(params);
  }

  recordObjectiveProgress(params: RecordObjectiveProgressParams): Promise<void> {
    return this.#requireConnection().reducers.recordObjectiveProgress(params);
  }

  rejectObjectiveFinding(params: RejectObjectiveFindingParams): Promise<void> {
    return this.#requireConnection().reducers.rejectObjectiveFinding(params);
  }

  reportControl(params: ReportControlParams): Promise<void> {
    return this.#requireConnection().reducers.reportControl(params);
  }

  requestExecution(params: RequestExecutionParams): Promise<void> {
    return this.#requireConnection().reducers.requestExecution(params);
  }

  requestExecutionCancel(params: RequestExecutionCancelParams): Promise<void> {
    return this.#requireConnection().reducers.requestExecutionCancel(params);
  }

  revokeMission(params: RevokeMissionParams): Promise<void> {
    return this.#requireConnection().reducers.revokeMission(params);
  }

  readEventHistory(params: ReadEventHistoryArgs): Promise<ReadEventHistoryResult> {
    return this.#requireConnection().procedures.readEventHistory(params);
  }

  readGeometryDetail(params: ReadGeometryDetailArgs): Promise<ReadGeometryDetailResult> {
    return this.#requireConnection().procedures.readGeometryDetail(params);
  }

  readMapHistory(params: ReadMapHistoryArgs): Promise<ReadMapHistoryResult> {
    return this.#requireConnection().procedures.readMapHistory(params);
  }

  readObservationDetail(params: ReadObservationDetailArgs): Promise<ReadObservationDetailResult> {
    return this.#requireConnection().procedures.readObservationDetail(params);
  }

  readObservationHistory(params: ReadObservationHistoryArgs): Promise<ReadObservationHistoryResult> {
    return this.#requireConnection().procedures.readObservationHistory(params);
  }

  readSpatialFrameDetail(params: ReadSpatialFrameDetailArgs): Promise<ReadSpatialFrameDetailResult> {
    return this.#requireConnection().procedures.readSpatialFrameDetail(params);
  }

  #requireConnection(): InstanceType<typeof DbConnection> {
    if (!this.#connection || !this.#connection.isActive) throw new Error("world_client_not_connected");
    return this.#connection;
  }

  #buildConnection(callbacks: WorldConnectionCallbacks): WorldConnection {
    const builder = DbConnection.builder()
      .withUri(this.#options.uri)
      .withDatabaseName(this.#options.databaseName)
      .withConfirmedReads(true)
      .onConnect((connection) => callbacks.onConnect(connection))
      .onConnectError((_context, error) => callbacks.onConnectError(error))
      .onDisconnect((_context, error) => callbacks.onDisconnect(error));
    if (this.#options.token) builder.withToken(this.#options.token);
    return builder.build();
  }

  #readSnapshot(connection: WorldConnection): CurrentWorldSnapshot {
    return {
      readiness: Array.from(connection.db.readiness, (row) => detach(row)),
      addressedMessages: Array.from(connection.db.addressedMessages, (row) => detach(row)),
      assignedMissions: Array.from(connection.db.assignedMissions, (row) => detach(row)),
      relevantActionBindings: Array.from(connection.db.relevantActionBindings, (row) => detach(row)),
      relevantAgents: Array.from(connection.db.relevantAgents, (row) => detach(row)),
      relevantEntities: Array.from(connection.db.relevantEntities, (row) => detach(row)),
      relevantExecutions: Array.from(connection.db.relevantExecutions, (row) => detach(row)),
      relevantFeedbackWatermarks: Array.from(connection.db.relevantFeedbackWatermarks, (row) => detach(row)),
      relevantGeometry: Array.from(connection.db.relevantGeometry, (row) => detach(row)),
      relevantLocalMaps: Array.from(connection.db.relevantLocalMaps, (row) => detach(row)),
      relevantMissionAgents: Array.from(connection.db.relevantMissionAgents, (row) => detach(row)),
      relevantMissionObjectiveProgress: Array.from(connection.db.relevantMissionObjectiveProgress, (row) => detach(row)),
      relevantPoses: Array.from(connection.db.relevantPoses, (row) => detach(row)),
      relevantSemantic: Array.from(connection.db.relevantSemantic, (row) => detach(row)),
      relevantUnitAssignments: Array.from(connection.db.relevantUnitAssignments, (row) => detach(row)),
      relevantUnitControls: Array.from(connection.db.relevantUnitControls, (row) => detach(row)),
    };
  }

  #bindSnapshotEvents(connection: WorldConnection): void {
    const tables = [
      connection.db.readiness,
      connection.db.addressedMessages,
      connection.db.assignedMissions,
      connection.db.relevantActionBindings,
      connection.db.relevantAgents,
      connection.db.relevantEntities,
      connection.db.relevantExecutions,
      connection.db.relevantFeedbackWatermarks,
      connection.db.relevantGeometry,
      connection.db.relevantLocalMaps,
      connection.db.relevantMissionAgents,
      connection.db.relevantMissionObjectiveProgress,
      connection.db.relevantPoses,
      connection.db.relevantSemantic,
      connection.db.relevantUnitAssignments,
      connection.db.relevantUnitControls,
    ];
    for (const rawTable of tables) {
      const table = rawTable as unknown as ObservableClientTable;
      const onChange = (): void => this.#queueSnapshotNotification();
      const callback = onChange as RowEventCallback;
      table.onInsert(callback);
      table.onDelete(callback);
      const supportsUpdate = Boolean(table.onUpdate && table.removeOnUpdate);
      if (supportsUpdate) table.onUpdate?.(callback);
      this.#rowListenerRemovers.push(() => {
        table.removeOnInsert(callback);
        table.removeOnDelete(callback);
        if (supportsUpdate) table.removeOnUpdate?.(callback);
      });
    }
  }

  #clearRowListeners(): void {
    for (const remove of this.#rowListenerRemovers.splice(0)) remove();
  }

  #stopSubscription(): void {
    const subscription = this.#subscription;
    this.#subscription = undefined;
    this.#clearRowListeners();
    if (subscription && !subscription.isEnded()) subscription.unsubscribe();
  }

  #queueSnapshotNotification(): void {
    if (!this.#ready || this.#snapshotNotificationQueued) return;
    this.#snapshotNotificationQueued = true;
    queueMicrotask(() => {
      this.#snapshotNotificationQueued = false;
      if (!this.#ready || !this.#connection?.isActive) return;
      this.#options.onSnapshotChange?.(this.#readSnapshot(this.#connection));
    });
  }

  #setState(state: ConnectionState, error?: Error): void {
    this.#state = state;
    this.#options.onStateChange?.(state, error);
  }
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function detach<T>(value: T, seen = new WeakMap<object, unknown>()): T {
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Timestamp) return new Timestamp(value.microsSinceUnixEpoch) as T;
  if (value instanceof Identity) return new Identity(value.toHexString()) as T;
  if (value instanceof Date) return new Date(value.getTime()) as T;
  const object = value as object;
  const previous = seen.get(object);
  if (previous) throw new TypeError("cannot detach cyclic row");
  if (Array.isArray(value)) {
    seen.set(object, value);
    try {
      return value.map((item) => detach(item, seen)) as T;
    } finally {
      seen.delete(object);
    }
  }
  seen.set(object, value);
  try {
    const detached: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) detached[key] = detach(nested, seen);
    return detached as T;
  } finally {
    seen.delete(object);
  }
}
