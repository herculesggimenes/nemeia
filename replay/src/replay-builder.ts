import { ReplayError } from "./replay-errors.ts";

export class ReplayBuilder {
  #eventLog;
  #getAuthorization;
  #getDigestBytes;
  #versionPins;

  constructor({ eventLog, getAuthorization = () => null, getDigestBytes = () => null, versionPins = {} }) {
    this.#eventLog = eventLog;
    this.#getAuthorization = getAuthorization;
    this.#getDigestBytes = getDigestBytes;
    this.#versionPins = { suite: "0.2.1", ...versionPins };
  }

  buildRunReplay(run_id) {
    const events = this.#eventLog.read({ run_id }, { limit: 100_000 }).items.sort((left, right) => left.seq - right.seq);
    if (events.length === 0) {
      throw new ReplayError("RUN_REPLAY_EMPTY", `No events found for run ${run_id}.`, { run_id });
    }
    const replayEvents = [...events, ...this.#attentionSeamsCovering(events)].sort((left, right) => left.seq - right.seq);
    const authorizationIds = authorizationIdsForEvents(events);
    const authorizations = authorizationIds.map((id) => {
      const authorization = this.#getAuthorization(id);
      if (!authorization) {
        throw new ReplayError("AUTHORIZATION_MISSING", `Authorization ${id} is missing from replay.`, { authorization_id: id });
      }
      return authorization;
    });
    return {
      run_id,
      events: replayEvents,
      authorization_ids: authorizationIds,
      authorizations,
      version_pins: this.#versionPinsFor({ events, authorizations }),
      attention_digests: this.#attentionDigestsFor(replayEvents),
      artifacts: artifactRefsForEvents(replayEvents)
    };
  }

  buildMissionReport(mission_id) {
    const events = this.#eventLog.read({ mission_id }, { limit: 100_000 }).items.sort((left, right) => left.seq - right.seq);
    const runs = new Set(events.map((event) => event.run_id).filter(Boolean));
    const anomalyCounts = countAnomalies(events);
    return {
      mission_id,
      counts: {
        events: events.length,
        runs: runs.size,
        authorizations_issued: events.filter((event) => event.event_type === "authorization.issued").length,
        completed_runs: events.filter((event) => event.event_type === "run.completed" || event.event_type === "authorization.completed").length,
        rejected_runs: events.filter((event) => event.event_type === "run.rejected").length,
        aborted_runs: events.filter((event) => event.event_type === "run.aborted" || event.event_type === "authorization.aborted").length,
        stops: events.filter((event) => event.event_type === "authorization.stopped" || event.event_type === "kernel.stop_state_set").length,
        warnings: events.filter((event) => event.severity === 1).length,
        critical: events.filter((event) => event.severity === 2).length,
        anomalies_opened: anomalyCounts.opened,
        anomalies_closed: anomalyCounts.closed,
        anomalies_open: anomalyCounts.open
      },
      run_ids: [...runs].sort(),
      first_seq: events[0]?.seq ?? null,
      last_seq: events.at(-1)?.seq ?? null
    };
  }

  #versionPinsFor({ events, authorizations }) {
    const pins = { ...this.#versionPins };
    for (const event of events) {
      if (event.source?.includes("@")) {
        const [sourceKind, sourceVersion] = event.source.split("@");
        pins[`source:${sourceKind}`] ??= sourceVersion;
      }
      if (event.payload?.preset) {
        pins.preset ??= event.payload.preset;
      }
    }
    for (const authorization of authorizations) {
      if (authorization.capability?.impl) {
        pins.capability ??= authorization.capability.impl;
      }
      pins[`authorization:${authorization.id}`] = authorization.signature;
    }
    return pins;
  }

  #attentionDigestsFor(events) {
    const seams = events.filter((event) => event.event_type === "attention.seam");
    return seams.map((event) => {
      const digestRef = event.payload.digest_ref;
      return {
        digest_ref: digestRef,
        seam_seq: event.seq,
        bytes: this.#getDigestBytes(digestRef)
      };
    });
  }

  #attentionSeamsCovering(events) {
    const missionId = events[0]?.mission_id;
    if (!missionId) {
      return [];
    }
    const runSeqs = new Set(events.map((event) => event.seq));
    return this.#eventLog
      .read({ mission_id: missionId, event_type: "attention.seam" }, { limit: 100_000 })
      .items.filter((event) => {
        const range = event.payload?.cursor_range;
        if (!range) {
          return false;
        }
        for (const seq of runSeqs) {
          if (seq >= range.start && seq <= range.end) {
            return true;
          }
        }
        return false;
      });
  }
}

function countAnomalies(events) {
  const opened = new Set();
  const closed = new Set();
  for (const event of events) {
    if (event.event_type === "anomaly.opened") {
      const id = event.payload?.anomaly?.id ?? event.payload?.anomaly_id;
      if (id) {
        opened.add(id);
      }
    }
    if (event.event_type === "anomaly.closed") {
      const id = event.payload?.anomaly_id;
      if (id) {
        closed.add(id);
      }
    }
  }
  return {
    opened: opened.size,
    closed: closed.size,
    open: [...opened].filter((id) => !closed.has(id)).length
  };
}

function authorizationIdsForEvents(events) {
  const ids = new Set();
  for (const event of events) {
    for (const ref of event.refs ?? []) {
      if (typeof ref === "string" && ref.startsWith("auth_")) {
        ids.add(ref);
      }
    }
    if (typeof event.payload?.authorization_id === "string") {
      ids.add(event.payload.authorization_id);
    }
  }
  return [...ids].sort();
}

function artifactRefsForEvents(events) {
  const refs = new Set();
  for (const event of events) {
    collectArtifactRefs(event.payload, refs);
    for (const ref of event.refs ?? []) {
      if (typeof ref === "string" && ref.startsWith("artifact:")) {
        refs.add(ref);
      }
    }
  }
  return [...refs].sort();
}

function collectArtifactRefs(value, refs) {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectArtifactRefs(item, refs);
    }
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (key.endsWith("_ref") && typeof child === "string" && child.startsWith("artifact:")) {
        refs.add(child);
      }
      if (key.endsWith("_refs") && Array.isArray(child)) {
        for (const ref of child) {
          if (typeof ref === "string" && ref.startsWith("artifact:")) {
            refs.add(ref);
          }
        }
      }
      collectArtifactRefs(child, refs);
    }
  }
}
