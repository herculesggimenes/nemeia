import { defineHook } from "eve/hooks";
import { getRuntimeLedger } from "../lib/world-bridge/runtime-ledger.ts";
import {
  bindNemeiaSandboxSession,
  clearNemeiaSandboxSession,
  clearNemeiaSessionBindings,
  clearNemeiaWorldContext,
  initializeNemeiaWorldRuntime,
  nemeiaSandbox,
  prepareNemeiaWorldContext,
  setNemeiaStepContext,
} from "../sandbox.ts";
import { principalFromSandboxAuth } from "../lib/world-bridge/sandbox-backend.ts";
import { observeReceivedWorldWake } from "../channels/nemeia-world.ts";

async function record(
  event: {
    readonly meta: { readonly id: string };
    readonly data: { readonly stepIndex: number; readonly turnId: string };
    readonly type: "step.started" | "step.completed" | "step.failed";
  },
  sessionId: string,
): Promise<void> {
  try {
    getRuntimeLedger().recordStepHook({
      eventId: event.meta.id,
      sessionId,
      turnId: event.data.turnId,
      stepIndex: event.data.stepIndex,
      eventType: event.type,
    });
  } catch {
    // Diagnostics/ledger observation must not fail a reasoning turn or safety path.
  }
}

export default defineHook({
  events: {
    "message.received"(event, ctx) {
      // Eve 0.63 exposes message.received on public hooks, not ChannelEvents.
      // Custom channels report kind "http", not their filename. Correlate
      // only the exact reserved payload and configured current principal;
      // delivery receipt never acknowledges the underlying domain work.
      observeReceivedWorldWake(event.data, ctx.session.id, ctx.session.auth.current);
    },
    async "step.started"(event, ctx) {
      // Revalidate on every step, including a reopened sandbox. This is a
      // runtime authorization path, so an absent principal is not swallowed as
      // a diagnostics failure.
      const principal = principalFromSandboxAuth(ctx.session.auth);
      clearNemeiaSessionBindings(ctx.session.id);
      // Reopened sessions may skip onSession; authorize and initialize before
      // constructing the backend handle whose closures use the read host.
      if (principal !== null) await initializeNemeiaWorldRuntime(principal);
      const sandbox = await ctx.getSandbox();
      if (principal === null) {
        nemeiaSandbox.clearBinding(sandbox.id);
        clearNemeiaSandboxSession(sandbox.id);
        clearNemeiaWorldContext(ctx.session.id);
        throw new Error("Nemeia sandbox principal is unavailable for this step");
      }
      try {
        nemeiaSandbox.registerBinding(sandbox.id, principal);
        bindNemeiaSandboxSession(sandbox.id, ctx.session.id);
        setNemeiaStepContext(sandbox.id, {
          sessionId: ctx.session.id,
          turnId: event.data.turnId,
          stepIndex: event.data.stepIndex,
        });
      } catch (error) {
        nemeiaSandbox.clearBinding(sandbox.id);
        clearNemeiaSandboxSession(sandbox.id);
        clearNemeiaWorldContext(ctx.session.id);
        throw error;
      }
      try {
        await prepareNemeiaWorldContext(ctx.session.id, event.data.turnId, event.data.stepIndex, principal);
      } catch (error) {
        nemeiaSandbox.clearBinding(sandbox.id);
        clearNemeiaSandboxSession(sandbox.id);
        clearNemeiaWorldContext(ctx.session.id);
        throw error;
      }
      await record(event, ctx.session.id);
    },
    async "turn.started"(event, ctx) {
      // The accepted reservation closes the channel-to-turn gap; this public
      // Eve lifecycle event extends busy state across every model step.
      const ledger = getRuntimeLedger();
      ledger.markTurnStarted(ctx.session.id, event.data.turnId);
      ledger.acknowledgeWakeForSession(ctx.session.id);
    },
    async "turn.completed"(event, ctx) {
      const ledger = getRuntimeLedger();
      ledger.completeWakeForSession(ctx.session.id);
      ledger.markTurnIdle(ctx.session.id, event.data.turnId);
    },
    async "turn.failed"(event, ctx) {
      const ledger = getRuntimeLedger();
      ledger.completeWakeForSession(ctx.session.id);
      ledger.markTurnIdle(ctx.session.id, event.data.turnId);
    },
    async "turn.cancelled"(event, ctx) {
      const ledger = getRuntimeLedger();
      ledger.completeWakeForSession(ctx.session.id);
      ledger.markTurnIdle(ctx.session.id, event.data.turnId);
    },
    async "session.waiting"(_event, ctx) {
      getRuntimeLedger().clearSessionActivity(ctx.session.id);
    },
    async "session.completed"(_event, ctx) {
      getRuntimeLedger().clearSessionActivity(ctx.session.id);
    },
    async "session.failed"(_event, ctx) {
      getRuntimeLedger().clearSessionActivity(ctx.session.id);
    },
    async "step.completed"(event, ctx) {
      await record(event, ctx.session.id);
    },
    async "step.failed"(event, ctx) {
      await record(event, ctx.session.id);
    },
  },
});
