import { createHash } from "node:crypto";
import { signCanonicalJson } from "../../contracts/src/signing.ts";

export const GO2_DRIVER_VERSION = "0.2.1";
export const GO2_HARDWARE_GAUNTLET_ACK = "I_UNDERSTAND_GO2_HARDWARE_GAUNTLET_RISK";

export class Go2Driver {
  #transport;
  #clock;
  #robotId;
  #manifest;
  #connected = false;
  #lastStatus = null;
  #lastStatusAt = null;
  #events = [];
  #nextSeq = 1;

  constructor({ transport, robotId = "go2", clock = () => new Date(), manifest = null }) {
    if (!transport) {
      throw new Go2DriverError("GO2_TRANSPORT_REQUIRED", "Go2Driver requires a transport.");
    }
    this.#transport = transport;
    this.#clock = clock;
    this.#robotId = robotId;
    this.#manifest = manifest ?? go2DriverManifest();
  }

  manifest() {
    return structuredClone(this.#manifest);
  }

  connect(config = {}) {
    const ack = this.#transport.connect(config);
    this.#connected = true;
    this.#emit("driver.connected", { config: scrubConfig(config) });
    return ack ?? { ack: true };
  }

  disconnect() {
    const ack = this.#transport.disconnect?.();
    this.#connected = false;
    this.#emit("driver.disconnected", {});
    return ack ?? { ack: true };
  }

  status() {
    const raw = this.#transport.status();
    if (raw) {
      this.#lastStatus = raw;
      this.#lastStatusAt = this.#clock();
    }
    return normalizeGo2Status({
      robotId: this.#robotId,
      connected: this.#connected,
      raw: this.#lastStatus,
      heartbeatAgeMs: this.#lastStatusAt ? Math.max(0, this.#clock().getTime() - this.#lastStatusAt.getTime()) : Number.POSITIVE_INFINITY
    });
  }

  set_setpoint(action_space, setpoint) {
    this.#requireConnected();
    if (action_space !== "base_velocity_3d") {
      throw new Go2DriverError("ACTION_SPACE_UNSUPPORTED", `Go2 driver does not support ${action_space}.`, { action_space });
    }
    const clamped = clampSetpoint(setpoint, this.#manifest.action_spaces[0].hard_caps);
    const ack = this.#transport.setVelocity(clamped);
    this.#emit("driver.setpoint_applied", { action_space, setpoint: clamped });
    return ack ?? { ack: true };
  }

  execute_discrete(action, params = {}, deadline_ms = 0) {
    this.#requireConnected();
    const native = this.#manifest.native_actions.find((entry) => entry.name === action);
    if (!native) {
      throw new Go2DriverError("NATIVE_ACTION_UNSUPPORTED", `Go2 driver does not support native action ${action}.`, { action });
    }
    const ack = action === "damp"
      ? this.#transport.damp()
      : this.#transport.executeSportAction(action, params, deadline_ms);
    this.#emit("driver.native_action", { action, params: structuredClone(params), deadline_ms });
    return ack ?? { ack: true };
  }

  command_safe_state() {
    this.#requireConnected();
    const ack = this.#transport.damp();
    this.#emit("driver.safe_state_commanded", { action: "damp" });
    return ack ?? { ack: true };
  }

  open_stream(name) {
    const declared = this.#manifest.streams.find((stream) => stream.name === name);
    if (!declared) {
      throw new Go2DriverError("STREAM_UNSUPPORTED", `Go2 driver does not declare stream ${name}.`, { name });
    }
    return this.#transport.openStream(name, declared);
  }

  events({ after = 0 } = {}) {
    return this.#events.filter((event) => event.seq > after);
  }

  #requireConnected() {
    if (!this.#connected) {
      throw new Go2DriverError("GO2_NOT_CONNECTED", "Go2 driver is not connected.");
    }
  }

  #emit(event_type, payload, severity = 0) {
    this.#events.push({
      seq: this.#nextSeq++,
      schema_version: 1,
      source: `driver:${this.#robotId}`,
      event_type,
      severity,
      timestamp: this.#clock().toISOString(),
      robot_id: this.#robotId,
      refs: [],
      payload
    });
  }
}

export class Go2DriverError extends Error {
  constructor(error_code, message, details = {}) {
    super(message);
    this.name = "Go2DriverError";
    this.error_code = error_code;
    this.details = details;
  }
}

export function go2DriverManifest({
  version = GO2_DRIVER_VERSION,
  hardCaps = { vx_mps: 0.25, vy_mps: 0.15, yaw_rps: 0.35 },
  maxEntryMs = 300,
  totalLossWithinMs = 300
} = {}) {
  return {
    driver: "go2",
    version,
    action_spaces: [
      {
        name: "base_velocity_3d",
        kind: "continuous",
        hard_caps: hardCaps,
        observables: {
          velocity: "measured",
          force: "none"
        }
      }
    ],
    native_actions: [
      { name: "damp", interruptible: true, safety_action: true },
      { name: "balance_stand", interruptible: true },
      { name: "stop_move", interruptible: true, safety_action: true },
      { name: "sit", interruptible: true },
      { name: "stand_up", interruptible: true }
    ],
    streams: [
      { name: "camera_front", type: "rgb", hz: 30 },
      { name: "go2_sport_state", type: "telemetry", hz: 50 },
      { name: "go2_low_state", type: "telemetry", hz: 500 }
    ],
    safe_state: {
      kind: "vendor:damp",
      balance_loop: "vendor_onboard",
      max_entry_ms: maxEntryMs,
      on_total_loss: {
        behavior: "vendor:damp",
        within_ms: totalLossWithinMs
      }
    }
  };
}

export function normalizeGo2Status({ robotId = "go2", connected, raw, heartbeatAgeMs }) {
  const mode = raw?.mode ?? raw?.sport_mode ?? "unknown";
  const batteryPct = Number(raw?.battery?.pct ?? raw?.battery_pct ?? 0);
  const faults = [];
  if (!connected) {
    faults.push("driver_disconnected");
  }
  if (!raw) {
    faults.push("telemetry_unavailable");
  }
  for (const fault of raw?.faults ?? []) {
    faults.push(String(fault));
  }
  return {
    robot_id: robotId,
    heartbeat_age_ms: Number.isFinite(heartbeatAgeMs) ? heartbeatAgeMs : 9_999_999,
    battery: {
      pct: batteryPct,
      power_headroom: powerHeadroom(raw, batteryPct)
    },
    safe_state_active: mode === "damp" || mode === "safe_state" || mode === "idle",
    pose: {
      frame_id: raw?.pose?.frame_id ?? "odom",
      position: raw?.pose?.position ?? [0, 0, 0],
      rotation_xyzw: raw?.pose?.rotation_xyzw ?? [0, 0, 0, 1],
      age_ms: Number.isFinite(heartbeatAgeMs) ? heartbeatAgeMs : 9_999_999
    },
    faults,
    vendor_display: {
      mode,
      transport: raw?.transport ?? "go2"
    }
  };
}

export function buildGo2DriverGauntletReport({ manifest, outcomes, suiteVersion = "0.2.1", generatedAt = new Date().toISOString() }) {
  const cases = ["D1", "D2", "D3", "D4", "D5", "D6", "D7"].map((id) => {
    const outcome = outcomes[id] ?? { result: "missing", evidence_refs: [] };
    return {
      id,
      result: outcome.result,
      evidence_refs: outcome.evidence_refs ?? [],
      measurements: outcome.measurements ?? {},
      notes: outcome.notes ?? ""
    };
  });
  const report = {
    schema_version: 1,
    conformance_class: "DR",
    suite: "NEM-10.2 driver-matrix",
    suite_version: suiteVersion,
    package: `driver:${manifest.driver}@${manifest.version}`,
    generated_at: generatedAt,
    result: cases.every((entry) => entry.result === "pass") ? "pass" : "incomplete",
    cases
  };
  return {
    ...report,
    report_sha256: `sha256:${createHash("sha256").update(JSON.stringify(report)).digest("hex")}`
  };
}

export async function runGo2HardwareGauntlet({
  driver,
  probes,
  safetyAcknowledgement,
  clock = () => new Date(),
  suiteVersion = "0.2.1"
}) {
  if (safetyAcknowledgement !== GO2_HARDWARE_GAUNTLET_ACK) {
    throw new Go2DriverError("GO2_HARDWARE_ACK_REQUIRED", "Hardware gauntlet requires explicit Go2 motion-risk acknowledgement.");
  }
  if (!probes?.preflight) {
    throw new Go2DriverError("GO2_GAUNTLET_PROBES_REQUIRED", "Hardware gauntlet requires probe hooks.");
  }

  const preflight = await probes.preflight();
  if (preflight?.ok !== true) {
    throw new Go2DriverError("GO2_PREFLIGHT_FAILED", "Go2 hardware gauntlet preflight failed.", { preflight });
  }

  const manifest = driver.manifest();
  const outcomes = {};

  outcomes.D1 = await runCase("D1", async () => {
    const idle = await measureSafeState(probes, "idle", () => driver.command_safe_state());
    driver.set_setpoint("base_velocity_3d", { vx_mps: 0.03, vy_mps: 0, yaw_rps: 0 });
    const midMotion = await measureSafeState(probes, "mid_motion", () => driver.command_safe_state());
    const nativeActions = [];
    for (const action of manifest.native_actions.filter((entry) => entry.interruptible)) {
      if (action.safety_action) {
        continue;
      }
      driver.execute_discrete(action.name, {}, 300);
      nativeActions.push(await measureSafeState(probes, `native:${action.name}`, () => driver.command_safe_state()));
    }
    return {
      result: allPass([idle, midMotion, ...nativeActions]) ? "pass" : "fail",
      evidence_refs: evidenceRefs([idle, midMotion, ...nativeActions]),
      measurements: {
        idle_entry_ms: idle.entry_ms,
        mid_motion_entry_ms: midMotion.entry_ms,
        native_actions: Object.fromEntries(nativeActions.map((entry) => [entry.label, entry.entry_ms]))
      },
      notes: "Safe state from idle, mid-motion, and interruptible native actions."
    };
  });

  outcomes.D2 = await runCase("D2", async () => {
    driver.set_setpoint("base_velocity_3d", { vx_mps: 0.03, vy_mps: 0, yaw_rps: 0 });
    const measurement = await probes.killSetpointStream();
    return outcomeFromMeasurement(measurement, "Safe state under setpoint stream loss.");
  });

  outcomes.D3 = await runCase("D3", async () => {
    const measurement = await probes.killSupervisorProcess();
    const withinLimit = Number(measurement.within_ms ?? measurement.entry_ms ?? Number.POSITIVE_INFINITY) <= manifest.safe_state.on_total_loss.within_ms;
    return {
      ...outcomeFromMeasurement({ ...measurement, ok: measurement.ok && withinLimit }, "Process kill behavior matches manifest safe_state.on_total_loss."),
      measurements: {
        ...measurement.measurements,
        within_ms: measurement.within_ms ?? measurement.entry_ms,
        declared_within_ms: manifest.safe_state.on_total_loss.within_ms,
        ended_upright: measurement.ended_upright
      }
    };
  });

  outcomes.D4 = await runCase("D4", async () => {
    const measurement = await probes.measureSafeStateEntry({ context: "declared_max_entry" });
    const withinLimit = Number(measurement.entry_ms ?? Number.POSITIVE_INFINITY) <= manifest.safe_state.max_entry_ms;
    return {
      ...outcomeFromMeasurement({ ...measurement, ok: measurement.ok && withinLimit }, "Measured safe-state entry is within declared max_entry_ms."),
      measurements: {
        entry_ms: measurement.entry_ms,
        declared_max_entry_ms: manifest.safe_state.max_entry_ms
      }
    };
  });

  outcomes.D5 = await runCase("D5", async () => {
    const measurement = await probes.auditObservables(manifest.action_spaces);
    return outcomeFromMeasurement(measurement, "Measured/inferred observables match instrumented ground truth.");
  });

  outcomes.D6 = await runCase("D6", async () => {
    const before = driver.status();
    await probes.dropTelemetry();
    const after = driver.status();
    const honest = after.heartbeat_age_ms > before.heartbeat_age_ms || after.faults.includes("telemetry_unavailable");
    return {
      result: honest ? "pass" : "fail",
      evidence_refs: evidenceRefs([after]),
      measurements: {
        before_heartbeat_age_ms: before.heartbeat_age_ms,
        after_heartbeat_age_ms: after.heartbeat_age_ms,
        after_faults: after.faults
      },
      notes: "Status stops being fresh when Go2 telemetry stops."
    };
  });

  outcomes.D7 = await runCase("D7", async () => {
    const measurement = await probes.verifyStreams(manifest.streams);
    return outcomeFromMeasurement(measurement, "Declared stream rates and sensitivity flags verified.");
  });

  return buildGo2DriverGauntletReport({
    manifest,
    outcomes,
    suiteVersion,
    generatedAt: clock().toISOString()
  });
}

export function signGo2DriverGauntletReport(report, privateKey) {
  return {
    ...report,
    signature: signCanonicalJson({ ...report, signature: "" }, privateKey)
  };
}

function clampSetpoint(setpoint, hardCaps) {
  return Object.fromEntries(Object.entries(setpoint).map(([field, value]) => {
    const cap = hardCaps[field];
    const number = Number(value);
    return [field, cap === undefined ? number : Math.max(-cap, Math.min(cap, number))];
  }));
}

function powerHeadroom(raw, batteryPct) {
  if (raw?.power_headroom) {
    return raw.power_headroom;
  }
  if (batteryPct <= 15) {
    return "critical";
  }
  if (batteryPct <= 30) {
    return "reduced";
  }
  return "nominal";
}

async function runCase(id, run) {
  try {
    return await run();
  } catch (error) {
    return {
      result: "fail",
      evidence_refs: [],
      measurements: {},
      notes: `${id} failed: ${error?.message ?? String(error)}`
    };
  }
}

async function measureSafeState(probes, label, command) {
  const measurement = await probes.measureSafeStateEntry({ context: label, command });
  return { label, ...measurement };
}

function outcomeFromMeasurement(measurement, notes) {
  return {
    result: measurement.ok ? "pass" : "fail",
    evidence_refs: measurement.evidence_refs ?? [],
    measurements: measurement.measurements ?? measurement,
    notes: measurement.notes ?? notes
  };
}

function allPass(measurements) {
  return measurements.every((entry) => entry.ok === true);
}

function evidenceRefs(measurements) {
  return [...new Set(measurements.flatMap((entry) => entry.evidence_refs ?? []))];
}

function scrubConfig(config) {
  return Object.fromEntries(Object.entries(config).filter(([key]) => !/token|secret|password/i.test(key)));
}
