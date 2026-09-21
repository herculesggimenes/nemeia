import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  NativeMapPublisher,
  RecordedAcquisitionAdapter,
  ResourceGatewayAdapter,
} from "../../perception/src/index.ts";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
// Private domain tables are never queried directly. These are the generated
// public views; scoped procedures below provide authorized evidence reads.
const TABLE_NAMES = [
  "readiness", "relevant_entities", "relevant_geometry", "relevant_local_maps", "relevant_poses",
  "relevant_semantic", "relevant_executions", "assigned_missions", "addressed_messages",
  "relevant_agents", "relevant_mission_agents", "relevant_mission_objective_progress",
  "relevant_unit_assignments", "relevant_unit_controls", "relevant_action_bindings",
];

function assertLoopback(uri) {
  const parsed = new URL(uri);
  if (!LOOPBACK_HOSTS.has(parsed.hostname)) throw new Error("generated client accepts only loopback endpoints");
  if (!/^https?:$/.test(parsed.protocol)) throw new Error("generated client URI must use http(s) for SDK conversion");
  return parsed;
}

function websocketUri(uri) {
  return uri.replace(/^http:/, "ws:").replace(/^https:/, "wss:").replace(/\/$/, "");
}

function generatedEntry(modulePath) {
  const absolute = resolve(modulePath);
  return extname(absolute) ? absolute : join(absolute, "index.ts");
}

function tableAccessor(tableName) {
  return tableName.replace(/_([a-z])/g, (_match, letter) => letter.toUpperCase());
}

function stableRows(connection, tableName) {
  const table = connection.db?.[tableAccessor(tableName)];
  if (!table || typeof table[Symbol.iterator] !== "function") {
    throw new Error(`generated SDK is missing the canonical authorized view: ${tableName}`);
  }
  return [...table];
}

function snapshotFrom(connection) {
  return {
    readiness: stableRows(connection, "readiness"),
    addressedMessages: stableRows(connection, "addressed_messages"),
    assignedMissions: stableRows(connection, "assigned_missions"),
    relevantActionBindings: stableRows(connection, "relevant_action_bindings"),
    relevantAgents: stableRows(connection, "relevant_agents"),
    relevantEntities: stableRows(connection, "relevant_entities"),
    relevantExecutions: stableRows(connection, "relevant_executions"),
    relevantGeometry: stableRows(connection, "relevant_geometry"),
    relevantLocalMaps: stableRows(connection, "relevant_local_maps"),
    relevantMissionAgents: stableRows(connection, "relevant_mission_agents"),
    relevantMissionObjectiveProgress: stableRows(connection, "relevant_mission_objective_progress"),
    relevantPoses: stableRows(connection, "relevant_poses"),
    relevantSemantic: stableRows(connection, "relevant_semantic"),
    relevantUnitAssignments: stableRows(connection, "relevant_unit_assignments"),
    relevantUnitControls: stableRows(connection, "relevant_unit_controls"),
  };
}

function identityFingerprint(identity) {
  const value = typeof identity?.toHexString === "function" ? identity.toHexString() : String(identity);
  return createHash("sha256").update(value).digest("hex");
}

function collectResourceIds(value, result = new Set()) {
  if (!value || typeof value !== "object") return result;
  if (
    typeof value.id === "string" && typeof value.schema === "string" && typeof value.sha256 === "string" &&
    (typeof value.byteLength === "bigint" || typeof value.byteLength === "string" || typeof value.byteLength === "number")
  ) result.add(value.id);
  if (Array.isArray(value)) {
    for (const item of value) collectResourceIds(item, result);
  } else {
    for (const child of Object.values(value)) collectResourceIds(child, result);
  }
  return result;
}

async function readCredential(pathname) {
  try {
    const value = (await readFile(pathname, "utf8")).trim();
    return value || undefined;
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

async function persistCredential(pathname, token) {
  await mkdir(dirname(pathname), { recursive: true, mode: 0o700 });
  await writeFile(pathname, `${token}\n`, { mode: 0o600 });
  await chmod(pathname, 0o600);
}

function callGeneratedReducer(connection, name, input) {
  const reducer = connection.reducers?.[name] ?? connection.reducers?.[tableAccessor(name)];
  if (typeof reducer !== "function") throw new Error(`generated SDK reducer is missing: ${name}`);
  return reducer(input);
}

function callGeneratedProcedure(connection, name, input) {
  const procedure = connection.procedures?.[name] ?? connection.procedures?.[tableAccessor(name)];
  if (typeof procedure !== "function") throw new Error(`generated SDK procedure is missing: ${name}`);
  return procedure(input);
}

function nativeResourceRef(value) {
  return {
    id: value.id,
    schema: value.schema,
    sha256: value.sha256,
    byteLength: BigInt(value.byteLength),
  };
}

function timestampFor(Timestamp, value) {
  return Timestamp.fromDate(new Date(value));
}

function observationInputFor({ Timestamp, observation, samples, resources }) {
  const firstSample = samples[0];
  if (!firstSample) throw new Error("standard fixture must contain at least one sample");
  const observedAt = timestampFor(Timestamp, observation.observedAt ?? firstSample.capturedAt);
  const pose = observation.pose ? {
    observedAt: timestampFor(Timestamp, observation.pose.observedAt ?? observation.observedAt ?? firstSample.capturedAt),
    frameId: observation.pose.frameId ?? firstSample.spatialFrameId,
    value: observation.pose.value,
  } : undefined;
  const geometry = observation.geometry ? {
    observedAt: timestampFor(Timestamp, observation.geometry.observedAt ?? observation.observedAt ?? firstSample.capturedAt),
    value: observation.geometry.value,
  } : undefined;
  return {
    id: observation.id,
    producerSession: firstSample.sourceSessionId,
    trackId: observation.trackId,
    entityId: observation.entityId,
    localMapId: observation.localMapId,
    inputs: samples.map((sample) => ({
      streamId: sample.streamId,
      sessionId: sample.sourceSessionId,
      sequence: sample.sequence,
      capturedAt: timestampFor(Timestamp, sample.capturedAt),
    })),
    retained: resources.map(nativeResourceRef),
    transforms: [],
    supersedes: [],
    pose,
    geometry,
    semantic: observation.semantic ? {
      observedAt,
      frameId: observation.semantic.frameId ?? firstSample.spatialFrameId,
      value: observation.semantic.value,
    } : undefined,
  };
}

/**
 * Wraps the actual TypeScript bindings generated by `spacetime generate`.
 * This is deliberately a DbConnection adapter: it does not provide a second
 * transport, in-memory world, auth policy, or resource-reference contract.
 */
export async function createLoopbackAdapter({
  modulePath,
  uri,
  databaseName = "nemeia-local-loopback",
  scopedIdentityFile,
  scopedIdentityFingerprint,
  processSupervisor,
}) {
  const endpoint = assertLoopback(uri);
  if (!modulePath) throw new Error("generated module path is required");
  if (!scopedIdentityFile) throw new Error("scoped identity credential file is required");
  const generated = await import(pathToFileURL(generatedEntry(modulePath)).href);
  const DbConnection = generated.DbConnection;
  if (!DbConnection || typeof DbConnection.builder !== "function") {
    throw new Error("spacetime generate output must export the native DbConnection builder");
  }

  let connection;
  let fingerprint;
  let processRestartCount = 0;
  let closed = false;
  let readyResolve;
  let readyReject;
  let readyPromise = Promise.resolve();
  let resourceAdapter;
  let commitContext;
  let Timestamp;

  const sdk = await import("spacetimedb");
  Timestamp = sdk.Timestamp;

  const connect = async () => {
    if (closed) throw new Error("generated client adapter is closed");
    readyPromise = new Promise((resolveReady, rejectReady) => {
      readyResolve = resolveReady;
      readyReject = rejectReady;
    });
    const token = await readCredential(scopedIdentityFile);
    const builder = DbConnection.builder()
      .withUri(websocketUri(endpoint.toString()))
      .withDatabaseName(databaseName)
      .withConfirmedReads(true)
      .onConnect((connected, identity, nextToken) => {
        connection = connected;
        const nextFingerprint = identityFingerprint(identity);
        if ((fingerprint && nextFingerprint !== fingerprint) || (scopedIdentityFingerprint && nextFingerprint !== scopedIdentityFingerprint)) {
          readyReject(new Error("scoped identity changed while reconnecting"));
          return;
        }
        fingerprint = nextFingerprint;
        void persistCredential(scopedIdentityFile, nextToken)
          .then(() => {
            connection.subscriptionBuilder()
              .onApplied(() => readyResolve())
              .onError((_context, error) => readyReject(error))
              .subscribe(TABLE_NAMES.map((table) => `SELECT * FROM ${table}`));
          })
          .catch(readyReject);
      })
      .onConnectError((_context, error) => readyReject(error));
    if (token) builder.withToken(token);
    try {
      connection = builder.build();
    } catch (error) {
      readyReject(error);
    }
    await readyPromise;
  };

  const adapter = {
    mode: "loopback-spacetimedb",
    endpoint: endpoint.toString().replace(/\/$/, ""),
    get processRestartCount() {
      return processRestartCount;
    },
    async start() {
      await connect();
    },
    async close() {
      closed = true;
      connection?.disconnect();
      connection = undefined;
    },
    async restartWorldProcess() {
      if (!processSupervisor || typeof processSupervisor.restart !== "function") {
        throw new Error("process supervisor is required for actual SpacetimeDB restart evidence");
      }
      connection?.disconnect();
      connection = undefined;
      await processSupervisor.restart();
      processRestartCount += 1;
      await connect();
    },
    async getScopedIdentityFingerprint() {
      await readyPromise;
      return fingerprint;
    },
    async getIdentity() {
      await readyPromise;
      if (!connection?.identity) throw new Error("native SDK identity is unavailable");
      return connection.identity;
    },
    async callReducer(name, input) {
      await readyPromise;
      return callGeneratedReducer(connection, name, input);
    },
    async callProcedure(name, input) {
      await readyPromise;
      return callGeneratedProcedure(connection, name, input);
    },
    async readScopedViews() {
      await readyPromise;
      const snapshot = snapshotFrom(connection);
      return {
        readiness: snapshot.readiness,
        entities: snapshot.relevantEntities,
        localMaps: snapshot.relevantLocalMaps,
        missions: snapshot.assignedMissions,
        executions: snapshot.relevantExecutions,
        agents: snapshot.relevantAgents,
        missionAgents: snapshot.relevantMissionAgents,
        missionObjectiveProgress: snapshot.relevantMissionObjectiveProgress,
        unitAssignments: snapshot.relevantUnitAssignments,
        unitControls: snapshot.relevantUnitControls,
        actionBindings: snapshot.relevantActionBindings,
      };
    },
    async readSnapshot() {
      await readyPromise;
      return snapshotFrom(connection);
    },
    attachResourceGateway({ gateway, session, reader }) {
      if (!gateway || !session || !reader) throw new Error("actual resource gateway, session, and reader are required");
      const facade = {
        publishBytes: gateway.publishBytes.bind(gateway),
        commitPublishedReferences: gateway.commitPublishedReferences.bind(gateway),
        read: gateway.read.bind(gateway),
      };
      resourceAdapter = new ResourceGatewayAdapter({ gateway: facade, session, reader });
      return resourceAdapter;
    },
    async commitPublishedReferences(request) {
      await readyPromise;
      if (!commitContext) throw new Error("resource reference commit arrived without an attached World operation");
      if (commitContext.kind === "observation") {
        await callGeneratedReducer(connection, "ingestObservation", {
          input: observationInputFor({
            Timestamp,
            observation: commitContext.observation,
            samples: commitContext.samples,
            resources: request.resources,
          }),
        });
      } else if (commitContext.kind === "map") {
        if (request.resources.length < 2) throw new Error("map commit context requires manifest and evidence references");
        const product = commitContext.product;
        await callGeneratedReducer(connection, "commitMapCheckpoint", {
          input: {
            mapId: product.mapId,
            expectedRevision: product.expectedHeadRevision ?? 0n,
            rootFrameId: product.spatialFrameId,
            manifest: nativeResourceRef(request.resources.at(-2)),
            evidenceIndex: nativeResourceRef(request.resources.at(-1)),
            estimatorState: undefined,
            inputObservationIds: [...product.inputObservationIds],
          },
        });
      } else {
        throw new Error(`unsupported resource commit context: ${commitContext.kind}`);
      }
      commitContext = undefined;
    },
    async ingestStandardSyntheticFixture({ samples, observation, mapProduct }) {
      if (!resourceAdapter) throw new Error("actual resource gateway must be attached before fixture ingestion");
      if (!Array.isArray(samples) || samples.length === 0) throw new Error("standard synthetic fixture samples are required");
      if (!observation?.id || !observation.localMapId ||
          (!observation.semantic?.value && !observation.pose?.value && !observation.geometry?.value)) {
        throw new Error("standard synthetic fixture observation metadata is incomplete");
      }
      const acquisition = new RecordedAcquisitionAdapter({ resourceGateway: resourceAdapter, maxClockErrorMs: 50 });
      commitContext = { kind: "observation", observation, samples };
      let replay;
      try {
        replay = await acquisition.replay(samples);
      } catch (error) {
        commitContext = undefined;
        throw error;
      }
      if (replay.issues.length || replay.accepted.length !== samples.length) {
        commitContext = undefined;
        throw new Error(`standard synthetic fixture replay rejected: ${JSON.stringify(replay.issues)}`);
      }
      let map;
      if (mapProduct) {
        const mapPublisher = new NativeMapPublisher({
          resourceGateway: resourceAdapter,
          checkpointPort: { commitMapCheckpoint: (params) => callGeneratedReducer(connection, "commitMapCheckpoint", params) },
        });
        commitContext = { kind: "map", product: mapProduct };
        try {
          map = await mapPublisher.publish(mapProduct);
        } catch (error) {
          commitContext = undefined;
          throw error;
        }
      }
      return { replay, map };
    },
    async readBackpackProjection() {
      await readyPromise;
      const entityRows = stableRows(connection, "relevant_entities");
      const observationPage = await callGeneratedProcedure(connection, "readObservationHistory", { afterSequence: 0n, limit: 100 });
      const mapPage = await callGeneratedProcedure(connection, "readMapHistory", { mapId: "local-map-go2-001", afterRevision: 0n, limit: 100 });
      const observationRows = observationPage?.rows ?? [];
      const mapRevisionRows = mapPage?.rows ?? [];
      const resourceIds = [...collectResourceIds({ entityRows, observationRows, mapRevisionRows })];
      const firstObservation = observationRows[0]?.input;
      const recordedAcquisitionAt = firstObservation?.inputs?.[0]?.capturedAt?.toISOString?.()
        ?? firstObservation?.inputs?.[0]?.capturedAt
        ?? undefined;
      return {
        entityIds: entityRows.map((row) => row.id),
        observationIds: observationRows.map((row) => row.id),
        mapRevisionIds: mapRevisionRows.map((row) => row.id ?? row.key),
        resourceIds,
        recordedAcquisitionAt,
      };
    },
    async ingestRecordedBackpackFixture() {
      throw new Error("perception-owned recorded fixture and a distinct scoped perception identity are required; publisher/admin is never demoted");
    },
    async runG3BackpackFlow(options = {}) {
      if (!options.agent || !options.controller || !options.runDirectory || !options.fixture) {
        throw new Error("actual G3 composition requires agent, controller, runDirectory, and standard fixture adapters");
      }
      const helper = await import("./g3-flow.ts");
      const run = helper.runActualG3Flow ?? helper.runG3Flow ?? helper.runG3Qualification;
      if (typeof run !== "function") throw new Error("conformance/src/g3-flow.ts has no actual G3 flow export");
      return run({ operator: adapter, ...options });
    },
    async runNegativeBoundaryTests() {
      throw new Error("actual bootstrap/module/resource boundary ports are not attached");
    },
  };

  adapter.generatedModule = generated;
  adapter.generatedConnection = () => connection;
  adapter.generatedReducer = (name, input) => callGeneratedReducer(connection, name, input);
  adapter.scopedIdentityFile = resolve(scopedIdentityFile);
  adapter.scopedIdentityDirectory = dirname(resolve(scopedIdentityFile));
  return adapter;
}
