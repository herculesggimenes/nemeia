import { createHmac } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";
import { waitForFixtureMarker } from "./marker-wait.ts";

function base64url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

function signedJwt(principalId: string): string {
  const secret = process.env.NEMEIA_WORLD_AUTH_SECRET;
  const issuer = process.env.NEMEIA_WORLD_AUTH_ISSUER;
  const audience = process.env.NEMEIA_WORLD_AUTH_AUDIENCE;
  if (secret === undefined || issuer === undefined || audience === undefined) {
    throw new Error("fixture channel auth is not configured");
  }
  const subject = principalId.startsWith(`${issuer}:`) ? principalId.slice(issuer.length + 1) : principalId;
  if (subject.length === 0 || subject.includes(":")) throw new Error("fixture JWT owner subject is invalid");
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({
    iss: issuer,
    aud: audience,
    sub: subject,
    iat: now,
    exp: now + 300,
  }));
  const unsigned = `${header}.${payload}`;
  const signature = createHmac("sha256", secret).update(unsigned).digest("base64url");
  return `${unsigned}.${signature}`;
}

function outputsFromTurn(turn: { readonly message: string | undefined }): Array<{ readonly output?: unknown; readonly stdout?: unknown; readonly stderr?: unknown; readonly exitCode?: unknown }> {
  if (turn.message === undefined) throw new Error("fixture turn did not return a message");
  const message = turn.message.replace(/^contexts=/u, "");
  const parsed: unknown = JSON.parse(message);
  if (!Array.isArray(parsed)) throw new Error("fixture turn did not return serialized tool results");
  return parsed.filter((value): value is { readonly output?: unknown; readonly stdout?: unknown; readonly stderr?: unknown; readonly exitCode?: unknown } =>
    value !== null && typeof value === "object",
  );
}

function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  return JSON.stringify(value);
}

function successfulToolResult(result: { readonly stderr?: unknown; readonly exitCode?: unknown }): boolean {
  return (result.exitCode === undefined || result.exitCode === 0) && (result.stderr === undefined || result.stderr === "");
}

function parseToolReceipt(call: Record<string, unknown>): unknown {
  let value: unknown = call.output ?? call.result ?? call.stdout;
  if (typeof value === "string") {
    try { value = JSON.parse(value) as unknown; } catch { return value; }
  }
  if (value !== null && typeof value === "object") {
    const output = value as Record<string, unknown>;
    if (typeof output.stdout === "string") {
      try { return JSON.parse(output.stdout) as unknown; } catch { return output; }
    }
  }
  return value;
}

function jsonFragments(text: string): Array<Record<string, unknown>> {
  const fragments: Array<Record<string, unknown>> = [];
  for (const line of text.split(/\r?\n/u)) {
    const candidate = line.trim();
    if (!candidate.startsWith("{") && !candidate.startsWith("[")) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate) as unknown;
    } catch { continue; }
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (item !== null && typeof item === "object" && !Array.isArray(item)) fragments.push(item as Record<string, unknown>);
      }
    } else if (parsed !== null && typeof parsed === "object") {
      fragments.push(parsed as Record<string, unknown>);
    }
  }
  return fragments;
}

function writeEvidence(value: unknown): void {
  const path = process.env.NEMEIA_EVAL_RESULT_FILE;
  if (path !== undefined) writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export default defineEval({
  description: "Actual Eve lifecycle with authenticated production WorldClient and delayed real reducer change.",
  async test(t) {
    const thinkingFile = process.env.NEMEIA_EVAL_THINKING_FILE;
    const releaseFile = process.env.NEMEIA_EVAL_RELEASE_FILE;
    const changedFile = process.env.NEMEIA_G2_WORLD_CHANGED_FILE;
    const modelCallFile = process.env.NEMEIA_EVAL_MODEL_CALL_FILE;
    const actionCallFile = process.env.NEMEIA_EVAL_ACTION_CALL_FILE;
    const ownerPrincipal = process.env.NEMEIA_AGENT_OWNER_PRINCIPAL_ID;
    const expectedMissionId = process.env.NEMEIA_G2_EXPECTED_MISSION_ID;
    if (thinkingFile === undefined || releaseFile === undefined || changedFile === undefined || modelCallFile === undefined || actionCallFile === undefined || ownerPrincipal === undefined) {
      throw new Error("actual Eve eval files and owner principal are not configured");
    }
    writeFileSync(thinkingFile, "\n");
    writeFileSync(releaseFile, "\n");
    writeFileSync(changedFile, "\n");
    writeFileSync(modelCallFile, "");
    writeFileSync(actionCallFile, "");

    if (process.env.NEMEIA_EVAL_DEFAULT_API_ONLY === "1") {
      // Public default HTTP API authenticates its installed localDev principal;
      // this is intentionally not the JWT-mapped world owner on /wake.
      const turn = await t.send("Read the world using bash nemeia world summary.");
      const events = turn.session.events;
      const failures = events.filter((event) => event.type.endsWith(".failed"));
      const failureText = JSON.stringify(failures);
      const calls = (turn as unknown as { toolCalls?: readonly Record<string, unknown>[] }).toolCalls ?? [];
      const deniedByOwnerGuard = failureText.includes("Nemeia sandbox principal is not the configured agent owner");
      const evidence = {
        defaultApiOtherPrincipalDenied: deniedByOwnerGuard && !calls.some((call) => {
          const result = parseToolReceipt(call);
          return result !== null && typeof result === "object" && (result as Record<string, unknown>).worldId === process.env.NEMEIA_WORLD_ID;
        }),
        principalSource: "installed Eve default-channel localDev authenticator",
        expectedOtherPrincipalId: "local-dev",
        configuredOwnerPrincipalId: ownerPrincipal,
        eventTypes: events.map((event) => event.type),
        failureMessages: failures.map((event) => JSON.stringify("data" in event ? event.data : {}).slice(0, 1200)),
        deniedBeforeModelWorldAccess: deniedByOwnerGuard && calls.length === 0,
      };
      writeEvidence(evidence);
      assert.notEqual(ownerPrincipal, "local-dev");
      assert.equal(evidence.defaultApiOtherPrincipalDenied, true);
      return;
    }

    if (process.env.NEMEIA_EVAL_ACTION_ONLY === "1") {
      const ownerToken = process.env.NEMEIA_EVE_OWNER_TOKEN ?? signedJwt(ownerPrincipal);
      const wakeResponse = await t.target.fetch("/wake", {
        method: "POST",
        headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
        body: JSON.stringify({
          wakeId: `fixture-action-${Date.now()}`,
          worldId: process.env.NEMEIA_WORLD_ID ?? "",
          agentId: process.env.NEMEIA_AGENT_ID ?? "",
          sourceIds: ["qualification-action"],
          dirtyKeys: ["world.action"],
          mustHandleIds: [],
          rescanRequired: false,
        }),
      });
      const wakeBody = await wakeResponse.text();
      assert.equal(wakeResponse.status, 202, wakeBody);
      const wake = JSON.parse(wakeBody) as { readonly sessionId?: string };
      assert.equal(typeof wake.sessionId, "string");
      const turn = await t.target.watchTurn(wake.sessionId!).result();
      const session = turn.session;
      assert.ok(turn);
      const toolCalls = (turn as unknown as { readonly toolCalls?: readonly Record<string, unknown>[] }).toolCalls ?? [];
      const actionCalls = toolCalls.filter((call) => call.name === "bash");
      const actionCall = actionCalls[0];
      const retryCall = actionCalls[1];
      const actionResultEvents = session.events
        .filter((event) => event.type === "action.result")
        .map((event) => event as { readonly data?: Record<string, unknown> });
      const actionOutputs = actionResultEvents.flatMap((event) => {
        const result = event.data?.result;
        return result !== null && typeof result === "object" ? [{ output: (result as Record<string, unknown>).output }] : [];
      });
      const receipt = actionOutputs[0] === undefined
        ? actionCall === undefined ? undefined : parseToolReceipt(actionCall)
        : parseToolReceipt(actionOutputs[0]);
      const retryReceipt = actionOutputs[1] === undefined
        ? retryCall === undefined ? undefined : parseToolReceipt(retryCall)
        : parseToolReceipt(actionOutputs[1]);
      const stepEvent = session.events.find((event) => event.type === "step.started") as { readonly data?: Record<string, unknown> } | undefined;
      const stepData = stepEvent?.data ?? {};
      const eventTypes: string[] = session.events.map((event) => event.type);
      const actionCommandPath = actionCalls.length === 2 && actionCalls.every((call) => {
        const input = call.input;
        const command = input !== null && typeof input === "object" ? (input as Record<string, unknown>).command : undefined;
        return typeof command === "string" && command.startsWith("nemeia world action propose ");
      });
      const evidence = {
        actualEveLifecycle: ["session.started", "turn.started", "step.started"].every((type) => eventTypes.includes(type)),
        eventTypes,
        bashTool: actionCalls.length === 2,
        actionCommandPath: actionCommandPath && readFileSync(actionCallFile, "utf8").trim() === "nemeia world action propose",
        receipt,
        retryReceipt,
        step: {
          sessionId: session.sessionId,
          ...(typeof stepData.turnId === "string" ? { turnId: stepData.turnId } : {}),
          ...(typeof stepData.stepIndex === "number" ? { stepIndex: stepData.stepIndex } : {}),
        },
      };
      writeEvidence(evidence);
      t.succeeded();
      t.calledTool("bash", { count: 2 });
      assert.equal(evidence.actualEveLifecycle, true);
      assert.equal(evidence.bashTool, true);
      assert.equal(evidence.actionCommandPath, true);
      if (receipt === undefined) throw new Error("actual Eve bash action result was not observable");
      if (retryReceipt === undefined) throw new Error("actual Eve retry bash action result was not observable");
      return;
    }

    if (process.env.NEMEIA_EVAL_PERMISSION_ONLY === "1") {
      const firstResultMarker = process.env.NEMEIA_EVAL_PERMISSION_FIRST_RESULT_FILE;
      if (firstResultMarker === undefined) throw new Error("permission probe first-result marker is not configured");
      const ownerToken = process.env.NEMEIA_EVE_OWNER_TOKEN ?? signedJwt(ownerPrincipal);
      const wakeResponse = await t.target.fetch("/wake", {
        method: "POST",
        headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
        body: JSON.stringify({
          wakeId: `fixture-permission-${Date.now()}`,
          worldId: process.env.NEMEIA_WORLD_ID ?? "",
          agentId: process.env.NEMEIA_AGENT_ID ?? "",
          sourceIds: ["qualification-permission"],
          dirtyKeys: ["world.permission"],
          mustHandleIds: [],
          rescanRequired: false,
        }),
      });
      const wakeBody = await wakeResponse.text();
      assert.equal(wakeResponse.status, 202, wakeBody);
      const wake = JSON.parse(wakeBody) as { readonly sessionId?: string };
      assert.equal(typeof wake.sessionId, "string");
      const turn = await t.target.watchTurn(wake.sessionId!).result();
      const session = turn.session;
      assert.ok(turn);
      const results = outputsFromTurn(turn);
      const first = results[0];
      const second = results[1];
      const marker = JSON.parse(readFileSync(firstResultMarker, "utf8")) as { readonly success?: unknown };
      const firstReadSucceeded = marker.success === true && first !== undefined && successfulToolResult(first);
      const revokedReadDenied = second !== undefined && !successfulToolResult(second) &&
        textOf(second.stderr).toLowerCase().includes("world");
      const eventTypes: string[] = session.events.map((event) => event.type);
      const toolCalls = (turn as unknown as { readonly toolCalls?: readonly Record<string, unknown>[] }).toolCalls ?? [];
      const detailCommandObserved = toolCalls.some((call) => {
        if (call.name !== "bash" || call.input === null || typeof call.input !== "object") return false;
        const command = (call.input as Record<string, unknown>).command;
        return typeof command === "string" && command.startsWith("nemeia world detail observation-detail ");
      });
      const evidence = {
        permissionProbe: true,
        actualEveLifecycle: ["session.started", "turn.started", "step.started"].every((type) => eventTypes.includes(type)),
        eventTypes,
        firstReadSucceeded,
        revokedReadDenied,
        detailCommandObserved,
        resultCount: results.length,
      };
      writeEvidence(evidence);
      t.succeeded();
      assert.equal(evidence.actualEveLifecycle, true);
      assert.equal(firstReadSucceeded, true);
      assert.equal(detailCommandObserved, true);
      assert.equal(revokedReadDenied, true);
      return;
    }

    const alternateToken = signedJwt(`${ownerPrincipal}-not-authorized`);
    const deniedResponse = await t.target.fetch("/wake", {
      method: "POST",
      headers: { authorization: `Bearer ${alternateToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        wakeId: `fixture-denied-${Date.now()}`,
        worldId: process.env.NEMEIA_WORLD_ID ?? "",
        agentId: process.env.NEMEIA_AGENT_ID ?? "",
        sourceIds: [],
        dirtyKeys: [],
        mustHandleIds: [],
        rescanRequired: false,
      }),
    });
    assert.equal(deniedResponse.status, 403, await deniedResponse.text());

    const ownerToken = process.env.NEMEIA_EVE_OWNER_TOKEN ?? signedJwt(ownerPrincipal);
    const wakeResponse = await t.target.fetch("/wake", {
      method: "POST",
      headers: { authorization: `Bearer ${ownerToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        wakeId: `fixture-wake-${Date.now()}`,
        worldId: process.env.NEMEIA_WORLD_ID ?? "",
        agentId: process.env.NEMEIA_AGENT_ID ?? "",
        sourceIds: ["qualification-source"],
        dirtyKeys: ["world.qualification"],
        mustHandleIds: [],
        rescanRequired: false,
      }),
    });
    const wakeBody = await wakeResponse.text();
    assert.equal(wakeResponse.status, 202, wakeBody);
    const wake = JSON.parse(wakeBody) as { readonly sessionId?: string };
    assert.equal(typeof wake.sessionId, "string");

    const turnPromise = t.target.watchTurn(wake.sessionId!).result();
    await waitForFixtureMarker(thinkingFile, "thinking", "delayed public mockModel callback", turnPromise);
    await waitForFixtureMarker(changedFile, "changed", "actual subscribed WorldClient change", turnPromise);
    writeFileSync(releaseFile, "release\n");

    const turn = await turnPromise;
    const session = turn.session;
    assert.ok(turn);
    const results = outputsFromTurn(turn);
    const sandboxText = results.map((result) => textOf(result.output ?? result.stdout ?? result.stderr)).join("\n");
    const fragments = jsonFragments(sandboxText);
    const manifests = fragments.filter((fragment) => fragment.schema === "nemeia.world-context@1");
    const contextIds = manifests.flatMap((manifest) => typeof manifest.contextId === "string" ? [manifest.contextId] : []);
    const revisions = manifests.flatMap((manifest) => typeof manifest.worldRevision === "string" ? [manifest.worldRevision] : []);
    const modelCalls = readFileSync(modelCallFile, "utf8").trim().split(/\r?\n/u).filter(Boolean);
    const eventTypes: string[] = session.events.map((event) => event.type);
    const turnToolCalls = (turn as unknown as { readonly toolCalls?: readonly Record<string, unknown>[] }).toolCalls ?? [];
    const actionWasRequested = readFileSync(actionCallFile, "utf8").trim() === "nemeia world action propose" && turnToolCalls.some((call) => {
      if (call.name !== "bash" || call.input === null || typeof call.input !== "object") return false;
      const command = (call.input as Record<string, unknown>).command;
      return typeof command === "string" && command.startsWith("nemeia world action propose ");
    });
    const actionResult = results[2];
    const actionReceipt = actionResult === undefined ? undefined : parseToolReceipt(actionResult);
    const actionAccepted = actionResult !== undefined && successfulToolResult(actionResult) &&
      actionReceipt !== null && typeof actionReceipt === "object" &&
      typeof (actionReceipt as Record<string, unknown>).executionId === "string";
    const firstStepText = results.slice(0, 2).map((result) => textOf(result.output ?? result.stdout ?? result.stderr)).join("\n");
    const boundedFirstStepOutput = !firstStepText.includes("[truncated]");
    const pinnedResult = results[3];
    const pinnedText = textOf(pinnedResult?.output ?? pinnedResult?.stdout ?? pinnedResult?.stderr);
    const pinnedFragments = jsonFragments(pinnedText);
    const pinnedManifests = pinnedFragments.filter((fragment) => fragment.schema === "nemeia.world-context@1");
    const pinnedMission = pinnedFragments.find((fragment) => Array.isArray(fragment.missionMatches));
    const missionAbsentFromPinnedContext = Array.isArray(pinnedMission?.missionMatches) && pinnedMission.missionMatches.length === 0;
    const freshStepText = results.slice(4).map((result) => textOf(result.output ?? result.stdout ?? result.stderr)).join("\n");
    const boundedFreshOutput = !freshStepText.includes("[truncated]");
    const freshFragments = jsonFragments(freshStepText);
    const freshMission = freshFragments.find((fragment) => expectedMissionId !== undefined && fragment.missionId === expectedMissionId);
    const freshSummary = freshFragments.find((fragment) =>
      fragment.worldId === (process.env.NEMEIA_WORLD_ID ?? "") &&
      fragment.agentId === (process.env.NEMEIA_AGENT_ID ?? "") &&
      Array.isArray(fragment.localMaps) && Array.isArray(fragment.objects),
    );
    const localMaps = freshSummary?.localMaps;
    const objects = freshSummary?.objects;
    const hasUsefulMap = Array.isArray(localMaps) && localMaps.some((map) => map !== null && typeof map === "object" &&
      (map as Record<string, unknown>).id === process.env.NEMEIA_G2_EXPECTED_MAP_ID &&
      (map as Record<string, unknown>).unitId === process.env.NEMEIA_G2_EXPECTED_UNIT_ID &&
      (map as Record<string, unknown>).headRevision !== null && (map as Record<string, unknown>).headRevision !== undefined);
    const hasUsefulObject = Array.isArray(objects) && objects.some((object) => {
      if (object === null || typeof object !== "object") return false;
      const value = object as Record<string, unknown>;
      return value.id === process.env.NEMEIA_G2_EXPECTED_ENTITY_ID && value.id !== process.env.NEMEIA_G2_EXPECTED_UNIT_ID &&
        String(value.kind).toLowerCase() !== "unit" && Array.isArray(value.semantic) && value.semantic.length > 0 &&
        Array.isArray(value.supportObservationIds) && value.supportObservationIds.includes(process.env.NEMEIA_G2_EXPECTED_OBSERVATION_ID);
    });
    const unauthorizedWakeDenied = deniedResponse.status === 403;
    const evidence = {
      actualEveLifecycle: ["session.started", "turn.started", "step.started"].every((type) => eventTypes.includes(type)),
      eventTypes,
      injectedModel: modelCalls.length >= 4,
      modelCallCount: modelCalls.length,
      worldChangedDuringThinking: readFileSync(changedFile, "utf8").trim() === "changed",
      authenticatedJustBashRead: results.length >= 5 && [results[0], results[1], results[3], results[4]].every((result) => result !== undefined && successfulToolResult(result)) && !sandboxText.includes("active Eve principal binding is unavailable"),
      usefulWorldContext: freshMission?.description === "Eve G2 delayed WorldClient subscription qualification" && hasUsefulMap && hasUsefulObject,
      sameStepPinned: pinnedManifests.length === 2 && typeof pinnedManifests[0]?.contextId === "string" &&
        pinnedManifests[0].contextId === pinnedManifests[1]?.contextId && !pinnedText.includes("[truncated]") && missionAbsentFromPinnedContext,
      nextStepFresh: contextIds.length >= 3 && contextIds.some((id) => id !== contextIds[0]) && revisions.length >= 2 && revisions.some((revision) => revision !== revisions[0]),
      // This is deliberately not promoted to the required revocation gate:
      // the alternate principal was rejected at /wake, but no authenticated
      // Eve session was revoked after grant and then denied a mounted read.
      revokedAccessDenied: false,
      unauthorizedWakeDenied,
      missionPresentInFreshContext: freshMission !== undefined,
      missionAbsentFromPinnedContext,
      usefulMapHead: hasUsefulMap,
      usefulObservedObject: hasUsefulObject,
      parsedFragmentDiagnostics: freshFragments.slice(0, 24).map((fragment) => ({
        keys: Object.keys(fragment).slice(0, 24),
        hasMissionId: typeof fragment.missionId === "string",
        hasLocalMaps: Array.isArray(fragment.localMaps),
        hasObjects: Array.isArray(fragment.objects),
        hasWorldIdentity: fragment.worldId === (process.env.NEMEIA_WORLD_ID ?? "") && fragment.agentId === (process.env.NEMEIA_AGENT_ID ?? ""),
      })),
      actionCommandPath: actionWasRequested && actionAccepted,
      actionAccepted,
      boundedFirstStepOutput,
      boundedFreshOutput,
      contextIds,
      worldRevisions: revisions,
      resultCount: results.length,
    };
    writeEvidence(evidence);

    t.succeeded();
    t.check(freshStepText, includes("worldRevision"));
    t.calledTool("bash", { count: 5 });
    assert.equal(evidence.actualEveLifecycle, true);
    assert.equal(evidence.injectedModel, true);
    assert.equal(evidence.sameStepPinned, true);
    assert.equal(evidence.nextStepFresh, true);
    assert.equal(evidence.actionAccepted, true);
    assert.equal(evidence.boundedFirstStepOutput, true);
    assert.equal(evidence.boundedFreshOutput, true);
    assert.equal(evidence.usefulWorldContext, true);
  },
});
