import { appendFileSync, closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export class EventLog {
  #events = [];
  #nextSeq = 1;
  #clock;

  constructor({ clock = () => new Date() } = {}) {
    this.#clock = clock;
  }

  append(event) {
    const persisted = prepareEvent(event, this.#nextSeq++, this.#clock);
    this.#events.push(persisted);
    return persisted;
  }

  read(filter = {}, { after = 0, limit = 100 } = {}) {
    const afterSeq = cursorSeq(after);
    const items = this.#events
      .filter((event) => event.seq > afterSeq)
      .filter((event) => matchesFilter(event, filter))
      .slice(0, limit);
    const next = items.length === limit ? encodeCursor(items.at(-1).seq) : null;
    return { items, next };
  }

  all() {
    return [...this.#events];
  }
}

export class FileEventLog {
  #path;
  #events = [];
  #nextSeq = 1;
  #clock;

  constructor({ path, clock = () => new Date() }) {
    if (!path) {
      throw new EventLogError("EVENT_LOG_PATH_REQUIRED", "FileEventLog requires a path.");
    }
    this.#path = path;
    this.#clock = clock;
    mkdirSync(dirname(path), { recursive: true });
    this.#load();
  }

  append(event) {
    const persisted = prepareEvent(event, this.#nextSeq++, this.#clock);
    appendDurably(this.#path, `${JSON.stringify(persisted)}\n`);
    this.#events.push(persisted);
    return persisted;
  }

  read(filter = {}, { after = 0, limit = 100 } = {}) {
    const afterSeq = cursorSeq(after);
    const items = this.#events
      .filter((event) => event.seq > afterSeq)
      .filter((event) => matchesFilter(event, filter))
      .slice(0, limit);
    const next = items.length === limit ? encodeCursor(items.at(-1).seq) : null;
    return { items, next };
  }

  all() {
    return [...this.#events];
  }

  backup({ path }) {
    if (!path) {
      throw new EventLogError("EVENT_LOG_BACKUP_PATH_REQUIRED", "FileEventLog backup requires a destination path.");
    }
    mkdirSync(dirname(path), { recursive: true });
    validateEventLogFile(this.#path);
    copyFileSync(this.#path, path);
    fsyncPath(path);
    return {
      path,
      event_count: this.#events.length,
      last_seq: this.#events.at(-1)?.seq ?? 0
    };
  }

  restore({ path }) {
    if (!path) {
      throw new EventLogError("EVENT_LOG_RESTORE_PATH_REQUIRED", "FileEventLog restore requires a source path.");
    }
    const restored = validateEventLogFile(path);
    const tempPath = `${this.#path}.restore.tmp`;
    writeFileSync(tempPath, restored.bytes, "utf8");
    fsyncPath(tempPath);
    renameSync(tempPath, this.#path);
    fsyncDirectory(dirname(this.#path));
    this.#events = restored.events;
    this.#nextSeq = restored.events.length === 0 ? 1 : Math.max(...restored.events.map((event) => event.seq)) + 1;
    return {
      path: this.#path,
      event_count: this.#events.length,
      last_seq: this.#events.at(-1)?.seq ?? 0
    };
  }

  #load() {
    if (!existsSync(this.#path)) {
      appendDurably(this.#path, "");
      return;
    }
    const { events: loaded } = validateEventLogFile(this.#path);
    this.#events = loaded;
    this.#nextSeq = loaded.length === 0 ? 1 : Math.max(...loaded.map((event) => event.seq)) + 1;
  }
}

export class EventLogError extends Error {
  constructor(error_code, message, details = {}) {
    super(message);
    this.name = "EventLogError";
    this.error_code = error_code;
    this.details = details;
  }
}

function matchesFilter(event, filter) {
  if (filter.event_type && event.event_type !== filter.event_type) {
    return false;
  }
  if (filter.event_types && !filter.event_types.includes(event.event_type)) {
    return false;
  }
  if (filter.theme && eventTheme(event) !== filter.theme) {
    return false;
  }
  if (filter.themes && !filter.themes.includes(eventTheme(event))) {
    return false;
  }
  if (filter.run_id && event.run_id !== filter.run_id) {
    return false;
  }
  if (filter.mission_id && event.mission_id !== filter.mission_id) {
    return false;
  }
  if (filter.robot_id && event.robot_id !== filter.robot_id) {
    return false;
  }
  if (filter.source && event.source !== filter.source) {
    return false;
  }
  if (filter.since && Date.parse(event.timestamp) < Date.parse(filter.since)) {
    return false;
  }
  if (filter.until && Date.parse(event.timestamp) > Date.parse(filter.until)) {
    return false;
  }
  return true;
}

function encodeCursor(seq) {
  return `evtcur:${Buffer.from(JSON.stringify({ v: 1, after: seq }), "utf8").toString("base64url")}`;
}

function cursorSeq(cursor) {
  if (cursor == null || cursor === "") {
    return 0;
  }
  if (typeof cursor === "number") {
    return Number.isFinite(cursor) ? cursor : 0;
  }
  const raw = String(cursor);
  if (/^\d+$/.test(raw)) {
    return Number(raw);
  }
  if (!raw.startsWith("evtcur:")) {
    return 0;
  }
  try {
    const decoded = JSON.parse(Buffer.from(raw.slice("evtcur:".length), "base64url").toString("utf8"));
    return Number.isInteger(decoded.after) && decoded.after >= 0 ? decoded.after : 0;
  } catch {
    return 0;
  }
}

function eventTheme(event) {
  if (event.payload?.theme) {
    return event.payload.theme;
  }
  if (event.event_type.startsWith("run.") || event.event_type.startsWith("authorization.")) {
    return "run.own";
  }
  if (event.event_type.startsWith("mission.")) {
    return "mission.lifecycle";
  }
  if (event.event_type === "scene.observation") {
    return event.payload?.theme ?? "entity.bound";
  }
  return event.event_type;
}

function prepareEvent(event, seq, clock) {
  return deepFreeze({
    schema_version: 1,
    refs: [],
    ...event,
    seq,
    timestamp: clock().toISOString()
  });
}

function appendDurably(path, bytes) {
  appendFileSync(path, bytes, "utf8");
  fsyncPath(path);
}

function fsyncPath(path) {
  const fd = openSync(path, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function fsyncDirectory(path) {
  const fd = openSync(path, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function validateEventLogFile(path) {
  if (!existsSync(path)) {
    throw new EventLogError("EVENT_LOG_RESTORE_MISSING", "Event log restore source does not exist.", { path });
  }
  const bytes = readFileSync(path, "utf8");
  const lines = bytes.split("\n").filter((line) => line.trim().length > 0);
  const events = [];
  let previousSeq = 0;
  for (const [index, line] of lines.entries()) {
    let event;
    try {
      event = JSON.parse(line);
    } catch (cause) {
      throw new EventLogError("EVENT_LOG_CORRUPT", `Event log line ${index + 1} is not valid JSON.`, { line: index + 1, cause });
    }
    validatePersistedEvent(event, index + 1);
    if (event.seq <= previousSeq) {
      throw new EventLogError("EVENT_LOG_CORRUPT", `Event log line ${index + 1} has a non-monotonic seq.`, { line: index + 1 });
    }
    previousSeq = event.seq;
    events.push(deepFreeze(event));
  }
  return { bytes, events };
}

function validatePersistedEvent(event, line) {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    throw new EventLogError("EVENT_LOG_CORRUPT", `Event log line ${line} is not an object.`, { line });
  }
  if (!Number.isInteger(event.seq) || event.seq < 1) {
    throw new EventLogError("EVENT_LOG_CORRUPT", `Event log line ${line} has an invalid seq.`, { line });
  }
  if (typeof event.timestamp !== "string" || Number.isNaN(Date.parse(event.timestamp))) {
    throw new EventLogError("EVENT_LOG_CORRUPT", `Event log line ${line} has an invalid timestamp.`, { line });
  }
  if (typeof event.event_type !== "string" || event.event_type.length === 0) {
    throw new EventLogError("EVENT_LOG_CORRUPT", `Event log line ${line} has an invalid event_type.`, { line });
  }
  if (typeof event.source !== "string" || event.source.length === 0) {
    throw new EventLogError("EVENT_LOG_CORRUPT", `Event log line ${line} has an invalid source.`, { line });
  }
}

function deepFreeze(value) {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}
