import { createInterface } from "node:readline";

const options = JSON.parse(process.env.NEM_CAPABILITY_WORKER_OPTIONS ?? "{}");
const moduleUrl = options.module_url;
const manifest = options.manifest;
const packageFiles = new Map(Object.entries(options.package_files ?? {}));
const limits = {
  scratch_bytes: options.limits?.scratch_bytes ?? 1_000_000,
  network_requests: options.limits?.network_requests ?? 0
};
const network = normalizeNetwork(options.network ?? manifest?.network ?? "none");
const scratch = new Map();
const usage = { scratch_bytes: 0, network_requests: 0 };

if (!moduleUrl) {
  throw new Error("NEM_CAPABILITY_WORKER_OPTIONS.module_url is required");
}

const module = await import(moduleUrl);
const capability = createCapability(module, options);

const input = createInterface({ input: process.stdin });
for await (const line of input) {
  if (!line.trim()) {
    continue;
  }
  const request = JSON.parse(line);
  handle(request)
    .then((value) => write({ id: request.id, ok: true, value }))
    .catch((error) => write({
      id: request.id,
      ok: false,
      error: {
        name: error?.name ?? "Error",
        error_code: error?.error_code ?? error?.code ?? "CAPABILITY_PROCESS_ERROR",
        message: error?.message ?? String(error),
        details: error?.details ?? {}
      }
    }));
}

async function handle(request) {
  const args = request.args ?? [];
  switch (request.op) {
    case "describe":
      return capability.describe();
    case "bind":
      return capability.bind(args[0], args[1], args[2], sandboxContext());
    case "start":
      return capability.start();
    case "on_frame":
      return capability.on_frame(args[0], args[1]);
    case "emit_chunk":
      return capability.emit_chunk(args[0]);
    case "abort":
      return capability.abort(args[0]);
    case "stop":
      return capability.stop();
    case "terminate":
      return capability.terminate();
    default:
      throw Object.assign(new Error(`Unknown capability op ${request.op}`), { error_code: "CAPABILITY_PROCESS_PROTOCOL" });
  }
}

function createCapability(module, options) {
  if (typeof module.createCapability === "function") {
    return module.createCapability(options);
  }
  if (typeof module.default === "function") {
    return new module.default(options);
  }
  if (module.default && typeof module.default === "object") {
    return module.default;
  }
  throw Object.assign(new Error("Capability module must export createCapability, a default class, or a default object."), {
    error_code: "CAPABILITY_MODULE_INVALID"
  });
}

function sandboxContext() {
  return Object.freeze({
    packageRead,
    scratchWrite,
    scratchRead,
    networkFetch,
    usage: () => ({
      manifest: `cap:${manifest.capability}@${manifest.version}`,
      scratch_bytes: usage.scratch_bytes,
      network_requests: usage.network_requests
    })
  });
}

function packageRead(path) {
  const normalized = normalizeRelativePath(path);
  if (!packageFiles.has(normalized)) {
    throw Object.assign(new Error(`Package file ${normalized} was not found.`), {
      error_code: "PACKAGE_FILE_NOT_FOUND",
      details: { path: normalized }
    });
  }
  return packageFiles.get(normalized);
}

function scratchWrite(path, bytes) {
  const normalized = normalizeRelativePath(path);
  const value = String(bytes ?? "");
  const nextBytes = usage.scratch_bytes - (scratch.get(normalized)?.length ?? 0) + value.length;
  if (nextBytes > limits.scratch_bytes) {
    throw Object.assign(new Error("Capability scratch space limit exceeded."), {
      error_code: "RESOURCE_LIMIT_EXCEEDED",
      details: { limit: limits.scratch_bytes, attempted: nextBytes }
    });
  }
  scratch.set(normalized, value);
  usage.scratch_bytes = nextBytes;
  return { path: `scratch:${normalized}`, bytes: value.length };
}

function scratchRead(path) {
  return scratch.get(normalizeRelativePath(path)) ?? null;
}

function networkFetch(hostPort, request = {}) {
  const target = String(hostPort ?? "");
  if (!network.has(target)) {
    throw Object.assign(new Error(`Network target ${target} is not declared.`), {
      error_code: "NETWORK_DENIED",
      details: { target }
    });
  }
  if (usage.network_requests + 1 > limits.network_requests) {
    throw Object.assign(new Error("Capability network request limit exceeded."), {
      error_code: "RESOURCE_LIMIT_EXCEEDED",
      details: { limit: limits.network_requests, attempted: usage.network_requests + 1 }
    });
  }
  usage.network_requests += 1;
  return { ok: true, target, request: structuredClone(request) };
}

function normalizeNetwork(network) {
  if (network === "none" || network === undefined || network === null) {
    return new Set();
  }
  if (!Array.isArray(network)) {
    throw Object.assign(new Error("Capability network policy must be none or an array."), {
      error_code: "SANDBOX_POLICY_INVALID"
    });
  }
  return new Set(network.map((entry) => String(entry)));
}

function normalizeRelativePath(path) {
  const normalized = String(path ?? "").replaceAll("\\", "/").replace(/^\/+/, "");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length === 0 || parts.includes("..")) {
    throw Object.assign(new Error("Capability path must stay within its mount."), {
      error_code: "SANDBOX_PATH_DENIED",
      details: { path }
    });
  }
  return parts.join("/");
}

function write(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}
