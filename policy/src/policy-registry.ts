import { PolicyError } from "./policy-errors.ts";

const MATURITY_RANK = { experimental: 0, trusted: 1 };
const PACKAGE_ID = /^(cap|driver):[A-Za-z0-9._-]+@[0-9]+\.[0-9]+\.[0-9]+$/;
const ARTIFACT_REF = /^artifact:.+$/;

export class PolicyRegistry {
  #packages = new Map();
  #anomalyLog;

  constructor({ anomalyLog = null } = {}) {
    this.#anomalyLog = anomalyLog;
  }

  install(state) {
    const validated = validateRegistryState(state);
    this.#packages.set(validated.package, validated);
    return this.get(state.package);
  }

  enable(packageId) {
    return this.#update(packageId, { enabled: true });
  }

  pin(packageId) {
    return this.#update(packageId, { pinned: true });
  }

  revoke(packageId) {
    return this.#update(packageId, { enabled: false });
  }

  promote(packageId, maturity = "trusted") {
    this.#assertNoSafetyAnomaly({ capability: packageId });
    return this.#update(packageId, { maturity });
  }

  demote(packageId, maturity = "experimental") {
    return this.#update(packageId, { maturity });
  }

  get(packageId) {
    const state = this.#packages.get(packageId);
    if (!state) {
      throw new PolicyError("PACKAGE_NOT_REGISTERED", `${packageId} is not registered.`, { package: packageId });
    }
    return { ...state };
  }

  list() {
    return [...this.#packages.values()].map((state) => ({ ...state })).sort((left, right) => left.package.localeCompare(right.package));
  }

  assertUsable(packageId, minMaturity) {
    const state = this.get(packageId);
    if (!state.enabled) {
      throw new PolicyError("PACKAGE_REVOKED", `${packageId} is not enabled.`, { package: packageId });
    }
    if (!state.pinned) {
      throw new PolicyError("PACKAGE_NOT_PINNED", `${packageId} is not pinned.`, { package: packageId });
    }
    if (MATURITY_RANK[state.maturity] < MATURITY_RANK[minMaturity]) {
      throw new PolicyError("CAPABILITY_MATURITY_TOO_LOW", `${packageId} maturity ${state.maturity} is below ${minMaturity}.`, {
        package: packageId,
        maturity: state.maturity,
        min_maturity: minMaturity
      });
    }
    return state;
  }

  #update(packageId, patch) {
    const current = this.get(packageId);
    const next = validateRegistryState({ ...current, ...patch });
    this.#packages.set(packageId, next);
    return { ...next };
  }

  #assertNoSafetyAnomaly(filter) {
    try {
      this.#anomalyLog?.assertNoOpenSafetyAnomalies(filter);
    } catch (error) {
      if (error?.error_code === "SAFETY_ANOMALY_OPEN") {
        throw new PolicyError("SAFETY_ANOMALY_OPEN", "Open safety anomalies block maturity promotion.", error.details);
      }
      throw error;
    }
  }
}

export function packageIdForRule(rule) {
  return `cap:${rule.impl.capability}@${rule.impl.version}`;
}

export function validateRegistryState(state) {
  if (!PACKAGE_ID.test(String(state?.package ?? ""))) {
    throw new PolicyError("REGISTRY_PACKAGE_INVALID", "Registry package must be a cap: or driver: SemVer package id.", { package: state?.package });
  }
  if (typeof state?.enabled !== "boolean") {
    throw invalidField("enabled", "enabled must be boolean");
  }
  if (typeof state?.pinned !== "boolean") {
    throw invalidField("pinned", "pinned must be boolean");
  }
  if (!(state?.maturity in MATURITY_RANK)) {
    throw invalidField("maturity", "maturity must be experimental or trusted");
  }
  if (!ARTIFACT_REF.test(String(state.gauntlet_report ?? ""))) {
    throw invalidField("gauntlet_report", "gauntlet_report must be an artifact: reference");
  }
  if (!Array.isArray(state.history) || !state.history.every((ref) => Number.isInteger(ref) || typeof ref === "string")) {
    throw invalidField("history", "history must contain integer or string log refs");
  }
  return {
    package: state.package,
    enabled: state.enabled,
    pinned: state.pinned,
    maturity: state.maturity,
    gauntlet_report: state.gauntlet_report,
    history: [...state.history]
  };
}

function invalidField(field, message) {
  return new PolicyError("REGISTRY_STATE_INVALID", message, { field });
}
