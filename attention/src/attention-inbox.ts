import { AnomalyLog } from "../../anomaly/src/anomaly-log.ts";
import { compilePredicate } from "./cel-predicate.ts";
import { AttentionError } from "./attention-errors.ts";
import { lintModelVisibleText } from "./rendering-lint.ts";

const VERBATIM_EVENT_TYPES = new Set([
  "run.completed",
  "run.rejected",
  "run.aborted",
  "authorization.aborted",
  "authorization.stopped",
  "operator.message"
]);

export class AttentionInbox {
  #eventLog;
  #contract;
  #wakePredicate;
  #cursor = 0;
  #digestStore = new Map();
  #clock;
  #nextDigestId = 1;
  #nextWakeTimerAt = null;
  #anomalyLog;
  #runtimeAnomalies = new Set();

  constructor({ eventLog, contract, clock = () => new Date(), anomalyLog = null } = {}) {
    this.#eventLog = eventLog;
    this.#contract = materializeContract(contract);
    this.#wakePredicate = compilePredicate(this.#contract.wake_predicate_cel);
    this.#clock = clock;
    this.#anomalyLog = anomalyLog ?? new AnomalyLog({ eventLog });
  }

  contract() {
    return structuredClone(this.#contract);
  }

  pending() {
    const events = this.#pendingEvents();
    return {
      pending_count: events.length,
      pending_age: events.length === 0 ? 0 : this.#clock().getTime() - new Date(events[0].timestamp).getTime(),
      themes: [...new Set(events.map((event) => eventTheme(event)))],
      max_severity: events.reduce((max, event) => Math.max(max, event.severity), 0),
      next_wake_timer_at: this.#nextWakeTimerAt?.toISOString() ?? null
    };
  }

  shouldWake({ turn_active = false, bound_entity = null } = {}) {
    const events = this.#pendingEvents();
    if (events.length === 0) {
      this.#nextWakeTimerAt = null;
      return false;
    }
    const inbox = this.pending();
    const now = this.#clock();
    let nextTimerAt = null;
    for (const event of events) {
      const env = {
        event: eventEnv(event),
        inbox,
        mission: {
          id: this.#contract.mission_id,
          principal: this.#contract.principal,
          turn_active,
          bound_entity
        }
      };
      const result = this.#evaluateWakePredicate(event, env, now);
      if (result.woke) {
        this.#nextWakeTimerAt = null;
        return true;
      }
      nextTimerAt = minDate(nextTimerAt, result.nextTimerAt);
    }
    this.#nextWakeTimerAt = nextTimerAt;
    return false;
  }

  nextTimerAt() {
    return this.#nextWakeTimerAt ? new Date(this.#nextWakeTimerAt) : null;
  }

  drain({ cause = "scheduled" } = {}) {
    const events = this.#pendingEvents();
    const cursorStart = this.#cursor + 1;
    const cursorEnd = events.at(-1)?.seq ?? this.#cursor;
    const digest = this.#renderDigest(events);
    const digestRef = `digest:${this.#contract.mission_id}:${this.#contract.principal}:${this.#nextDigestId++}`;
    this.#digestStore.set(digestRef, digest.bytes);
    this.#cursor = cursorEnd;

    const seam = {
      seam_at: this.#clock().toISOString(),
      cause,
      cursor_range: { start: cursorStart, end: cursorEnd },
      digest_version: this.#contract.digest_version,
      digest_ref: digestRef,
      coalesced_counts: digest.coalesced_counts
    };
    this.#eventLog.append({
      schema_version: 1,
      source: "mission-server",
      event_type: "attention.seam",
      severity: 0,
      mission_id: this.#contract.mission_id,
      refs: [],
      payload: seam
    });

    return {
      seam,
      digest_ref: digestRef,
      bytes: digest.bytes,
      events
    };
  }

  replayDigest(digestRef) {
    return this.#digestStore.get(digestRef) ?? null;
  }

  #evaluateWakePredicate(event, env, now) {
    try {
      if (this.#wakePredicate.evaluate(env)) {
        return { woke: true, nextTimerAt: null };
      }
      return { woke: false, nextTimerAt: this.#wakePredicate.nextTimerAt(env, now) };
    } catch (error) {
      this.#emitRuntimeAnomaly(event, error);
      return { woke: false, nextTimerAt: null };
    }
  }

  #emitRuntimeAnomaly(event, error) {
    const code = error instanceof AttentionError ? error.error_code : "CEL_RUNTIME_ERROR";
    const key = `${event.seq}:${code}`;
    if (this.#runtimeAnomalies.has(key)) {
      return;
    }
    this.#runtimeAnomalies.add(key);
    this.#anomalyLog.open({
      id: `anm_attention_predicate_${event.seq}_${code.toLowerCase()}`,
      mission_id: this.#contract.mission_id,
      severity: "warning",
      expected: "Attention wake predicate evaluates without runtime errors.",
      observed: `Attention wake predicate returned false after ${code}.`,
      evidence_refs: [`event:${event.seq}`],
      suspected_cause: error instanceof Error ? error.message : String(error),
      source: "attention"
    });
  }

  #pendingEvents() {
    return this.#eventLog
      .read({ mission_id: this.#contract.mission_id }, { after: this.#cursor, limit: 10_000 })
      .items.filter((event) => event.event_type !== "attention.seam")
      .filter((event) => this.#matchesStateFilter(event));
  }

  #matchesStateFilter(event) {
    const theme = eventTheme(event);
    return this.#contract.state_filter.includes(theme) || this.#contract.state_filter.includes(event.event_type);
  }

  #renderDigest(events) {
    const verbatim = events.filter(isVerbatimEvent);
    const rest = events.filter((event) => !isVerbatimEvent(event));
    const lines = [];
    const coalesced_counts = {};

    for (const event of verbatim) {
      lines.push(renderEvent(event));
    }

    if (events.length > this.#contract.budget.max_pending) {
      const byTheme = Map.groupBy(rest, eventTheme);
      for (const [theme, themedEvents] of byTheme) {
        const latest = themedEvents.at(-1);
        coalesced_counts[theme] = themedEvents.length;
        lines.push(
          `[coalesced theme=${theme} count=${themedEvents.length} first_seq=${themedEvents[0].seq} last_seq=${latest.seq}] ${safeSummary(latest)}`
        );
      }
    } else {
      for (const event of rest) {
        lines.push(renderEvent(event));
      }
    }

    const bytes = [
      `digest_version=${this.#contract.digest_version}`,
      `cursor_events=${events.length}`,
      `coalesced_counts=${JSON.stringify(coalesced_counts)}`,
      ...lines
    ].join("\n");
    lintModelVisibleText(bytes, { field: "digest", maxLength: 10_000 });
    return { bytes, coalesced_counts };
  }
}

function materializeContract(contract) {
  return {
    ...contract,
    state_filter: [...new Set(["run.own", "mission.lifecycle", ...(contract.state_filter ?? [])])],
    budget: {
      max_pending: contract.budget?.max_pending ?? 50
    },
    digest_version: contract.digest_version ?? 1,
    predicate_env_version: contract.predicate_env_version ?? 1
  };
}

function eventTheme(event) {
  if (event.payload?.theme) {
    return event.payload.theme;
  }
  if (event.event_type.startsWith("run.")) {
    return "run.own";
  }
  if (event.event_type.startsWith("mission.")) {
    return "mission.lifecycle";
  }
  if (event.event_type === "scene.observation") {
    return event.payload?.theme ?? "entity.bound";
  }
  if (event.event_type.startsWith("authorization.")) {
    return "run.own";
  }
  return event.event_type;
}

function eventEnv(event) {
  return {
    theme: eventTheme(event),
    type: event.event_type,
    severity: event.severity,
    robot_id: event.robot_id ?? null,
    entity_id: event.payload?.entity_id ?? event.entity_id ?? null,
    source: event.source,
    at: event.timestamp,
    attrs: event.payload ?? {}
  };
}

function isVerbatimEvent(event) {
  return VERBATIM_EVENT_TYPES.has(event.event_type) || eventTheme(event) === "protected_class.advisory";
}

function renderEvent(event) {
  const rendered = `[seq=${event.seq} theme=${eventTheme(event)} type=${event.event_type} severity=${event.severity}] ${safeSummary(event)}`;
  lintModelVisibleText(rendered, { field: `event:${event.seq}`, maxLength: 2000 });
  return rendered;
}

function safeSummary(event) {
  const payload = event.payload ?? {};
  const summary = payload.summary ?? payload.message ?? payload.reason ?? payload.verb ?? JSON.stringify(payload);
  return String(summary).slice(0, 1000);
}

function minDate(left, right) {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  return left.getTime() <= right.getTime() ? left : right;
}
