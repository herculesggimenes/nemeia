import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("authored defineSandbox onSession and step hook bind actual Eve handles", async () => {
  const appRoot = mkdtempSync(join(tmpdir(), "nemeia-eve-lifecycle-"));
  process.env.NEMEIA_WORLD_ID = "world-lifecycle";
  process.env.NEMEIA_AGENT_ID = "agent-lifecycle";
  process.env.NEMEIA_AGENT_OWNER_PRINCIPAL_ID = "owner";
  process.env.NEMEIA_AGENT_LEDGER = join(appRoot, "ledger.sqlite");
  const [{ default: sandboxDefinition, nemeiaSandbox }, { default: stepHook }] = await Promise.all([
    import("../sandbox.ts"),
    import("../hooks/world-step-receipts.ts"),
  ]);
  const owner = { principalId: "owner", principalType: "service", authenticator: "jwt-hmac" };
  const other = { principalId: "other", principalType: "service", authenticator: "jwt-hmac" };
  const common = { templateKey: null, runtimeContext: { appRoot } };
  const first = await sandboxDefinition.backend.create({ ...common, sessionKey: "eve-session" });
  try {
    await sandboxDefinition.onSession({
      use: first.useSessionFn,
      ctx: { session: { id: first.session.id, auth: { current: owner, initiator: owner } } },
    });
    assert.equal(nemeiaSandbox.bindingFor(first.session.id)?.principal.principalId, "owner");
    await stepHook.events["step.started"](
      { type: "step.started", meta: { id: "event-owner" }, data: { turnId: "turn-owner", stepIndex: 0 } },
      {
        session: { id: first.session.id, auth: { current: owner, initiator: owner } },
        getSandbox: async () => first.session,
      },
    );
    const firstResult = await first.session.run({ command: "nemeia world summary" });
    assert.equal(firstResult.exitCode, 1, "the lifecycle test has no world read adapter, so command must fail closed");

    await first.stop();
    const reopened = await sandboxDefinition.backend.create({
      ...common,
      sessionKey: first.session.id,
      existingMetadata: (await first.captureState()).metadata,
    });
    try {
      await assert.rejects(
        sandboxDefinition.onSession({
          use: reopened.useSessionFn,
          ctx: { session: { id: reopened.session.id, auth: { current: other, initiator: owner } } },
        }),
        /configured agent owner/,
      );
      assert.equal(nemeiaSandbox.bindingFor(reopened.session.id), null);

      await assert.rejects(
        sandboxDefinition.onSession({
          use: reopened.useSessionFn,
          ctx: { session: { id: reopened.session.id, auth: { current: null, initiator: owner } } },
        }),
        /authenticated Eve session principal/,
      );
      assert.equal(nemeiaSandbox.bindingFor(reopened.session.id), null);
      const denied = await reopened.session.run({ command: "nemeia world summary" });
      assert.equal(denied.exitCode, 1);
    } finally {
      await reopened.shutdown();
    }
  } finally {
    await first.shutdown().catch(() => undefined);
    rmSync(appRoot, { recursive: true, force: true });
  }
});
