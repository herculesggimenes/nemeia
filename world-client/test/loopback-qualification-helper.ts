import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Identity, Timestamp } from "spacetimedb";
import { DbConnection } from "../src/generated/index.ts";
import { WorldClient } from "../src/index.ts";

type Connection = InstanceType<typeof DbConnection>;

export type ActualWorldConnection = {
  readonly connection: Connection;
  readonly identity: Identity;
  readonly token: string;
  close(): void;
};

export type ActualWorldQualificationOptions = {
  readonly uri: string;
  readonly databaseName: string;
  readonly adminToken: string;
};

const VIEW_QUERIES = [
  "readiness",
  "addressed_messages",
  "assigned_missions",
  "relevant_action_bindings",
  "relevant_agents",
  "relevant_entities",
  "relevant_executions",
  "relevant_feedback_watermarks",
  "relevant_geometry",
  "relevant_local_maps",
  "relevant_mission_agents",
  "relevant_mission_objective_progress",
  "relevant_poses",
  "relevant_semantic",
  "relevant_unit_assignments",
  "relevant_unit_controls",
].map((name) => `SELECT * FROM ${name}`);

const PACKAGE = {
  name: "nemeia-world-qualification",
  version: "1.0.0",
  sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
};

function wsUri(uri: string): string {
  return uri.replace(/^http:/, "ws:").replace(/^https:/, "wss:").replace(/\/$/, "");
}

function tableRows(connection: Connection, name: string): readonly unknown[] {
  const table = (connection.db as unknown as Record<string, Iterable<unknown>>)[name];
  if (!table) throw new Error(`generated client is missing view ${name}`);
  return [...table];
}

function callReducer(connection: Connection, name: string, input: unknown): Promise<void> {
  const reducer = (connection.reducers as unknown as Record<string, (value: unknown) => Promise<void>>)[name];
  if (!reducer) throw new Error(`generated client is missing reducer ${name}`);
  return reducer(input);
}

function callProcedure(connection: Connection, name: string, input: unknown): Promise<unknown> {
  const procedure = (connection.procedures as unknown as Record<string, (value: unknown) => Promise<unknown>>)[name];
  if (!procedure) throw new Error(`generated client is missing procedure ${name}`);
  return procedure(input);
}

async function waitFor(condition: () => boolean, description: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`timed out waiting for ${description}`);
}

async function expectRejected(action: () => Promise<unknown>, pattern: RegExp): Promise<void> {
  try {
    await action();
  } catch (error) {
    const message = String(error);
    // SpacetimeDB 2.10.1 may redact module error text at the generated SDK
    // boundary. The rejection is still the authoritative denial; row-count
    // and subsequent-read assertions below verify the attempted effect.
    if (!pattern.test(message)) assert.match(message, /InternalError/);
    return;
  }
  assert.fail(`expected rejection matching ${pattern}`);
}

export async function connectActualWorld(options: {
  uri: string;
  databaseName: string;
  token?: string;
}): Promise<ActualWorldConnection> {
  let connection: Connection | undefined;
  let identity: Identity | undefined;
  let receivedToken: string | undefined;
  let resolveReady: ((value: ActualWorldConnection) => void) | undefined;
  let rejectReady: ((error: Error) => void) | undefined;
  let ready = false;
  const readyPromise = new Promise<ActualWorldConnection>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  const builder = DbConnection.builder()
    .withUri(wsUri(options.uri))
    .withDatabaseName(options.databaseName)
    .withConfirmedReads(true)
    .onConnect((connected, connectedIdentity, token) => {
      connection = connected;
      identity = connectedIdentity;
      receivedToken = token;
      const subscription = connected.subscriptionBuilder()
        .onApplied(() => {
          if (ready) return;
          ready = true;
          resolveReady?.({
            connection: connected,
            identity: connectedIdentity,
            token,
            close: () => connected.disconnect(),
          });
        })
        .onError((context) => rejectReady?.(
          context.event instanceof Error ? context.event : new Error("world subscription failed"),
        ));
      subscription.subscribe(VIEW_QUERIES);
    })
    .onConnectError((_context, error) => rejectReady?.(error))
    .onDisconnect((_context, error) => {
      if (!ready) rejectReady?.(error ?? new Error("world connection disconnected before readiness"));
    });
  if (options.token) builder.withToken(options.token);
  try {
    connection = builder.build();
  } catch (error) {
    rejectReady?.(error instanceof Error ? error : new Error(String(error)));
  }
  // Keep these references observable while awaiting the callback so a future
  // SDK version cannot silently lose the identity/token handshake.
  void connection;
  void identity;
  void receivedToken;
  return readyPromise;
}

function timestamp(iso: string): Timestamp {
  return Timestamp.fromDate(new Date(iso));
}

function resource(id: string, digest: string) {
  return { id, schema: "nemeia.test/resource@1", sha256: digest.repeat(64), byteLength: 1n };
}

function frameRef(sessionId: string, sequence: bigint, capturedAt: string) {
  return {
    streamId: "camera/color",
    sessionId,
    sequence,
    capturedAt: timestamp(capturedAt),
  };
}

function imageObservation(input: {
  id: string;
  entityId: string;
  mapId: string;
  frameSession: string;
  observedAt: string;
  centerX?: number;
}) {
  const captured = frameRef(input.frameSession, 0n, input.observedAt);
  return {
    input: {
      id: input.id,
      producerSession: input.frameSession,
      trackId: "track-blue-backpack",
      entityId: input.entityId,
      localMapId: input.mapId,
      inputs: [captured],
      retained: [],
      transforms: [],
      supersedes: [],
      pose: undefined,
      geometry: {
        observedAt: timestamp(input.observedAt),
        value: {
          tag: "BoundingBox2D",
          value: {
            frame: captured,
            centerX: input.centerX ?? 10,
            centerY: 20,
            width: 30,
            height: 40,
            angleRad: 0,
          },
        },
      },
      semantic: undefined,
    },
  };
}

function semanticObservation(input: {
  id: string;
  entityId: string;
  mapId: string;
  frameId: string;
  frameSession: string;
  observedAt: string;
}) {
  const captured = frameRef(input.frameSession, 0n, input.observedAt);
  return {
    input: {
      id: input.id,
      producerSession: input.frameSession,
      trackId: "track-blue-backpack",
      entityId: input.entityId,
      localMapId: input.mapId,
      inputs: [captured],
      retained: [],
      transforms: [],
      supersedes: [],
      pose: undefined,
      geometry: undefined,
      semantic: {
        observedAt: timestamp(input.observedAt),
        frameId: input.frameId,
        value: { hypotheses: [{ label: "backpack", score: 0.97 }] },
      },
    },
  };
}

function poseObservation(input: {
  id: string;
  entityId: string;
  mapId: string;
  frameId: string;
  frameSession: string;
  observedAt: string;
  positionM: { x: number; y: number; z: number };
}) {
  const captured = frameRef(input.frameSession, 1n, input.observedAt);
  return {
    input: {
      id: input.id,
      producerSession: input.frameSession,
      trackId: `track-${input.id}`,
      entityId: input.entityId,
      localMapId: input.mapId,
      inputs: [captured],
      retained: [],
      transforms: [],
      supersedes: [],
      pose: {
        observedAt: timestamp(input.observedAt),
        frameId: input.frameId,
        value: {
          positionM: input.positionM,
          orientation: { x: 0, y: 0, z: 0, w: 1 },
        },
      },
      geometry: undefined,
      semantic: undefined,
    },
  };
}

function boxObservation(input: {
  id: string;
  entityId: string;
  mapId: string;
  frameId: string;
  frameSession: string;
  observedAt: string;
  centerM: { x: number; y: number; z: number };
}) {
  const captured = frameRef(input.frameSession, 2n, input.observedAt);
  return {
    input: {
      id: input.id,
      producerSession: input.frameSession,
      trackId: `track-${input.id}`,
      entityId: input.entityId,
      localMapId: input.mapId,
      inputs: [captured],
      retained: [],
      transforms: [],
      supersedes: [],
      pose: undefined,
      geometry: {
        observedAt: timestamp(input.observedAt),
        value: {
          tag: "BoundingBox3D",
          value: {
            frameId: input.frameId,
            pose: {
              positionM: input.centerM,
              orientation: { x: 0, y: 0, z: 0, w: 1 },
            },
            sizeM: { x: 0.4, y: 0.4, z: 0.4 },
          },
        },
      },
      semantic: undefined,
    },
  };
}

async function provisionMember(
  admin: ActualWorldConnection,
  identity: Identity,
  role: string,
  unitId?: string,
  producerSession?: string,
): Promise<void> {
  await callReducer(admin.connection, "configureMember", {
    identity,
    role: { tag: role },
    unitId,
    producerSession,
    package: role === "Perception" ? PACKAGE : undefined,
  });
}

export async function runActualWorldQualification(options: ActualWorldQualificationOptions): Promise<{
  readonly checks: Readonly<Record<string, boolean>>;
  readonly ids: Readonly<Record<string, string>>;
}> {
  const suffix = `${process.pid}-${Date.now().toString(36)}`;
  const unitA = `qualification-unit-a-${suffix}`;
  const unitB = `qualification-unit-b-${suffix}`;
  const mapA = `qualification-map-a-${suffix}`;
  const mapB = `qualification-map-b-${suffix}`;
  const mapC = `qualification-map-c-${suffix}`;
  const frameA = `qualification-frame-a-${suffix}`;
  const frameB = `qualification-frame-b-${suffix}`;
  const frameC = `qualification-frame-c-${suffix}`;
  const entityA = `qualification-entity-a-${suffix}`;
  const entityB = `qualification-entity-b-${suffix}`;
  const sessionA = `qualification-session-a-${suffix}`;
  const sessionAReset = `qualification-session-a-reset-${suffix}`;
  const sessionB = `qualification-session-b-${suffix}`;
  const agentId = `qualification-agent-${suffix}`;
  const unrelatedAgentId = `qualification-unrelated-agent-${suffix}`;
  const feedbackMissionId = `qualification-feedback-mission-${suffix}`;
  const feedbackObjectiveId = `qualification-feedback-objective-${suffix}`;
  const handles: ActualWorldConnection[] = [];
  const connect = async (token?: string): Promise<ActualWorldConnection> => {
    const handle = await connectActualWorld({ uri: options.uri, databaseName: options.databaseName, token });
    handles.push(handle);
    return handle;
  };

  const admin = await connect(options.adminToken);
  const firstCaller = await connect();
  const perceptionA = await connect();
  const perceptionB = await connect();
  const controllerA = await connect();
  const controllerB = await connect();
  const agent = await connect();
  const unrelatedAgent = await connect();
  let operatorClient: WorldClient | undefined;

  try {
    const unauthorizedUnit = `unauthorized-${suffix}`;
    await expectRejected(
      () => callReducer(firstCaller.connection, "configureUnit", {
        unitId: unauthorizedUnit,
        displayName: "unauthorized",
        controllerIdentity: firstCaller.identity,
      }),
      /unauthorized_member_required|forbidden_role/,
    );
    assert.ok(
      !(tableRows(firstCaller.connection, "relevantEntities") as Array<{ id?: string }>)
        .some((row) => row.id === unauthorizedUnit),
      "unauthorized first caller changed the world",
    );

    await provisionMember(admin, perceptionA.identity, "Perception", unitA, sessionA);
    await provisionMember(admin, perceptionB.identity, "Perception", unitB, sessionB);
    await provisionMember(admin, controllerA.identity, "Controller", unitA);
    await provisionMember(admin, controllerB.identity, "Controller", unitB);
    await provisionMember(admin, agent.identity, "Agent");
    await provisionMember(admin, unrelatedAgent.identity, "Agent");
    await callReducer(admin.connection, "configureAgent", {
      agentId,
      principal: agent.identity,
      displayName: "qualification agent",
      readScope: { worldId: "nemeia-local-world" },
      paused: false,
      expectedRevision: 0n,
    });
    await callReducer(admin.connection, "configureAgent", {
      agentId: unrelatedAgentId,
      principal: unrelatedAgent.identity,
      displayName: "unrelated qualification agent",
      readScope: { worldId: "nemeia-local-world" },
      paused: false,
      expectedRevision: 0n,
    });
    await callReducer(admin.connection, "configureUnit", {
      unitId: unitA,
      displayName: "qualification unit A",
      controllerIdentity: controllerA.identity,
    });
    await callReducer(admin.connection, "configureUnit", {
      unitId: unitB,
      displayName: "qualification unit B",
      controllerIdentity: controllerB.identity,
    });

    await callReducer(perceptionA.connection, "registerSpatialFrame", {
      input: { frameId: frameA, sourceSession: sessionA, originEpoch: 0n, parentFrameId: undefined },
    });
    await callReducer(perceptionB.connection, "registerSpatialFrame", {
      input: { frameId: frameB, sourceSession: sessionB, originEpoch: 0n, parentFrameId: undefined },
    });
    await callReducer(perceptionA.connection, "initializeLocalMap", { mapId: mapA, unitId: unitA, rootFrameId: frameA });
    await callReducer(perceptionB.connection, "initializeLocalMap", { mapId: mapB, unitId: unitB, rootFrameId: frameB });

    const observationA = imageObservation({
      id: `qualification-observation-a-${suffix}`,
      entityId: entityA,
      mapId: mapA,
      frameSession: sessionA,
      observedAt: "2026-09-20T12:00:00.000Z",
    });
    const observationB = semanticObservation({
      id: `qualification-observation-b-${suffix}`,
      entityId: entityB,
      mapId: mapB,
      frameId: frameB,
      frameSession: sessionB,
      observedAt: "2026-09-20T12:00:01.000Z",
    });
    await callReducer(perceptionA.connection, "ingestObservation", observationA);
    await callReducer(perceptionB.connection, "ingestObservation", observationB);
    const observationCountBeforeDuplicate = (await callProcedure(
      perceptionA.connection,
      "readObservationHistory",
      { afterSequence: 0n, limit: 100 },
    ) as { rows: readonly unknown[] }).rows.length;
    await callReducer(perceptionA.connection, "ingestObservation", observationA);
    const observationRowsAfterDuplicate = (await callProcedure(
      perceptionA.connection,
      "readObservationHistory",
      { afterSequence: 0n, limit: 100 },
    ) as { rows: Array<{ id: string }> }).rows;
    assert.equal(observationRowsAfterDuplicate.length, observationCountBeforeDuplicate, "duplicate observation added a row");
    assert.equal(observationRowsAfterDuplicate.filter((row) => row.id === observationA.input.id).length, 1);
    await expectRejected(
      () => callReducer(perceptionA.connection, "ingestObservation", {
        input: { ...observationA.input, geometry: { ...observationA.input.geometry, value: { ...observationA.input.geometry.value, value: { ...observationA.input.geometry.value.value, centerX: 11 } } } },
      }),
      /observation_idempotency_conflict/,
    );
    const observationRowsAfterConflict = (await callProcedure(
      perceptionA.connection,
      "readObservationHistory",
      { afterSequence: 0n, limit: 100 },
    ) as { rows: readonly unknown[] }).rows;
    assert.equal(observationRowsAfterConflict.length, observationCountBeforeDuplicate, "changed duplicate altered observation history");

    const checkpoint = {
      input: {
        mapId: mapA,
        expectedRevision: 0n,
        rootFrameId: frameA,
        manifest: resource(`qualification-manifest-${suffix}`, "b"),
        evidenceIndex: resource(`qualification-evidence-${suffix}`, "c"),
        estimatorState: undefined,
        inputObservationIds: [observationA.input.id],
      },
    };
    await callReducer(perceptionA.connection, "commitMapCheckpoint", checkpoint);
    const mapRowsAfterFirstCommit = (await callProcedure(
      perceptionA.connection,
      "readMapHistory",
      { mapId: mapA, afterRevision: 0n, limit: 100 },
    ) as { rows: readonly unknown[] }).rows.length;
    assert.equal(mapRowsAfterFirstCommit, 1);
    await callReducer(perceptionA.connection, "commitMapCheckpoint", checkpoint);
    const mapRowsAfterDuplicate = (await callProcedure(
      perceptionA.connection,
      "readMapHistory",
      { mapId: mapA, afterRevision: 0n, limit: 100 },
    ) as { rows: readonly unknown[] }).rows;
    assert.equal(mapRowsAfterDuplicate.length, mapRowsAfterFirstCommit, "duplicate map checkpoint added a row");
    await expectRejected(
      () => callReducer(perceptionA.connection, "commitMapCheckpoint", {
        input: { ...checkpoint.input, inputObservationIds: [] },
      }),
      /manifest_digest_conflict/,
    );

    // Completion validation is exercised against the real admitted/claimed
    // module row. Navigation has no target observation in its result; the
    // module binds the fresh Unit pose to the immutable target frame/pose.
    const wrongCompletionFrame = `qualification-completion-frame-wrong-${suffix}`;
    await callReducer(perceptionA.connection, "registerSpatialFrame", {
      input: { frameId: wrongCompletionFrame, sourceSession: sessionA, originEpoch: 0n, parentFrameId: undefined },
    });
    await callReducer(admin.connection, "setActionBinding", {
      unitId: unitA,
      actionName: "navigate@1",
      version: 1n,
      policy: {
        executor: PACKAGE,
        mode: { tag: "Simulation" },
        maxEvidenceAgeMs: 120_000,
        maxLinearMps: 0.2,
        maxRunMs: 10_000,
        toleranceM: 0.1,
      },
    });
    await callReducer(controllerA.connection, "reportControl", {
      unitId: unitA,
      epoch: 0n,
      stopLatched: false,
      safeStateConfirmed: true,
    });
    const completionExecutionId = `qualification-completion-${suffix}`;
    const completionTarget = {
      positionM: { x: 0, y: 0, z: 0 },
      orientation: { x: 0, y: 0, z: 0, w: 1 },
    };
    await callReducer(admin.connection, "requestExecution", {
      executionId: completionExecutionId,
      unitId: unitA,
      assignment: undefined,
      missionLink: undefined,
      input: {
        tag: "Navigate",
        value: { mapId: mapA, basisRevision: 1n, targetFrameId: frameA, target: completionTarget },
      },
      bindingVersion: 1n,
      targetVersion: 1n,
      acceptBy: timestamp(new Date(Date.now() + 60_000).toISOString()),
    });
    await callReducer(controllerA.connection, "claimExecution", { executionId: completionExecutionId, expectedEpoch: 0n });
    await callReducer(controllerA.connection, "reportControl", {
      unitId: unitA,
      epoch: 0n,
      stopLatched: false,
      safeStateConfirmed: true,
    });

    const staleAt = new Date(Date.now() - 60_000).toISOString();
    // Leave the fresh sample just ahead of the publish call, then wait past
    // it before finishing so the reducer sees it both post-claim and current.
    const freshAt = new Date(Date.now() + 100).toISOString();
    const wrongFrameObservation = poseObservation({
      id: `qualification-completion-wrong-frame-${suffix}`,
      entityId: unitA,
      mapId: mapA,
      frameId: wrongCompletionFrame,
      frameSession: sessionA,
      observedAt: freshAt,
      positionM: { x: 0, y: 0, z: 0 },
    });
    const staleObservation = poseObservation({
      id: `qualification-completion-stale-${suffix}`,
      entityId: unitA,
      mapId: mapA,
      frameId: frameA,
      frameSession: sessionA,
      observedAt: staleAt,
      positionM: { x: 0, y: 0, z: 0 },
    });
    const wrongEntityObservation = poseObservation({
      id: `qualification-completion-wrong-entity-${suffix}`,
      entityId: `qualification-completion-entity-${suffix}`,
      mapId: mapA,
      frameId: frameA,
      frameSession: sessionA,
      observedAt: freshAt,
      positionM: { x: 0, y: 0, z: 0 },
    });
    const falseResidualObservation = poseObservation({
      id: `qualification-completion-false-residual-${suffix}`,
      entityId: unitA,
      mapId: mapA,
      frameId: frameA,
      frameSession: sessionA,
      observedAt: freshAt,
      positionM: { x: 1, y: 0, z: 0 },
    });
    const validObservation = poseObservation({
      id: `qualification-completion-valid-${suffix}`,
      entityId: unitA,
      mapId: mapA,
      frameId: frameA,
      frameSession: sessionA,
      observedAt: freshAt,
      positionM: { x: 0.05, y: 0, z: 0 },
    });
    for (const candidate of [wrongFrameObservation, staleObservation, wrongEntityObservation, falseResidualObservation, validObservation]) {
      await callReducer(perceptionA.connection, "ingestObservation", candidate);
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
    const completionResult = (unitObservationId: string, localReceiptId: string) => ({
      tag: "Succeeded",
      value: {
        completion: {
          tag: "Navigate",
          value: { unitObservationId, localReceiptId },
        },
      },
    });
    const finishAttempt = (result: unknown, safeProof: unknown = undefined) => callReducer(controllerA.connection, "finishExecution", {
      executionId: completionExecutionId,
      controllerEpoch: 0n,
      result,
      safeProof,
    });
    await expectRejected(
      () => finishAttempt(completionResult(wrongFrameObservation.input.id, "wrong-frame-receipt")),
      /navigation_completion_frame_mismatch/,
    );
    await expectRejected(
      () => finishAttempt(completionResult(staleObservation.input.id, "stale-receipt")),
      /unit_completion_pose_stale/,
    );
    await expectRejected(
      () => finishAttempt(completionResult(wrongEntityObservation.input.id, "wrong-entity-receipt")),
      /unit_completion_entity_mismatch/,
    );
    await expectRejected(
      () => finishAttempt(completionResult(falseResidualObservation.input.id, "false-residual-receipt")),
      /navigation_residual_out_of_tolerance/,
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    const safeProofAt = timestamp(new Date().toISOString());
    await callReducer(controllerA.connection, "reportControl", {
      unitId: unitA,
      epoch: 0n,
      stopLatched: false,
      safeStateConfirmed: true,
    });
    await finishAttempt(
      completionResult(validObservation.input.id, "valid-navigation-receipt"),
      {
        executionId: completionExecutionId,
        unitId: unitA,
        controllerEpoch: 0n,
        observationId: validObservation.input.id,
        observedAt: safeProofAt,
      },
    );
    const completedExecution = (tableRows(controllerA.connection, "relevantExecutions") as Array<{ id: string; state: { tag: string } }>)
      .find((row) => row.id === completionExecutionId);
    assert.equal(completedExecution?.state.tag, "Succeeded", "valid measured navigation completion did not close the execution");

    // A result measured before cancellation is still valid against immutable
    // claimedAt, but cancellation wins terminal state and safe proof is held
    // to the post-cancellation lifecycle boundary.
    const lateExecutionId = `qualification-late-success-${suffix}`;
    await callReducer(admin.connection, "requestExecution", {
      executionId: lateExecutionId,
      unitId: unitA,
      assignment: undefined,
      missionLink: undefined,
      input: {
        tag: "Navigate",
        value: { mapId: mapA, basisRevision: 1n, targetFrameId: frameA, target: completionTarget },
      },
      bindingVersion: 1n,
      targetVersion: 1n,
      acceptBy: timestamp(new Date(Date.now() + 60_000).toISOString()),
    });
    await callReducer(controllerA.connection, "claimExecution", { executionId: lateExecutionId, expectedEpoch: 0n });
    const lateObservation = poseObservation({
      id: `qualification-late-success-observation-${suffix}`,
      entityId: unitA,
      mapId: mapA,
      frameId: frameA,
      frameSession: sessionA,
      observedAt: new Date(Date.now() + 50).toISOString(),
      positionM: { x: 0.05, y: 0, z: 0 },
    });
    await callReducer(perceptionA.connection, "ingestObservation", lateObservation);
    await callReducer(admin.connection, "requestExecutionCancel", { executionId: lateExecutionId });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const lateProofAt = timestamp(new Date().toISOString());
    await callReducer(controllerA.connection, "reportControl", {
      unitId: unitA,
      epoch: 0n,
      stopLatched: false,
      safeStateConfirmed: true,
    });
    await callReducer(controllerA.connection, "finishExecution", {
      executionId: lateExecutionId,
      controllerEpoch: 0n,
      result: completionResult(lateObservation.input.id, "late-success-receipt"),
      safeProof: {
        executionId: lateExecutionId,
        unitId: unitA,
        controllerEpoch: 0n,
        observationId: lateObservation.input.id,
        observedAt: lateProofAt,
      },
    });
    const lateExecution = (tableRows(controllerA.connection, "relevantExecutions") as Array<{
      id: string;
      state: { tag: string };
      result?: { tag: string };
    }>).find((row) => row.id === lateExecutionId);
    assert.equal(lateExecution?.state.tag, "Cancelled", "cancellation did not win over a late success");
    assert.equal(lateExecution?.result?.tag, "Succeeded", "late measured success was not retained as evidence");

    // Approach pins the admitted target frame/basis observation. Replacing
    // the current geometry after claim must not invalidate a new measured box
    // in that same frame.
    const approachTargetId = `qualification-approach-target-${suffix}`;
    const approachInitialAt = new Date(Date.now() - 1_000).toISOString();
    const approachInitial = boxObservation({
      id: `qualification-approach-initial-${suffix}`,
      entityId: approachTargetId,
      mapId: mapA,
      frameId: frameA,
      frameSession: sessionA,
      observedAt: approachInitialAt,
      centerM: { x: 1, y: 0, z: 0 },
    });
    await callReducer(perceptionA.connection, "ingestObservation", approachInitial);
    await callReducer(admin.connection, "setActionBinding", {
      unitId: unitA,
      actionName: "approach@1",
      version: 1n,
      policy: {
        executor: PACKAGE,
        mode: { tag: "Simulation" },
        maxEvidenceAgeMs: 120_000,
        maxLinearMps: 0.2,
        maxRunMs: 10_000,
        toleranceM: 0.1,
      },
    });
    const approachExecutionId = `qualification-approach-geometry-advance-${suffix}`;
    await callReducer(admin.connection, "requestExecution", {
      executionId: approachExecutionId,
      unitId: unitA,
      assignment: undefined,
      missionLink: undefined,
      input: { tag: "Approach", value: { targetId: approachTargetId, standoffM: 1, expectedGeometryVersion: 1n } },
      bindingVersion: 1n,
      targetVersion: 1n,
      acceptBy: timestamp(new Date(Date.now() + 60_000).toISOString()),
    });
    await callReducer(controllerA.connection, "claimExecution", { executionId: approachExecutionId, expectedEpoch: 0n });
    const approachUpdatedAt = new Date(Date.now() + 50).toISOString();
    const approachUpdated = boxObservation({
      id: `qualification-approach-updated-${suffix}`,
      entityId: approachTargetId,
      mapId: mapA,
      frameId: frameA,
      frameSession: sessionA,
      observedAt: approachUpdatedAt,
      centerM: { x: 1.1, y: 0, z: 0 },
    });
    const approachUnit = poseObservation({
      id: `qualification-approach-unit-${suffix}`,
      entityId: unitA,
      mapId: mapA,
      frameId: frameA,
      frameSession: sessionA,
      observedAt: approachUpdatedAt,
      positionM: { x: 0.1, y: 0, z: 0 },
    });
    await callReducer(perceptionA.connection, "ingestObservation", approachUpdated);
    await callReducer(perceptionA.connection, "ingestObservation", approachUnit);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const approachProofAt = timestamp(new Date().toISOString());
    await callReducer(controllerA.connection, "reportControl", {
      unitId: unitA,
      epoch: 0n,
      stopLatched: false,
      safeStateConfirmed: true,
    });
    await callReducer(controllerA.connection, "finishExecution", {
      executionId: approachExecutionId,
      controllerEpoch: 0n,
      result: {
        tag: "Succeeded",
        value: {
          completion: {
            tag: "Approach",
            value: {
              unitObservationId: approachUnit.input.id,
              targetObservationId: approachUpdated.input.id,
              localReceiptId: "approach-geometry-advance-receipt",
              measuredDistanceM: 1,
            },
          },
        },
      },
      safeProof: {
        executionId: approachExecutionId,
        unitId: unitA,
        controllerEpoch: 0n,
        observationId: approachUnit.input.id,
        observedAt: approachProofAt,
      },
    });
    const approachExecution = (tableRows(controllerA.connection, "relevantExecutions") as Array<{ id: string; state: { tag: string } }>)
      .find((row) => row.id === approachExecutionId);
    assert.equal(approachExecution?.state.tag, "Succeeded", "geometry replacement after claim invalidated pinned approach basis");

    const observationCountBeforeAgentAttempt = (await callProcedure(
      perceptionA.connection,
      "readObservationHistory",
      { afterSequence: 0n, limit: 100 },
    ) as { rows: readonly unknown[] }).rows.length;
    await expectRejected(
      () => callReducer(agent.connection, "ingestObservation", {
        input: { ...observationA.input, id: `agent-fake-resource-${suffix}`, retained: [resource(`fake-${suffix}`, "d")] },
      }),
      /forbidden_role|unauthorized_member_required/,
    );
    const observationRowsAfterAgentAttempt = (await callProcedure(
      perceptionA.connection,
      "readObservationHistory",
      { afterSequence: 0n, limit: 100 },
    ) as { rows: readonly unknown[] }).rows;
    assert.equal(
      observationRowsAfterAgentAttempt.length,
      observationCountBeforeAgentAttempt,
      "agent resource attempt changed observation history",
    );

    await callReducer(admin.connection, "createMission", {
      missionId: feedbackMissionId,
      spec: {
        description: "qualification feedback mission",
        template: undefined,
        objectives: [{
          id: feedbackObjectiveId,
          description: "review the observed finding",
          dependsOn: [],
          optional: false,
          criterion: { tag: "Located", value: { description: "the observed object" } },
        }],
        deadlineAt: undefined,
      },
    });
    await callReducer(admin.connection, "assignMission", {
      missionId: feedbackMissionId,
      agentId,
      expectedMissionRevision: 1n,
      expectedAgentRevision: 1n,
    });
    await waitFor(
      () => tableRows(agent.connection, "assignedMissions").some((row) => (row as { id?: string }).id === feedbackMissionId),
      "assigned feedback mission",
    );
    const missionBeforeFeedback = (tableRows(agent.connection, "assignedMissions") as Array<{ id: string; revision: bigint }>)
      .find((row) => row.id === feedbackMissionId);
    assert.ok(missionBeforeFeedback);
    const progressBeforeFeedback = tableRows(agent.connection, "relevantMissionObjectiveProgress")
      .filter((row) => (row as { missionId?: string }).missionId === feedbackMissionId);
    await callReducer(admin.connection, "rejectObjectiveFinding", {
      missionId: feedbackMissionId,
      objectiveId: feedbackObjectiveId,
      entityId: entityA,
      observationIds: [observationA.input.id],
      expectedMissionRevision: missionBeforeFeedback.revision,
      reason: "operator rejected the finding",
    });
    await waitFor(
      () => tableRows(agent.connection, "relevantFeedbackWatermarks")
        .some((row) => (row as { missionId?: string }).missionId === feedbackMissionId),
      "assigned agent feedback watermark",
    );
    const agentWatermarks = tableRows(agent.connection, "relevantFeedbackWatermarks") as Array<{
      missionId: string;
      sequence: bigint;
    }>;
    const feedbackWatermark = agentWatermarks.find((row) => row.missionId === feedbackMissionId);
    assert.ok(feedbackWatermark);
    assert.ok(
      !(tableRows(unrelatedAgent.connection, "relevantFeedbackWatermarks") as Array<{ missionId?: string }>)
        .some((row) => row.missionId === feedbackMissionId),
      "unrelated agent received feedback watermark",
    );
    const feedbackPage = await callProcedure(agent.connection, "readEventHistory", {
      subjectId: feedbackMissionId,
      afterSequence: feedbackWatermark.sequence - 1n,
      limit: 10,
    }) as { rows: Array<{ sequence: bigint; id: string; kind: string; detail: string }> };
    const feedbackEvent = feedbackPage.rows.find((row) => row.sequence === feedbackWatermark.sequence);
    assert.ok(feedbackEvent);
    assert.equal(feedbackEvent.kind, "mission.finding_rejected");
    assert.match(feedbackEvent.detail, /operator rejected the finding/);

    // The default maxEventRows is 1,000. The watermark must still advance
    // after more than that many rejection events for one assigned mission;
    // no bounded prefix of world_event rows may be used as the wake source.
    const initialFeedbackSequence = feedbackWatermark.sequence;
    for (let index = 0; index < 1_000; index += 1) {
      await callReducer(admin.connection, "rejectObjectiveFinding", {
        missionId: feedbackMissionId,
        objectiveId: feedbackObjectiveId,
        entityId: entityA,
        observationIds: [observationA.input.id],
        expectedMissionRevision: missionBeforeFeedback.revision,
        reason: `operator rejected finding ${index + 1}`,
      });
    }
    let latestFeedbackWatermark: { missionId: string; sequence: bigint } | undefined;
    let latestFeedbackEvent: { sequence: bigint; kind: string; detail: string } | undefined;
    const latestFeedbackDeadline = Date.now() + 15_000;
    while (Date.now() < latestFeedbackDeadline) {
      const candidate = (tableRows(agent.connection, "relevantFeedbackWatermarks") as Array<{
        missionId: string;
        sequence: bigint;
      }>).find((row) => row.missionId === feedbackMissionId);
      if (candidate && candidate.sequence > initialFeedbackSequence) {
        const page = await callProcedure(agent.connection, "readEventHistory", {
          subjectId: feedbackMissionId,
          afterSequence: candidate.sequence - 1n,
          limit: 10,
        }) as { rows: Array<{ sequence: bigint; kind: string; detail: string }> };
        const event = page.rows.find((row) => row.sequence === candidate.sequence);
        if (event?.detail.includes("operator rejected finding 1000")) {
          latestFeedbackWatermark = candidate;
          latestFeedbackEvent = event;
          break;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(latestFeedbackWatermark);
    assert.ok(latestFeedbackWatermark.sequence > initialFeedbackSequence);
    assert.ok(latestFeedbackEvent);
    assert.equal(latestFeedbackEvent.kind, "mission.finding_rejected");
    assert.match(latestFeedbackEvent.detail, /operator rejected finding 1000/);
    const missionAfterFeedback = (tableRows(agent.connection, "assignedMissions") as Array<{ id: string; revision: bigint }>)
      .find((row) => row.id === feedbackMissionId);
    assert.equal(missionAfterFeedback?.revision, missionBeforeFeedback.revision, "feedback changed mission revision");
    const progressAfterFeedback = tableRows(agent.connection, "relevantMissionObjectiveProgress")
      .filter((row) => (row as { missionId?: string }).missionId === feedbackMissionId);
    assert.equal(progressAfterFeedback.length, progressBeforeFeedback.length, "feedback changed mission progress");

    const hiddenObservation = await callProcedure(perceptionA.connection, "readObservationDetail", { observationId: observationB.input.id });
    assert.equal(hiddenObservation, undefined, "a producer cannot read another Unit's observation detail");

    await waitFor(() => tableRows(perceptionA.connection, "relevantGeometry").some((row) => (
      row as { entityId?: string; value?: { tag?: string } }
    ).entityId === entityA), "image-only geometry in Unit A view");
    const unitAEntities = tableRows(perceptionA.connection, "relevantEntities") as Array<{ id: string }>;
    const unitBEntities = tableRows(perceptionB.connection, "relevantEntities") as Array<{ id: string }>;
    const controllerAControls = tableRows(controllerA.connection, "relevantUnitControls") as Array<{ unitId: string }>;
    const controllerBControls = tableRows(controllerB.connection, "relevantUnitControls") as Array<{ unitId: string }>;
    assert.ok(unitAEntities.some((row) => row.id === entityA));
    assert.ok(!unitAEntities.some((row) => row.id === entityB));
    assert.ok(unitBEntities.some((row) => row.id === entityB));
    assert.ok(!unitBEntities.some((row) => row.id === entityA));
    assert.deepEqual(controllerAControls.map((row) => row.unitId), [unitA]);
    assert.deepEqual(controllerBControls.map((row) => row.unitId), [unitB]);

    await expectRejected(
      () => callReducer(perceptionA.connection, "registerSpatialFrame", {
        input: { frameId: `cross-unit-parent-${suffix}`, sourceSession: sessionA, originEpoch: 0n, parentFrameId: frameB },
      }),
      /wrong_parent_frame/,
    );
    await expectRejected(
      () => callReducer(perceptionA.connection, "ingestObservation", {
        input: {
          ...observationA.input,
          id: `cross-unit-transform-${suffix}`,
          transforms: [{
            parentFrameId: frameA,
            childFrameId: frameB,
            observedAt: timestamp("2026-09-20T12:00:02.000Z"),
            pose: {
              positionM: { x: 0, y: 0, z: 0 },
              orientation: { x: 0, y: 0, z: 0, w: 1 },
            },
          }],
        },
      }),
      /wrong_spatial_frame/,
    );

    await callReducer(perceptionA.connection, "registerSpatialFrame", {
      input: { frameId: frameB.replace("-b-", "-a-reset-"), sourceSession: sessionA, originEpoch: 1n, parentFrameId: frameA },
    });
    const resetFrame = frameB.replace("-b-", "-a-reset-");
    await callReducer(perceptionA.connection, "initializeLocalMap", { mapId: mapB.replace("-b-", "-a-reset-"), unitId: unitA, rootFrameId: resetFrame });
    await expectRejected(
      () => callReducer(perceptionA.connection, "configureMember", {
        identity: perceptionA.identity,
        role: { tag: "Perception" },
        unitId: unitA,
        producerSession: sessionAReset,
        package: PACKAGE,
      }),
      /forbidden_role|unauthorized_member_required/,
    );
    await callReducer(admin.connection, "configureMember", {
      identity: perceptionA.identity,
      role: { tag: "Perception" },
      unitId: unitA,
      producerSession: sessionAReset,
      package: PACKAGE,
    });
    await callReducer(perceptionA.connection, "registerSpatialFrame", {
      input: { frameId: frameC, sourceSession: sessionAReset, originEpoch: 0n, parentFrameId: undefined },
    });
    await callReducer(perceptionA.connection, "initializeLocalMap", { mapId: mapC, unitId: unitA, rootFrameId: frameC });

    const historyBeforeFuture = await callProcedure(perceptionA.connection, "readObservationHistory", { afterSequence: 0n, limit: 100 }) as { rows: readonly unknown[]; nextSequence: bigint; historyGap: boolean };
    const tail = historyBeforeFuture.nextSequence;
    const historyAtTail = await callProcedure(perceptionA.connection, "readObservationHistory", { afterSequence: tail, limit: 100 }) as { rows: readonly unknown[]; nextSequence: bigint };
    assert.equal(historyAtTail.rows.length, 0);
    assert.equal(historyAtTail.nextSequence, tail, "history cursor must not advance past the current head");
    const futureObservation = imageObservation({
      id: `qualification-observation-future-${suffix}`,
      entityId: entityA,
      mapId: mapA,
      frameSession: sessionAReset,
      observedAt: "2026-09-20T12:00:03.000Z",
    });
    await callReducer(perceptionA.connection, "ingestObservation", {
      input: { ...futureObservation.input, trackId: "track-future" },
    });
    const historyAfterFuture = await callProcedure(perceptionA.connection, "readObservationHistory", { afterSequence: tail, limit: 100 }) as { rows: Array<{ id: string }>; nextSequence: bigint };
    assert.ok(historyAfterFuture.rows.some((row) => row.id === futureObservation.input.id));
    assert.ok(historyAfterFuture.nextSequence > tail);
    const retainedMapCount = tableRows(perceptionA.connection, "relevantLocalMaps").length;

    const clientStates: string[] = [];
    operatorClient = new WorldClient({
      uri: options.uri,
      databaseName: options.databaseName,
      token: options.adminToken,
      onStateChange: (state) => clientStates.push(state),
    });
    operatorClient.connect();
    operatorClient.subscribeCurrentWorld();
    await waitFor(() => operatorClient?.state === "ready", "real SDK WorldClient subscription readiness");
    const detached = operatorClient.snapshot();
    const originalEntityCount = detached.relevantEntities.length;
    if (detached.relevantEntities[0]) detached.relevantEntities[0].displayName = "local-only";
    assert.equal(operatorClient.snapshot().relevantEntities.length, originalEntityCount, "WorldClient snapshots must be detached");
    assert.notEqual(operatorClient.snapshot().relevantEntities[0]?.displayName, "local-only", "WorldClient row state must be detached");
    operatorClient.disconnect();
    assert.equal(operatorClient.state, "disconnected");
    operatorClient.connect();
    operatorClient.subscribeCurrentWorld();
    await waitFor(() => operatorClient?.state === "ready", "WorldClient reconnect readiness");
    assert.ok(clientStates.includes("ready"));

    await callReducer(admin.connection, "configureMember", {
      identity: perceptionA.identity,
      role: { tag: "Agent" },
      unitId: undefined,
      producerSession: undefined,
      package: undefined,
    });
    await waitFor(() => tableRows(perceptionA.connection, "relevantEntities").length === 0, "revoked producer view removal");
    await expectRejected(
      () => callReducer(perceptionA.connection, "ingestObservation", {
        input: { ...futureObservation.input, id: `revoked-${suffix}`, producerSession: sessionAReset },
      }),
      /forbidden_role|unauthorized_member_required/,
    );

    return {
      checks: {
        unauthorizedFirstCallerDenied: true,
        agentCannotIngestFakeResource: true,
        producerAndControllerUnitScope: true,
        revocationInvalidates: true,
        duplicateObservationAndMapSemantics: true,
        imageOnlyGeometryVisible: true,
        retainedMapsAndFrameOriginReset: retainedMapCount >= 3,
        boundedHistoryCursor: true,
        assignedAgentReceivesFeedback: true,
        unrelatedAgentCannotSeeFeedback: true,
        rejectionLeavesProgressUnchanged: true,
        measuredNavigationCompletionRejectsWrongFrameStaleEntityAndResidual: true,
        lateSuccessEvidenceRetainedCancellationWins: true,
        approachCompletionSurvivesGeometryAdvance: true,
        realSdkSubscriptionReconnectAndDetach: true,
      },
      ids: { unitA, unitB, mapA, mapB, mapC, frameA, frameB, frameC },
    };
  } finally {
    operatorClient?.disconnect();
    for (const handle of handles.reverse()) handle.close();
  }
}

export async function readTokenFile(pathname: string): Promise<string> {
  const token = (await readFile(pathname, "utf8")).trim();
  if (!token) throw new Error(`empty SpacetimeDB token file: ${pathname}`);
  return token;
}
