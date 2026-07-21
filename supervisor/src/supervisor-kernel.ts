import { verifyCanonicalJson } from "../../contracts/src/signing.ts";
import { KernelError } from "./kernel-errors.ts";

const DEFAULT_HEARTBEAT_MAX_AGE_MS = 500;
const DEFAULT_CLOCK_SKEW_MS = 250;
const RUN_CAUSAL_DRIVER_EVENTS = new Set([
  "driver.native_action",
  "driver.safe_state_commanded",
  "driver.setpoint_applied"
]);

export class SupervisorKernel {
  #robotId;
  #driver;
  #trustedPublicKey;
  #clock;
  #heartbeatMaxAgeMs;
  #clockSkewMs;
  #stopState = false;
  #activeAuthorization = null;
  #activeStream = null;
  #consumed = new Map();
  #events = [];
  #nextSeq = 1;
  #lastStatusSampleAtMs = null;
  #driverEventCursor = 0;

  constructor({
    robotId,
    driver,
    trustedPublicKey,
    clock = () => new Date(),
    heartbeatMaxAgeMs = DEFAULT_HEARTBEAT_MAX_AGE_MS,
    clockSkewMs = DEFAULT_CLOCK_SKEW_MS
  }) {
    this.#robotId = robotId;
    this.#driver = driver;
    this.#trustedPublicKey = trustedPublicKey;
    this.#clock = clock;
    this.#heartbeatMaxAgeMs = heartbeatMaxAgeMs;
    this.#clockSkewMs = clockSkewMs;
    this.#driverEventCursor = latestDriverSeq(driver);
  }

  status() {
    return this.#statusSnapshot();
  }

  #statusSnapshot() {
    const driverStatus = this.#driver.status();
    return {
      ...driverStatus,
      kernel: {
        stop_state: this.#stopState,
        active_authorization: this.#activeAuthorization?.id ?? null,
        heartbeat_max_age_ms: this.#heartbeatMaxAgeMs,
        safe_state_condition: driverStatus.safe_state_active ? "active" : "inactive"
      }
    };
  }

  stop({ source = "operator_stop" } = {}) {
    const activeAuthorization = this.#activeAuthorization;
    this.#stopState = true;
    this.#driver.command_safe_state();
    if (activeAuthorization) {
      this.#ingestDriverEvents(activeAuthorization);
      this.#emit("authorization.stopped", activeAuthorization, { trigger: source }, 1);
      this.#activeAuthorization = null;
      this.#activeStream = null;
    }
    this.#emitKernel("kernel.stop_state_set", { source }, 0, activeAuthorization);
    return { stop_state: true, acked_at: this.#now() };
  }

  clearStop() {
    this.#stopState = false;
    this.#emitKernel("kernel.stop_state_cleared", {});
    return { stop_state: false, acked_at: this.#now() };
  }

  upstreamLost({ source = "mission_server_connection_lost" } = {}) {
    if (!this.#activeAuthorization) {
      this.#emitKernel("kernel.upstream_lost", { source });
      return { state: "idle", trigger: "upstream_loss" };
    }
    return this.#abortActive("upstream_loss", "authorization.aborted", { source });
  }

  execute(authorization) {
    this.#verifyAuthorization(authorization);
    this.#consumed.set(authorization.id, this.#clock().getTime());
    this.#activeAuthorization = authorization;
    this.#emit("authorization.accepted", authorization, { authorization_id: authorization.id });

    if (authorization.grant.discrete) {
      return this.#executeDiscrete(authorization);
    }

    this.#activeStream = {
      authorization,
      latestChunk: null,
      lastSeq: 0,
      startedAtMs: this.#clock().getTime(),
      lastValidChunkAtMs: null
    };
    this.#emit("authorization.active", authorization, { authorization_id: authorization.id });
    return {
      state: "active",
      authorization_id: authorization.id,
      chunk_channel: `chunks/${authorization.id}`
    };
  }

  submitChunk(chunk) {
    if (!this.#activeStream || !this.#activeAuthorization) {
      throw new KernelError("NO_ACTIVE_AUTHORIZATION", "No stream authorization is active.");
    }
    const authorization = this.#activeAuthorization;
    if (chunk.auth_id !== authorization.id) {
      throw new KernelError("AUTHZ_CHUNK_MISMATCH", `Chunk is for ${chunk.auth_id}, not ${authorization.id}.`);
    }
    if (!Number.isInteger(chunk.seq) || chunk.seq <= this.#activeStream.lastSeq) {
      throw new KernelError("CHUNK_SEQUENCE", "Chunk seq must be strictly increasing.", {
        seq: chunk.seq,
        last_seq: this.#activeStream.lastSeq
      });
    }
    this.#validateSetpointFields(chunk.setpoint, authorization);
    this.#activeStream.latestChunk = {
      auth_id: chunk.auth_id,
      seq: chunk.seq,
      setpoint: { ...chunk.setpoint },
      received_at_ms: this.#clock().getTime()
    };
    this.#activeStream.lastSeq = chunk.seq;
    this.#activeStream.lastValidChunkAtMs = this.#clock().getTime();
    return { accepted: true, seq: chunk.seq };
  }

  tick() {
    this.#emitStatusSampleDue();
    if (!this.#activeAuthorization || !this.#activeStream) {
      return { state: "idle" };
    }

    const authorization = this.#activeAuthorization;
    const stream = authorization.grant.stream;
    const nowMs = this.#clock().getTime();

    if (this.#stopState) {
      return this.#abortActive("operator_stop", "authorization.stopped");
    }
    if (this.#isExpired(authorization)) {
      return this.#abortActive("expired", "authorization.aborted");
    }

    const status = this.#driver.status();
    if (status.heartbeat_age_ms > this.#heartbeatMaxAgeMs) {
      return this.#abortActive("stale_heartbeat", "authorization.aborted");
    }

    if (nowMs - this.#activeStream.startedAtMs > stream.max_duration_ms) {
      return this.#completeActive("max_duration_elapsed");
    }

    if (!this.#activeStream.latestChunk) {
      if (nowMs - this.#activeStream.startedAtMs > stream.watchdog_ms) {
        return this.#abortActive("stream_silence", "authorization.aborted");
      }
      return { state: "waiting_for_chunk", authorization_id: authorization.id };
    }

    if (nowMs - this.#activeStream.lastValidChunkAtMs > stream.watchdog_ms) {
      return this.#abortActive("stream_silence", "authorization.aborted");
    }

    const chunk = this.#activeStream.latestChunk;
    const applied_setpoint = this.#clampSetpoint(chunk.setpoint, authorization);
    this.#driver.set_setpoint(stream.action_space, applied_setpoint);
    this.#ingestDriverEvents(authorization);
    const ack = {
      seq: chunk.seq,
      applied_setpoint
    };
    this.#emit("kernel.chunk_applied", authorization, {
      authorization_id: authorization.id,
      ...ack
    });
    return {
      state: "active",
      authorization_id: authorization.id,
      chunk_ack: ack
    };
  }

  events({ after = 0 } = {}) {
    this.#ingestDriverEvents();
    return this.#events.filter((event) => event.seq > after);
  }

  #executeDiscrete(authorization) {
    const grant = authorization.grant.discrete;
    this.#emit("authorization.active", authorization, { authorization_id: authorization.id });
    const applied_setpoint = this.#clampSetpoint(grant.setpoint, authorization);
    if (grant.type === "bounded_move") {
      this.#driver.set_setpoint("base_velocity_3d", applied_setpoint);
      this.#ingestDriverEvents(authorization);
      this.#emit("kernel.chunk_applied", authorization, {
        authorization_id: authorization.id,
        seq: 1,
        applied_setpoint
      });
      this.#driver.command_safe_state();
      this.#ingestDriverEvents(authorization);
      this.#emit("kernel.zero_command_sent", authorization, { authorization_id: authorization.id });
    } else {
      this.#driver.execute_discrete(grant.type.slice("native:".length), applied_setpoint, grant.duration_ms);
      this.#ingestDriverEvents(authorization);
      this.#driver.command_safe_state();
      this.#ingestDriverEvents(authorization);
    }
    this.#emit("authorization.completed", authorization, { authorization_id: authorization.id });
    this.#activeAuthorization = null;
    this.#activeStream = null;
    return {
      state: "completed",
      authorization_id: authorization.id,
      applied_setpoint
    };
  }

  #verifyAuthorization(authorization) {
    if (!verifyCanonicalJson(authorization, this.#trustedPublicKey)) {
      throw new KernelError("AUTHZ_SIGNATURE_INVALID", "Authorization signature verification failed.");
    }
    if (this.#isExpired(authorization)) {
      throw new KernelError("AUTHZ_EXPIRED", "Authorization is expired.");
    }
    if (this.#consumed.has(authorization.id)) {
      throw new KernelError("AUTHZ_REPLAYED", "Authorization has already been consumed.");
    }
    if (authorization.robot_id !== this.#robotId) {
      throw new KernelError("AUTHZ_ROBOT_MISMATCH", `Authorization is for ${authorization.robot_id}, not ${this.#robotId}.`);
    }
    this.#verifyHardCaps(authorization);
    const status = this.#driver.status();
    if (status.heartbeat_age_ms > this.#heartbeatMaxAgeMs) {
      throw new KernelError("STALE_ROBOT_STATUS", `Robot status age ${status.heartbeat_age_ms} ms exceeds ${this.#heartbeatMaxAgeMs} ms.`, {
        heartbeat_age_ms: status.heartbeat_age_ms
      });
    }
    if (this.#stopState) {
      throw new KernelError("STOP_STATE_ACTIVE", "Kernel stop state is active.");
    }
    if (this.#activeAuthorization) {
      throw new KernelError("AUTHZ_CONCURRENCY", "Another authorization is already active.");
    }
  }

  #isExpired(authorization) {
    return new Date(authorization.expires_at).getTime() + this.#clockSkewMs < this.#clock().getTime();
  }

  #verifyHardCaps(authorization) {
    const manifest = this.#driver.manifest();
    const setpoint = authorization.grant.discrete?.setpoint;
    if (!setpoint) {
      const streamActionSpace = authorization.grant.stream?.action_space;
      if (streamActionSpace && !manifest.action_spaces.some((space) => space.name === streamActionSpace)) {
        throw new KernelError("ACTION_SPACE_UNSUPPORTED", `Driver does not support ${streamActionSpace}.`);
      }
      return;
    }
    const actionSpace = manifest.action_spaces.find((space) => space.name === "base_velocity_3d");
    if (!actionSpace) {
      throw new KernelError("ACTION_SPACE_UNSUPPORTED", "Driver does not support base_velocity_3d.");
    }
    for (const [field, value] of Object.entries(setpoint)) {
      const cap = actionSpace.hard_caps[field];
      if (cap !== undefined && Math.abs(value) > cap) {
        throw new KernelError("AUTHZ_HARD_CAP_EXCEEDED", `${field}=${value} exceeds driver hard cap ${cap}.`, { field, value, cap });
      }
    }
  }

  #clampSetpoint(setpoint, authorization) {
    const manifest = this.#driver.manifest();
    const actionSpaceName = authorization.grant.stream?.action_space ?? "base_velocity_3d";
    const actionSpace = manifest.action_spaces.find((space) => space.name === actionSpaceName);
    const clamped = {};
    for (const [field, value] of Object.entries(setpoint)) {
      const cap = actionSpace?.hard_caps?.[field];
      const grantCap = grantLimitForField(field, authorization);
      const effectiveCap = minDefined(cap, grantCap);
      clamped[field] = effectiveCap === undefined ? value : Math.max(-effectiveCap, Math.min(effectiveCap, value));
    }
    return clamped;
  }

  #validateSetpointFields(setpoint, authorization) {
    if (!setpoint || typeof setpoint !== "object" || Array.isArray(setpoint)) {
      throw new KernelError("CHUNK_MALFORMED", "Chunk setpoint must be an object.");
    }
    const manifest = this.#driver.manifest();
    const actionSpace = manifest.action_spaces.find((space) => space.name === authorization.grant.stream.action_space);
    const allowed = new Set(Object.keys(actionSpace?.hard_caps ?? {}));
    for (const [field, value] of Object.entries(setpoint)) {
      if (!allowed.has(field)) {
        throw new KernelError("CHUNK_MALFORMED", `Unknown setpoint field ${field}.`, { field });
      }
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new KernelError("CHUNK_MALFORMED", `Setpoint field ${field} must be a finite number.`, { field });
      }
    }
  }

  #abortActive(trigger, eventType, extraPayload = {}) {
    const authorization = this.#activeAuthorization;
    this.#driver.command_safe_state();
    this.#ingestDriverEvents(authorization);
    this.#emit(eventType, authorization, { trigger, ...extraPayload }, 1);
    this.#activeAuthorization = null;
    this.#activeStream = null;
    return {
      state: eventType === "authorization.stopped" ? "stopped" : "aborted",
      authorization_id: authorization.id,
      trigger
    };
  }

  #completeActive(reason) {
    const authorization = this.#activeAuthorization;
    this.#driver.command_safe_state();
    this.#ingestDriverEvents(authorization);
    this.#emit("authorization.completed", authorization, { authorization_id: authorization.id, reason });
    this.#activeAuthorization = null;
    this.#activeStream = null;
    return {
      state: "completed",
      authorization_id: authorization.id,
      reason
    };
  }

  #emit(event_type, authorization, payload, severity = 0) {
    this.#events.push({
      seq: this.#nextSeq++,
      schema_version: 1,
      source: `kernel:${this.#robotId}`,
      event_type,
      severity,
      timestamp: this.#now(),
      robot_id: this.#robotId,
      mission_id: authorization.mission_id,
      run_id: authorization.run_id,
      refs: [authorization.id],
      payload
    });
  }

  #emitStatusSampleDue() {
    const nowMs = this.#clock().getTime();
    if (this.#lastStatusSampleAtMs !== null && nowMs - this.#lastStatusSampleAtMs < this.#heartbeatMaxAgeMs) {
      return;
    }
    this.#lastStatusSampleAtMs = nowMs;
    this.#emitKernel("kernel.status_sample", this.#statusSnapshot());
  }

  #ingestDriverEvents(authorization = this.#activeAuthorization) {
    if (typeof this.#driver.events !== "function") {
      return;
    }
    const events = this.#driver.events({ after: this.#driverEventCursor });
    for (const event of events) {
      this.#driverEventCursor = Math.max(this.#driverEventCursor, event.seq ?? 0);
      if (!authorization && RUN_CAUSAL_DRIVER_EVENTS.has(event.event_type)) {
        continue;
      }
      this.#events.push({
        schema_version: event.schema_version ?? 1,
        source: event.source ?? `driver:${this.#robotId}`,
        event_type: event.event_type,
        severity: event.severity ?? 0,
        timestamp: event.timestamp ?? this.#now(),
        robot_id: event.robot_id ?? this.#robotId,
        ...(authorization
          ? {
              mission_id: event.mission_id ?? authorization.mission_id,
              run_id: event.run_id ?? authorization.run_id,
              refs: event.refs?.length ? event.refs : [authorization.id]
            }
          : { refs: event.refs ?? [] }),
        payload: {
          ...(event.payload ?? {}),
          driver_seq: event.seq
        },
        seq: this.#nextSeq++
      });
    }
  }

  #emitKernel(event_type, payload, severity = 0, authorization = null) {
    this.#events.push({
      seq: this.#nextSeq++,
      schema_version: 1,
      source: `kernel:${this.#robotId}`,
      event_type,
      severity,
      timestamp: this.#now(),
      robot_id: this.#robotId,
      ...(authorization
        ? {
            mission_id: authorization.mission_id,
            run_id: authorization.run_id,
            refs: [authorization.id]
          }
        : { refs: [] }),
      payload
    });
  }

  #now() {
    return this.#clock().toISOString();
  }
}

function grantLimitForField(field, authorization) {
  const limits = authorization.grant.stream?.limits;
  if (!limits) {
    return undefined;
  }
  const limitName = limitNameForField(field);
  if (!limitName || authorization.enforcement?.[limitName] !== "enforcing") {
    return undefined;
  }
  return limits[limitName];
}

function limitNameForField(field) {
  if (field === "vx_mps" || field === "vy_mps") {
    return "max_speed_mps";
  }
  if (field === "yaw_rps") {
    return "max_yaw_rps";
  }
  return null;
}

function minDefined(left, right) {
  if (left === undefined) {
    return right;
  }
  if (right === undefined) {
    return left;
  }
  return Math.min(left, right);
}

function latestDriverSeq(driver) {
  if (typeof driver.events !== "function") {
    return 0;
  }
  return driver.events({ after: 0 }).reduce((maxSeq, event) => Math.max(maxSeq, event.seq ?? 0), 0);
}
