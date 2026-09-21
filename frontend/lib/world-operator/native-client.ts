import { WorldClient, type CurrentWorldSnapshot } from "@nemeia/world-client/src/index.ts";
import type {
  NativeOperatorClient,
  NativeOperatorInputs,
  NativeOperatorOperation,
  OperatorEventPage,
  OperatorProjection,
  OperatorResourceContext,
  OperatorResourceReference
} from "../../types/operator";
import { ResourceReadFailure } from "./resource-read-policy";
import { projectionFromSnapshot } from "./generated-projection";

export const EMPTY_OPERATOR_PROJECTION: OperatorProjection = {
  operatorIdentity: null,
  agents: [],
  events: [],
  feedbackWatermarks: [],
  executions: [],
  evidence: [],
  findings: [],
  maps: [],
  missions: [],
  readiness: {
    authorized: false,
    mode: "unknown",
    role: "anonymous",
    synchronized: false,
    unitId: null,
    worldId: "unknown"
  },
  units: []
};

/** Keep the operator surface limited to generated mission authority reducers. */
const SUPPORTED_OPERATIONS = new Set<NativeOperatorOperation>([
  "assignMission",
  "assignUnit",
  "cancelMission",
  "createMission",
  "rejectObjectiveFinding",
  "reconcileMission",
  "recordObjectiveProgress"
]);

type WorldClientConfig = {
  databaseName: string;
  uri: string;
};

/**
 * Frontend-owned adapter around the canonical generated DbConnection. It is
 * intentionally constructed here, not installed by world-client on window.
 * The browser only connects when explicit loopback URI/database configuration
 * and a manually supplied operator token are present. The token stays in this
 * module's memory and is never read from a public build variable, URL, or log.
 * World membership/role remains server-authoritative in readiness.
 */
export function createNativeOperatorClient(): NativeOperatorClient | null {
  if (typeof window === "undefined") { return null; }
  const config = readWorldClientConfig();
  return config ? new GeneratedNativeOperatorClient(config) : null;
}

let operatorToken: string | null = null;

export function setOperatorToken(token: string): void {
  operatorToken = token.trim() || null;
}

export function clearOperatorToken(): void {
  operatorToken = null;
}

export async function fetchAuthorizedResourceReferences(context: OperatorResourceContext): Promise<OperatorResourceReference[]> {
  const response = await fetch("/api/world/resources/references", {
    body: JSON.stringify({ context }),
    cache: "no-store",
    headers: authorizedResourceHeaders(),
    method: "POST"
  });
  if (!response.ok) { throw new ResourceReadFailure("resource_references_unavailable", response.status); }
  const value: unknown = await response.json();
  if (!isRecord(value) || !Array.isArray(value.references) || !value.references.every(isResourceReference)) {
    throw new ResourceReadFailure("invalid_resource_references_response", 502);
  }
  return value.references;
}

export async function fetchAuthorizedResourceBytes(input: { context: OperatorResourceContext; resource: OperatorResourceReference; offset: number; length: number }): Promise<Response> {
  const response = await fetch("/api/world/resources/read", {
    body: JSON.stringify(input),
    cache: "no-store",
    headers: authorizedResourceHeaders(),
    method: "POST"
  });
  if (!response.ok) { throw new ResourceReadFailure("resource_bytes_unavailable", response.status); }
  return response;
}

class GeneratedNativeOperatorClient implements NativeOperatorClient {
  readonly supports = (operation: NativeOperatorOperation): boolean => SUPPORTED_OPERATIONS.has(operation);
  #worldClient: WorldClient | undefined;
  #handlers: Parameters<NativeOperatorClient["subscribe"]>[0] | undefined;
  #stopRequested = false;
  private readonly config: WorldClientConfig;

  constructor(config: WorldClientConfig) {
    this.config = config;
  }

  subscribe(handlers: Parameters<NativeOperatorClient["subscribe"]>[0]) {
    this.#handlers = handlers;
    this.#stopRequested = false;
    handlers.onStatus("connecting");
    this.#worldClient = new WorldClient({
      databaseName: this.config.databaseName,
      onSnapshotChange: (snapshot) => this.publishProjection(snapshot),
      onStateChange: (state, error) => {
        if (this.#stopRequested) { return; }
        if (state === "connecting") { handlers.onStatus("connecting"); }
        if (state === "disconnected") { handlers.onStatus("disconnected"); }
        if (state === "error") { handlers.onError(error ?? new Error("world_client_error")); }
      },
      token: operatorToken ?? undefined,
      uri: this.config.uri
    });
    this.#worldClient.connect();
    this.#worldClient.subscribeCurrentWorld((snapshot) => this.publishProjection(snapshot));

    return { unsubscribe: () => this.disconnect() };
  }

  async call<Operation extends NativeOperatorOperation>(operation: Operation, input: NativeOperatorInputs[Operation]): Promise<boolean> {
    if (!this.supports(operation)) {
      throw new Error(`native_operation_not_generated:${operation}`);
    }
    const connection = this.#worldClient?.connection;
    if (!connection || !connection.isActive) { throw new Error("world_client_not_connected"); }
    const readiness = this.#worldClient?.snapshot().readiness[0];
    if (!readiness?.authorized || !readiness.synchronized || !["world_operator", "admin"].includes(readiness.role)) {
      throw new Error("world_client_not_authorized");
    }
    switch (operation) {
      case "assignMission": await connection.reducers.assignMission(input as NativeOperatorInputs["assignMission"]); break;
      case "assignUnit": await connection.reducers.assignUnit(input as NativeOperatorInputs["assignUnit"]); break;
      case "cancelMission": await connection.reducers.cancelMission(input as NativeOperatorInputs["cancelMission"]); break;
      case "createMission": await connection.reducers.createMission(input as NativeOperatorInputs["createMission"]); break;
      case "rejectObjectiveFinding": await connection.reducers.rejectObjectiveFinding(input as NativeOperatorInputs["rejectObjectiveFinding"]); break;
      case "reconcileMission": await connection.reducers.reconcileMission(input as NativeOperatorInputs["reconcileMission"]); break;
      case "recordObjectiveProgress": await connection.reducers.recordObjectiveProgress(input as NativeOperatorInputs["recordObjectiveProgress"]); break;
    }
    return true;
  }

  async readEvents(subjectId: string, afterSequence: string): Promise<OperatorEventPage> {
    const connection = this.#worldClient?.connection;
    if (!connection || !connection.isActive) { throw new Error("world_client_not_connected"); }
    const page = await connection.procedures.readEventHistory({ afterSequence: BigInt(afterSequence), limit: 128, subjectId });
    return {
      events: page.rows.map((row) => ({
        detail: row.detail,
        id: row.id,
        kind: row.kind,
        recordedAt: row.recordedAt.toISOString(),
        sequence: row.sequence.toString(10),
        subjectId: row.subjectId,
      })),
      historyGap: page.historyGap,
      nextSequence: page.nextSequence.toString(10),
    };
  }

  private disconnect(): void {
    this.#stopRequested = true;
    this.#worldClient?.disconnect();
    this.#worldClient = undefined;
  }

  private publishProjection(snapshot: CurrentWorldSnapshot): void {
    const handlers = this.#handlers;
    if (!handlers) { return; }
    const projection = projectionFromSnapshot(snapshot, this.#worldClient?.connection?.identity?.toHexString() ?? null);
    const readiness = projection.readiness;
    handlers.onProjection(projection);
    if (!readiness.synchronized) {
      handlers.onStatus("connecting");
    } else if (readiness.authorized && (readiness.role === "world_operator" || readiness.role === "admin")) {
      handlers.onStatus("authenticated");
    } else {
      handlers.onStatus("forbidden");
    }
  }
}

function readWorldClientConfig(): WorldClientConfig | null {
  const uri = process.env.NEXT_PUBLIC_NEMEIA_SPACETIMEDB_URI;
  const databaseName = process.env.NEXT_PUBLIC_NEMEIA_SPACETIMEDB_DATABASE;
  if (!uri || !databaseName || !operatorToken || !isLoopbackUri(uri)) { return null; }
  return { databaseName, uri };
}

function isLoopbackUri(uri: string): boolean {
  try {
    return new Set(["127.0.0.1", "::1", "localhost"]).has(new URL(uri).hostname);
  } catch {
    return false;
  }
}

function authorizedResourceHeaders(): HeadersInit {
  if (!operatorToken) { throw new ResourceReadFailure("operator_token_required", 401); }
  return { Authorization: `Bearer ${operatorToken}`, "Content-Type": "application/json" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isResourceReference(value: unknown): value is OperatorResourceReference {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.schema === "string"
    && typeof value.sha256 === "string"
    && typeof value.byteLength === "string";
}
