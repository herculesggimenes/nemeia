import assert from "node:assert/strict";
import { defineEval, type EveEvalTurn } from "eve/evals";
import { automaticMissionIds, awaitMarker, loopbackWakeUrl, parseAutomaticRead, writeMarker } from "../agent/automatic-wake-protocol.ts";

type ObserveRequest = { sessionId: string; turnIds: string[] };

function wakeFor(turn: EveEvalTurn): { wakeId: string; dirtyKeys: string[] } {
  const received = turn.events.find((event) => event.type === "message.received");
  assert.ok(received?.type === "message.received");
  const wake = JSON.parse(received.data.message) as { wakeId: string; dirtyKeys: string[] };
  assert.equal(typeof wake.wakeId, "string");
  assert.ok(Array.isArray(wake.dirtyKeys));
  return wake;
}

function contexts(turn: EveEvalTurn): ReturnType<typeof parseAutomaticRead>[] {
  assert.equal(turn.status, "waiting");
  const text = turn.message;
  assert.ok(typeof text === "string" && text.startsWith("automatic-contexts="));
  const message = JSON.parse(text.slice("automatic-contexts=".length)) as { wakeId: string; results: unknown[] };
  assert.equal(message.wakeId, wakeFor(turn).wakeId);
  assert.ok(turn.toolCalls.length > 0);
  assert.ok(turn.toolCalls.every((call) => call.name === "bash" &&
    typeof (call.input as Record<string, unknown>)?.command === "string" &&
    String((call.input as Record<string, unknown>).command).startsWith("cat /world/manifest.json | jq -c ") &&
    !String((call.input as Record<string, unknown>).command).includes("world action")));
  assert.ok(turn.events.some((event) => event.type === "step.started" && event.data.modelId === "nemeia-fixtures/nemeia-eval-fixture"));
  return message.results.map(parseAutomaticRead);
}

export default defineEval({
  description: "Subsequent native DB updates wake public Eve through the owned operational bridge; no actions.",
  timeoutMs: 180_000,
  async test(t) {
    if (!process.env.NEMEIA_AUTO_WAKE_DIRECTORY) { t.skip("requires the separately coordinated automatic-wake adapter"); return; }
    const expectedIds = automaticMissionIds().sort();
    const triggerId = automaticMissionIds()[0];
    assert.equal(t.target.kind, "local");
    writeMarker("target-ready.json", { url: t.target.url, wakeUrl: loopbackWakeUrl(t.target.url), kind: t.target.kind });
    let cursor = 0;
    let sessionId: string | undefined;
    const observedTurns: Array<{ turnId: string; wakeId: string; dirtyKeys: string[]; cursor: number }> = [];
    async function observe(request: ObserveRequest): Promise<EveEvalTurn[]> {
      assert.ok(request.turnIds.length > 0 && request.turnIds.length <= 4);
      sessionId ??= request.sessionId;
      assert.equal(request.sessionId, sessionId);
      const turns: EveEvalTurn[] = [];
      for (const expectedTurn of request.turnIds) {
        const live = t.target.watchTurn(sessionId, { startIndex: cursor });
        const started = await live.waitForEvent("turn.started");
        assert.equal(started.data.turnId, expectedTurn);
        const turn = await live.result();
        assert.ok(turn.events.some((event) => event.type === "turn.completed"));
        const nextCursor = turn.session.state.streamIndex;
        assert.ok(typeof nextCursor === "number" && nextCursor > cursor);
        cursor = nextCursor;
        observedTurns.push({ turnId: expectedTurn, ...wakeFor(turn), cursor });
        turns.push(turn);
      }
      return turns;
    }
    try {
      const baseline = await observe(await awaitMarker<ObserveRequest>("observe-baseline.json"));
      assert.ok(baseline.every((turn) => turn.message === "automatic-wake initial subscription baseline" && turn.toolCalls.length === 0));
      writeMarker("baseline-observed.json", { cursor, sessionId, turnIds: observedTurns.map((turn) => turn.turnId) });
      const [measured] = await observe(await awaitMarker<ObserveRequest>("observe-measured.json"));
      assert.ok(measured);
      const [pinned, fresh, ...unexpected] = contexts(measured);
      assert.equal(unexpected.length, 0);
      assert.ok(pinned && fresh);
      assert.deepEqual(pinned.missionIds, [triggerId]);
      assert.deepEqual(fresh.missionIds, expectedIds);
      assert.notEqual(pinned.contextId, fresh.contextId);
      assert.notEqual(pinned.worldRevision, fresh.worldRevision);
      const measuredWake = wakeFor(measured);
      assert.ok(measuredWake.dirtyKeys.some((key) => key.includes(triggerId)));
      writeMarker("measured-observed.json", { cursor, sessionId, wakeId: measuredWake.wakeId, pinned, fresh });
      const idle = await observe(await awaitMarker<ObserveRequest>("observe-idle.json"));
      assert.ok(idle.length >= 1 && idle.length <= 2, "busy burst must produce bounded coalesced delivery, not a per-row queue");
      for (const turn of idle) {
        const reads = contexts(turn);
        assert.equal(reads.length, 1);
        assert.deepEqual(reads[0].missionIds, expectedIds);
      }
      assert.ok(idle.some((turn) => wakeFor(turn).dirtyKeys.some((key) => expectedIds.filter((id) => id !== triggerId).some((id) => key.includes(id)))));
      const checks = {
        publicTargetAndCursor: true, initialLoadExcluded: true, publicMockModelLifecycle: true,
        measuredNativeMissionInWake: true, sameStepPinned: true, nextStepFresh: true,
        usefulIntactWorldContext: true, idleNextDelivery: true, actionFreeBash: true,
      };
      writeMarker("eval-observed.json", { checks, observedTurns, pinned, fresh, idleTurns: idle.length, nodeVersion: process.version });
      const stopped = await awaitMarker("bridge-stopped.json");
      assert.equal(stopped.cleanExit, true);
      t.succeeded();
      t.calledTool("bash", { count: 2 + idle.length });
    } catch (error) {
      writeMarker("eval-error.json", { error: error instanceof Error ? error.message.slice(0, 2000) : "automatic wake eval failed" });
      throw error;
    }
  },
});
