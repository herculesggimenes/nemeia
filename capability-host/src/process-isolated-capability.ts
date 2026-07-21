import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CapabilityHostError } from "./capability-host-errors.ts";

const WORKER_PATH = fileURLToPath(new URL("./process-capability-worker.ts", import.meta.url));

export class AsyncCapabilityHost {
  #capability;
  #kernel;
  #state = "idle";
  #authorization = null;
  #target = null;

  constructor({ capability, kernel }) {
    this.#capability = capability;
    this.#kernel = kernel;
  }

  async describe() {
    return this.#capability.describe();
  }

  async bind(authorization, target = authorization.target, streamEndpoints = {}) {
    if (!authorization.capability) {
      throw new CapabilityHostError("AUTHZ_NOT_CAPABILITY_BOUND", "Authorization does not name a capability.");
    }
    const manifest = await this.describe();
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
    const result = await this.#capability.bind(authorization, target, streamEndpoints);
    if (result !== "ready" && result?.state !== "ready") {
      throw new CapabilityHostError("CAPABILITY_REFUSED", "Capability refused bind.", { result });
    }
    this.#authorization = authorization;
    this.#target = target;
    this.#state = "bound";
    return { state: "ready", authorization_id: authorization.id };
  }

  async start() {
    this.#requireState("bound");
    const opened = this.#kernel.execute(this.#authorization);
    await this.#capability.start();
    this.#state = "running";
    return opened;
  }

  async onFrame(stream, frame) {
    this.#requireState("running");
    return this.#capability.onFrame(stream, frame);
  }

  async emitChunk(setpoint) {
    this.#requireState("running");
    const chunk = await this.#capability.emitChunk(setpoint);
    return this.#kernel.submitChunk(chunk);
  }

  tick() {
    this.#requireState("running");
    return this.#kernel.tick();
  }

  async abort(trigger) {
    if (this.#state === "running" || this.#state === "bound") {
      await this.#capability.abort(trigger);
      this.#kernel.stop({ source: trigger });
      this.#state = "aborted";
    }
    return { state: this.#state, trigger };
  }

  async stop() {
    if (this.#state === "running" || this.#state === "bound") {
      await this.#capability.stop();
      this.#kernel.stop({ source: "capability_stop" });
      this.#state = "stopped";
    }
    return { state: this.#state };
  }

  async terminate() {
    const result = await this.#capability.terminate();
    await this.#capability.close();
    this.#state = "terminated";
    return result;
  }

  #requireState(expected) {
    if (this.#state !== expected) {
      throw new CapabilityHostError("CAPABILITY_STATE", `Capability host is ${this.#state}; expected ${expected}.`);
    }
  }
}

export class ProcessIsolatedCapability {
  #child;
  #pending = new Map();
  #nextId = 1;
  #closed = false;

  constructor({
    modulePath,
    manifest,
    packageFiles = {},
    network = "none",
    limits = {},
    useBubblewrap = hasBubblewrap(),
    timeoutMs = 1_000,
    memoryMb = 128
  }) {
    if (!modulePath) {
      throw new CapabilityHostError("CAPABILITY_MODULE_INVALID", "Process isolated capability requires a modulePath.");
    }
    const options = {
      module_url: pathToFileURL(modulePath).href,
      manifest,
      package_files: packageFiles,
      network,
      limits
    };
    const command = buildCommand({
      modulePath,
      network,
      useBubblewrap,
      memoryMb,
      env: {
        NEM_CAPABILITY_WORKER_OPTIONS: JSON.stringify(options)
      }
    });
    this.#child = spawn(command.file, command.args, {
      env: command.env,
      stdio: ["pipe", "pipe", "pipe"]
    });
    this.#child.once("exit", (code, signal) => this.#rejectAll(new CapabilityHostError("CAPABILITY_PROCESS_EXITED", "Capability process exited.", {
      code,
      signal,
      stderr: this.lastStderr ?? ""
    })));
    this.#child.stderr.on("data", (chunk) => {
      this.lastStderr = `${this.lastStderr ?? ""}${chunk.toString("utf8")}`;
    });
    createInterface({ input: this.#child.stdout }).on("line", (line) => this.#handleLine(line));
    this.timeoutMs = timeoutMs;
  }

  describe() {
    return this.#request("describe");
  }

  bind(authorization, target, streamEndpoints) {
    return this.#request("bind", [authorization, target, streamEndpoints]);
  }

  start() {
    return this.#request("start");
  }

  onFrame(stream, frame) {
    return this.#request("on_frame", [stream, frame]);
  }

  emitChunk(setpoint) {
    return this.#request("emit_chunk", [setpoint]);
  }

  abort(trigger) {
    return this.#request("abort", [trigger]);
  }

  stop() {
    return this.#request("stop");
  }

  terminate() {
    return this.#request("terminate");
  }

  close() {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    this.#child.kill("SIGKILL");
  }

  #request(op, args = []) {
    if (this.#closed) {
      return Promise.reject(new CapabilityHostError("CAPABILITY_PROCESS_EXITED", "Capability process is closed."));
    }
    const id = this.#nextId++;
    const payload = `${JSON.stringify({ id, op, args })}\n`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        this.close();
        reject(new CapabilityHostError("CAPABILITY_PROCESS_TIMEOUT", `Capability process timed out during ${op}.`, { op }));
      }, this.timeoutMs);
      this.#pending.set(id, { resolve, reject, timer });
      this.#child.stdin.write(payload);
    });
  }

  #handleLine(line) {
    const message = JSON.parse(line);
    const pending = this.#pending.get(message.id);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timer);
    this.#pending.delete(message.id);
    if (message.ok) {
      pending.resolve(message.value);
      return;
    }
    pending.reject(new CapabilityHostError(message.error.error_code, message.error.message, message.error.details));
  }

  #rejectAll(error) {
    for (const [id, pending] of this.#pending.entries()) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.#pending.delete(id);
    }
    this.#closed = true;
  }
}

function buildCommand({ modulePath, network, useBubblewrap, memoryMb, env }) {
  const nodeArgs = [
    `--max-old-space-size=${memoryMb}`,
    "--permission",
    `--allow-fs-read=${WORKER_PATH}`,
    `--allow-fs-read=${modulePath}`,
    WORKER_PATH
  ];
  const baseEnv = {
    PATH: process.env.PATH ?? "",
    NODE_OPTIONS: "",
    ...env
  };
  if (useBubblewrap && network === "none") {
    return {
      file: "bwrap",
      args: [
        "--unshare-net",
        "--die-with-parent",
        "--ro-bind",
        "/",
        "/",
        "--tmpfs",
        "/tmp",
        process.execPath,
        ...nodeArgs
      ],
      env: baseEnv
    };
  }
  return {
    file: process.execPath,
    args: nodeArgs,
    env: baseEnv
  };
}

function hasBubblewrap() {
  return spawnSync("bwrap", [
    "--unshare-net",
    "--die-with-parent",
    "--ro-bind",
    "/",
    "/",
    "--tmpfs",
    "/tmp",
    process.execPath,
    "--version"
  ], { encoding: "utf8" }).status === 0;
}
