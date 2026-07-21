import { AnomalyLog } from "../../anomaly/src/anomaly-log.ts";
import { contractFromPreset } from "../../attention/src/attention-contract.ts";
import { AttentionInbox } from "../../attention/src/attention-inbox.ts";
import { EventLog } from "../../mission-server/src/event-log.ts";
import { MissionServer } from "../../mission-server/src/mission-server.ts";
import { validatePackageBundle } from "../../policy/src/package-bundle.ts";
import { PolicyRegistry } from "../../policy/src/policy-registry.ts";
import { SceneProjector } from "../../scene/src/scene-projector.ts";
import { SimDriver } from "../../supervisor/src/sim-driver.ts";
import { SupervisorKernel } from "../../supervisor/src/supervisor-kernel.ts";
import { MissionApiError, errorResponse } from "./mission-api-errors.ts";
import { EventLogSessionStore, sessionsFromTokens } from "./session-store.ts";

const JSON_HEADERS = { "content-type": "application/json" };

export class MissionApi {
  #missionServer;
  #eventLog;
  #supervisors;
  #drivers;
  #scene;
  #anomalyLog;
  #attentionInboxes = new Map();
  #registry;
  #policy;
  #packagePublicKey;
  #sessionStore;
  #clock;
  #idempotency = new Map();
  #supervisorEventSeq = new Map();
  #toolCallCommandIds = new Set();

  constructor({
    missionServer,
    eventLog = missionServer?.eventLog ?? new EventLog(),
    supervisors = new Map(),
    drivers = new Map(),
    scene = null,
    anomalyLog = null,
    registry = null,
    policy = null,
    packagePublicKey = null,
    tokens = defaultTokens(),
    sessionStore = null,
    clock = () => new Date()
  } = {}) {
    this.#eventLog = eventLog;
    this.#missionServer = missionServer ?? new MissionServer({ eventLog, scene, clock });
    this.#supervisors = asMap(supervisors);
    this.#drivers = asMap(drivers);
    this.#scene = scene;
    this.#anomalyLog = anomalyLog ?? new AnomalyLog({ eventLog });
    this.#registry = registry ?? new PolicyRegistry({ anomalyLog: this.#anomalyLog });
    this.#policy = policy;
    this.#packagePublicKey = packagePublicKey;
    this.#sessionStore = sessionStore ?? new EventLogSessionStore({ eventLog, sessions: sessionsFromTokens(tokens), clock });
    this.#clock = clock;
  }

  static withSim({ robotId = "go2", clock = () => new Date(), policy = null } = {}) {
    const eventLog = new EventLog({ clock });
    const scene = new SceneProjector({ eventLog, clock });
    const driver = new SimDriver({ robotId, clock });
    driver.connect();
    const missionServer = new MissionServer({ eventLog, scene, driverManifest: driver.manifest(), clock });
    const supervisor = new SupervisorKernel({
      robotId,
      driver,
      trustedPublicKey: missionServer.publicKey,
      clock
    });
    return new MissionApi({
      eventLog,
      missionServer,
      scene,
      supervisors: new Map([[robotId, supervisor]]),
      drivers: new Map([[robotId, driver]]),
      policy,
      clock
    });
  }

  async handle(request) {
    try {
      const normalized = normalizeRequest(request);
      const principal = this.#authenticate(normalized);
      this.#recordToolCall(normalized, principal);
      const response = await this.#idempotent(normalized, principal, () => this.#dispatch(normalized, principal));
      return {
        status: response.status ?? 200,
        headers: { ...JSON_HEADERS, ...(response.headers ?? {}) },
        body: response.body ?? response
      };
    } catch (error) {
      return errorResponse(error);
    }
  }

  async #dispatch(request, principal) {
    const route = routeFor(request);

    if (request.method === "GET" && route.path === "/health") {
      return {
        body: {
          schema_version: 1,
          status: "ok",
          principal: principal.principal,
          server_time: this.#clock().toISOString(),
          components: {
            mission_server: "ok",
            robots: [...this.#supervisors.keys()].sort(),
            scene: this.#scene ? "available" : "unavailable"
          }
        }
      };
    }

    if (request.method === "POST" && route.path === "/missions") {
      requireGrant(principal, "operator");
      const mission = this.#missionServer.createMission({
        idempotencyKey: idempotencyKey(request),
        preset: request.body.preset,
        robot_ids: request.body.robot_ids ?? [],
        principal: principal.principal
      });
      return { status: 201, body: mission };
    }

    const missionMatch = route.match(/^\/missions\/([^/]+)$/);
    if (request.method === "GET" && missionMatch) {
      return { body: this.#missionServer.getMission(missionMatch[1]) };
    }

    const missionCompleteMatch = route.match(/^\/missions\/([^/]+)\/complete$/);
    if (request.method === "POST" && missionCompleteMatch) {
      requireGrant(principal, "operator");
      return {
        body: this.#missionServer.completeMission({
          idempotencyKey: idempotencyKey(request),
          mission_id: missionCompleteMatch[1],
          principal: principal.principal,
          result: request.body.result ?? {}
        })
      };
    }

    const attentionMatch = route.match(/^\/missions\/([^/]+)\/attention$/);
    if (request.method === "GET" && attentionMatch) {
      const inbox = this.#attentionInbox(attentionMatch[1], principal.principal);
      return {
        body: {
          contract: inbox.contract(),
          pending: inbox.pending()
        }
      };
    }

    const drainMatch = route.match(/^\/missions\/([^/]+)\/drain$/);
    if (request.method === "POST" && drainMatch) {
      const inbox = this.#attentionInbox(drainMatch[1], principal.principal);
      return {
        body: inbox.drain({ cause: request.body.cause ?? "manual" })
      };
    }

    const waitMatch = route.match(/^\/missions\/([^/]+)\/wait$/);
    if (request.method === "POST" && waitMatch) {
      return {
        body: await this.#waitAttention(waitMatch[1], principal.principal, request.body)
      };
    }

    if (route.path === "/registry") {
      requireGrant(principal, "operator");
      if (request.method === "GET") {
        return { body: { items: this.#registry.list(), next: null } };
      }
      if (request.method === "POST") {
        return { status: 201, body: this.#registryInstall(request.body, principal.principal) };
      }
    }

    const registryMatch = route.match(/^\/registry\/([^/]+)$/);
    if (registryMatch) {
      requireGrant(principal, "operator");
      const packageId = decodeURIComponent(registryMatch[1]);
      if (request.method === "GET") {
        return { body: this.#registry.get(packageId) };
      }
    }

    const registryOpMatch = route.match(/^\/registry\/([^/]+)\/(pin|enable|promote|demote|revoke)$/);
    if (request.method === "POST" && registryOpMatch) {
      requireGrant(principal, "operator");
      return {
        body: this.#registryOp({
          packageId: decodeURIComponent(registryOpMatch[1]),
          op: registryOpMatch[2],
          body: request.body,
          principal: principal.principal
        })
      };
    }

    if (request.method === "GET" && route.path === "/robots") {
      return {
        body: {
          items: [...this.#supervisors.keys()].sort().map((robot_id) => ({ robot_id })),
          next: null
        }
      };
    }

    const robotVerbsMatch = route.match(/^\/robots\/([^/]+)\/verbs$/);
    if (request.method === "GET" && robotVerbsMatch) {
      const robot_id = robotVerbsMatch[1];
      this.#requireSupervisor(robot_id);
      const driverManifest = this.#drivers.get(robot_id)?.manifest?.() ?? null;
      const verbs =
        this.#policy?.verbsFor({ robot: robot_id, principal: principal.principal, driverManifest }) ??
        ["entity", "scene", "status", "stop"];
      return { body: { robot_id, principal: principal.principal, verbs } };
    }

    const robotStatusMatch = route.match(/^\/robots\/([^/]+)\/status$/);
    if (request.method === "GET" && robotStatusMatch) {
      return { body: this.#requireSupervisor(robotStatusMatch[1]).status() };
    }

    const robotStopMatch = route.match(/^\/robots\/([^/]+)\/stop$/);
    if (request.method === "POST" && robotStopMatch) {
      const robot_id = robotStopMatch[1];
      const supervisor = this.#requireSupervisor(robot_id);
      const result = supervisor.stop({ source: `api:${principal.principal}` });
      this.#recordSupervisorEvents(robot_id, supervisor);
      const event = this.#eventLog.append({
        schema_version: 1,
        source: "mission-api",
        event_type: "robot.stop",
        severity: 1,
        robot_id,
        payload: { principal: principal.principal, acked_at: result.acked_at }
      });
      return { body: { ...result, event_id: `evt_${event.seq}` } };
    }

    const robotClearStopMatch = route.match(/^\/robots\/([^/]+)\/clear-stop$/);
    if (request.method === "POST" && robotClearStopMatch) {
      requireGrant(principal, "operator");
      return { body: this.#requireSupervisor(robotClearStopMatch[1]).clearStop() };
    }

    if (request.method === "POST" && route.path === "/runs") {
      requireAnyGrant(principal, ["agent", "operator"]);
      const run = this.#missionServer.proposeRun({
        idempotencyKey: idempotencyKey(request),
        mission_id: request.body.mission_id,
        robot_id: request.body.robot_id,
        verb: request.body.verb,
        args: request.body.args ?? {},
        target: request.body.target,
        reason: request.body.reason,
        expected_result: request.body.expected_result,
        proposed_by: principal.principal
      });
      return { status: 201, body: run };
    }

    const runMatch = route.match(/^\/runs\/([^/]+)$/);
    if (request.method === "GET" && runMatch) {
      return { body: this.#missionServer.getRun(runMatch[1]) };
    }

    const approveMatch = route.match(/^\/runs\/([^/]+)\/approve$/);
    if (request.method === "POST" && approveMatch) {
      requireGrant(principal, "operator");
      const approved = this.#missionServer.approveRun({
        idempotencyKey: idempotencyKey(request),
        run_id: approveMatch[1],
        operator: principal.principal,
        reason: request.body.reason
      });
      const execution = this.#dispatchAuthorization(approved.authorization);
      return {
        body: {
          ...approved,
          run: this.#missionServer.getRun(approved.run.id),
          execution
        }
      };
    }

    const rejectMatch = route.match(/^\/runs\/([^/]+)\/reject$/);
    if (request.method === "POST" && rejectMatch) {
      requireGrant(principal, "operator");
      return {
        body: this.#missionServer.rejectRun({
          idempotencyKey: idempotencyKey(request),
          run_id: rejectMatch[1],
          operator: principal.principal,
          reason: request.body.reason
        })
      };
    }

    const replayMatch = route.match(/^\/runs\/([^/]+)\/replay$/);
    if (request.method === "GET" && replayMatch) {
      requireReplayGrant(principal);
      return { body: this.#missionServer.replayRun(replayMatch[1]) };
    }

    if (request.method === "GET" && route.path === "/scene") {
      if (!this.#scene) {
        throw new MissionApiError("SCENE_UNAVAILABLE", "Scene projection is not configured.", { status: 503, retryable: true });
      }
      return { body: request.query.since ? this.#scene.getSceneSince(request.query.since) : this.#scene.getScene() };
    }

    const entityMatch = route.match(/^\/entities\/([^/]+)$/);
    if (request.method === "GET" && entityMatch) {
      if (!this.#scene) {
        throw new MissionApiError("SCENE_UNAVAILABLE", "Scene projection is not configured.", { status: 503, retryable: true });
      }
      const snapshot = this.#scene.getScene();
      const entity = snapshot.entities.find((candidate) => candidate.id === entityMatch[1]);
      if (!entity) {
        throw new MissionApiError("ENTITY_NOT_IN_SCENE", `Entity ${entityMatch[1]} is not in the current scene.`, { status: 404 });
      }
      return { body: { entity, snapshot_id: snapshot.scene_snapshot_id } };
    }

    if (request.method === "POST" && route.path === "/anomalies") {
      requireGrant(principal, "operator");
      return {
        status: 201,
        body: this.#anomalyLog.open({
          ...request.body,
          source: `api:${principal.principal}`
        }).anomaly
      };
    }

    if (request.method === "GET" && route.path === "/anomalies") {
      return {
        body: {
          items: this.#anomalyLog.list({
            ...(request.query.status ? { status: request.query.status } : {}),
            ...(request.query.severity ? { severity: request.query.severity } : {}),
            ...(request.query.mission_id ? { mission_id: request.query.mission_id } : {}),
            ...(request.query.capability ? { capability: request.query.capability } : {})
          }),
          next: null
        }
      };
    }

    const anomalyPatchMatch = route.match(/^\/anomalies\/([^/]+)$/);
    if (request.method === "PATCH" && anomalyPatchMatch) {
      requireGrant(principal, "operator");
      const anomaly_id = anomalyPatchMatch[1];
      if (request.body.status === "closed") {
        return {
          body: this.#anomalyLog.close({
            anomaly_id,
            owner: request.body.owner ?? principal.principal,
            evidence_refs: request.body.evidence_refs ?? [],
            resolution: request.body.resolution,
            source: `api:${principal.principal}`
          }).anomaly
        };
      }
      if (request.body.owner) {
        this.#anomalyLog.assign({ anomaly_id, owner: request.body.owner, source: `api:${principal.principal}` });
      }
      return {
        body: this.#anomalyLog.update({
          anomaly_id,
          patch: request.body.patch ?? request.body,
          source: `api:${principal.principal}`
        }).anomaly
      };
    }

    if (request.method === "GET" && route.path === "/events") {
      const after = request.query.after ?? 0;
      const limit = Number(request.query.limit ?? 100);
      return { body: this.#eventLog.read(eventFilterFromQuery(request.query), { after, limit }) };
    }

    throw new MissionApiError("ROUTE_NOT_FOUND", `${request.method} ${route.path} is not a Mission API route.`, { status: 404 });
  }

  async #idempotent(request, principal, dispatch) {
    if (!isMutating(request.method)) {
      return dispatch();
    }
    const key = idempotencyKey(request);
    const cacheKey = `${principal.principal}:${request.method}:${request.path}:${key}`;
    if (this.#idempotency.has(cacheKey)) {
      return this.#idempotency.get(cacheKey);
    }
    const response = await dispatch();
    this.#idempotency.set(cacheKey, deepClone(response));
    return response;
  }

  #authenticate(request) {
    const auth = request.headers.authorization ?? request.headers.Authorization;
    if (!auth?.startsWith("Bearer ")) {
      throw new MissionApiError("AUTH_REQUIRED", "Mission API requires a bearer token.", { status: 401 });
    }
    const token = auth.slice("Bearer ".length);
    return this.#sessionStore.authenticate(token, { at: this.#clock() });
  }

  #requireSupervisor(robot_id) {
    const supervisor = this.#supervisors.get(robot_id);
    if (!supervisor) {
      throw new MissionApiError("ROBOT_NOT_FOUND", `Robot ${robot_id} is not registered.`, { status: 404 });
    }
    return supervisor;
  }

  #dispatchAuthorization(authorization) {
    const supervisor = this.#requireSupervisor(authorization.robot_id);
    const execution = supervisor.execute(authorization);
    this.#recordSupervisorEvents(authorization.robot_id, supervisor);
    return execution;
  }

  #recordSupervisorEvents(robot_id, supervisor) {
    const after = this.#supervisorEventSeq.get(robot_id) ?? 0;
    const events = supervisor.events({ after });
    for (const event of events) {
      const bridged = {
        schema_version: event.schema_version,
        source: event.source,
        event_type: event.event_type,
        severity: event.severity,
        robot_id: event.robot_id,
        mission_id: event.mission_id,
        run_id: event.run_id,
        refs: event.refs,
        payload: event.payload
      };
      if (event.event_type.startsWith("authorization.")) {
        this.#missionServer.recordAuthorizationEvent(bridged);
      } else {
        this.#eventLog.append(bridged);
      }
      this.#supervisorEventSeq.set(robot_id, event.seq);
    }
  }

  #recordToolCall(request, principal) {
    const raw = request.headers["x-nemeia-tool-call"];
    if (!raw) {
      return;
    }
    let payload;
    try {
      payload = JSON.parse(String(raw));
    } catch {
      return;
    }
    const command_id = typeof payload.command_id === "string" ? payload.command_id : null;
    if (!command_id || this.#toolCallCommandIds.has(command_id)) {
      return;
    }
    const argv = Array.isArray(payload.argv) ? payload.argv.map((value) => String(value)) : [];
    this.#eventLog.append({
      schema_version: 1,
      source: "nemeiactl",
      event_type: "tool.call",
      severity: 0,
      payload: {
        argv,
        principal: principal.principal,
        turn_id: payload.turn_id == null ? null : String(payload.turn_id),
        command_id
      }
    });
    this.#toolCallCommandIds.add(command_id);
  }

  #registryInstall(body, principal) {
    const registryState = {
      package: body.package,
      enabled: Boolean(body.enabled),
      pinned: Boolean(body.pinned),
      maturity: body.maturity ?? "experimental",
      gauntlet_report: body.gauntlet_report,
      history: body.history ?? []
    };
    validatePackageBundle({ registryState, bundle: body.bundle, publicKey: this.#packagePublicKey });
    const event = this.#eventLog.append({
      schema_version: 1,
      source: `operator:${principal}`,
      event_type: "registry.install",
      severity: 0,
      payload: {
        package: body.package,
        gauntlet_report: body.gauntlet_report,
        ...(body.bundle?.signature ? { package_signature: body.bundle.signature } : {})
      }
    });
    return this.#registry.install({
      ...registryState,
      history: [...registryState.history, event.seq, event.event_type]
    });
  }

  #registryOp({ packageId, op, body, principal }) {
    const before = this.#registry.get(packageId);
    let state;
    if (op === "pin") {
      state = this.#registry.pin(packageId);
    } else if (op === "enable") {
      state = this.#registry.enable(packageId);
    } else if (op === "promote") {
      state = this.#registry.promote(packageId, body.maturity ?? "trusted");
    } else if (op === "demote") {
      state = this.#registry.demote(packageId, body.maturity ?? "experimental");
    } else if (op === "revoke") {
      state = this.#registry.revoke(packageId);
    } else {
      throw new MissionApiError("REGISTRY_OP_UNKNOWN", `Unknown registry operation ${op}.`, { status: 404 });
    }
    const event = this.#eventLog.append({
      schema_version: 1,
      source: `operator:${principal}`,
      event_type: `registry.${op}`,
      severity: 0,
      payload: {
        package: packageId,
        before,
        after: state
      }
    });
    return this.#registry.install({
      ...state,
      history: [...(state.history ?? []), event.seq, event.event_type]
    });
  }

  #attentionInbox(mission_id, principal) {
    const mission = this.#missionServer.getMission(mission_id);
    const key = `${mission_id}:${principal}`;
    if (!this.#attentionInboxes.has(key)) {
      this.#attentionInboxes.set(
        key,
        new AttentionInbox({
          eventLog: this.#eventLog,
          anomalyLog: this.#anomalyLog,
          contract: contractFromPreset({ mission, principal }),
          clock: this.#clock
        })
      );
    }
    return this.#attentionInboxes.get(key);
  }

  async #waitAttention(mission_id, principal, body = {}) {
    const inbox = this.#attentionInbox(mission_id, principal);
    const timeoutMs = Math.max(0, Math.min(Number(body.timeout_ms ?? 0), 1_000));
    const startedAt = Date.now();
    while (true) {
      const armedTimerAt = inbox.nextTimerAt();
      if (inbox.shouldWake({ turn_active: Boolean(body.turn_active), bound_entity: body.bound_entity ?? null })) {
        const cause = armedTimerAt && armedTimerAt.getTime() <= this.#clock().getTime() ? "predicate_fired(timer)" : "predicate_fired(term)";
        return {
          woke: true,
          ...inbox.drain({ cause })
        };
      }
      if (Date.now() - startedAt >= timeoutMs) {
        return {
          woke: false,
          pending: inbox.pending()
        };
      }
      const timerAt = inbox.nextTimerAt();
      const remainingTimeout = timeoutMs - (Date.now() - startedAt);
      const timerDelay = timerAt ? Math.max(0, timerAt.getTime() - this.#clock().getTime()) : Infinity;
      await sleep(Math.max(1, Math.min(25, remainingTimeout, timerDelay)));
    }
  }
}

function normalizeRequest(request) {
  const url = new URL(request.url ?? request.path ?? "/", "http://nemeia.local");
  return {
    method: String(request.method ?? "GET").toUpperCase(),
    path: url.pathname,
    query: Object.fromEntries(url.searchParams.entries()),
    headers: normalizeHeaders(request.headers ?? {}),
    body: request.body ?? {}
  };
}

function normalizeHeaders(headers) {
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
}

function routeFor(request) {
  return {
    path: request.path,
    match: (pattern) => request.path.match(pattern)
  };
}

function eventFilterFromQuery(query) {
  return {
    ...(query.event_type ? { event_type: String(query.event_type) } : {}),
    ...(query.event_types ? { event_types: String(query.event_types).split(",").filter(Boolean) } : {}),
    ...(query.theme ? { theme: String(query.theme) } : {}),
    ...(query.themes ? { themes: String(query.themes).split(",").filter(Boolean) } : {}),
    ...(query.mission_id ? { mission_id: String(query.mission_id) } : {}),
    ...(query.run_id ? { run_id: String(query.run_id) } : {}),
    ...(query.robot_id ? { robot_id: String(query.robot_id) } : {}),
    ...(query.source ? { source: String(query.source) } : {}),
    ...(query.since ? { since: String(query.since) } : {}),
    ...(query.until ? { until: String(query.until) } : {})
  };
}

function idempotencyKey(request) {
  const key = request.headers["idempotency-key"];
  if (!key) {
    throw new MissionApiError("IDEMPOTENCY_KEY_REQUIRED", "Mutating Mission API requests require Idempotency-Key.", { status: 409 });
  }
  return String(key);
}

function isMutating(method) {
  return ["POST", "PATCH", "PUT", "DELETE"].includes(method);
}

function deepClone(value) {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function requireGrant(principal, grant) {
  if (!principal.grants.includes(grant)) {
    throw new MissionApiError("AUTH_FORBIDDEN", `Principal ${principal.principal} lacks ${grant} grant.`, { status: 403 });
  }
}

function requireAnyGrant(principal, grants) {
  if (!grants.some((grant) => principal.grants.includes(grant))) {
    throw new MissionApiError("AUTH_FORBIDDEN", `Principal ${principal.principal} lacks a required grant.`, { status: 403 });
  }
}

function requireReplayGrant(principal) {
  if (principal.grants.includes("operator")) {
    return;
  }
  if (principal.principal === "agent" && principal.grants.includes("read")) {
    return;
  }
  throw new MissionApiError("AUTH_FORBIDDEN", `Principal ${principal.principal} cannot read run replay.`, { status: 403 });
}

function asMap(value) {
  if (value instanceof Map) {
    return value;
  }
  return new Map(Object.entries(value));
}

function defaultTokens() {
  return {
    "operator-token": { principal: "operator", grants: ["operator"] },
    "agent-token": { principal: "agent", grants: ["agent", "read"] },
    "read-token": { principal: "reader", grants: ["read"] }
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
