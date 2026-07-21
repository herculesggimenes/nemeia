import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { verifyCanonicalJson } from "../../contracts/src/signing.ts";
import { SupervisorKernel } from "../../supervisor/src/supervisor-kernel.ts";
import {
  GO2_HARDWARE_GAUNTLET_ACK,
  Go2Driver,
  Go2DriverError,
  buildGo2DriverGauntletReport,
  go2DriverManifest,
  runGo2HardwareGauntlet,
  signGo2DriverGauntletReport
} from "../src/go2-driver.ts";
import { makeStreamAuthorization } from "./support.ts";

const fixedClock = () => new Date("2026-07-07T17:00:00.000Z");

test("Go2Driver exposes a NEM-5 DriverManifest with safety facts outside trust state", () => {
  const manifest = go2DriverManifest({ maxEntryMs: 240, totalLossWithinMs: 280 });

  assert.equal(manifest.driver, "go2");
  assert.equal(manifest.action_spaces[0].name, "base_velocity_3d");
  assert.deepEqual(manifest.action_spaces[0].observables, { velocity: "measured", force: "none" });
  assert.equal(manifest.native_actions.some((action) => action.name === "damp" && action.safety_action), true);
  assert.deepEqual(manifest.streams.map((stream) => stream.name), ["camera_front", "go2_sport_state", "go2_low_state"]);
  assert.equal(manifest.safe_state.kind, "vendor:damp");
  assert.equal(manifest.safe_state.max_entry_ms, 240);
  assert.equal("maturity" in manifest, false);
  assert.equal("gauntlet_report" in manifest, false);
});

test("Go2Driver normalizes telemetry and heartbeat freshness", () => {
  const transport = new FakeGo2Transport();
  let nowMs = Date.parse("2026-07-07T17:00:00.000Z");
  const driver = new Go2Driver({ transport, clock: () => new Date(nowMs) });

  driver.connect({ host: "go2.local", password: "redacted" });
  assert.equal(driver.events()[0].payload.password, undefined);
  assert.equal(driver.status().heartbeat_age_ms, 0);
  transport.currentStatus = null;
  nowMs += 250;

  const status = driver.status();
  assert.equal(status.robot_id, "go2");
  assert.equal(status.heartbeat_age_ms, 250);
  assert.equal(status.battery.power_headroom, "nominal");
  assert.equal(status.safe_state_active, true);
  assert.deepEqual(status.pose.position, [1, 2, 0.4]);

  nowMs += 250;
  assert.equal(driver.status().heartbeat_age_ms, 500);
});

test("Go2Driver safe state and native actions route through Unitree sport transport", () => {
  const transport = new FakeGo2Transport();
  const driver = new Go2Driver({ transport, clock: fixedClock });
  driver.connect();

  assert.deepEqual(driver.command_safe_state(), { ack: true, action: "damp" });
  assert.deepEqual(driver.execute_discrete("sit", { speed: "slow" }, 500), { ack: true, action: "sit" });
  assert.deepEqual(transport.commands.map((entry) => entry.type), ["connect", "damp", "sport:sit"]);

  assert.throws(
    () => driver.execute_discrete("flip", {}, 1_800),
    (error) => error instanceof Go2DriverError && error.error_code === "NATIVE_ACTION_UNSUPPORTED"
  );
});

test("Go2Driver works behind SupervisorKernel stream execution", () => {
  const fixture = makeStreamAuthorization({ clock: fixedClock });
  const transport = new FakeGo2Transport();
  const driver = new Go2Driver({ transport, clock: fixedClock });
  driver.connect();
  driver.status();
  const kernel = new SupervisorKernel({
    robotId: "go2",
    driver,
    trustedPublicKey: fixture.publicKey,
    clock: fixedClock
  });

  assert.equal(kernel.execute(fixture.authorization).state, "active");
  assert.deepEqual(kernel.submitChunk({
    auth_id: fixture.authorization.id,
    seq: 1,
    setpoint: { vx_mps: 0.2, vy_mps: 0.2, yaw_rps: 0.5 }
  }), { accepted: true, seq: 1 });
  const tick = kernel.tick();

  assert.deepEqual(tick.chunk_ack.applied_setpoint, { vx_mps: 0.12, vy_mps: 0.12, yaw_rps: 0.15 });
  assert.deepEqual(transport.commands.at(-1).setpoint, tick.chunk_ack.applied_setpoint);

  kernel.stop();
  assert.equal(transport.commands.at(-1).type, "damp");
});

test("Go2Driver streams and driver gauntlet report are deterministic", () => {
  const transport = new FakeGo2Transport();
  const driver = new Go2Driver({ transport, clock: fixedClock });
  const stream = driver.open_stream("camera_front");

  assert.deepEqual(stream, { name: "camera_front", declared_hz: 30 });
  assert.throws(
    () => driver.open_stream("microphone"),
    (error) => error instanceof Go2DriverError && error.error_code === "STREAM_UNSUPPORTED"
  );

  const manifest = driver.manifest();
  const report = buildGo2DriverGauntletReport({
    manifest,
    generatedAt: "2026-07-07T17:00:00.000Z",
    outcomes: {
      D1: { result: "pass", evidence_refs: ["artifact:d1"], measurements: { max_entry_ms: 210 } },
      D2: { result: "pass", evidence_refs: ["artifact:d2"] },
      D3: { result: "pass", evidence_refs: ["artifact:d3"], measurements: { total_loss_within_ms: 260 } },
      D4: { result: "pass", evidence_refs: ["artifact:d4"], measurements: { max_entry_ms: 210 } },
      D5: { result: "pass", evidence_refs: ["artifact:d5"] },
      D6: { result: "pass", evidence_refs: ["artifact:d6"] },
      D7: { result: "pass", evidence_refs: ["artifact:d7"] }
    }
  });
  const repeated = buildGo2DriverGauntletReport({
    manifest,
    generatedAt: "2026-07-07T17:00:00.000Z",
    outcomes: {
      D1: { result: "pass", evidence_refs: ["artifact:d1"], measurements: { max_entry_ms: 210 } },
      D2: { result: "pass", evidence_refs: ["artifact:d2"] },
      D3: { result: "pass", evidence_refs: ["artifact:d3"], measurements: { total_loss_within_ms: 260 } },
      D4: { result: "pass", evidence_refs: ["artifact:d4"], measurements: { max_entry_ms: 210 } },
      D5: { result: "pass", evidence_refs: ["artifact:d5"] },
      D6: { result: "pass", evidence_refs: ["artifact:d6"] },
      D7: { result: "pass", evidence_refs: ["artifact:d7"] }
    }
  });

  assert.equal(report.result, "pass");
  assert.equal(report.package, `driver:${manifest.driver}@${manifest.version}`);
  assert.deepEqual(report.cases.map((entry) => entry.id), ["D1", "D2", "D3", "D4", "D5", "D6", "D7"]);
  assert.match(report.report_sha256, /^sha256:[a-f0-9]{64}$/);
  assert.equal(report.report_sha256, repeated.report_sha256);
});

test("runGo2HardwareGauntlet refuses to run without explicit motion-risk acknowledgement", async () => {
  const driver = new Go2Driver({ transport: new FakeGo2Transport(), clock: fixedClock });

  await assert.rejects(
    () => runGo2HardwareGauntlet({
      driver,
      probes: makePassingHardwareProbes({ transport: new FakeGo2Transport() }),
      safetyAcknowledgement: "nope",
      clock: fixedClock
    }),
    (error) => error instanceof Go2DriverError && error.error_code === "GO2_HARDWARE_ACK_REQUIRED"
  );
});

test("runGo2HardwareGauntlet collects D1-D7 hardware outcomes and signs report", async () => {
  const transport = new FakeGo2Transport();
  let nowMs = Date.parse("2026-07-07T17:00:00.000Z");
  const clock = () => new Date(nowMs);
  const driver = new Go2Driver({ transport, clock });
  driver.connect();
  driver.status();
  const report = await runGo2HardwareGauntlet({
    driver,
    probes: makePassingHardwareProbes({
      transport,
      advanceMs: (ms) => {
        nowMs += ms;
      }
    }),
    safetyAcknowledgement: GO2_HARDWARE_GAUNTLET_ACK,
    clock
  });
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const signed = signGo2DriverGauntletReport(report, privateKey);

  assert.equal(report.result, "pass");
  assert.deepEqual(report.cases.map((entry) => entry.id), ["D1", "D2", "D3", "D4", "D5", "D6", "D7"]);
  assert.equal(report.cases.find((entry) => entry.id === "D4").measurements.declared_max_entry_ms, 300);
  assert.equal(report.cases.find((entry) => entry.id === "D6").measurements.after_heartbeat_age_ms, 350);
  assert.match(signed.signature, /^ed25519:/);
  assert.equal(verifyCanonicalJson(signed, publicKey), true);
});

test("runGo2HardwareGauntlet marks failed measurements without putting trust in manifest", async () => {
  const transport = new FakeGo2Transport();
  const driver = new Go2Driver({ transport, clock: fixedClock });
  driver.connect();
  const report = await runGo2HardwareGauntlet({
    driver,
    probes: {
      ...makePassingHardwareProbes({ transport }),
      measureSafeStateEntry: async () => ({ ok: false, entry_ms: 999, evidence_refs: ["artifact:slow-safe-state"] })
    },
    safetyAcknowledgement: GO2_HARDWARE_GAUNTLET_ACK,
    clock: fixedClock
  });

  assert.equal(report.result, "incomplete");
  assert.equal(report.cases.find((entry) => entry.id === "D1").result, "fail");
  assert.equal(report.cases.find((entry) => entry.id === "D4").result, "fail");
  assert.equal("gauntlet_report" in driver.manifest(), false);
});

class FakeGo2Transport {
  commands = [];
  currentStatus = {
    mode: "damp",
    battery_pct: 82,
    pose: {
      frame_id: "odom",
      position: [1, 2, 0.4],
      rotation_xyzw: [0, 0, 0, 1]
    },
    faults: [],
    transport: "fake-unitree"
  };

  connect(config = {}) {
    this.commands.push({ type: "connect", config });
    return { ack: true };
  }

  disconnect() {
    this.commands.push({ type: "disconnect" });
    return { ack: true };
  }

  status() {
    return this.currentStatus;
  }

  setVelocity(setpoint) {
    this.commands.push({ type: "velocity", setpoint });
    return { ack: true, setpoint };
  }

  damp() {
    this.commands.push({ type: "damp" });
    return { ack: true, action: "damp" };
  }

  executeSportAction(action, params, deadline_ms) {
    this.commands.push({ type: `sport:${action}`, action, params, deadline_ms });
    return { ack: true, action };
  }

  openStream(name, declaration) {
    return { name, declared_hz: declaration.hz };
  }
}

function makePassingHardwareProbes({ transport, advanceMs = () => {} }) {
  return {
    async preflight() {
      return {
        ok: true,
        battery_pct: 82,
        clear_area: true,
        controller_ready: true,
        single_motion_authority: true
      };
    },
    async measureSafeStateEntry({ context, command }) {
      command?.();
      return {
        ok: true,
        entry_ms: context === "declared_max_entry" ? 210 : 180,
        evidence_refs: [`artifact:${context}`]
      };
    },
    async killSetpointStream() {
      transport.damp();
      return {
        ok: true,
        evidence_refs: ["artifact:d2-command-loss"],
        measurements: { safe_state_after_command_loss_ms: 220 }
      };
    },
    async killSupervisorProcess() {
      return {
        ok: true,
        evidence_refs: ["artifact:d3-process-kill"],
        measurements: { total_loss_within_ms: 260 },
        within_ms: 260,
        ended_upright: true
      };
    },
    async auditObservables() {
      return {
        ok: true,
        evidence_refs: ["artifact:d5-observables"],
        measurements: { velocity_error_mps: 0.018, force_observable: "none" }
      };
    },
    async dropTelemetry() {
      transport.currentStatus = null;
      advanceMs(350);
    },
    async verifyStreams(streams) {
      return {
        ok: true,
        evidence_refs: ["artifact:d7-streams"],
        measurements: Object.fromEntries(streams.map((stream) => [stream.name, { hz: stream.hz, sensitive: stream.sensitive === true }]))
      };
    }
  };
}
