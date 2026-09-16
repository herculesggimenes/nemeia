/** Nemeia protocol — canonical implementation target, not a claim of implementation.
 * Normative behavior: docs/protocol.md. Browser rendering reads these regions.
 */

// region common
export type Id = string; // opaque, globally unique identity; never derive an entity ID from its label
export type Cursor = string; // opaque position in one world's journal; compare for equality only
export type Timestamp = string; // RFC 3339 UTC with milliseconds; reject invalid or future evidence times
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }; // finite JSON only
export type SchemaRef = { name: string; version: number }; // exact registered payload schema
export type PackageRef = { name: string; version: string; sha256: string }; // immutable implementation pin
export type Source = { instanceId: Id; package: PackageRef }; // authenticated producer instance and code
export type Problem = {
  type: string; // RFC 9457 problem-type URI; stable machine-readable meaning
  title: string; // short name for this problem type
  status: number; // HTTP status; 400, 401, 403, 404, 409, 500, 503, or 504
  detail: string; // occurrence-specific explanation; never parse for behavior
  instance?: string; // URI identifying this failure occurrence
}; // application/problem+json; use extensions only when a consumer needs them
export type Result<T> = { ok: true; value: T } | { ok: false; error: Problem }; // SDK result; HTTP maps errors to status
export type RequestContext = { principalId: Id; source: Source }; // supplied by the authenticated host, never JSON input
// endregion

// region geometry
export type Vec2 = [number, number]; // finite x, y
export type Vec3 = [number, number, number]; // finite x, y, z
export type Quaternion = [number, number, number, number]; // x, y, z, w; unit length within 1e-6
export type Pose3 = { positionM: Vec3; orientation: Quaternion }; // position and rotation in the containing frame
export type SpatialGeometry =
  | { kind: "box3"; frameId: Id; pose: Pose3; sizeM: Vec3 } // full positive extents, rotated about the center
  | { kind: "pointCloud"; frameId: Id; resource: ResourceRef } // encoding and layout declared by the resource schema
  | { kind: "mesh"; frameId: Id; pose: Pose3; resource: ResourceRef }; // local vertices transformed by pose
export type ImageBox = {
  kind: "box2"; frame: FrameRef; centerPx: Vec2; sizePx: Vec2; angleRad: number;
}; // belongs to a particular image; cannot be used as a 3D obstacle
export type Geometry = SpatialGeometry | ImageBox; // closed union; unknown geometry fails validation
export type TransformSample = {
  parentFrameId: Id; childFrameId: Id; observedAt: Timestamp; pose: Pose3;
}; // maps child coordinates into parent; immutable sample retained for replay
// endregion

// region evidence
export type FrameRef = {
  streamId: Id; // identifies the camera, LiDAR, or other source stream
  sessionId: Id; // new identity when the stream restarts
  sequence: number; // non-negative safe integer within the stream session
  capturedAt: Timestamp; // acquisition time in the world's clock domain
}; // sequence is unique within a stream session; frame references do not promise retained bytes
export type ResourceRef = { id: Id; schema: SchemaRef }; // stable stored bytes; resolve through ResourceStore
export type Resource = {
  id: Id; schema: SchemaRef; mediaType: string; byteLength: number; sha256: string;
}; // immutable metadata; no filesystem paths or expiring URLs in durable events
export type Semantic = {
  hypotheses: { label: string; score: number }[]; // scores in [0,1]; model scores are not graspability or geometry certainty
};
export type Sample<T> = { observedAt: Timestamp; value: T }; // separate observation times for independent facets
export type Observation = {
  id: Id; // producer retry identity
  trackId?: string; // scoped to authenticated source.instanceId; association owns entity IDs
  inputs: FrameRef[]; // exact sensor inputs; empty for operator assertions
  retained: ResourceRef[]; // optional retained evidence; [] when frames were not recorded
  supersedes: Id[]; // observation IDs replaced by fusion; no source-name conventions
  transforms: TransformSample[]; // exact samples used to convert frames; [] when no conversion occurred
} & (
  | { semantic: Sample<Semantic>; geometry?: Sample<Geometry> }
  | { semantic?: Sample<Semantic>; geometry: Sample<Geometry> }
); // at least one measured facet; late semantic updates never erase geometry
export type Evidence = {
  observedAt: Timestamp; observationIds: Id[];
}; // freshness is computed against an explicit evaluation time, never persisted as ageMs
export type Association = { observationId: Id; entityId: Id }; // trusted projector decision, recorded so replay never reruns tracking
// endregion

// region world
export type Component<T> = {
  version: number; // owner-assigned positive revision, increased only when the component changes
  value: T; // validated against the installed schema for this component key
  evidence?: Evidence; // required for components derived from observations
};
export interface ComponentValues {
  "core.pose": { frameId: Id; pose: Pose3 };
  "core.geometry": SpatialGeometry;
  "core.semantic": Semantic;
  "core.connection": { state: "offline" | "connecting" | "online" | "fault" };
  "core.motion": { state: "idle" | "busy" | "stopped" | "fault" };
  "core.power": { batteryPct: number | null }; // null is unknown; zero is an actual reading
  "core.sensor": { streams: StreamDescriptor[] };
}
export type Components = { [K in keyof ComponentValues]?: Component<ComponentValues[K]> }; // extend through a registered package
export type Entity = {
  id: Id; // assigned by trusted association; survives label changes
  label: string; // human-readable name, never an association key
  components: Components; // typed domain state; presentation is derived separately
}; // semantic classification lives in core.semantic; it does not define physical ability
export type RelationshipKey = { subjectId: Id; predicate: string; objectId: Id }; // structural tuple, never colon concatenation
export type Relationship = RelationshipKey & { evidence?: Evidence }; // both endpoints must exist
export type WorldSnapshot = {
  worldId: Id; // world scope shared by all contained identities and frames
  cursor: Cursor; // resume after this complete committed decision
  entities: Entity[]; // complete current entity state
  relationships: Relationship[]; // directed facts between existing entities
  actions: ActionDefinition[]; // installed meanings; executor selection remains host-owned
}; // detached snapshot at one committed cursor; views add presentation without duplicating domain state
export type ComponentChange = {
  [K in keyof ComponentValues]: { op: "component.set"; entityId: Id; key: K; component: Component<ComponentValues[K]> }
}[keyof ComponentValues]; // value type follows the component key
export type Change =
  | { op: "entity.put"; entity: Entity } // complete replacement; component updates use component.set
  | { op: "entity.remove"; entityId: Id } // atomically removes incident relationships
  | ComponentChange
  | { op: "component.remove"; entityId: Id; key: keyof ComponentValues }
  | { op: "relationship.put"; relationship: Relationship }
  | { op: "relationship.remove"; key: RelationshipKey };
export type WorldDelta = { from: Cursor; to: Cursor; changes: Change[] }; // ordered changes; includes removals
// endregion

// region actions
export type ActionRef = { name: string; version: number }; // one spelling for action meaning; no second verb registry
export type Requirement = {
  component: keyof ComponentValues; maxAgeMs?: number;
}; // presence plus optional freshness; action-specific checks are pure and versioned
export type ActionDefinition = {
  action: ActionRef; // stable action meaning and schema version
  description: string; // intended outcome, independent of executor implementation
  input: SchemaRef; // registered request input schema
  output: SchemaRef; // registered successful result schema
  actor: Requirement[]; // component presence and freshness required on the actor
  target: { kind: "none" } | { kind: "required"; components: Requirement[] }; // cardinality is explicit
};
export type Affordance = {
  action: ActionRef; actorId: Id; targetId?: Id; evaluatedAt: Timestamp; cursor: Cursor;
  availability: { available: true } | { available: false; reasons: string[] };
}; // discovery hint; the service re-evaluates with actual input at dispatch
export type ActionRequest = {
  requestId: Id; action: ActionRef; actorId: Id; targetId?: Id; input: Json;
  expectedCursor?: Cursor; // optional optimistic check against the exact world the caller saw
}; // identity and authority come from RequestContext; clients cannot submit bindings or grants
export type ComponentPin = { entityId: Id; component: keyof ComponentValues; version: number };
export type Execution = {
  id: Id; request: ActionRequest; executor: PackageRef; mode: "state" | "physical";
  binding: ComponentPin[]; createdAt: Timestamp;
} & (
  | { state: "awaitingApproval" | "accepted" | "running" | "cancelling" }
  | { state: "succeeded"; finishedAt: Timestamp; output: Json }
  | { state: "rejected" | "failed"; finishedAt: Timestamp; error: Problem }
  | { state: "cancelled"; finishedAt: Timestamp; reason: string }
); // one attempt identity throughout; accepted is not completed
export type ApproachInput = { standoffM: number }; // positive ground-plane distance to target center; path clearance is a separate check
export type ApproachOutput = { distanceM: number; observationId: Id }; // measured completion evidence
// endregion

// region events
export type EventPayloads = {
  "dev.nemeia.world.changed.v1": { changes: Change[]; associations: Association[] };
  "dev.nemeia.observation.recorded.v1": { observation: Observation };
  "dev.nemeia.execution.changed.v1": { execution: Execution };
  "dev.nemeia.control.reported.v1": { executionId: Id; report: ControlReport };
  "dev.nemeia.extension.recorded.v1": { schema: SchemaRef; value: Json };
}; // Nemeia defines payloads; CloudEvents defines the envelope
export type NewEvent = {
  [K in keyof EventPayloads]: {
    specversion: "1.0"; id: Id; source: string; type: K; time: Timestamp;
    subject?: string; datacontenttype: "application/json";
    data: EventPayloads[K] & { worldId: Id; producer: PackageRef; causes: Id[] };
  }
}[keyof EventPayloads]; // CloudEvents 1.0 JSON; source is a URI, causes are globally unique event IDs
export type Event = { cursor: Cursor; recordedAt: Timestamp; event: NewEvent }; // journal wrapper is not a CloudEvent extension
export type EventPage = { items: Event[]; next: Cursor; hasMore: boolean }; // next also advances over filtered-out events
export type EventQuery = { after: Cursor; limit: number; types?: (keyof EventPayloads)[] }; // world scope is fixed by the service
// endregion

// region world-service
export interface WorldService {
  snapshot(context: RequestContext): Promise<Result<WorldSnapshot>>; // atomically return authorized state and its resume cursor
  changes(after: Cursor, context: RequestContext): Promise<Result<WorldDelta>>; // return changes or cursor-expired error; never silently restart
  affordances(input: { actorId: Id; targetId?: Id }, context: RequestContext): Promise<Result<Affordance[]>>; // derive possibilities from current components
  dispatch(request: ActionRequest, context: RequestContext): Promise<Result<Execution>>; // validate, record, then start once
  execution(id: Id, context: RequestContext): Promise<Result<Execution>>; // read current attempt state
  cancel(id: Id, context: RequestContext): Promise<Result<Execution>>; // idempotently request cancellation
  events(query: EventQuery, context: RequestContext): Promise<Result<EventPage>>; // poll the durable sequence with access scope
}
// endregion

// region observation-sink
export interface ObservationSink {
  ingest(observation: Observation, context: RequestContext): Promise<Result<{ eventId: Id }>>; // deduplicate then record evidence
}
export interface WorldWriter {
  commit(input: { requestId: Id; expectedCursor: Cursor; causes: Id[]; changes: Change[]; associations: Association[] }, context: RequestContext): Promise<Result<WorldDelta>>; // atomically commit changes and association decisions; [] when unrelated to perception
} // trusted systems only; validate the entire batch before state, events, and cursor commit together
// endregion

// region executor
export type ExecutorContext = {
  execution: Execution; snapshot: WorldSnapshot; signal: AbortSignal;
  control?: ControlSession; // only the host can acquire this scoped physical authority
  frames: AsyncIterable<SensorFrame>; // bounded latest-frame buffers; host enforces sensor permissions
};
export type ExecutorUpdate =
  | { type: "observation"; observation: Observation }
  | { type: "progress"; value: Json }; // advisory data; never direct state mutation or terminal execution state
export type ExecutorResult =
  | { kind: "state"; changes: Change[]; output: Json }
  | { kind: "physical"; output: Json }; // measured world changes arrive independently through observation ingestion
export interface ActionExecutor {
  readonly package: PackageRef; // pin implementation independently of action meaning
  readonly mode: "state" | "physical"; // binding selects transactional changes or local physical control
  run(context: ExecutorContext, emit: (update: ExecutorUpdate) => Promise<void>): Promise<ExecutorResult>; // run once; emit bounded progress/evidence and return one terminal result
} // host captures the result, termination, and cancellation; no generator return value to lose
// endregion

// region streams
export type StreamDescriptor = {
  id: Id; kind: "image" | "pointCloud" | "audio" | "telemetry"; schema: SchemaRef;
  frameId?: Id; // required for spatial data; separate from stream identity
}; // audio sample rate and image dimensions belong to the stream payload schema
export type SensorFrame = {
  ref: FrameRef; schema: SchemaRef; data: Uint8Array; // process-local payload; not a JSON event
};
export type RobotStatus = {
  robotId: Id; receivedAt: Timestamp; // last actual device sample, never the time status() was called
  connection: "online" | "offline" | "fault";
  safeState: "unknown" | "entering" | "confirmed" | "failed";
};
export type Velocity = { vxMps: number; vyMps: number; yawRadps: number }; // planar motion, finite fields; radians/sec is explicit
export type DriverCommand =
  | { kind: "velocity"; value: Velocity }
  | { kind: "native"; name: string; input: Json; deadlineMs: number };
export type DriverAck = {
  command: DriverCommand; sentAt: Timestamp; // actual command sent after any driver-level restriction
  confirmation: "sent" | "deviceAck"; // neither proves a semantic goal was achieved
};
export interface RobotDriver {
  readonly package: PackageRef; // immutable driver implementation pin
  readonly streams: StreamDescriptor[]; // available sensor channels and payload schemas
  connect(): Promise<Result<RobotStatus>>; // vendor configuration stays in the adapter
  disconnect(): Promise<void>; // stop before disconnecting an active controller
  status(): Promise<RobotStatus>; // cached normalized device evidence with an honest timestamp
  frames(streamId: Id, signal: AbortSignal): AsyncIterable<SensorFrame>; // disconnect ends the iterator
  command(command: DriverCommand): Promise<Result<DriverAck>>; // only the local control gate invokes this
  safeState(): Promise<Result<RobotStatus>>; // dedicated path, independent of world, journal, and agent
}
// endregion

// region control
export type ControlLimits = {
  maxLinearMps: number; maxYawRadps: number; watchdogMs: number; maxDurationMs: number;
}; // finite positive bounds intersected with device and local limits
export type ControlAdmission = {
  executionId: Id; robotId: Id; executor: PackageRef; limits: ControlLimits;
}; // trusted host input after policy; never client JSON or executor-provided authority
export type ControlReport =
  | { kind: "sent"; sessionId: Id; sequence: number; requested: Velocity; sent: Velocity; confirmation: "sent" | "deviceAck" }
  | { kind: "closed"; sessionId: Id; cause: "finished" | "cancelled" | "watchdog" | "deadline" | "fault"; safeState: RobotStatus["safeState"] }
  | { kind: "stop"; latch: "set" | "clear"; safeState: RobotStatus["safeState"] };
export type StopReceipt = { latched: boolean; safeState: RobotStatus["safeState"]; recordedAt: Timestamp };
export interface ControlSession {
  readonly id: Id; // local session identity; invalid after close or controller restart
  submit(sequence: number, value: Velocity): Promise<Result<ControlReport>>; // sequence starts at 1; ack follows dispatch to driver
  close(reason: "finished" | "cancelled"): Promise<Result<ControlReport>>; // idempotently enter safe state and revoke session
}
export interface ControlGate {
  open(admission: ControlAdmission): Promise<Result<ControlSession>>; // one active session per robot; no hidden queue
  stop(robotId: Id): Promise<StopReceipt>; // latch immediately and trigger safe state; independent of storage availability
  clearStop(robotId: Id, context: RequestContext): Promise<Result<StopReceipt>>; // operator-only; never restarts motion
}
// endregion

// region journal
export type Commit = {
  requestId: Id; principalId: Id; operation: string; fingerprint: string;
  expectedCursor: Cursor; events: NewEvent[]; response: Json;
}; // request reservation, full decision, and original response form one transaction
export interface Journal {
  commit(input: Commit): Promise<Result<{ cursor: Cursor; response: Json }>>; // same ID + fingerprint returns the original commit
  read(query: EventQuery): Promise<Result<EventPage>>; // world-scoped, exclusive cursor, ascending commit order
}
export interface ResourceStore {
  put(input: { schema: SchemaRef; mediaType: string; bytes: Uint8Array }): Promise<Result<Resource>>; // persist before returning reference
  describe(id: Id): Promise<Result<Resource>>; // metadata or explicit unavailable/expired result
  read(id: Id): Promise<Result<Uint8Array>>; // retention policy may remove bytes without erasing provenance
}
// endregion

// region governance
export type AdmissionDecision =
  | { kind: "allow" }
  | { kind: "deny"; error: Problem }
  | { kind: "approvalRequired"; expiresAt: Timestamp };
export interface AdmissionPolicy {
  evaluate(request: ActionRequest, snapshot: WorldSnapshot, context: RequestContext): Promise<AdmissionDecision>; // decide admission using current evidence and authenticated caller
} // optional module; approval repeats current checks before acceptance; it does not duplicate execution state
export type ApprovalRequest = { requestId: Id; executionId: Id; decision: "approve" | "reject"; reason: string };
export interface ApprovalService {
  decide(request: ApprovalRequest, context: RequestContext): Promise<Result<Execution>>; // same attempt; server authenticates approver
}
export type RemoteGrantClaims = {
  iss: string; aud: string; jti: Id; iat: number; exp: number; // JWT claims; times are NumericDate seconds
  executionId: Id; robotId: Id; executor: PackageRef; epoch: Id; limits: ControlLimits;
}; // Nemeia's private claims bind admission to a particular controller and execution
export type RemoteGrant = string; // compact JWS JWT, EdDSA/Ed25519 via JOSE library; protected header carries kid and typ
// endregion
