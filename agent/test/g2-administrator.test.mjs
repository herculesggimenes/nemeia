import assert from "node:assert/strict";
import { mkdtemp, chmod, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { openQualificationMemberAdministrator } from "./g2-loopback-adapter.ts";

async function privateFixture(value = "test-only-not-a-token", mode = 0o600) {
  const directory = await mkdtemp(join(tmpdir(), "nemeia-g2-admin-test-"));
  const pathname = join(directory, "admin.token");
  await writeFile(pathname, value, { mode });
  await chmod(pathname, mode);
  return pathname;
}

test("G2 administrator exposes only configureMember revocation/restore, not action authority", async () => {
  const pathname = await privateFixture();
  const calls = [];
  const administrator = await openQualificationMemberAdministrator({
    adminTokenFile: pathname,
    createClient: async (privateTokenFile) => {
      assert.equal(privateTokenFile, pathname);
      return {
        start: async () => { calls.push("start"); },
        close: async () => { calls.push("close"); },
        callReducer: async (name, input) => { calls.push({ name, input }); },
      };
    },
  });
  const identity = { testIdentity: "agent-principal" };
  await administrator.setAgentRole(identity, "Controller");
  await administrator.setAgentRole(identity, "Agent");
  await administrator.close();
  assert.deepEqual(Object.keys(administrator).sort(), ["close", "setAgentRole"]);
  assert.deepEqual(calls, ["start", ...["Controller", "Agent"].map((tag) => ({
    name: "configureMember",
    input: { identity, role: { tag }, unitId: undefined, producerSession: undefined, package: undefined },
  })), "close"]);
});

test("G2 requires explicit adminTokenFile with no operator fallback", async () => {
  for (const adminTokenFile of [undefined, "credentials/admin.token"]) {
    await assert.rejects(openQualificationMemberAdministrator({
      adminTokenFile,
      createClient: async () => { assert.fail("must not connect without private administrator path"); },
    }), /explicit absolute handoff\.adminTokenFile/u);
  }
});

test("G2 rejects public, empty, and symlinked administrator files before connecting", async () => {
  const publicPath = await privateFixture("test-only-not-a-token", 0o644);
  const emptyPath = await privateFixture("");
  const privatePath = await privateFixture();
  const linkPath = `${privatePath}.link`;
  await symlink(privatePath, linkPath);
  for (const [adminTokenFile, message] of [
    [publicPath, /mode 0600/u], [emptyPath, /credential is empty/u], [linkPath, /private regular file/u],
  ]) {
    await assert.rejects(openQualificationMemberAdministrator({
      adminTokenFile,
      createClient: async () => { assert.fail("invalid administrator file must not reach client creation"); },
    }), message);
  }
});

test("administrator connection is closed if startup fails", async () => {
  let closed = false;
  await assert.rejects(openQualificationMemberAdministrator({
    adminTokenFile: await privateFixture(),
    createClient: async () => ({
      start: async () => { throw new Error("test startup failure"); },
      close: async () => { closed = true; },
      callReducer: async () => { assert.fail("failed client must not mutate"); },
    }),
  }), /test startup failure/u);
  assert.equal(closed, true);
});
