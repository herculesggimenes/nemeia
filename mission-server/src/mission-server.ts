import { generateKeyPairSync } from "node:crypto";
import { signCanonicalJson } from "../../contracts/src/signing.ts";
import { ReplayBuilder } from "../../replay/src/replay-builder.ts";
import { EventLog } from "./event-log.ts";
import { makeId } from "./ids.ts";

const DEFAULT_APPROVAL_TTL_MS = 60_000;
const DEFAULT_AUTH_TTL_MS = 120_000;
const DEFAULT_AFFORDANCE_CONFIDENCE_MIN = 0.7;
const DEFAULT_SCENE_FRESHNESS_MS = 700;
const FORBIDDEN_PROPOSAL_FIELDS = new Set([
  "authorization",
  "authorization_ids",
  "abort_triggers",
  "checks",
  "enforcement",
  "freshness",
  "grant",
  "policy_rule",
  "scene",
  "scene_freshness",
  "scene_freshness_ms",
  "scene_snapshot",
  "scene_snapshot_id",
  "streams_granted"
]);
const FORBIDDEN_PROPOSAL_ARG_FIELDS = new Set([
  "affordance_confidence_min",
  "check",
  "checks",
  "freshness",
  "freshness_ms",
  "robot_status_ms",
  "scene_freshness",
  "scene_freshness_ms",
  "scene_ms",
  "scene_snapshot",
  "scene_snapshot_id"
]);

export class MissionServer {
  #clock;
  #eventLog;
  #scene;
  #policy;
  #driverManifest;
  #privateKey;
  #publicKey;
  #missions = new Map();
  #runs = new Map();
  #authorizations = new Map();
  #approvalDeadlines = new Map();
  #idempotency = new Map();

  constructor({
    eventLog = new EventLog(),
    scene = null,
    policy = null,
    driverManifest = null,
    clock = () => new Date(),
    signingKeyPair = null,
    signingKeyStore = null
  } = {}) {
    const keys = signingKeyStore?.current() ?? signingKeyPair ?? generateKeyPairSync("ed25519");
    this.#clock = clock;
    this.#eventLog = eventLog;
    this.#scene = scene;
    this.#policy = policy;
    this.#driverManifest = driverManifest;
    this.#privateKey = keys.privateKey;
    this.#publicKey = keys.publicKey;
  }

  get eventLog() {
    return this.#eventLog;
  }

  get publicKey() {
    return this.#publicKey;
  }

  createMission({ idempotencyKey, preset, robot_ids, principal = "operator" }) {
    return this.#idempotent(idempotencyKey, "createMission", () => {
      const mission = {
        id: makeId("msn"),
        schema_version: 1,
        preset,
        robot_ids,
        state: "active",
        created_at: this.#now()
      };
      this.#missions.set(mission.id, mission);
      this.#append("mission.created", {
        source: principal === "operator" ? "operator:local" : "mission-server",
        severity: 0,
        mission_id: mission.id,
        payload: { preset, robot_ids }
      });
      return mission;
    });
  }

  proposeRun(proposal) {
    assertProposalCarriesNoSafetyAssertions(proposal);
    const { idempotencyKey, mission_id, robot_id, verb, args = {}, target, reason, expected_result, proposed_by = "agent" } = proposal;
    return this.#idempotent(idempotencyKey, "proposeRun", () => {
      const mission = this.#requireActiveMission(mission_id);
      assertRobotInMission({ mission, robot_id });
      const policyRule = this.#matchPolicy({ verb, robot_id, principal: proposed_by });
      const boundTarget = this.#bindTargetIfNeeded({ verb, args, target });
      assertProposalArgsAreTyped({ verb, args });
      assertProposalWithinBounds({ verb, args, policyRule, driverManifest: this.#driverManifest });
      const approvalExpiresAt = this.#after(DEFAULT_APPROVAL_TTL_MS);
      const run = {
        id: makeId("run"),
        schema_version: 1,
        mission_id,
        robot_id,
        verb,
        args,
        ...(boundTarget ? { target: boundTarget } : {}),
        ...(reason ? { reason } : {}),
        ...(expected_result ? { expected_result } : {}),
        proposed_by,
        ...(policyRule && !policyRule.injected ? { policy_rule: policyRule } : {}),
        state: "awaiting_approval",
        authorization_ids: []
      };
      this.#runs.set(run.id, run);
      this.#approvalDeadlines.set(run.id, approvalExpiresAt);
      this.#append("run.proposed", {
        source: proposed_by === "agent" ? `agent:${mission_id}` : "operator:local",
        severity: 0,
        robot_id,
        mission_id,
        run_id: run.id,
        payload: { verb, args, target: boundTarget }
      });
      this.#append("run.awaiting_approval", {
        source: "mission-server",
        severity: 0,
        robot_id,
        mission_id,
        run_id: run.id,
        payload: { approval_expires_at: approvalExpiresAt }
      });
      return run;
    });
  }

  approveRun({ idempotencyKey, run_id, operator = "op_local", reason }) {
    return this.#idempotent(idempotencyKey, "approveRun", () => {
      const run = this.#requireAwaitingApproval(run_id);

      const decidedAt = this.#now();
      const approved = {
        ...run,
        approval: {
          operator,
          decided_at: decidedAt,
          expires_at: this.#after(DEFAULT_APPROVAL_TTL_MS)
        }
      };
      this.#runs.set(run_id, approved);

      this.#append("run.authorized", {
        source: "operator:local",
        severity: 0,
        robot_id: run.robot_id,
        mission_id: run.mission_id,
        run_id,
        payload: { operator, reason }
      });

      const checks = this.#evaluateChecks(approved);
      const livePolicyRule = this.#matchPolicy({ verb: approved.verb, robot_id: approved.robot_id, principal: approved.proposed_by });
      const authorization = this.#issueAuthorization({ ...approved, policy_rule: livePolicyRule?.injected ? approved.policy_rule : livePolicyRule }, checks);
      const authorizedRun = {
        ...approved,
        state: "authorized",
        authorization_ids: [authorization.id]
      };
      this.#runs.set(run_id, authorizedRun);
      this.#approvalDeadlines.delete(run_id);

      this.#append("authorization.dispatched", {
        source: "mission-server",
        severity: 0,
        robot_id: run.robot_id,
        mission_id: run.mission_id,
        run_id,
        refs: [authorization.id],
        payload: { authorization_id: authorization.id }
      });

      return { run: authorizedRun, authorization };
    });
  }

  rejectRun({ idempotencyKey, run_id, operator = "op_local", reason = "" }) {
    return this.#idempotent(idempotencyKey, "rejectRun", () => {
      const run = this.#requireAwaitingApproval(run_id);
      const rejected = {
        ...run,
        state: "rejected",
        result: {
          summary: reason || "Rejected by operator.",
          observed: {}
        }
      };
      this.#runs.set(run_id, rejected);
      this.#approvalDeadlines.delete(run_id);
      this.#append("run.rejected", {
        source: "operator:local",
        severity: 0,
        robot_id: run.robot_id,
        mission_id: run.mission_id,
        run_id,
        payload: { operator, reason }
      });
      return rejected;
    });
  }

  completeMission({ idempotencyKey, mission_id, principal = "operator", result = {} }) {
    return this.#idempotent(idempotencyKey, "completeMission", () => {
      const mission = this.#requireActiveMission(mission_id);
      const completed = {
        ...mission,
        state: "completed",
        completed_at: this.#now(),
        result
      };
      this.#missions.set(mission_id, completed);
      this.#append("mission.completed", {
        source: principal === "operator" ? "operator:local" : "mission-server",
        severity: 0,
        mission_id,
        payload: { result }
      });
      return completed;
    });
  }

  recordAuthorizationEvent(event) {
    const persisted = this.#append(event.event_type, {
      schema_version: event.schema_version ?? 1,
      source: event.source,
      severity: event.severity ?? 0,
      robot_id: event.robot_id,
      mission_id: event.mission_id,
      run_id: event.run_id,
      refs: event.refs ?? [],
      payload: event.payload ?? {}
    });
    this.#projectRunAuthorizationEvent(persisted);
    return persisted;
  }

  getMission(mission_id) {
    return this.#requireMission(mission_id);
  }

  getRun(run_id) {
    return this.#requireRun(run_id);
  }

  getAuthorization(authorization_id) {
    const authorization = this.#authorizations.get(authorization_id);
    if (!authorization) {
      throw new MissionServerError("AUTHORIZATION_NOT_FOUND", `Authorization ${authorization_id} was not found.`);
    }
    return authorization;
  }

  replayRun(run_id) {
    this.#requireRun(run_id);
    return new ReplayBuilder({
      eventLog: this.#eventLog,
      getAuthorization: (authorizationId) => this.#authorizations.get(authorizationId) ?? null
    }).buildRunReplay(run_id);
  }

  #issueAuthorization(run, checks) {
    const grant = grantForRun(run);
    const capability = capabilityForRun(run);
    const unsigned = {
      id: makeId("auth"),
      schema_version: 1,
      robot_id: run.robot_id,
      run_id: run.id,
      mission_id: run.mission_id,
      grant,
      enforcement: enforcementForGrant(grant, this.#driverManifest),
      ...(run.target ? { target: { entity_id: run.target.entity_id, snapshot_id: run.target.snapshot_id } } : {}),
      streams_granted: run.policy_rule?.streams ?? (capability ? ["camera_front"] : []),
      abort_triggers: run.policy_rule?.abort_triggers ?? (capability ? [{ target_stale: { max_ms: 700 } }, "operator_stop", "stream_silence"] : ["operator_stop", "battery_low"]),
      ...(capability ? { capability } : {}),
      checks,
      issued_at: this.#now(),
      expires_at: this.#after(DEFAULT_AUTH_TTL_MS),
      signature: ""
    };
    const authorization = {
      ...unsigned,
      signature: signCanonicalJson(unsigned, this.#privateKey)
    };
    this.#authorizations.set(authorization.id, authorization);

    this.#append("authorization.issued", {
      source: "mission-server",
      severity: 0,
      robot_id: run.robot_id,
      mission_id: run.mission_id,
      run_id: run.id,
      refs: [authorization.id],
      payload: {
        authorization_id: authorization.id,
        checks
      }
    });
    return authorization;
  }

  #evaluateChecks(run) {
    return [
      {
        name: "policy.principal_grant",
        result: "pass",
        mode: "enforcing",
        details: { principal: run.proposed_by }
      },
      {
        name: "policy.approval",
        result: "pass",
        mode: "enforcing",
        details: { approval: run.approval }
      },
      {
        name: "bounds.grant",
        result: "pass",
        mode: "enforcing",
        details: { args: run.args }
      }
    ];
  }

  #append(event_type, event) {
    return this.#eventLog.append({
      schema_version: 1,
      event_type,
      payload: {},
      ...event
    });
  }

  #requireMission(mission_id) {
    const mission = this.#missions.get(mission_id);
    if (!mission) {
      throw new MissionServerError("MISSION_NOT_FOUND", `Mission ${mission_id} was not found.`);
    }
    return mission;
  }

  #requireActiveMission(mission_id) {
    const mission = this.#requireMission(mission_id);
    if (mission.state !== "active") {
      throw new MissionServerError("MISSION_NOT_ACTIVE", `Mission ${mission_id} is ${mission.state}.`, { state: mission.state });
    }
    return mission;
  }

  #requireRun(run_id) {
    const run = this.#runs.get(run_id);
    if (!run) {
      throw new MissionServerError("RUN_NOT_FOUND", `Run ${run_id} was not found.`);
    }
    return run;
  }

  #requireAwaitingApproval(run_id) {
    const run = this.#requireRun(run_id);
    if (run.state !== "awaiting_approval") {
      throw new MissionServerError("RUN_NOT_AWAITING_APPROVAL", `Run ${run_id} is ${run.state}.`);
    }
    const approvalExpiresAt = this.#approvalDeadlines.get(run_id);
    if (approvalExpiresAt && new Date(approvalExpiresAt).getTime() <= this.#clock().getTime()) {
      const expired = { ...run, state: "expired" };
      this.#runs.set(run_id, expired);
      this.#approvalDeadlines.delete(run_id);
      this.#append("run.expired", {
        source: "mission-server",
        severity: 0,
        robot_id: run.robot_id,
        mission_id: run.mission_id,
        run_id,
        payload: { approval_expires_at: approvalExpiresAt }
      });
      throw new MissionServerError("APPROVAL_EXPIRED", `Run ${run_id} approval window expired.`, {
        approval_expires_at: approvalExpiresAt
      });
    }
    return run;
  }

  #projectRunAuthorizationEvent(event) {
    if (!event.run_id || !event.event_type?.startsWith("authorization.")) {
      return;
    }
    const run = this.#requireRun(event.run_id);
    const authorizationId = event.payload?.authorization_id ?? event.refs?.find((ref) => typeof ref === "string" && ref.startsWith("auth_"));
    if (authorizationId && !run.authorization_ids.includes(authorizationId)) {
      throw new MissionServerError("AUTHORIZATION_NOT_FOUND", `Authorization ${authorizationId} is not attached to run ${run.id}.`, {
        authorization_id: authorizationId,
        run_id: run.id
      });
    }
    if ((event.event_type === "authorization.accepted" || event.event_type === "authorization.active") && run.state === "authorized") {
      const executing = { ...run, state: "executing" };
      this.#runs.set(run.id, executing);
      this.#append("run.executing", {
        source: "mission-server",
        severity: 0,
        robot_id: run.robot_id,
        mission_id: run.mission_id,
        run_id: run.id,
        refs: authorizationId ? [authorizationId] : [],
        payload: { authorization_id: authorizationId }
      });
      return;
    }
    if (event.event_type === "authorization.completed" && (run.state === "authorized" || run.state === "executing")) {
      const completed = {
        ...run,
        state: "completed",
        result: {
          summary: event.payload?.reason ?? "Authorization completed.",
          observed: { authorization_id: authorizationId }
        }
      };
      this.#runs.set(run.id, completed);
      this.#append("run.completed", {
        source: "mission-server",
        severity: 0,
        robot_id: run.robot_id,
        mission_id: run.mission_id,
        run_id: run.id,
        refs: authorizationId ? [authorizationId] : [],
        payload: completed.result
      });
      return;
    }
    if ((event.event_type === "authorization.aborted" || event.event_type === "authorization.stopped") && (run.state === "authorized" || run.state === "executing")) {
      const trigger = event.payload?.trigger ?? (event.event_type === "authorization.stopped" ? "operator_stop" : "aborted");
      const aborted = {
        ...run,
        state: "aborted",
        result: {
          summary: `Run aborted: ${trigger}`,
          observed: { authorization_id: authorizationId, trigger }
        }
      };
      this.#runs.set(run.id, aborted);
      this.#append("run.aborted", {
        source: "mission-server",
        severity: event.severity,
        robot_id: run.robot_id,
        mission_id: run.mission_id,
        run_id: run.id,
        refs: authorizationId ? [authorizationId] : [],
        payload: aborted.result
      });
    }
  }

  #idempotent(idempotencyKey, operation, create) {
    if (!idempotencyKey) {
      throw new MissionServerError("IDEMPOTENCY_KEY_REQUIRED", `${operation} requires an idempotency key.`);
    }
    const key = `${operation}:${idempotencyKey}`;
    if (this.#idempotency.has(key)) {
      return this.#idempotency.get(key);
    }
    const result = create();
    this.#idempotency.set(key, result);
    return result;
  }

  #now() {
    return this.#clock().toISOString();
  }

  #after(ms) {
    return new Date(this.#clock().getTime() + ms).toISOString();
  }

  #bindTargetIfNeeded({ verb, args, target }) {
    if (!target || !this.#scene) {
      return target;
    }
    return this.#scene.bind({
      verb,
      target,
      confidenceThreshold: DEFAULT_AFFORDANCE_CONFIDENCE_MIN,
      freshnessMaxMs: DEFAULT_SCENE_FRESHNESS_MS
    });
  }

  #matchPolicy({ verb, robot_id, principal }) {
    if (!this.#policy) {
      return null;
    }
    return this.#policy.matchRule({
      verb,
      robot: robot_id,
      principal,
      driverManifest: this.#driverManifest
    });
  }
}

function assertProposalCarriesNoSafetyAssertions(proposal) {
  for (const field of Object.keys(proposal ?? {})) {
    if (FORBIDDEN_PROPOSAL_FIELDS.has(field)) {
      throw new MissionServerError("UNKNOWN_FIELD_FORBIDDEN", `Run proposal field ${field} is safety-relevant and must be derived server-side.`, { field });
    }
  }
  for (const field of Object.keys(proposal?.args ?? {})) {
    if (FORBIDDEN_PROPOSAL_ARG_FIELDS.has(field)) {
      throw new MissionServerError("UNKNOWN_FIELD_FORBIDDEN", `Run proposal arg ${field} is safety-relevant and must be derived server-side.`, { field: `args.${field}` });
    }
  }
  for (const field of Object.keys(proposal?.target ?? {})) {
    if (FORBIDDEN_PROPOSAL_ARG_FIELDS.has(field) || field === "freshness" || field === "freshness_ms") {
      throw new MissionServerError("UNKNOWN_FIELD_FORBIDDEN", `Run proposal target field ${field} is safety-relevant and must be derived server-side.`, { field: `target.${field}` });
    }
  }
}

function assertRobotInMission({ mission, robot_id }) {
  if (Array.isArray(mission.robot_ids) && !mission.robot_ids.includes(robot_id)) {
    throw new MissionServerError("ROBOT_NOT_FOUND", `Robot ${robot_id} is not part of mission ${mission.id}.`, {
      robot_id,
      mission_id: mission.id
    });
  }
}

function assertProposalArgsAreTyped({ verb, args = {} }) {
  const numericFields =
    verb === "bounded_move"
      ? ["x", "y", "yaw", "vx_mps", "vy_mps", "yaw_rps", "duration_ms", "duration-ms"]
      : ["max_speed_mps", "max_yaw_rps", "watchdog_ms", "max_duration_ms", "duration_ms", "duration-ms"];
  for (const field of numericFields) {
    if (!(field in args)) {
      continue;
    }
    assertFiniteNumber(`args.${field}`, args[field]);
  }
  for (const field of ["max_speed_mps", "max_yaw_rps", "watchdog_ms", "max_duration_ms", "duration_ms", "duration-ms"]) {
    if (field in args && args[field] <= 0) {
      throw new MissionServerError("ARG_OUT_OF_RANGE", `Run proposal arg ${field} must be greater than zero.`, { field: `args.${field}` });
    }
  }
}

function assertFiniteNumber(field, value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new MissionServerError("ARG_OUT_OF_RANGE", `Run proposal ${field} must be a finite number.`, { field });
  }
}

function assertProposalWithinBounds({ verb, args = {}, policyRule = null, driverManifest = null }) {
  if (!driverManifest) {
    return;
  }
  const actionSpace = actionSpaceFor(driverManifest, policyRule?.grant?.action_space ?? "base_velocity_3d");
  if (!actionSpace) {
    return;
  }
  if (verb === "bounded_move") {
    const setpoint = normalizeSetpoint(args);
    assertSetpointWithinHardCaps(setpoint, actionSpace.hard_caps);
    return;
  }
  const limits = {
    ...(policyRule?.grant?.limits ?? {}),
    ...(args.max_speed_mps !== undefined ? { max_speed_mps: args.max_speed_mps } : {}),
    ...(args.max_yaw_rps !== undefined ? { max_yaw_rps: args.max_yaw_rps } : {})
  };
  if (policyRule?.grant?.limits) {
    assertRequestedLimitWithinPolicy("max_speed_mps", args.max_speed_mps, policyRule.grant.limits.max_speed_mps);
    assertRequestedLimitWithinPolicy("max_yaw_rps", args.max_yaw_rps, policyRule.grant.limits.max_yaw_rps);
  }
  assertStreamLimitsWithinHardCaps(limits, actionSpace.hard_caps);
}

function assertSetpointWithinHardCaps(setpoint, hardCaps = {}) {
  for (const [field, value] of Object.entries(setpoint)) {
    const cap = hardCaps[field];
    if (cap !== undefined && Math.abs(value) > cap) {
      throw new MissionServerError("COMMAND_BOUNDS_EXCEEDED", `Run proposal ${field} exceeds driver hard cap.`, { field: `args.${argNameForSetpoint(field)}`, requested: value, cap });
    }
  }
}

function assertStreamLimitsWithinHardCaps(limits = {}, hardCaps = {}) {
  const linearCap = Math.min(...["vx_mps", "vy_mps"].map((field) => hardCaps[field]).filter((value) => typeof value === "number"));
  if (limits.max_speed_mps !== undefined && Number.isFinite(linearCap) && limits.max_speed_mps > linearCap) {
    throw new MissionServerError("COMMAND_BOUNDS_EXCEEDED", "Run proposal max_speed_mps exceeds driver hard cap.", {
      field: "args.max_speed_mps",
      requested: limits.max_speed_mps,
      cap: linearCap
    });
  }
  if (limits.max_yaw_rps !== undefined && hardCaps.yaw_rps !== undefined && limits.max_yaw_rps > hardCaps.yaw_rps) {
    throw new MissionServerError("COMMAND_BOUNDS_EXCEEDED", "Run proposal max_yaw_rps exceeds driver hard cap.", {
      field: "args.max_yaw_rps",
      requested: limits.max_yaw_rps,
      cap: hardCaps.yaw_rps
    });
  }
}

function assertRequestedLimitWithinPolicy(field, requested, cap) {
  if (requested !== undefined && cap !== undefined && requested > cap) {
    throw new MissionServerError("COMMAND_BOUNDS_EXCEEDED", `Run proposal ${field} exceeds policy grant.`, { field: `args.${field}`, requested, cap });
  }
}

function actionSpaceFor(driverManifest, name) {
  if (!driverManifest) {
    return null;
  }
  return driverManifest.action_spaces?.find((space) => space.name === name) ?? null;
}

function argNameForSetpoint(field) {
  return { vx_mps: "x", vy_mps: "y", yaw_rps: "yaw" }[field] ?? field;
}

export class MissionServerError extends Error {
  constructor(error_code, message, details = {}) {
    super(message);
    this.name = "MissionServerError";
    this.error_code = error_code;
    this.details = details;
  }
}

function normalizeSetpoint(args) {
  return {
    vx_mps: Number(args.vx_mps ?? args.x ?? 0),
    vy_mps: Number(args.vy_mps ?? args.y ?? 0),
    yaw_rps: Number(args.yaw_rps ?? args.yaw ?? 0)
  };
}

function grantForRun(run) {
  if (run.policy_rule) {
    const grant = run.policy_rule.grant ?? {};
    return {
      stream: {
        action_space: grant.action_space ?? "base_velocity_3d",
        limits: grant.limits ?? {
          max_speed_mps: Number(run.args.max_speed_mps ?? 0.15),
          max_yaw_rps: Number(run.args.max_yaw_rps ?? 0.2)
        },
        watchdog_ms: Number(grant.watchdog_ms ?? run.args.watchdog_ms ?? 100),
        max_duration_ms: Number(grant.max_duration_ms ?? run.args.max_duration_ms ?? 120_000)
      }
    };
  }
  if (run.verb === "bounded_move") {
    return {
      discrete: {
        type: "bounded_move",
        setpoint: normalizeSetpoint(run.args),
        duration_ms: Number(run.args.duration_ms ?? run.args["duration-ms"] ?? 400)
      }
    };
  }
  if (run.verb.startsWith("native:")) {
    return {
      discrete: {
        type: run.verb,
        setpoint: { ...run.args },
        duration_ms: Number(run.args.duration_ms ?? run.args["duration-ms"] ?? 200)
      }
    };
  }
  return {
    stream: {
      action_space: "base_velocity_3d",
      limits: {
        max_speed_mps: Number(run.args.max_speed_mps ?? 0.15),
        max_yaw_rps: Number(run.args.max_yaw_rps ?? 0.2)
      },
      watchdog_ms: Number(run.args.watchdog_ms ?? 100),
      max_duration_ms: Number(run.args.max_duration_ms ?? 120_000)
    }
  };
}

function capabilityForRun(run) {
  if (run.verb === "bounded_move") {
    return null;
  }
  if (run.policy_rule) {
    return {
      verb: run.policy_rule.verb,
      impl: `cap:${run.policy_rule.impl.capability}@${run.policy_rule.impl.version}`
    };
  }
  return {
    verb: run.verb,
    impl: `cap:${run.verb}-entity@0.1.0`
  };
}

function enforcementForGrant(grant, driverManifest = null) {
  if (grant.stream) {
    const actionSpace = actionSpaceFor(driverManifest, grant.stream.action_space);
    return Object.fromEntries(Object.keys(grant.stream.limits).map((name) => [name, enforcementForLimit(name, actionSpace)]));
  }
  return { max_speed_mps: "enforcing" };
}

function enforcementForLimit(limitName, actionSpace) {
  if (!actionSpace) {
    return "enforcing";
  }
  const observable = observableForLimit(limitName);
  if (!observable) {
    return "advisory";
  }
  const support = actionSpace.observables?.[observable];
  return support === "measured" || support === "inferred_from_current" ? "enforcing" : "advisory";
}

function observableForLimit(limitName) {
  if (/speed|yaw|velocity|vx|vy/i.test(limitName)) {
    return "velocity";
  }
  if (/force|torque|load/i.test(limitName)) {
    return "force";
  }
  return null;
}
