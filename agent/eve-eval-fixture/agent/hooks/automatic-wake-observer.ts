import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { defineHook } from "eve/hooks";

export default defineHook({
  events: {
    "*"(event, ctx) {
      const directory = process.env.NEMEIA_AUTO_WAKE_DIRECTORY;
      if (!directory || !["turn.started", "turn.completed", "turn.failed", "session.waiting", "session.failed", "message.received"].includes(event.type)) return;
      const data = "data" in event ? event.data as Record<string, unknown> : {};
      let wakeId: string | undefined;
      if (event.type === "message.received" && typeof data.message === "string") {
        try { const wake = JSON.parse(data.message) as Record<string, unknown>; if (typeof wake.wakeId === "string") wakeId = wake.wakeId; } catch { /* Not a wake. */ }
      }
      // Observe-only evidence; never seed auth, dispatch turns, or release busy state.
      appendFileSync(join(directory, "lifecycle.jsonl"), `${JSON.stringify({
        type: event.type, eventId: event.meta.id, sessionId: ctx.session.id,
        turnId: typeof data.turnId === "string" ? data.turnId : undefined, wakeId,
      })}\n`, { mode: 0o600 });
    },
  },
});
