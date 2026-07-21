import { createHash } from "node:crypto";
import { verifyCanonicalJson } from "../../contracts/src/signing.ts";
import { PolicyError } from "./policy-errors.ts";

const REQUIRED_GAUNTLET_CASES = {
  DR: ["D1", "D2", "D3", "D4", "D5", "D6", "D7"],
  CP: ["target_vanishes", "obstacle_enters_workspace", "stop_during_contact", "stream_starvation", "stale_scene", "malformed_chunk_fuzzing"]
};

export function validatePackageBundle({ registryState, bundle, publicKey }) {
  if (!bundle) {
    return null;
  }
  if (!publicKey) {
    throw new PolicyError("PACKAGE_SIGNATURE_INVALID", "Package bundle validation requires a trusted public key.", { package: registryState?.package });
  }
  const manifest = bundle.manifest;
  if (!manifest || typeof manifest !== "object") {
    throw invalid("manifest", "Package bundle must include manifest.json content.");
  }
  const packageId = packageIdForManifest(manifest);
  if (packageId !== registryState.package) {
    throw new PolicyError("PACKAGE_MANIFEST_MISMATCH", "Package manifest id does not match registry package.", {
      registry_package: registryState.package,
      manifest_package: packageId
    });
  }
  if (bundle.gauntlet_report && bundle.gauntlet_report !== registryState.gauntlet_report) {
    throw invalid("gauntlet_report", "Package gauntlet report must match registry state.");
  }
  if (bundle.gauntlet_report_artifact) {
    validateGauntletReportArtifact({
      registryState,
      report: bundle.gauntlet_report_artifact,
      publicKey
    });
  }
  validateArtifacts({ manifest, artifacts: bundle.artifacts ?? {} });

  const signedPayload = {
    schema_version: bundle.schema_version ?? 1,
    manifest,
    artifacts: bundle.artifacts ?? {},
    gauntlet_report: registryState.gauntlet_report,
    ...(bundle.gauntlet_report_artifact ? { gauntlet_report_artifact: bundle.gauntlet_report_artifact } : {}),
    signature: bundle.signature
  };
  if (!signatureValid(signedPayload, publicKey)) {
    throw new PolicyError("PACKAGE_SIGNATURE_INVALID", "Package bundle signature did not verify.", { package: registryState.package });
  }
  return { package: registryState.package, signature: bundle.signature };
}

export function validateGauntletReportArtifact({ registryState, report, publicKey }) {
  if (!report || typeof report !== "object" || Array.isArray(report)) {
    throw invalid("gauntlet_report_artifact", "Gauntlet report artifact must be an object.");
  }
  validateGauntletReportShape(report);
  if (report.package !== registryState.package) {
    throw new PolicyError("PACKAGE_GAUNTLET_MISMATCH", "Gauntlet report package does not match registry package.", {
      registry_package: registryState.package,
      report_package: report.package
    });
  }
  const expectedClass = registryState.package.startsWith("driver:") ? "DR" : "CP";
  if (report.conformance_class !== expectedClass) {
    throw new PolicyError("PACKAGE_GAUNTLET_MISMATCH", "Gauntlet report conformance class does not match package kind.", {
      package: registryState.package,
      expected: expectedClass,
      observed: report.conformance_class
    });
  }
  validateGauntletCaseCoverage(report);
  if (registryState.maturity === "trusted" && report.result !== "pass") {
    throw new PolicyError("PACKAGE_GAUNTLET_FAILED", "Trusted package registry state requires a passing gauntlet report.", {
      package: registryState.package,
      result: report.result
    });
  }
  if (!signatureValid(report, publicKey)) {
    throw new PolicyError("PACKAGE_GAUNTLET_SIGNATURE_INVALID", "Gauntlet report signature did not verify.", { package: registryState.package });
  }
  return {
    package: report.package,
    conformance_class: report.conformance_class,
    result: report.result,
    signature: report.signature
  };
}

function validateGauntletReportShape(report) {
  if (report.schema_version !== 1) {
    throw invalid("gauntlet_report_artifact.schema_version", "Gauntlet report schema_version must be 1.");
  }
  if (report.suite_version !== "0.2.1") {
    throw invalid("gauntlet_report_artifact.suite_version", "Gauntlet report suite_version must match NEM Suite 0.2.1.");
  }
  if (!["DR", "CP"].includes(report.conformance_class)) {
    throw invalid("gauntlet_report_artifact.conformance_class", "Package gauntlet reports must use DR or CP conformance class.");
  }
  if (!["pass", "fail", "incomplete"].includes(report.result)) {
    throw invalid("gauntlet_report_artifact.result", "Gauntlet report result must be pass, fail, or incomplete.");
  }
  if (!Array.isArray(report.cases) || report.cases.length === 0) {
    throw invalid("gauntlet_report_artifact.cases", "Gauntlet report must include case evidence.");
  }
  if (typeof report.report_sha256 !== "string" || !/^sha256:[a-f0-9]{64}$/.test(report.report_sha256)) {
    throw invalid("gauntlet_report_artifact.report_sha256", "Gauntlet report must include a sha256 digest.");
  }
  if (typeof report.signature !== "string" || !/^ed25519:[A-Za-z0-9+/=]+$/.test(report.signature)) {
    throw invalid("gauntlet_report_artifact.signature", "Gauntlet report must include an Ed25519 signature.");
  }
  for (const entry of report.cases) {
    if (!entry || typeof entry !== "object" || typeof entry.id !== "string") {
      throw invalid("gauntlet_report_artifact.cases", "Each gauntlet case must include an id.");
    }
    if (!["pass", "fail", "missing", "incomplete"].includes(entry.result)) {
      throw invalid("gauntlet_report_artifact.cases", `Gauntlet case ${entry.id} has an invalid result.`);
    }
    if (!Array.isArray(entry.evidence_refs) || entry.evidence_refs.length === 0 || entry.evidence_refs.some((ref) => typeof ref !== "string" || !ref.startsWith("artifact:"))) {
      throw invalid("gauntlet_report_artifact.cases", `Gauntlet case ${entry.id} must include artifact evidence refs.`);
    }
  }
}

function validateGauntletCaseCoverage(report) {
  const required = REQUIRED_GAUNTLET_CASES[report.conformance_class] ?? [];
  const cases = new Map(report.cases.map((entry) => [entry.id, entry]));
  for (const id of required) {
    const entry = cases.get(id);
    if (!entry) {
      throw invalid("gauntlet_report_artifact.cases", `Gauntlet report is missing required case ${id}.`);
    }
    if (report.result === "pass" && entry.result !== "pass") {
      throw new PolicyError("PACKAGE_GAUNTLET_FAILED", "Passing gauntlet report contains a non-passing required case.", {
        package: report.package,
        case: id,
        result: entry.result
      });
    }
  }
}

function validateArtifacts({ manifest, artifacts }) {
  for (const dependency of manifest.dependencies ?? []) {
    const content = artifacts[dependency.name];
    if (content === undefined) {
      throw invalid("artifacts", `Package artifact ${dependency.name} is missing.`);
    }
    const hash = sha256(String(content));
    if (hash !== dependency.sha256) {
      throw new PolicyError("PACKAGE_ARTIFACT_HASH_MISMATCH", `Package artifact ${dependency.name} hash does not match manifest.`, {
        artifact: dependency.name,
        expected: dependency.sha256,
        observed: hash
      });
    }
  }
}

function packageIdForManifest(manifest) {
  if (manifest.capability) {
    return `cap:${manifest.capability}@${manifest.version}`;
  }
  if (manifest.driver) {
    return `driver:${manifest.driver}@${manifest.version}`;
  }
  throw invalid("manifest", "Package manifest must identify a capability or driver.");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function invalid(field, message) {
  return new PolicyError("PACKAGE_BUNDLE_INVALID", message, { field });
}

function signatureValid(payload, publicKey) {
  try {
    return verifyCanonicalJson(payload, publicKey);
  } catch {
    return false;
  }
}
