import { makeId } from "../../mission-server/src/ids.ts";
import { AnomalyError } from "./anomaly-errors.ts";

const SEVERITY_EVENT_LEVEL = { info: 0, warning: 1, safety: 2 };
const REQUIRED_OPEN_FIELDS = ["mission_id", "severity", "expected", "observed", "evidence_refs"];

export class AnomalyLog {
  #eventLog;

  constructor({ eventLog }) {
    if (!eventLog) {
      throw new AnomalyError("EVENT_LOG_REQUIRED", "AnomalyLog requires an EventLog.");
    }
    this.#eventLog = eventLog;
  }

  open(input) {
    validateOpen(input);
    const anomaly = {
      id: input.id ?? makeId("anm"),
      schema_version: 1,
      severity: input.severity,
      mission_id: input.mission_id,
      ...(input.run_id ? { run_id: input.run_id } : {}),
      ...(input.capability ? { capability: input.capability } : {}),
      ...(input.driver ? { driver: input.driver } : {}),
      expected: input.expected,
      observed: input.observed,
      evidence_refs: [...input.evidence_refs],
      ...(input.suspected_cause ? { suspected_cause: input.suspected_cause } : {}),
      ...(input.owner ? { owner: input.owner } : {}),
      ...(input.closure_criteria ? { closure_criteria: input.closure_criteria } : {}),
      status: "open"
    };
    const event = this.#append("anomaly.opened", anomaly, {
      severity: SEVERITY_EVENT_LEVEL[anomaly.severity],
      source: input.source ?? "mission-server",
      payload: { anomaly }
    });
    return { anomaly, event };
  }

  assign({ anomaly_id, owner, source = "operator:local" }) {
    if (!owner) {
      throw new AnomalyError("OWNER_REQUIRED", "Assigning an anomaly requires an owner.");
    }
    const current = this.get(anomaly_id);
    this.#assertOpen(current);
    const event = this.#append("anomaly.assigned", current, {
      severity: SEVERITY_EVENT_LEVEL[current.severity],
      source,
      payload: { anomaly_id, owner }
    });
    return { anomaly: this.get(anomaly_id), event };
  }

  update({ anomaly_id, patch, source = "operator:local" }) {
    const current = this.get(anomaly_id);
    this.#assertOpen(current);
    const allowed = {};
    for (const key of ["suspected_cause", "closure_criteria", "expected", "observed"]) {
      if (patch?.[key] !== undefined) {
        allowed[key] = patch[key];
      }
    }
    if (patch?.evidence_refs !== undefined) {
      if (!Array.isArray(patch.evidence_refs)) {
        throw new AnomalyError("INVALID_ANOMALY", "evidence_refs must be an array.");
      }
      allowed.evidence_refs = [...new Set([...current.evidence_refs, ...patch.evidence_refs])];
    }
    if (Object.keys(allowed).length === 0) {
      throw new AnomalyError("EMPTY_UPDATE", "Anomaly update contains no supported fields.");
    }
    const event = this.#append("anomaly.updated", current, {
      severity: SEVERITY_EVENT_LEVEL[current.severity],
      source,
      payload: { anomaly_id, patch: allowed }
    });
    return { anomaly: this.get(anomaly_id), event };
  }

  close({ anomaly_id, owner, evidence_refs = [], resolution, source = "operator:local" }) {
    const current = this.get(anomaly_id);
    this.#assertOpen(current);
    if (current.closure_criteria && !resolution) {
      throw new AnomalyError("CLOSURE_CRITERIA_UNMET", "Closing this anomaly requires a resolution.");
    }
    const event = this.#append("anomaly.closed", current, {
      severity: SEVERITY_EVENT_LEVEL[current.severity],
      source,
      payload: {
        anomaly_id,
        owner: owner ?? current.owner,
        evidence_refs,
        ...(resolution ? { resolution } : {})
      }
    });
    return { anomaly: this.get(anomaly_id), event };
  }

  get(anomaly_id) {
    const anomaly = this.list().find((candidate) => candidate.id === anomaly_id);
    if (!anomaly) {
      throw new AnomalyError("ANOMALY_NOT_FOUND", `Anomaly ${anomaly_id} was not found.`, { anomaly_id });
    }
    return anomaly;
  }

  list(filter = {}) {
    const byId = new Map();
    for (const event of this.#events()) {
      applyTransition(byId, event);
    }
    return [...byId.values()]
      .filter((anomaly) => matchesFilter(anomaly, filter))
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  openSafetyAnomalies(filter = {}) {
    return this.list({ ...filter, severity: "safety", status: "open" });
  }

  assertNoOpenSafetyAnomalies(filter = {}) {
    const open = this.openSafetyAnomalies(filter);
    if (open.length > 0) {
      throw new AnomalyError("SAFETY_ANOMALY_OPEN", "Open safety anomalies block this operation.", {
        anomaly_ids: open.map((anomaly) => anomaly.id),
        filter
      });
    }
    return true;
  }

  #append(event_type, anomaly, event) {
    return this.#eventLog.append({
      schema_version: 1,
      event_type,
      refs: [anomaly.id, ...artifactRefs(anomaly.evidence_refs)],
      mission_id: anomaly.mission_id,
      ...(anomaly.run_id ? { run_id: anomaly.run_id } : {}),
      payload: {},
      ...event
    });
  }

  #events() {
    return this.#eventLog
      .read({ event_types: ["anomaly.opened", "anomaly.assigned", "anomaly.updated", "anomaly.closed"] }, { limit: 100_000 })
      .items.sort((left, right) => left.seq - right.seq);
  }

  #assertOpen(anomaly) {
    if (anomaly.status !== "open") {
      throw new AnomalyError("ANOMALY_CLOSED", `Anomaly ${anomaly.id} is already closed.`, { anomaly_id: anomaly.id });
    }
  }
}

function validateOpen(input) {
  for (const field of REQUIRED_OPEN_FIELDS) {
    if (input?.[field] === undefined) {
      throw new AnomalyError("INVALID_ANOMALY", `Missing required anomaly field ${field}.`, { field });
    }
  }
  if (!["info", "warning", "safety"].includes(input.severity)) {
    throw new AnomalyError("INVALID_ANOMALY", "Anomaly severity must be info, warning, or safety.", { severity: input.severity });
  }
  if (!Array.isArray(input.evidence_refs)) {
    throw new AnomalyError("INVALID_ANOMALY", "evidence_refs must be an array.");
  }
}

function applyTransition(byId, event) {
  if (event.event_type === "anomaly.opened") {
    const anomaly = event.payload.anomaly;
    byId.set(anomaly.id, structuredClone(anomaly));
    return;
  }

  const anomalyId = event.payload?.anomaly_id;
  const current = byId.get(anomalyId);
  if (!current) {
    return;
  }
  if (event.event_type === "anomaly.assigned") {
    current.owner = event.payload.owner;
  }
  if (event.event_type === "anomaly.updated") {
    Object.assign(current, event.payload.patch);
  }
  if (event.event_type === "anomaly.closed") {
    current.status = "closed";
    if (event.payload.owner) {
      current.owner = event.payload.owner;
    }
    current.evidence_refs = [...new Set([...current.evidence_refs, ...(event.payload.evidence_refs ?? [])])];
  }
}

function matchesFilter(anomaly, filter) {
  for (const [key, value] of Object.entries(filter)) {
    if (value !== undefined && anomaly[key] !== value) {
      return false;
    }
  }
  return true;
}

function artifactRefs(refs) {
  return refs.filter((ref) => typeof ref === "string" && ref.startsWith("artifact:"));
}
