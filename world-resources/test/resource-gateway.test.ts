import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, chmod, lstat, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  OfflineQuarantineError,
  ResourceAuthorizationError,
  ResourceBackpressureError,
  ResourceCommitError,
  ResourceCorruptError,
  ResourceCrashError,
  ResourceGateway,
  ResourceIdentityConflictError,
  ResourceQuotaError,
  ResourceSchemaError,
  toResourceReferenceBoundary,
  type EnrolledProducerBinding,
  type ResourceGatewayConfig,
  type ResourceReferenceCommitAdapter,
} from "../src/index.ts";

const PACKAGE_DIGEST = "a".repeat(64);
const CREDENTIAL = new TextEncoder().encode("worker-credential");
const DATA = new Uint8Array([1, 2, 3, 4, 5, 6]);

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function makeFixture(
  options: Partial<Omit<ResourceGatewayConfig, "root" | "bindings">> = {},
  referenceCommitAdapter: ResourceReferenceCommitAdapter = { commitPublishedReferences: async () => undefined },
  extraBindings: readonly EnrolledProducerBinding[] = [],
) {
  const root = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(join(tmpdir(), "nemeia-resource-test-")));
  const config: ResourceGatewayConfig = {
    root,
    bindings: [{
      bindingId: "binding-1",
      producerId: "producer-1",
      producerSession: "session-1",
      unitId: "unit-1",
      package: { name: "nemeia-perception", version: "1.0.0", sha256: PACKAGE_DIGEST },
      credential: CREDENTIAL,
      allowedSchemas: ["test/bytes"],
      referenceCommitAdapter,
    }, ...extraBindings],
    ...options,
  };
  const gateway = await ResourceGateway.open(config);
  const session = gateway.authenticateWorker({ bindingId: "binding-1", credential: CREDENTIAL });
  return {
    root,
    gateway,
    session,
    async close() {
      await rm(root, { recursive: true, force: true });
    },
  };
}

function publishInput(id = "resource-1", bytes = DATA) {
  return {
    id,
    schema: "test/bytes",
    bytes,
    expectedSha256: digest(bytes),
    expectedByteLength: bytes.byteLength,
  } as const;
}

test("publishes verified immutable bytes before the typed reference commit and reads bounded ranges", async () => {
  const calls: unknown[] = [];
  const fixture = await makeFixture({}, {
    commitPublishedReferences: async (request) => {
      calls.push(request);
      await access(join(fixture.root, "objects", request.resources[0].id));
    },
  });
  try {
    const ref = await fixture.gateway.publish(fixture.session, publishInput());
    assert.deepEqual(ref, {
      id: "resource-1",
      schema: "test/bytes",
      sha256: digest(DATA),
      byteLength: DATA.byteLength,
    });
    assert.equal(calls.length, 1);
    const reader = fixture.gateway.createReader({ authorizeRead: async () => true });
    assert.deepEqual(await fixture.gateway.read(reader, toResourceReferenceBoundary(ref), { offset: 1, length: 3 }), new Uint8Array([2, 3, 4]));
    const inventory = await fixture.gateway.inventory();
    assert.deepEqual(inventory.resourceIds, ["resource-1"]);
    assert.equal(inventory.retainedBytes, DATA.byteLength);
    const metadata = await lstat(join(fixture.root, "objects", ref.id));
    assert.equal(metadata.mode & 0o222, 0, "published resource must not be writable through the filesystem");
    await assert.rejects(writeFile(join(fixture.root, "objects", ref.id), new Uint8Array([9])), /EACCES|EPERM/);
  } finally {
    await fixture.close();
  }
});

test("handles short writes until the complete chunk is durable and rejects zero progress", async () => {
  const shortWriteFixture = await makeFixture({
    hooks: {
      writeChunk: async (handle, chunk, offset) =>
        (await handle.write(chunk, offset, Math.min(1, chunk.byteLength - offset))).bytesWritten,
    },
  });
  try {
    const ref = await shortWriteFixture.gateway.publish(shortWriteFixture.session, publishInput());
    const reader = shortWriteFixture.gateway.createReader({ authorizeRead: () => true });
    assert.deepEqual(
      await shortWriteFixture.gateway.read(reader, toResourceReferenceBoundary(ref), { offset: 0, length: DATA.byteLength }),
      DATA,
    );
  } finally {
    await shortWriteFixture.close();
  }

  const zeroProgressFixture = await makeFixture({
    hooks: { writeChunk: async () => 0 },
  });
  try {
    await assert.rejects(zeroProgressFixture.gateway.publish(zeroProgressFixture.session, publishInput()), /no safe progress/);
    assert.deepEqual((await zeroProgressFixture.gateway.inventory()).resourceIds, []);
  } finally {
    await zeroProgressFixture.close();
  }
});

test("rejects agent, Eve, browser, direct, and invalid worker writes at the gateway boundary", async () => {
  const fixture = await makeFixture();
  try {
    assert.throws(
      () => fixture.gateway.authenticateWorker({ bindingId: "binding-1", credential: new TextEncoder().encode("wrong") }),
      ResourceAuthorizationError,
    );
    assert.throws(
      () => fixture.gateway.authenticateWorker({ bindingId: "agent", credential: CREDENTIAL }),
      ResourceAuthorizationError,
    );
    await assert.rejects(
      fixture.gateway.publish({} as object, publishInput()),
      ResourceAuthorizationError,
    );
    await assert.rejects(
      fixture.gateway.read({} as object, {
        id: "resource-1", schema: "test/bytes", sha256: digest(DATA), byteLength: String(DATA.byteLength),
      }, { offset: 0, length: 1 }),
      ResourceAuthorizationError,
    );
    const deniedReader = fixture.gateway.createReader({ authorizeRead: () => false });
    const stored = await fixture.gateway.publish(fixture.session, publishInput());
    await assert.rejects(
      fixture.gateway.read(deniedReader, toResourceReferenceBoundary(stored), { offset: 0, length: 1 }),
      ResourceAuthorizationError,
    );
    await assert.rejects(
      fixture.gateway.publish(fixture.session, { ...publishInput("../escape"), id: "../escape" }),
      /opaque single path components/,
    );
    await assert.rejects(
      fixture.gateway.publish(fixture.session, { ...publishInput(), schema: "../private" }),
      ResourceSchemaError,
    );
    await assert.rejects(ResourceGateway.open({ root: "/", bindings: [] }), /non-root absolute path/);
    assert.doesNotMatch(new ResourceAuthorizationError().message, /worker-credential/);
  } finally {
    await fixture.close();
  }
});

test("rejects symlinked configured roots and resource object paths", async () => {
  const actual = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(join(tmpdir(), "nemeia-resource-root-")));
  const link = `${actual}-link`;
  try {
    const unmarked = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(join(tmpdir(), "nemeia-unmarked-root-")));
    try {
      await writeFile(join(unmarked, "existing-data"), new Uint8Array([1]));
      const beforeMode = (await lstat(unmarked)).mode;
      await assert.rejects(ResourceGateway.open({ root: unmarked, bindings: [] }), /new or marked dedicated/);
      assert.equal((await lstat(unmarked)).mode, beforeMode);
    } finally {
      await rm(unmarked, { recursive: true, force: true });
    }
    await symlink(actual, link);
    await assert.rejects(
      ResourceGateway.open({ root: link, bindings: [] }),
      /symlinks/,
    );
    await rm(link, { force: true });
    const fixture = await makeFixture();
    try {
      await symlink(join(actual, "outside"), join(fixture.root, "objects", "resource-1"));
      await assert.rejects(ResourceGateway.open({
        root: fixture.root,
        bindings: [],
      }), /links/);
    } finally {
      await fixture.close();
    }
  } finally {
    await rm(link, { force: true });
    await rm(actual, { recursive: true, force: true });
  }
});

for (const point of [
  "after_temp_open",
  "after_bytes_written",
  "after_temp_fsync",
  "before_publish",
  "after_publish",
  "before_reducer_commit",
  "after_reducer_commit",
] as const) {
  test(`crash recovery at ${point} never publishes partial bytes`, async () => {
    const root = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(join(tmpdir(), `nemeia-crash-${point}-`)));
    let commits = 0;
    const reducer = { commitPublishedReferences: async () => { commits += 1; } };
    const base: ResourceGatewayConfig = {
      root,
      bindings: [{
        bindingId: "binding-1",
        producerId: "producer-1",
        producerSession: "session-1",
        unitId: "unit-1",
        package: { name: "nemeia-perception", version: "1.0.0", sha256: PACKAGE_DIGEST },
        credential: CREDENTIAL,
        allowedSchemas: ["test/bytes"],
        referenceCommitAdapter: reducer,
      }],
      hooks: { crashAt: point },
    };
    try {
      const crashed = await ResourceGateway.open(base);
      const crashedSession = crashed.authenticateWorker({ bindingId: "binding-1", credential: CREDENTIAL });
      await assert.rejects(crashed.publish(crashedSession, publishInput()), (error) => error instanceof ResourceCrashError);

      const afterCrash = await crashed.inventory();
      if (point === "after_publish" || point === "before_reducer_commit" || point === "after_reducer_commit") {
        assert.deepEqual(afterCrash.resourceIds, ["resource-1"]);
      } else {
        assert.deepEqual(afterCrash.resourceIds, []);
      }

      const recovered = await ResourceGateway.open({ ...base, hooks: undefined });
      const recoveredSession = recovered.authenticateWorker({ bindingId: "binding-1", credential: CREDENTIAL });
      const ref = await recovered.publish(recoveredSession, publishInput());
      assert.equal(ref.sha256, digest(DATA));
      const reader = recovered.createReader({ authorizeRead: async () => true });
      assert.deepEqual(await recovered.read(reader, toResourceReferenceBoundary(ref), { offset: 0, length: DATA.byteLength }), DATA);
      assert.ok(commits >= (point === "after_reducer_commit" ? 2 : 1));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

test("rejects digest corruption, preserves immutable retries, and leaves reducer-failed bytes for retry", async () => {
  let failCommit = true;
  const fixture = await makeFixture({}, {
    commitPublishedReferences: async () => {
      if (failCommit) throw new Error("module unavailable");
    },
  });
  try {
    await assert.rejects(
      fixture.gateway.publish(fixture.session, { ...publishInput(), expectedSha256: "b".repeat(64) }),
      ResourceCorruptError,
    );
    await assert.rejects(fixture.gateway.publish(fixture.session, publishInput()), ResourceCommitError);
    assert.deepEqual((await fixture.gateway.inventory()).resourceIds, ["resource-1"]);
    failCommit = false;
    const ref = await fixture.gateway.publish(fixture.session, publishInput());
    assert.equal(ref.id, "resource-1");
    await assert.rejects(
      fixture.gateway.publish(fixture.session, publishInput("resource-1", new Uint8Array([9, 9, 9]))),
      ResourceIdentityConflictError,
    );
    const reader = fixture.gateway.createReader({ authorizeRead: async () => true });
    assert.deepEqual(await fixture.gateway.read(reader, toResourceReferenceBoundary(ref), { offset: 0, length: DATA.byteLength }), DATA);
  } finally {
    await fixture.close();
  }
});

test("commits only under the enrolled producer binding recorded with the retained bytes", async () => {
  const otherCredential = new TextEncoder().encode("other-worker-credential");
  const fixture = await makeFixture({}, { commitPublishedReferences: async () => undefined }, [{
    bindingId: "binding-2",
    producerId: "producer-2",
    producerSession: "session-2",
    unitId: "unit-2",
    package: { name: "nemeia-other", version: "1.0.0", sha256: PACKAGE_DIGEST },
    credential: otherCredential,
    allowedSchemas: ["test/bytes"],
    referenceCommitAdapter: { commitPublishedReferences: async () => undefined },
  }]);
  try {
    const stored = await fixture.gateway.publish(fixture.session, publishInput());
    const otherSession = fixture.gateway.authenticateWorker({ bindingId: "binding-2", credential: otherCredential });
    await assert.rejects(
      fixture.gateway.commitPublishedReferences(otherSession, [stored]),
      ResourceAuthorizationError,
    );
    await assert.rejects(
      fixture.gateway.publish(otherSession, publishInput()),
      ResourceAuthorizationError,
    );
  } finally {
    await fixture.close();
  }
});

test("rechecks the actual published file after the post-publication crash hook and before host commit", async () => {
  let commitCalls = 0;
  const fixture = await makeFixture({
    hooks: {
      onCheckpoint: async (point) => {
        if (point !== "after_publish") return;
        const pathname = join(fixture.root, "objects", "resource-1");
        await chmod(pathname, 0o600);
        await writeFile(pathname, new Uint8Array([9, 9, 9]));
        await chmod(pathname, 0o400);
      },
    },
  }, {
    commitPublishedReferences: async () => {
      commitCalls += 1;
    },
  });
  try {
    await assert.rejects(fixture.gateway.publish(fixture.session, publishInput()), ResourceCorruptError);
    assert.equal(commitCalls, 0);
  } finally {
    await fixture.close();
  }
});

test("fails closed on corrupt retained bytes and applies quota/backpressure", async () => {
  const fixture = await makeFixture({ maxResourceBytes: 4, quotaBytes: 5, maxReadBytes: 2 });
  try {
    await assert.rejects(fixture.gateway.publish(fixture.session, publishInput("too-large", new Uint8Array([1, 2, 3, 4, 5]))), ResourceQuotaError);
    const small = new Uint8Array([1, 2, 3, 4]);
    const ref = await fixture.gateway.publish(fixture.session, publishInput("small", small));
    const reader = fixture.gateway.createReader({ authorizeRead: async () => true });
    await assert.rejects(fixture.gateway.read(reader, toResourceReferenceBoundary(ref), { offset: 0, length: 3 }), ResourceQuotaError);
    await assert.rejects(fixture.gateway.publish(fixture.session, publishInput("full", new Uint8Array([7, 8]))), ResourceQuotaError);
    assert.deepEqual(await fixture.gateway.read(reader, toResourceReferenceBoundary(ref), { offset: 1, length: 2 }), new Uint8Array([2, 3]));
    const pathname = join(fixture.root, "objects", "small");
    await chmod(pathname, 0o600);
    await writeFile(pathname, new Uint8Array([8, 8, 8, 8]));
    await chmod(pathname, 0o400);
    await assert.rejects(fixture.gateway.read(reader, toResourceReferenceBoundary(ref), { offset: 0, length: 1 }), ResourceCorruptError);
  } finally {
    await fixture.close();
  }
});

test("returns explicit writer backpressure instead of queueing a second resource writer", async () => {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const fixture = await makeFixture();
  try {
    async function* slowBytes() {
      yield new Uint8Array([1]);
      await blocked;
      yield new Uint8Array([2]);
    }
    const pending = fixture.gateway.publish(fixture.session, {
      id: "slow",
      schema: "test/bytes",
      bytes: slowBytes(),
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await assert.rejects(fixture.gateway.publish(fixture.session, publishInput("second")), ResourceBackpressureError);
    release();
    await pending;
  } finally {
    release();
    await fixture.close();
  }
});

test("uses explicit offline reachability plans and quarantines only an isolated test root", async () => {
  const fixture = await makeFixture({ allowOfflineQuarantine: true });
  try {
    const reachable = await fixture.gateway.publish(fixture.session, publishInput("reachable"));
    await fixture.gateway.publish(fixture.session, publishInput("orphan", new Uint8Array([7, 8, 9])));
    const plan = await fixture.gateway.planOfflineReachability([toResourceReferenceBoundary(reachable)]);
    assert.deepEqual(plan.reachableIds, ["reachable"]);
    assert.deepEqual(plan.candidateIds, ["orphan"]);
    await assert.rejects(
      fixture.gateway.quarantineOffline(plan, { quiesced: false, isolatedTestRoot: fixture.root }),
      OfflineQuarantineError,
    );
    const moved = await fixture.gateway.quarantineOffline(plan, { quiesced: true, isolatedTestRoot: fixture.root });
    assert.deepEqual(moved, ["orphan"]);
    assert.deepEqual((await fixture.gateway.inventory()).resourceIds, ["reachable"]);
    assert.equal((await readdir(join(fixture.root, "quarantine"))).length, 1);
  } finally {
    await fixture.close();
  }
});

test("supports a multi-resource host commit only after every byte set is durable", async () => {
  const committedGroups: string[][] = [];
  const fixture = await makeFixture({}, {
    commitPublishedReferences: async (request) => {
      committedGroups.push(request.resources.map((resource) => resource.id));
      for (const resource of request.resources) {
        await access(join(fixture.root, "objects", resource.id));
      }
    },
  });
  try {
    const first = await fixture.gateway.publishBytes(fixture.session, publishInput("map-layer", new Uint8Array([1, 2])));
    const second = await fixture.gateway.publishBytes(fixture.session, publishInput("mapper-state", new Uint8Array([3, 4])));
    await fixture.gateway.commitPublishedReferences(fixture.session, [first, second]);
    assert.deepEqual(committedGroups, [["map-layer", "mapper-state"]]);
  } finally {
    await fixture.close();
  }
});
