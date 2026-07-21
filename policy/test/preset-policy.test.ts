import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { AnomalyLog } from "../../anomaly/src/anomaly-log.ts";
import { EventLog } from "../../mission-server/src/event-log.ts";
import { signCanonicalJson } from "../../contracts/src/signing.ts";
import { validateGauntletReportArtifact, validatePackageBundle } from "../src/package-bundle.ts";
import { PolicyError } from "../src/policy-errors.ts";
import { PolicyRegistry } from "../src/policy-registry.ts";
import { PresetPolicy, assertTightening, validatePreset } from "../src/preset-policy.ts";

test("PresetPolicy materializes verbs only when registry and driver requirements match", () => {
  const registry = registryWithFollow({ maturity: "experimental" });
  const policy = new PresetPolicy({ preset: followPreset({ min_capability_maturity: "experimental" }), registry });

  assert.deepEqual(policy.verbsFor({ robot: "go2", principal: "agent", driverManifest: driverManifest() }), ["entity", "follow", "scene", "status", "stop"]);
  assert.deepEqual(policy.verbsFor({ robot: "yam", principal: "agent", driverManifest: driverManifest() }), ["entity", "scene", "status", "stop"]);
  assert.deepEqual(policy.verbsFor({ robot: "go2", principal: "agent", driverManifest: driverManifest({ streams: [] }) }), ["entity", "scene", "status", "stop"]);
});

test("PresetPolicy checks registry maturity live at match time", () => {
  const registry = registryWithFollow({ maturity: "trusted" });
  const policy = new PresetPolicy({ preset: followPreset({ min_capability_maturity: "trusted" }), registry });

  assert.equal(policy.matchRule({ verb: "follow", robot: "go2", principal: "agent", driverManifest: driverManifest() }).verb, "follow");

  registry.demote("cap:follow-entity@0.1.0", "experimental");
  assert.throws(
    () => policy.matchRule({ verb: "follow", robot: "go2", principal: "agent", driverManifest: driverManifest() }),
    (error) => error instanceof PolicyError && error.error_code === "CAPABILITY_MATURITY_TOO_LOW"
  );

  registry.promote("cap:follow-entity@0.1.0", "trusted");
  registry.revoke("cap:follow-entity@0.1.0");
  assert.throws(
    () => policy.matchRule({ verb: "follow", robot: "go2", principal: "agent", driverManifest: driverManifest() }),
    (error) => error instanceof PolicyError && error.error_code === "PACKAGE_REVOKED"
  );
});

test("assertTightening rejects widened limits, removed abort triggers, and lowered maturity", () => {
  const parent = followPreset({ min_capability_maturity: "trusted" });
  assert.throws(
    () => assertTightening({ parent, child: followPreset({ min_capability_maturity: "experimental" }) }),
    (error) => error instanceof PolicyError && error.error_code === "LATTICE_VIOLATION"
  );
  assert.throws(
    () =>
      assertTightening({
        parent: followPreset({ max_speed_mps: 0.15 }),
        child: followPreset({ max_speed_mps: 0.2 })
      }),
    (error) => error instanceof PolicyError && error.details.field === "grant.limits.max_speed_mps"
  );
  assert.throws(
    () =>
      assertTightening({
        parent: followPreset({ abort_triggers: ["operator_stop", "stream_silence"] }),
        child: followPreset({ abort_triggers: ["operator_stop"] })
      }),
    (error) => error instanceof PolicyError && error.details.field === "abort_triggers"
  );
});

test("validatePreset rejects agent continuous pass-through verbs", () => {
  assert.throws(
    () =>
      validatePreset({
        ...followPreset(),
        rules: [
          {
            ...followPreset().rules[0],
            verb: "base_velocity_3d",
            principals: ["agent"]
          }
        ]
      }),
    (error) => error instanceof PolicyError && error.error_code === "PASS_THROUGH_AGENT_FORBIDDEN"
  );
});

test("validatePreset compiles preset Attention wake predicates", () => {
  assert.equal(
    validatePreset(
      followPreset({
        attention: {
          state_filter: ["entity.bound"],
          wake_predicate_cel: 'event.theme == "entity.bound"',
          budget: { max_pending: 10 },
          digest_version: 2,
          predicate_env_version: 1
        }
      })
    ),
    true
  );
  assert.throws(
    () =>
      validatePreset(
        followPreset({
          attention: {
            state_filter: ["run.own"],
            wake_predicate_cel: "event.unknown == 1",
            budget: { max_pending: 10 },
            digest_version: 2,
            predicate_env_version: 1
          }
        })
      ),
    (error) => error.error_code === "CEL_TYPE_ERROR"
  );
});

test("PolicyRegistry blocks maturity promotion while matching safety anomaly is open", () => {
  const anomalyLog = new AnomalyLog({ eventLog: new EventLog() });
  const registry = registryWithFollow({ maturity: "experimental", anomalyLog });
  anomalyLog.open({
    id: "anm_safety",
    severity: "safety",
    mission_id: "msn_test",
    capability: "cap:follow-entity@0.1.0",
    expected: "Follow capability avoids contact.",
    observed: "Unexpected contact.",
    evidence_refs: []
  });

  assert.throws(
    () => registry.promote("cap:follow-entity@0.1.0", "trusted"),
    (error) => error instanceof PolicyError && error.error_code === "SAFETY_ANOMALY_OPEN"
  );

  anomalyLog.close({ anomaly_id: "anm_safety" });
  assert.equal(registry.promote("cap:follow-entity@0.1.0", "trusted").maturity, "trusted");
});

test("PolicyRegistry validates registry state against package contract", () => {
  const registry = new PolicyRegistry();

  assert.throws(
    () =>
      registry.install({
        package: "follow-entity",
        enabled: true,
        pinned: true,
        maturity: "experimental",
        gauntlet_report: "artifact:gauntlet_follow",
        history: []
      }),
    (error) => error instanceof PolicyError && error.error_code === "REGISTRY_PACKAGE_INVALID"
  );

  assert.throws(
    () =>
      registry.install({
        package: "cap:follow-entity@0.1.0",
        enabled: true,
        pinned: true,
        maturity: "alpha",
        gauntlet_report: "artifact:gauntlet_follow",
        history: []
      }),
    (error) => error instanceof PolicyError && error.error_code === "REGISTRY_STATE_INVALID" && error.details.field === "maturity"
  );

  assert.throws(
    () =>
      registry.install({
        package: "cap:follow-entity@0.1.0",
        enabled: true,
        pinned: true,
        maturity: "experimental",
        gauntlet_report: "gauntlet_follow",
        history: []
      }),
    (error) => error instanceof PolicyError && error.error_code === "REGISTRY_STATE_INVALID" && error.details.field === "gauntlet_report"
  );
});

test("validatePackageBundle verifies manifest identity, artifact hashes, and detached signature", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const registryState = {
    package: "cap:follow-entity@0.1.0",
    enabled: true,
    pinned: true,
    maturity: "experimental",
    gauntlet_report: "artifact:gauntlet_follow",
    history: []
  };
  const bundle = signedBundle({ registryState, privateKey });

  assert.deepEqual(validatePackageBundle({ registryState, bundle, publicKey }), {
    package: registryState.package,
    signature: bundle.signature
  });
  assert.throws(
    () => validatePackageBundle({ registryState, bundle: { ...bundle, artifacts: { "tracker.onnx": "tampered" } }, publicKey }),
    (error) => error instanceof PolicyError && error.error_code === "PACKAGE_ARTIFACT_HASH_MISMATCH"
  );
  assert.throws(
    () => validatePackageBundle({ registryState, bundle: { ...bundle, schema_version: 2 }, publicKey }),
    (error) => error instanceof PolicyError && error.error_code === "PACKAGE_SIGNATURE_INVALID"
  );
  assert.throws(
    () =>
      validatePackageBundle({
        registryState,
        bundle: signedBundle({
          registryState: { ...registryState, package: "cap:other@0.1.0" },
          privateKey,
          capability: "other"
        }),
        publicKey
      }),
    (error) => error instanceof PolicyError && error.error_code === "PACKAGE_MANIFEST_MISMATCH"
  );
});

test("validateGauntletReportArtifact verifies signed driver reports against registry state", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const registryState = {
    package: "driver:go2@0.2.1",
    enabled: true,
    pinned: true,
    maturity: "trusted",
    gauntlet_report: "artifact:go2_d1_d7",
    history: []
  };
  const report = signedGauntletReport({ registryState, privateKey });

  assert.deepEqual(validateGauntletReportArtifact({ registryState, report, publicKey }), {
    package: "driver:go2@0.2.1",
    conformance_class: "DR",
    result: "pass",
    signature: report.signature
  });
  assert.deepEqual(validatePackageBundle({
    registryState,
    bundle: signedDriverBundle({ registryState, privateKey, report }),
    publicKey
  }), {
    package: registryState.package,
    signature: signedDriverBundle({ registryState, privateKey, report }).signature
  });
  assert.throws(
    () => validateGauntletReportArtifact({
      registryState,
      report: signedGauntletReport({ registryState: { ...registryState, package: "driver:other@0.2.1" }, privateKey }),
      publicKey
    }),
    (error) => error instanceof PolicyError && error.error_code === "PACKAGE_GAUNTLET_MISMATCH"
  );
  assert.throws(
    () => validateGauntletReportArtifact({
      registryState,
      report: signedGauntletReport({ registryState, privateKey, result: "incomplete" }),
      publicKey
    }),
    (error) => error instanceof PolicyError && error.error_code === "PACKAGE_GAUNTLET_FAILED"
  );
  assert.throws(
    () => validateGauntletReportArtifact({
      registryState,
      report: { ...report, result: "incomplete" },
      publicKey
    }),
    (error) => error instanceof PolicyError && error.error_code === "PACKAGE_GAUNTLET_FAILED"
  );
  assert.throws(
    () => validateGauntletReportArtifact({
      registryState,
      report: signedGauntletReport({ registryState, privateKey, omitCase: "D7" }),
      publicKey
    }),
    (error) => error instanceof PolicyError && error.error_code === "PACKAGE_BUNDLE_INVALID" && error.details.field === "gauntlet_report_artifact.cases"
  );
  assert.throws(
    () => validateGauntletReportArtifact({
      registryState,
      report: signedGauntletReport({ registryState, privateKey, failedCase: "D4" }),
      publicKey
    }),
    (error) => error instanceof PolicyError && error.error_code === "PACKAGE_GAUNTLET_FAILED" && error.details.case === "D4"
  );
});

test("assertTightening reports open safety anomaly before accepting preset widening path", () => {
  const anomalyLog = new AnomalyLog({ eventLog: new EventLog() });
  anomalyLog.open({
    id: "anm_safety",
    severity: "safety",
    mission_id: "msn_test",
    expected: "Policy prevents unsafe widening.",
    observed: "Widening was requested.",
    evidence_refs: []
  });

  assert.throws(
    () =>
      assertTightening({
        parent: followPreset({ max_speed_mps: 0.15 }),
        child: followPreset({ max_speed_mps: 0.2 }),
        anomalyLog
      }),
    (error) => error instanceof PolicyError && error.error_code === "SAFETY_ANOMALY_OPEN"
  );
});

function registryWithFollow({ maturity = "experimental", enabled = true, anomalyLog = null } = {}) {
  const registry = new PolicyRegistry({ anomalyLog });
  registry.install({
    package: "cap:follow-entity@0.1.0",
    enabled,
    pinned: true,
    maturity,
    gauntlet_report: "artifact:gauntlet_follow",
    history: []
  });
  return registry;
}

function signedBundle({ registryState, privateKey, capability = "follow-entity" }) {
  const artifacts = { "tracker.onnx": "model-bytes" };
  const payload = {
    schema_version: 1,
    manifest: {
      capability,
      version: "0.1.0",
      publisher: "test",
      verbs: [{ verb: "follow", args: {}, applies_to: ["trackable"], doc: "Follow a trackable entity." }],
      requires: { action_spaces: ["base_velocity_3d"], streams: ["camera_front"] },
      dependencies: [{ name: "tracker.onnx", sha256: sha256(artifacts["tracker.onnx"]) }],
      network: "none",
      grant_defaults: { limits: { max_speed_mps: 0.15 }, abort: ["operator_stop"] }
    },
    artifacts,
    gauntlet_report: registryState.gauntlet_report,
    signature: ""
  };
  return { ...payload, signature: signCanonicalJson(payload, privateKey) };
}

function signedDriverBundle({ registryState, privateKey, report }) {
  const payload = {
    schema_version: 1,
    manifest: {
      driver: "go2",
      version: "0.2.1",
      action_spaces: [
        {
          name: "base_velocity_3d",
          kind: "continuous",
          hard_caps: { vx_mps: 0.25, vy_mps: 0.15, yaw_rps: 0.35 },
          observables: { velocity: "measured", force: "none" }
        }
      ],
      native_actions: [{ name: "damp", interruptible: true, safety_action: true }],
      streams: [{ name: "camera_front", type: "rgb", hz: 30 }],
      safe_state: {
        kind: "vendor:damp",
        balance_loop: "vendor_onboard",
        max_entry_ms: 300,
        on_total_loss: { behavior: "vendor:damp", within_ms: 300 }
      }
    },
    artifacts: {},
    gauntlet_report: registryState.gauntlet_report,
    gauntlet_report_artifact: report,
    signature: ""
  };
  return { ...payload, signature: signCanonicalJson(payload, privateKey) };
}

function signedGauntletReport({ registryState, privateKey, result = "pass", omitCase = null, failedCase = null }) {
  const cases = ["D1", "D2", "D3", "D4", "D5", "D6", "D7"]
    .filter((id) => id !== omitCase)
    .map((id) => ({
      id,
      result: failedCase === id ? "fail" : result === "pass" ? "pass" : "missing",
      evidence_refs: [`artifact:${id.toLowerCase()}`],
      measurements: {},
      notes: ""
    }));
  const payload = {
    schema_version: 1,
    conformance_class: "DR",
    suite: "NEM-10.2 driver-matrix",
    suite_version: "0.2.1",
    package: registryState.package,
    generated_at: "2026-07-07T17:00:00.000Z",
    result,
    cases,
    report_sha256: `sha256:${"a".repeat(64)}`,
    signature: ""
  };
  return { ...payload, signature: signCanonicalJson(payload, privateKey) };
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function followPreset({
  min_capability_maturity = "experimental",
  max_speed_mps = 0.15,
  abort_triggers = ["operator_stop", "stream_silence"],
  attention = null
} = {}) {
  return {
    id: "preset_go2_follow_v1",
    schema_version: 1,
    name: "go2-follow",
    version: "1.0.0",
    min_capability_maturity,
    provenance: { author: "operator:op_local" },
    signature: "ed25519:test",
    ...(attention ? { attention } : {}),
    rules: [
      {
        verb: "follow",
        robots: ["go2"],
        principals: ["agent", "operator"],
        impl: { capability: "follow-entity", version: "0.1.0" },
        applies_to: ["trackable"],
        args: { standoff_m: { min: 1, max: 3 } },
        grant: {
          action_space: "base_velocity_3d",
          limits: { max_speed_mps, max_yaw_rps: 0.2 },
          watchdog_ms: 100,
          max_duration_ms: 120000
        },
        freshness: { robot_status_ms: 500, scene_ms: 700 },
        streams: ["camera_front"],
        network: "none",
        approval: { required: true, scope: "per_run" },
        abort_triggers
      }
    ]
  };
}

function driverManifest({ streams = [{ name: "camera_front", type: "rgb", hz: 30 }] } = {}) {
  return {
    driver: "go2",
    version: "0.1.0",
    action_spaces: [{ name: "base_velocity_3d", kind: "continuous", hard_caps: { vx_mps: 0.25, yaw_rps: 0.35 }, observables: { velocity: "measured", force: "none" } }],
    native_actions: [],
    streams,
    safe_state: {
      kind: "hold_posture",
      balance_loop: "driver_maintained",
      max_entry_ms: 20,
      on_total_loss: { behavior: "vendor:damp", within_ms: 300 }
    }
  };
}
