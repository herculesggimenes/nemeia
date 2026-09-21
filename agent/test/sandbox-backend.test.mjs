import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { InMemoryFs } from "just-bash";
import { createWorldFilesystem } from "../lib/world-bridge/command-boundary.ts";
import { createNemeiaSandboxBackend } from "../lib/world-bridge/sandbox-backend.ts";

const principalA = { principalId: "principal-a", principalType: "service", authenticator: "jwt-hmac" };
const principalB = { principalId: "principal-b", principalType: "service", authenticator: "jwt-hmac" };

function projection(principal) {
  return {
    worldId: "world-1",
    agentId: "agent-1",
    worldRevision: "1",
    missionLog: [],
    summary: { authorizedPrincipal: principal.principalId },
    sourceIds: [],
    dirtyKeys: [],
    mustHandleIds: [],
    rescanRequired: false,
    acquisitionTimes: [],
    evidence: [],
  };
}

test("public Eve backend wrapper isolates principals, blocks curl, and rebinds after reopen", async () => {
  const appRoot = mkdtempSync(join(tmpdir(), "nemeia-agent-sandbox-"));
  const reads = [];
  const runtime = createNemeiaSandboxBackend({
    worldId: "world-1",
    agentId: "agent-1",
    world: {
      async readProjection(request) {
        reads.push(request.principal.principalId);
        return projection(request.principal);
      },
    },
    contextProvider(binding) {
      return [{
        path: "/world/principal.json",
        content: `${binding.principal.principalId}\n`,
        byteLength: binding.principal.principalId.length + 1,
      }];
    },
  });
  const common = { templateKey: null, runtimeContext: { appRoot } };
  const first = await runtime.backend.create({ ...common, sessionKey: "session-a" });
  const second = await runtime.backend.create({ ...common, sessionKey: "session-b" });
  try {
    runtime.registerBinding(first.session.id, principalA);
    runtime.registerBinding(second.session.id, principalB);
    const firstRead = await first.session.run({ command: "nemeia world summary" });
    const secondRead = await second.session.run({ command: "nemeia world summary" });
    assert.match(firstRead.stdout, /principal-a/);
    assert.match(secondRead.stdout, /principal-b/);
    assert.deepEqual(reads, ["principal-a", "principal-b"]);

    assert.equal(await first.session.readTextFile({ path: "/world/principal.json" }), "principal-a\n");
    runtime.registerBinding(first.session.id, principalB);
    assert.equal(await first.session.readTextFile({ path: "/world/principal.json" }), "principal-b\n");
    await assert.rejects(
      first.session.writeTextFile({ path: "/world/principal.json", content: "forged\n" }),
      /read-only/,
    );
    const worldFilesystem = createWorldFilesystem(new InMemoryFs(), () => [{
      path: "/world/principal.json",
      content: "principal-b\n",
      byteLength: 12,
    }]);
    assert.throws(
      () => worldFilesystem.readFile("/world/..\/workspace\/secret"),
      /traversal denied/,
    );

    const egress = await first.session.run({ command: "curl https://example.com" });
    assert.equal(egress.exitCode, 126);
    assert.match(egress.stderr, /raw network egress is unavailable/);

    const state = await first.captureState();
    await first.stop();
    const reopened = await runtime.backend.create({
      ...common,
      sessionKey: first.session.id,
      existingMetadata: state.metadata,
    });
    try {
      const deniedUntilReauth = await reopened.session.run({ command: "nemeia world summary" });
      assert.equal(deniedUntilReauth.exitCode, 1);
      runtime.registerBinding(reopened.session.id, principalA);
      const rebound = await reopened.session.run({ command: "nemeia world summary" });
      assert.match(rebound.stdout, /principal-a/);
    } finally {
      await reopened.shutdown();
    }
  } finally {
    await second.shutdown();
    rmSync(appRoot, { recursive: true, force: true });
  }
});
