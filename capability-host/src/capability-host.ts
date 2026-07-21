import { CapabilityHostError } from "./capability-host-errors.ts";

export class CapabilityHost {
  #capability;
  #kernel;
  #sandbox;
  #state = "idle";
  #authorization = null;
  #target = null;
  #streamEndpoints = null;
  #eventLog;
  #observations = [];
  #events = [];

  constructor({ capability, kernel, sandbox = null, eventLog = null }) {
    this.#capability = capability;
    this.#kernel = kernel;
    this.#eventLog = eventLog;
    this.#sandbox = sandbox ?? new CapabilitySandbox({ manifest: capability.describe() });
  }

  describe() {
    return this.#capability.describe();
  }

  bind(authorization, target = authorization.target, streamEndpoints = {}) {
    if (!authorization.capability) {
      throw new CapabilityHostError("AUTHZ_NOT_CAPABILITY_BOUND", "Authorization does not name a capability.");
    }
    const manifest = this.describe();
    const expectedImpl = `cap:${manifest.capability}@${manifest.version}`;
    if (authorization.capability.impl !== expectedImpl) {
      throw new CapabilityHostError("CAPABILITY_IMPL_MISMATCH", `Authorization requires ${authorization.capability.impl}, host has ${expectedImpl}.`);
    }
    if (!authorization.grant.stream) {
      throw new CapabilityHostError("AUTHZ_NOT_STREAM", "Capability host requires a stream Authorization.");
    }
    const requiredStreams = new Set(manifest.requires.streams.map((stream) => stream.split("@")[0]));
    const grantedStreams = new Set(authorization.streams_granted);
    for (const stream of requiredStreams) {
      if (!grantedStreams.has(stream) && !grantedStreams.has(stream.replace(/^rgb$/, "camera_front"))) {
        throw new CapabilityHostError("STREAM_NOT_GRANTED", `Required stream ${stream} was not granted.`);
      }
    }
    const result = this.#capability.bind(authorization, target, streamEndpoints, this.#sandbox.context());
    if (result !== "ready" && result?.state !== "ready") {
      throw new CapabilityHostError("CAPABILITY_REFUSED", "Capability refused bind.", { result });
    }
    this.#authorization = authorization;
    this.#target = target;
    this.#streamEndpoints = streamEndpoints;
    this.#state = "bound";
    return { state: "ready", authorization_id: authorization.id };
  }

  start() {
    this.#requireState("bound");
    const opened = this.#kernel.execute(this.#authorization);
    this.#capability.start();
    this.#state = "running";
    return opened;
  }

  onFrame(stream, frame) {
    this.#requireState("running");
    return this.#capability.on_frame(stream, frame);
  }

  emitChunk(setpoint) {
    this.#requireState("running");
    const chunk = this.#capability.emit_chunk(setpoint);
    return this.#kernel.submitChunk(chunk);
  }

  tick() {
    this.#requireState("running");
    return this.#kernel.tick();
  }

  emitObservation(observation) {
    const record = {
      source: `cap:${this.describe().capability}@${this.describe().version}`,
      authorization_id: this.#authorization?.id,
      target: this.#target,
      observation
    };
    this.#observations.push(record);
    this.#appendEvent({
      source: record.source,
      event_type: "scene.observation",
      severity: 0,
      robot_id: this.#authorization?.robot_id,
      mission_id: this.#authorization?.mission_id,
      run_id: this.#authorization?.run_id,
      refs: this.#authorization ? [this.#authorization.id] : [],
      payload: {
        ...structuredClone(observation),
        target: this.#target
      }
    });
    return record;
  }

  emitEvent(type, payload) {
    const record = {
      source: `cap:${this.describe().capability}@${this.describe().version}`,
      type,
      authorization_id: this.#authorization?.id,
      payload
    };
    this.#events.push(record);
    this.#appendEvent({
      source: record.source,
      event_type: type,
      severity: payload?.severity ?? 0,
      robot_id: this.#authorization?.robot_id,
      mission_id: this.#authorization?.mission_id,
      run_id: this.#authorization?.run_id,
      refs: this.#authorization ? [this.#authorization.id] : [],
      payload: structuredClone(payload ?? {})
    });
    return record;
  }

  abort(trigger) {
    if (this.#state === "running" || this.#state === "bound") {
      this.#capability.abort(trigger);
      this.#kernel.stop({ source: trigger });
      this.#state = "aborted";
    }
    return { state: this.#state, trigger };
  }

  stop() {
    if (this.#state === "running" || this.#state === "bound") {
      this.#capability.stop();
      this.#kernel.stop({ source: "capability_stop" });
      this.#state = "stopped";
    }
    return { state: this.#state };
  }

  terminate() {
    const result = this.#capability.terminate();
    this.#state = "terminated";
    return result;
  }

  observations() {
    return [...this.#observations];
  }

  events() {
    return [...this.#events];
  }

  #requireState(expected) {
    if (this.#state !== expected) {
      throw new CapabilityHostError("CAPABILITY_STATE", `Capability host is ${this.#state}; expected ${expected}.`);
    }
  }

  #appendEvent(event) {
    return this.#eventLog?.append(event) ?? null;
  }
}

export class CapabilitySandbox {
  #manifest;
  #packageFiles;
  #scratchFiles = new Map();
  #network;
  #limits;
  #usage = { scratch_bytes: 0, network_requests: 0 };

  constructor({ manifest, packageFiles = {}, network = null, limits = {} }) {
    this.#manifest = manifest;
    this.#packageFiles = new Map(Object.entries(packageFiles));
    this.#network = normalizeNetwork(network ?? manifest.network ?? "none");
    this.#limits = {
      scratch_bytes: limits.scratch_bytes ?? 1_000_000,
      network_requests: limits.network_requests ?? 0
    };
  }

  context() {
    return Object.freeze({
      packageRead: (path) => this.packageRead(path),
      scratchWrite: (path, bytes) => this.scratchWrite(path, bytes),
      scratchRead: (path) => this.scratchRead(path),
      networkFetch: (hostPort, request = {}) => this.networkFetch(hostPort, request),
      usage: () => this.usage()
    });
  }

  packageRead(path) {
    const normalized = normalizeRelativePath(path);
    if (!this.#packageFiles.has(normalized)) {
      throw new CapabilityHostError("PACKAGE_FILE_NOT_FOUND", `Package file ${normalized} was not found.`, { path: normalized });
    }
    return this.#packageFiles.get(normalized);
  }

  packageWrite() {
    throw new CapabilityHostError("PACKAGE_READ_ONLY", "Capability package mount is read-only.");
  }

  scratchWrite(path, bytes) {
    const normalized = normalizeRelativePath(path);
    const value = String(bytes ?? "");
    const nextBytes = this.#usage.scratch_bytes - (this.#scratchFiles.get(normalized)?.length ?? 0) + value.length;
    if (nextBytes > this.#limits.scratch_bytes) {
      throw new CapabilityHostError("RESOURCE_LIMIT_EXCEEDED", "Capability scratch space limit exceeded.", {
        limit: this.#limits.scratch_bytes,
        attempted: nextBytes
      });
    }
    this.#scratchFiles.set(normalized, value);
    this.#usage.scratch_bytes = nextBytes;
    return { path: `scratch:${normalized}`, bytes: value.length };
  }

  scratchRead(path) {
    return this.#scratchFiles.get(normalizeRelativePath(path)) ?? null;
  }

  networkFetch(hostPort, request = {}) {
    const target = String(hostPort ?? "");
    if (!this.#network.has(target)) {
      throw new CapabilityHostError("NETWORK_DENIED", `Network target ${target} is not declared.`, { target });
    }
    if (this.#usage.network_requests + 1 > this.#limits.network_requests) {
      throw new CapabilityHostError("RESOURCE_LIMIT_EXCEEDED", "Capability network request limit exceeded.", {
        limit: this.#limits.network_requests,
        attempted: this.#usage.network_requests + 1
      });
    }
    this.#usage.network_requests += 1;
    return {
      ok: true,
      target,
      request: structuredClone(request)
    };
  }

  usage() {
    return {
      manifest: `cap:${this.#manifest.capability}@${this.#manifest.version}`,
      scratch_bytes: this.#usage.scratch_bytes,
      network_requests: this.#usage.network_requests
    };
  }
}

export class ManualChunkCapability {
  #manifest;
  #authorization = null;
  #nextSeq = 1;
  #frames = [];
  #stopped = false;

  constructor({ manifest }) {
    this.#manifest = manifest;
  }

  describe() {
    return this.#manifest;
  }

  bind(authorization, target, streamEndpoints, sandbox) {
    this.#authorization = authorization;
    this.sandbox = sandbox;
    return "ready";
  }

  start() {
    this.#stopped = false;
  }

  on_frame(stream, frame) {
    this.#frames.push({ stream, frame });
  }

  emit_chunk(setpoint) {
    if (this.#stopped) {
      throw new CapabilityHostError("CAPABILITY_STOPPED", "Capability has been stopped.");
    }
    return {
      auth_id: this.#authorization.id,
      seq: this.#nextSeq++,
      setpoint
    };
  }

  abort() {
    this.#stopped = true;
  }

  stop() {
    this.#stopped = true;
  }

  terminate() {
    return {
      state: this.#stopped ? "stopped" : "completed",
      frames_seen: this.#frames.length
    };
  }
}

function normalizeNetwork(network) {
  if (network === "none" || network === undefined || network === null) {
    return new Set();
  }
  if (!Array.isArray(network)) {
    throw new CapabilityHostError("SANDBOX_POLICY_INVALID", "Capability network policy must be none or an array.");
  }
  return new Set(network.map((entry) => String(entry)));
}

function normalizeRelativePath(path) {
  const normalized = String(path ?? "").replaceAll("\\", "/").replace(/^\/+/, "");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length === 0 || parts.includes("..")) {
    throw new CapabilityHostError("SANDBOX_PATH_DENIED", "Capability path must stay within its mount.", { path });
  }
  return parts.join("/");
}
