import { readFileSync } from "node:fs";

type ObservedSession = {
  readonly events: readonly { readonly type: string; readonly data?: unknown }[];
};

/** Public attachSession settlement must interrupt a barrier the model never reached. */
export function waitForFixtureMarker(
  path: string,
  expected: string,
  description: string,
  completedTurn?: Promise<ObservedSession>,
  timeoutMs = Number(process.env.NEMEIA_EVAL_TIMEOUT_MS ?? 60_000),
): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    void completedTurn?.then((session) => {
      const failures = session.events.filter((event) => event.type.endsWith(".failed")).slice(-4).map((event) => {
        const data = event.data !== null && typeof event.data === "object" ? event.data as Record<string, unknown> : {};
        return { type: event.type, code: data.code, message: typeof data.message === "string" ? data.message.slice(0, 1200) : undefined };
      });
      finish(new Error(`Eve turn settled before ${description}; failures=${JSON.stringify(failures)}`));
    }, (error: unknown) => finish(new Error(`Eve turn observation failed before ${description}: ${error instanceof Error ? error.message : String(error)}`)));
    const poll = () => {
      if (settled) return;
      try {
        if (readFileSync(path, "utf8").trim() === expected) { finish(); return; }
      } catch { /* The live model has not published the marker yet. */ }
      if (Date.now() >= deadline) { finish(new Error(`${description} did not appear before the eval timeout`)); return; }
      timer = setTimeout(poll, 10);
    };
    poll();
  });
}
