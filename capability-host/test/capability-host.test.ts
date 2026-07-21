import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { EventLog } from "../../mission-server/src/event-log.ts";
import { MissionServer } from "../../mission-server/src/mission-server.ts";
import { SimDriver } from "../../supervisor/src/sim-driver.ts";
import { SupervisorKernel } from "../../supervisor/src/supervisor-kernel.ts";
import { runCapabilityGauntlet } from "../src/capability-gauntlet.ts";
import { CapabilityHost, CapabilitySandbox, ManualChunkCapability } from "../src/capability-host.ts";
import { CapabilityHostError } from "../src/capability-host-errors.ts";
import { AsyncCapabilityHost, ProcessIsolatedCapability } from "../src/process-isolated-capability.ts";

const fixedClock = () => new Date("2026-07-07T17:00:00.000Z");

test("CapabilityHost binds Mission Server stream Authorization and forwards chunks to Supervisor", () => {
  const fixture = makeFollowFixture();
  const host = new CapabilityHost({
    capability: new ManualChunkCapability({ manifest: followManifest() }),
    kernel: fixture.kernel
  });

  assert.deepEqual(host.bind(fixture.authorization), {
    state: "ready",
    authorization_id: fixture.authorization.id
  });
  assert.equal(host.start().state, "active");
  assert.deepEqual(host.emitChunk({ vx_mps: 0.2, vy_mps: 0, yaw_rps: 0.2 }), {
    accepted: true,
    seq: 1
  });
  const tick = host.tick();

  assert.equal(tick.state, "active");
  assert.deepEqual(tick.chunk_ack.applied_setpoint, { vx_mps: 0.12, vy_mps: 0, yaw_rps: 0.15 });
  assert.deepEqual(fixture.driver.appliedSetpoints().at(-1).setpoint, tick.chunk_ack.applied_setpoint);
});

test("CapabilityHost refuses mismatched capability implementations and ungranted streams", () => {
  const fixture = makeFollowFixture();
  const mismatch = new CapabilityHost({
    capability: new ManualChunkCapability({
      manifest: { ...followManifest(), version: "0.2.0" }
    }),
    kernel: fixture.kernel
  });
  assert.throws(
    () => mismatch.bind(fixture.authorization),
    (error) => error instanceof CapabilityHostError && error.error_code === "CAPABILITY_IMPL_MISMATCH"
  );

  const needsAudio = new CapabilityHost({
    capability: new ManualChunkCapability({
      manifest: {
        ...followManifest(),
        requires: { action_spaces: ["base_velocity_3d"], streams: ["microphone"] }
      }
    }),
    kernel: fixture.kernel
  });
  assert.throws(
    () => needsAudio.bind(fixture.authorization),
    (error) => error instanceof CapabilityHostError && error.error_code === "STREAM_NOT_GRANTED"
  );
});

test("CapabilityHost stop asks kernel for safe state and prevents more chunks", () => {
  const fixture = makeFollowFixture();
  const capability = new ManualChunkCapability({ manifest: followManifest() });
  const host = new CapabilityHost({ capability, kernel: fixture.kernel });
  host.bind(fixture.authorization);
  host.start();

  assert.deepEqual(host.stop(), { state: "stopped" });
  assert.equal(fixture.driver.safeStateCommands().length, 1);
  assert.throws(
    () => host.emitChunk({ vx_mps: 0.1 }),
    (error) => error instanceof CapabilityHostError && error.error_code === "CAPABILITY_STATE"
  );
});

test("CapabilitySandbox enforces read-only package and scratch limits", () => {
  const sandbox = new CapabilitySandbox({
    manifest: followManifest(),
    packageFiles: { "manifest.json": "{\"ok\":true}" },
    limits: { scratch_bytes: 8 }
  });
  const context = sandbox.context();

  assert.equal(context.packageRead("manifest.json"), "{\"ok\":true}");
  assert.deepEqual(context.scratchWrite("tmp/state.txt", "1234"), { path: "scratch:tmp/state.txt", bytes: 4 });
  assert.equal(context.scratchRead("tmp/state.txt"), "1234");
  assert.throws(
    () => sandbox.packageWrite("manifest.json", "{}"),
    (error) => error instanceof CapabilityHostError && error.error_code === "PACKAGE_READ_ONLY"
  );
  assert.throws(
    () => context.scratchWrite("../escape.txt", "x"),
    (error) => error instanceof CapabilityHostError && error.error_code === "SANDBOX_PATH_DENIED"
  );
  assert.throws(
    () => context.scratchWrite("tmp/too-big.txt", "123456789"),
    (error) => error instanceof CapabilityHostError && error.error_code === "RESOURCE_LIMIT_EXCEEDED"
  );
});

test("CapabilitySandbox denies network by default and allows declared targets within limits", () => {
  const denied = new CapabilitySandbox({ manifest: followManifest() }).context();
  assert.throws(
    () => denied.networkFetch("example.com:443"),
    (error) => error instanceof CapabilityHostError && error.error_code === "NETWORK_DENIED"
  );

  const allowed = new CapabilitySandbox({
    manifest: { ...followManifest(), network: ["telemetry.local:443"] },
    limits: { network_requests: 1 }
  }).context();
  assert.deepEqual(allowed.networkFetch("telemetry.local:443", { method: "GET" }), {
    ok: true,
    target: "telemetry.local:443",
    request: { method: "GET" }
  });
  assert.throws(
    () => allowed.networkFetch("telemetry.local:443"),
    (error) => error instanceof CapabilityHostError && error.error_code === "RESOURCE_LIMIT_EXCEEDED"
  );
});

test("CapabilityHost passes sandbox context to capabilities at bind", () => {
  const fixture = makeFollowFixture();
  const capability = new ManualChunkCapability({ manifest: followManifest() });
  const sandbox = new CapabilitySandbox({
    manifest: followManifest(),
    packageFiles: { "config/default.json": "{\"speed\":0.12}" },
    limits: { scratch_bytes: 100 }
  });
  const host = new CapabilityHost({ capability, kernel: fixture.kernel, sandbox });

  host.bind(fixture.authorization);

  assert.equal(capability.sandbox.packageRead("config/default.json"), "{\"speed\":0.12}");
  assert.deepEqual(capability.sandbox.scratchWrite("run/state.json", "{}"), { path: "scratch:run/state.json", bytes: 2 });
});

test("CapabilityHost writes observations and capability events to the Event Log", () => {
  const fixture = makeFollowFixture();
  const eventLog = new EventLog({ clock: fixedClock });
  const host = new CapabilityHost({
    capability: new ManualChunkCapability({ manifest: followManifest() }),
    kernel: fixture.kernel,
    eventLog
  });
  host.bind(fixture.authorization);

  host.emitObservation({
    streams: ["camera_front"],
    labels: ["person"],
    confidence: 0.91,
    artifact_refs: ["artifact:frame_1"]
  });
  host.emitEvent("attention.seam", {
    theme: "entity.bound",
    digest_ref: "artifact:digest_1",
    cursor_range: { after: 0, until: 1 },
    severity: 1
  });

  const [observation, event] = eventLog.all();
  assert.equal(observation.event_type, "scene.observation");
  assert.equal(observation.source, "cap:follow-entity@0.1.0");
  assert.equal(observation.robot_id, "go2");
  assert.equal(observation.mission_id, fixture.authorization.mission_id);
  assert.equal(observation.run_id, fixture.authorization.run_id);
  assert.deepEqual(observation.refs, [fixture.authorization.id]);
  assert.deepEqual(observation.payload.labels, ["person"]);
  assert.deepEqual(observation.payload.target, fixture.authorization.target);

  assert.equal(event.event_type, "attention.seam");
  assert.equal(event.source, "cap:follow-entity@0.1.0");
  assert.equal(event.severity, 1);
  assert.equal(event.run_id, fixture.authorization.run_id);
  assert.deepEqual(event.refs, [fixture.authorization.id]);
  assert.equal(event.payload.theme, "entity.bound");
});

test("Capability gauntlet produces deterministic CP report for required scenarios", () => {
  const report = runCapabilityGauntlet({ manifest: followManifest(), seed: "fixed-seed" });
  const repeated = runCapabilityGauntlet({ manifest: followManifest(), seed: "fixed-seed" });

  assert.equal(report.conformance_class, "CP");
  assert.equal(report.result, "pass");
  assert.equal(report.package, "cap:follow-entity@0.1.0");
  assert.deepEqual(report.cases.map((entry) => entry.name), [
    "target_vanishes",
    "obstacle_enters_workspace",
    "stop_during_contact",
    "stream_starvation",
    "stale_scene",
    "malformed_chunk_fuzzing"
  ]);
  assert.equal(report.report_sha256, repeated.report_sha256);
  assert.equal(report.cases.every((entry) => entry.result === "pass"), true);

  const starvation = report.cases.find((entry) => entry.name === "stream_starvation");
  assert.equal(starvation.evidence.tick.trigger, "stream_silence");
  const malformed = report.cases.find((entry) => entry.name === "malformed_chunk_fuzzing");
  assert.deepEqual(malformed.evidence.rejected.map((entry) => entry.error_code), [
    "AUTHZ_CHUNK_MISMATCH",
    "CHUNK_MALFORMED",
    "CHUNK_MALFORMED",
    "CHUNK_MALFORMED"
  ]);
});

test("Capability gauntlet records failed cases without aborting report generation", () => {
  const report = runCapabilityGauntlet({
    manifest: followManifest(),
    capabilityFactory: () => new RefusingCapability({ manifest: followManifest() })
  });

  assert.equal(report.result, "fail");
  assert.equal(report.cases.length, 6);
  assert.equal(report.cases.every((entry) => entry.result === "fail"), true);
  assert.equal(report.cases[0].evidence.error_code, "CAPABILITY_REFUSED");
});

test("ProcessIsolatedCapability runs lifecycle over IPC and keeps raw host access denied", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nemeia-capability-process-"));
  const modulePath = join(dir, "capability.mjs");
  writeFileSync(modulePath, processCapabilityModule(), "utf8");
  const fixture = makeFollowFixture();
  const capability = new ProcessIsolatedCapability({
    modulePath,
    manifest: followManifest(),
    packageFiles: { "config/default.json": "{\"speed\":0.12}" },
    limits: { scratch_bytes: 100 },
    useBubblewrap: false
  });
  const host = new AsyncCapabilityHost({ capability, kernel: fixture.kernel });
  try {
    assert.deepEqual(await host.bind(fixture.authorization), {
      state: "ready",
      authorization_id: fixture.authorization.id
    });
    assert.equal((await host.start()).state, "active");
    assert.deepEqual(await host.emitChunk({ vx_mps: 0.2, vy_mps: 0, yaw_rps: 0.2 }), {
      accepted: true,
      seq: 1
    });
    const tick = host.tick();
    assert.deepEqual(tick.chunk_ack.applied_setpoint, { vx_mps: 0.12, vy_mps: 0, yaw_rps: 0.15 });
    const result = await host.terminate();

    assert.equal(result.state, "completed");
    assert.equal(result.package_config, "{\"speed\":0.12}");
    assert.equal(result.scratch_value, "ok");
    assert.equal(result.raw_fs_denied, true);
    assert.equal(result.child_process_denied, true);
    assert.equal(result.worker_denied, true);
  } finally {
    capability.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ProcessIsolatedCapability maps worker errors to CapabilityHostError", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nemeia-capability-process-"));
  const modulePath = join(dir, "capability.mjs");
  writeFileSync(modulePath, refusingProcessCapabilityModule(), "utf8");
  const capability = new ProcessIsolatedCapability({
    modulePath,
    manifest: followManifest(),
    useBubblewrap: false
  });
  try {
    await assert.rejects(
      () => capability.bind({}, {}, {}),
      (error) => error instanceof CapabilityHostError && error.error_code === "CAPABILITY_REFUSED_IN_PROCESS"
    );
  } finally {
    capability.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ProcessIsolatedCapability default launcher can describe a package", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nemeia-capability-process-"));
  const modulePath = join(dir, "capability.mjs");
  writeFileSync(modulePath, processCapabilityModule(), "utf8");
  const capability = new ProcessIsolatedCapability({
    modulePath,
    manifest: followManifest()
  });
  try {
    const manifest = await capability.describe();
    assert.equal(manifest.capability, "follow-entity");
    assert.equal(manifest.version, "0.1.0");
  } finally {
    capability.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ProcessIsolatedCapability kills the worker on lifecycle timeout", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nemeia-capability-process-"));
  const modulePath = join(dir, "capability.mjs");
  writeFileSync(modulePath, hangingProcessCapabilityModule(), "utf8");
  const capability = new ProcessIsolatedCapability({
    modulePath,
    manifest: followManifest(),
    timeoutMs: 20,
    useBubblewrap: false
  });
  try {
    await assert.rejects(
      () => capability.start(),
      (error) => error instanceof CapabilityHostError && error.error_code === "CAPABILITY_PROCESS_TIMEOUT"
    );
    await assert.rejects(
      () => capability.describe(),
      (error) => error instanceof CapabilityHostError && error.error_code === "CAPABILITY_PROCESS_EXITED"
    );
  } finally {
    capability.close();
    rmSync(dir, { recursive: true, force: true });
  }
});



function makeFollowFixture() {
  const server = new MissionServer({ clock: fixedClock });
  const mission = server.createMission({
    idempotencyKey: "mission",
    preset: { id: "preset_go2_follow_v1", version: "1.0.0" },
    robot_ids: ["go2"]
  });
  const run = server.proposeRun({
    idempotencyKey: "run",
    mission_id: mission.id,
    robot_id: "go2",
    verb: "follow",
    args: { max_speed_mps: 0.12, max_yaw_rps: 0.15, watchdog_ms: 100 },
    target: { entity_id: "ent_person_01", snapshot_id: "ssg_test", evidence_refs: ["artifact:crop"] }
  });
  const { authorization } = server.approveRun({
    idempotencyKey: "approve",
    run_id: run.id,
    operator: "op_local"
  });
  const driver = new SimDriver({ clock: fixedClock });
  driver.connect();
  const kernel = new SupervisorKernel({
    robotId: "go2",
    driver,
    trustedPublicKey: server.publicKey,
    clock: fixedClock
  });
  return { authorization, driver, kernel, server };
}

function followManifest() {
  return {
    capability: "follow-entity",
    version: "0.1.0",
    publisher: "local:test",
    verbs: [
      {
        verb: "follow",
        args: { standoff_m: { type: "float", min: 1, max: 3 } },
        applies_to: ["person", "trackable"],
        doc: "Follow an entity at a standoff distance."
      }
    ],
    requires: {
      action_spaces: ["base_velocity_3d"],
      streams: ["camera_front"]
    },
    dependencies: [],
    network: "none",
    grant_defaults: {
      limits: { max_speed_mps: 0.12 },
      abort: [{ target_stale: { max_ms: 700 } }]
    }
  };
}

class RefusingCapability extends ManualChunkCapability {
  bind() {
    return { state: "refused", reason: "gauntlet test refusal" };
  }
}

function processCapabilityModule() {
  return `
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { Worker } from "node:worker_threads";

export function createCapability(options) {
  let authorization = null;
  let sandbox = null;
  let seq = 1;
  const denied = { raw_fs: false, child_process: false, worker: false };
  return {
    describe() {
      return options.manifest;
    },
    bind(auth, target, streamEndpoints, sandboxContext) {
      authorization = auth;
      sandbox = sandboxContext;
      return "ready";
    },
    start() {
      try {
        readFileSync("/etc/passwd", "utf8");
      } catch {
        denied.raw_fs = true;
      }
      try {
        spawnSync(process.execPath, ["--version"]);
      } catch {
        denied.child_process = true;
      }
      try {
        new Worker("console.log(1)", { eval: true });
      } catch {
        denied.worker = true;
      }
    },
    on_frame() {},
    emit_chunk(setpoint) {
      return { auth_id: authorization.id, seq: seq++, setpoint };
    },
    abort() {},
    stop() {},
    terminate() {
      const packageConfig = sandbox.packageRead("config/default.json");
      sandbox.scratchWrite("run/state.txt", "ok");
      return {
        state: "completed",
        package_config: packageConfig,
        scratch_value: sandbox.scratchRead("run/state.txt"),
        raw_fs_denied: denied.raw_fs,
        child_process_denied: denied.child_process,
        worker_denied: denied.worker
      };
    }
  };
}
`;
}

function refusingProcessCapabilityModule() {
  return `
export default {
  describe() {
    return {
      capability: "follow-entity",
      version: "0.1.0",
      publisher: "local:test",
      verbs: [],
      requires: { action_spaces: ["base_velocity_3d"], streams: ["camera_front"] },
      dependencies: [],
      network: "none",
      grant_defaults: { limits: {}, abort: [] }
    };
  },
  bind() {
    const error = new Error("refused in process");
    error.error_code = "CAPABILITY_REFUSED_IN_PROCESS";
    throw error;
  }
};
`;
}

function hangingProcessCapabilityModule() {
  return `
export default {
  describe() {
    return {
      capability: "follow-entity",
      version: "0.1.0",
      publisher: "local:test",
      verbs: [],
      requires: { action_spaces: ["base_velocity_3d"], streams: ["camera_front"] },
      dependencies: [],
      network: "none",
      grant_defaults: { limits: {}, abort: [] }
    };
  },
  start() {
    return new Promise(() => {});
  }
};
`;
}
