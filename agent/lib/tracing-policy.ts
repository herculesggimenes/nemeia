import type { JsonValue } from "./world-bridge/types.ts";

export interface TraceCorrelation {
  readonly wakeId?: string;
  readonly contextId?: string;
  readonly sessionId?: string;
  readonly turnId?: string;
  readonly stepIndex?: number;
  readonly decisionId?: string;
  /** Eve's model-attempt identifier; never the world action execution id. */
  readonly attemptId?: string;
  readonly executionId?: string;
}

export interface TraceRecord {
  readonly name: string;
  readonly correlation: TraceCorrelation;
  readonly attributes: Readonly<Record<string, JsonValue>>;
}

const SECRET_KEY = /(authorization|cookie|password|secret|token|api[-_]?key|signed|credential)/iu;
const URL_KEY = /(?:^|[-_])url$/iu;
const SECRET_VALUE = /(?:bearer\s+|(?:sk|ghp|xox)[-_][A-Za-z0-9]|-----BEGIN|eyJ[A-Za-z0-9_-]{16,})/u;
const MAX_STRING_BYTES = 512;
const MAX_DEPTH = 4;
const MAX_OBJECT_KEYS = 64;
const MAX_TOTAL_BYTES = 16 * 1024;

interface SanitizationBudget {
  remainingBytes: number;
  remainingKeys: number;
}

function consume(budget: SanitizationBudget, value: string): boolean {
  const bytes = Buffer.byteLength(value, "utf8");
  if (bytes > budget.remainingBytes) return false;
  budget.remainingBytes -= bytes;
  return true;
}

/** Bounded, key-aware redaction for records sent to OTel/Laminar exporters. */
export function sanitizeTraceValue(value: unknown, key = "", depth = 0): JsonValue {
  return sanitizeTraceValueWithBudget(value, key, depth, { remainingBytes: MAX_TOTAL_BYTES, remainingKeys: MAX_OBJECT_KEYS });
}

function sanitizeTraceValueWithBudget(
  value: unknown,
  key: string,
  depth: number,
  budget: SanitizationBudget,
): JsonValue {
  if (SECRET_KEY.test(key) || URL_KEY.test(key)) return "[redacted]";
  if (typeof value === "string") {
    // Inspect the complete original value before truncation: a secret or URL
    // may occur after the first bounded prefix.
    if (/(?:https?|wss?):\/\//iu.test(value) || SECRET_VALUE.test(value)) return "[redacted]";
    const bounded = Buffer.byteLength(value, "utf8") > MAX_STRING_BYTES ? `${value.slice(0, MAX_STRING_BYTES)}…` : value;
    return consume(budget, bounded) ? bounded : "[size-limited]";
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    const primitive = String(value);
    return consume(budget, primitive) ? value : "[size-limited]";
  }
  if (depth >= MAX_DEPTH) return "[depth-limited]";
  if (Array.isArray(value)) {
    return value.slice(0, 32).map((item) => sanitizeTraceValueWithBudget(item, key, depth + 1, budget));
  }
  if (typeof value === "object") {
    const output: Record<string, JsonValue> = {};
    for (const [childKey, childValue] of Object.entries(value).slice(0, MAX_OBJECT_KEYS)) {
      if (budget.remainingKeys <= 0) break;
      budget.remainingKeys -= 1;
      const boundedKey = childKey.slice(0, 128);
      if (!consume(budget, boundedKey)) break;
      output[boundedKey] = sanitizeTraceValueWithBudget(childValue, boundedKey, depth + 1, budget);
    }
    return output;
  }
  return "[unsupported]";
}

function trustedIdentifier(value: unknown, maxLength = 128): string | undefined {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) return undefined;
  return /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u.test(value) ? value : undefined;
}

function trustedCorrelation(correlation: TraceCorrelation): TraceCorrelation {
  const result: TraceCorrelation = {};
  for (const key of ["wakeId", "contextId", "sessionId", "turnId", "decisionId", "attemptId", "executionId"] as const) {
    const value = trustedIdentifier(correlation[key]);
    if (value !== undefined) (result as Record<string, string>)[key] = value;
  }
  if (Number.isSafeInteger(correlation.stepIndex) && (correlation.stepIndex ?? 0) >= 0) {
    (result as Record<string, number>).stepIndex = correlation.stepIndex as number;
  }
  return result;
}

export type TraceExporter = (record: TraceRecord) => void | Promise<void>;

/**
 * Fire-and-forget exporter queue. Exporter failure and queue overflow are
 * diagnostic loss only; no world commit, local stop, or authorization path
 * awaits this sink.
 */
export class NonBlockingTraceSink {
  private readonly pending: TraceRecord[] = [];
  private draining = false;
  private inFlight = 0;
  private droppedCount = 0;
  private readonly exporter: TraceExporter;
  private readonly maxPending: number;

  constructor(exporter: TraceExporter, maxPending = 128) {
    this.exporter = exporter;
    this.maxPending = maxPending;
  }

  get dropped(): number {
    return this.droppedCount;
  }

  emit(record: TraceRecord): void {
    const sanitized: TraceRecord = {
      name: trustedIdentifier(record.name) ?? "invalid-trace-name",
      correlation: trustedCorrelation(record.correlation),
      attributes: sanitizeTraceValue(record.attributes) as Readonly<Record<string, JsonValue>>,
    };
    if (this.pending.length + this.inFlight >= this.maxPending) {
      this.droppedCount += 1;
      return;
    }
    this.pending.push(sanitized);
    void this.drain();
  }

  async flush(): Promise<void> {
    await this.drain();
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.pending.length > 0) {
        const next = this.pending.shift();
        if (next === undefined) continue;
        this.inFlight += 1;
        try {
          await this.exporter(next);
        } catch {
          this.droppedCount += 1;
        } finally {
          this.inFlight -= 1;
        }
      }
    } finally {
      this.draining = false;
      if (this.pending.length > 0) void this.drain();
    }
  }
}
