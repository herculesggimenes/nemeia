import { compilePredicate } from "../../attention/src/cel-predicate.ts";
import { PolicyError } from "./policy-errors.ts";
import { packageIdForRule } from "./policy-registry.ts";

const READ_VERBS = new Set(["status", "scene", "entity"]);

export class PresetPolicy {
  #preset;
  #registry;

  constructor({ preset, registry }) {
    validatePreset(preset);
    this.#preset = structuredClone(preset);
    this.#registry = registry;
  }

  preset() {
    return structuredClone(this.#preset);
  }

  verbsFor({ robot, principal, driverManifest }) {
    const verbs = new Set(["stop", ...READ_VERBS]);
    for (const rule of this.#preset.rules) {
      if (this.#ruleMatches(rule, { robot, principal, driverManifest, requireRegistry: false })) {
        verbs.add(rule.verb);
      }
    }
    return [...verbs].sort();
  }

  matchRule({ verb, robot, principal, driverManifest }) {
    if (verb === "stop" || READ_VERBS.has(verb)) {
      return { injected: true, verb };
    }
    const rule = this.#preset.rules.find((candidate) => candidate.verb === verb && this.#ruleMatches(candidate, { robot, principal, driverManifest, requireRegistry: true }));
    if (!rule) {
      throw new PolicyError("VERB_NOT_IN_POLICY", `Verb ${verb} is not available for ${principal} on ${robot}.`, { verb, robot, principal });
    }
    return structuredClone(rule);
  }

  #ruleMatches(rule, { robot, principal, driverManifest, requireRegistry }) {
    if (!rule.robots.includes(robot)) {
      return false;
    }
    if (!rule.principals.includes(principal)) {
      return false;
    }
    if (driverManifest && !requiresSatisfied(rule, driverManifest)) {
      return false;
    }
    if (requireRegistry) {
      this.#registry.assertUsable(packageIdForRule(rule), this.#preset.min_capability_maturity);
    }
    return true;
  }
}

export function validatePreset(preset) {
  if (!preset?.rules?.length) {
    throw new PolicyError("PRESET_EMPTY", "Preset must contain at least one rule.");
  }
  for (const rule of preset.rules) {
    if (rule.principals.includes("agent") && rule.grant?.action_space === "base_velocity_3d" && !rule.impl) {
      throw new PolicyError("PASS_THROUGH_AGENT_FORBIDDEN", "Agent rules cannot grant continuous pass-through action spaces.");
    }
    if (rule.principals.includes("agent") && rule.verb === "base_velocity_3d") {
      throw new PolicyError("PASS_THROUGH_AGENT_FORBIDDEN", "Agent rules cannot expose base velocity as a verb.");
    }
  }
  if (preset.attention?.wake_predicate_cel !== undefined) {
    compilePredicate(preset.attention.wake_predicate_cel);
  }
  return true;
}

export function assertTightening({ parent, child, anomalyLog = null }) {
  if (anomalyLog && presetWidens({ parent, child })) {
    try {
      anomalyLog.assertNoOpenSafetyAnomalies({});
    } catch (error) {
      if (error?.error_code === "SAFETY_ANOMALY_OPEN") {
        throw new PolicyError("SAFETY_ANOMALY_OPEN", "Open safety anomalies block preset widening.", error.details);
      }
      throw error;
    }
  }
  if (maturityRank(child.min_capability_maturity) < maturityRank(parent.min_capability_maturity)) {
    throw lattice("min_capability_maturity", "child cannot lower minimum maturity");
  }
  for (const childRule of child.rules) {
    const parentRule = parent.rules.find((rule) => rule.verb === childRule.verb);
    if (!parentRule) {
      continue;
    }
    for (const [name, value] of Object.entries(childRule.grant?.limits ?? {})) {
      const parentValue = parentRule.grant?.limits?.[name];
      if (parentValue !== undefined && value > parentValue) {
        throw lattice(`grant.limits.${name}`, "numeric limits may only tighten");
      }
    }
    for (const name of ["watchdog_ms", "max_duration_ms"]) {
      if (childRule.grant?.[name] !== undefined && parentRule.grant?.[name] !== undefined && childRule.grant[name] > parentRule.grant[name]) {
        throw lattice(`grant.${name}`, "durations may only tighten");
      }
    }
    if (!isSubset(childRule.streams ?? [], parentRule.streams ?? [])) {
      throw lattice("streams", "sets may only narrow");
    }
    if (parentRule.approval?.required && !childRule.approval?.required) {
      throw lattice("approval.required", "approval may only escalate");
    }
    if (!isSuperset(childRule.abort_triggers ?? [], parentRule.abort_triggers ?? [])) {
      throw lattice("abort_triggers", "abort triggers may only be added");
    }
  }
  return true;
}

function presetWidens({ parent, child }) {
  if (maturityRank(child.min_capability_maturity) < maturityRank(parent.min_capability_maturity)) {
    return true;
  }
  for (const childRule of child.rules) {
    const parentRule = parent.rules.find((rule) => rule.verb === childRule.verb);
    if (!parentRule) {
      return true;
    }
    for (const [name, value] of Object.entries(childRule.grant?.limits ?? {})) {
      const parentValue = parentRule.grant?.limits?.[name];
      if (parentValue !== undefined && value > parentValue) {
        return true;
      }
    }
    for (const name of ["watchdog_ms", "max_duration_ms"]) {
      if (childRule.grant?.[name] !== undefined && parentRule.grant?.[name] !== undefined && childRule.grant[name] > parentRule.grant[name]) {
        return true;
      }
    }
    if (!isSubset(childRule.streams ?? [], parentRule.streams ?? [])) {
      return true;
    }
    if (parentRule.approval?.required && !childRule.approval?.required) {
      return true;
    }
    if (!isSuperset(childRule.abort_triggers ?? [], parentRule.abort_triggers ?? [])) {
      return true;
    }
  }
  return false;
}

function requiresSatisfied(rule, driverManifest) {
  const actionSpaces = new Set(driverManifest.action_spaces?.map((space) => space.name) ?? []);
  const streams = new Set(driverManifest.streams?.map((stream) => stream.name) ?? []);
  const actionSpace = rule.grant?.action_space ?? "base_velocity_3d";
  if (!actionSpaces.has(actionSpace)) {
    return false;
  }
  return (rule.streams ?? []).every((stream) => streams.has(stream));
}

function maturityRank(value) {
  return { experimental: 0, trusted: 1 }[value] ?? -1;
}

function isSubset(left, right) {
  return left.every((value) => right.includes(value));
}

function isSuperset(left, right) {
  const normalizedLeft = new Set(left.map((value) => JSON.stringify(value)));
  return right.every((value) => normalizedLeft.has(JSON.stringify(value)));
}

function lattice(field, message) {
  return new PolicyError("LATTICE_VIOLATION", message, { field });
}
