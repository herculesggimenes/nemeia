import { createHash } from "node:crypto";
import { MissionServer } from "../../mission-server/src/mission-server.ts";
import { SimDriver } from "../../supervisor/src/sim-driver.ts";
import { SupervisorKernel } from "../../supervisor/src/supervisor-kernel.ts";
import { KernelError } from "../../supervisor/src/kernel-errors.ts";
import { CapabilityHost, ManualChunkCapability } from "./capability-host.ts";

const CASES = [
  "target_vanishes",
  "obstacle_enters_workspace",
  "stop_during_contact",
  "stream_starvation",
  "stale_scene",
  "malformed_chunk_fuzzing"
];

const BASE_TIME_MS = Date.parse("2026-07-07T17:00:00.000Z");

export class CapabilityGauntlet {
  #manifest;
  #seed;
  #clockStartMs;
  #capabilityFactory;

  constructor({ manifest, seed = "nem-cp-gauntlet-v1", clockStartMs = BASE_TIME_MS, capabilityFactory = null }) {
    this.#manifest = manifest;
    this.#seed = seed;
    this.#clockStartMs = clockStartMs;
    this.#capabilityFactory = capabilityFactory ?? (() => new ManualChunkCapability({ manifest }));
  }

  run() {
    const cases = CASES.map((name, index) => this.#runCase(name, index));
    const passed = cases.every((entry) => entry.result === "pass");
    const report = {
      schema_version: 1,
      conformance_class: "CP",
      suite: "NEM-10.2 capability-gauntlet",
      seed: this.#seed,
      package: `cap:${this.#manifest.capability}@${this.#manifest.version}`,
      generated_at: new Date(this.#clockStartMs).toISOString(),
      result: passed ? "pass" : "fail",
      cases
    };
    return {
      ...report,
      report_sha256: digestReport(report)
    };
  }

  #runCase(name, index) {
    const fixture = makeGauntletFixture({
      manifest: this.#manifest,
      capability: this.#capabilityFactory(),
      clockStartMs: this.#clockStartMs + index * 10_000,
      idempotencyPrefix: `${name}-${stableSeedNumber(`${this.#seed}:${name}`)}`
    });
    try {
      return scenarios[name](fixture);
    } catch (error) {
      return {
        name,
        result: "fail",
        evidence: {
          error_code: error?.error_code ?? error?.code ?? "UNKNOWN",
          message: error?.message ?? String(error)
        }
      };
    }
  }
}

export function runCapabilityGauntlet(options) {
  return new CapabilityGauntlet(options).run();
}

const scenarios = {
  target_vanishes(fixture) {
    fixture.bindAndStart();
    fixture.host.emitChunk({ vx_mps: 0.1, vy_mps: 0, yaw_rps: 0 });
    fixture.kernel.tick();
    const aborted = fixture.host.abort("target_vanished");
    const status = fixture.kernel.status();
    return passCase("target_vanishes", {
      trigger: aborted.trigger,
      host_state: aborted.state,
      active_authorization: status.kernel.active_authorization,
      safe_state_commands: fixture.driver.safeStateCommands().length,
      kernel_events: eventTypes(fixture.kernel)
    }, aborted.state === "aborted" && status.kernel.active_authorization === null && fixture.driver.safeStateCommands().length === 1);
  },

  obstacle_enters_workspace(fixture) {
    fixture.bindAndStart();
    fixture.host.emitChunk({ vx_mps: 0.08, vy_mps: 0, yaw_rps: 0 });
    fixture.kernel.tick();
    const aborted = fixture.host.abort("obstacle_entered_workspace");
    return passCase("obstacle_enters_workspace", {
      trigger: aborted.trigger,
      safe_state_active: fixture.kernel.status().kernel.safe_state_condition,
      safe_state_commands: fixture.driver.safeStateCommands().length,
      kernel_events: eventTypes(fixture.kernel)
    }, aborted.state === "aborted" && fixture.kernel.status().kernel.safe_state_condition === "active");
  },

  stop_during_contact(fixture) {
    fixture.bindAndStart();
    fixture.host.emitChunk({ vx_mps: 0.1, vy_mps: 0, yaw_rps: 0 });
    fixture.kernel.tick();
    const stopped = fixture.host.stop();
    return passCase("stop_during_contact", {
      host_state: stopped.state,
      active_authorization: fixture.kernel.status().kernel.active_authorization,
      safe_state_commands: fixture.driver.safeStateCommands().length,
      kernel_events: eventTypes(fixture.kernel)
    }, stopped.state === "stopped" && fixture.kernel.status().kernel.active_authorization === null);
  },

  stream_starvation(fixture) {
    fixture.bindAndStart();
    fixture.advanceMs(fixture.authorization.grant.stream.watchdog_ms + 1);
    const tick = fixture.kernel.tick();
    return passCase("stream_starvation", {
      tick: {
        state: tick.state,
        trigger: tick.trigger
      },
      safe_state_commands: fixture.driver.safeStateCommands().length,
      kernel_events: eventTypes(fixture.kernel)
    }, tick.state === "aborted" && tick.trigger === "stream_silence" && fixture.driver.safeStateCommands().length === 1);
  },

  stale_scene(fixture) {
    fixture.bindAndStart();
    fixture.host.onFrame("camera_front", {
      scene_snapshot_id: "ssg_stale",
      age_ms: 701,
      entities: [{ entity_id: fixture.authorization.target.entity_id, visible: true }]
    });
    const aborted = fixture.host.abort("stale_scene");
    return passCase("stale_scene", {
      trigger: aborted.trigger,
      safe_state_commands: fixture.driver.safeStateCommands().length,
      terminated: fixture.host.terminate()
    }, aborted.state === "aborted" && fixture.driver.safeStateCommands().length === 1);
  },

  malformed_chunk_fuzzing(fixture) {
    fixture.bindAndStart();
    const rejected = [];
    for (const chunk of malformedChunks(fixture.authorization.id)) {
      try {
        fixture.kernel.submitChunk(chunk);
      } catch (error) {
        rejected.push({
          error_code: error.error_code,
          kernel_error: error instanceof KernelError
        });
      }
    }
    const stopped = fixture.host.stop();
    return passCase("malformed_chunk_fuzzing", {
      rejected,
      host_state: stopped.state,
      safe_state_commands: fixture.driver.safeStateCommands().length
    }, rejected.length === 4 && rejected.every((entry) => entry.kernel_error) && stopped.state === "stopped");
  }
};

function makeGauntletFixture({ manifest, capability, clockStartMs, idempotencyPrefix }) {
  let nowMs = clockStartMs;
  const clock = () => new Date(nowMs);
  const server = new MissionServer({ clock });
  const mission = server.createMission({
    idempotencyKey: `${idempotencyPrefix}:mission`,
    preset: { id: "preset_go2_follow_v1", version: "1.0.0" },
    robot_ids: ["go2"]
  });
  const run = server.proposeRun({
    idempotencyKey: `${idempotencyPrefix}:run`,
    mission_id: mission.id,
    robot_id: "go2",
    verb: "follow",
    args: { max_speed_mps: 0.12, max_yaw_rps: 0.15, watchdog_ms: 100, max_duration_ms: 1_000 },
    target: { entity_id: "ent_person_01", snapshot_id: "ssg_gauntlet", evidence_refs: ["artifact:gauntlet-target"] }
  });
  const { authorization } = server.approveRun({
    idempotencyKey: `${idempotencyPrefix}:approve`,
    run_id: run.id,
    operator: "op_gauntlet"
  });
  const driver = new SimDriver({ clock });
  driver.connect();
  const kernel = new SupervisorKernel({
    robotId: "go2",
    driver,
    trustedPublicKey: server.publicKey,
    clock
  });
  const host = new CapabilityHost({ capability, kernel });
  return {
    authorization,
    driver,
    host,
    kernel,
    bindAndStart() {
      host.bind(authorization);
      host.start();
    },
    advanceMs(ms) {
      nowMs += ms;
    }
  };
}

function passCase(name, evidence, condition) {
  return {
    name,
    result: condition ? "pass" : "fail",
    evidence
  };
}

function eventTypes(kernel) {
  return kernel.events().map((event) => event.event_type);
}

function malformedChunks(authId) {
  return [
    { auth_id: `${authId}:wrong`, seq: 1, setpoint: { vx_mps: 0 } },
    { auth_id: authId, seq: 1, setpoint: { unknown_field: 0 } },
    { auth_id: authId, seq: 2, setpoint: { vx_mps: Number.NaN } },
    { auth_id: authId, seq: 3, setpoint: null }
  ];
}

function stableSeedNumber(seed) {
  return createHash("sha256").update(seed).digest("hex").slice(0, 8);
}

function digestReport(report) {
  return createHash("sha256").update(JSON.stringify(report)).digest("hex");
}
