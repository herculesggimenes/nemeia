import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  isEvidenceFresh,
  missionReadyObjectives,
  objectiveDependenciesReady
} from "../../lib/world-operator/operator-policies.ts";
import {
  parseResourceReadRequest,
  sameResource,
  safeMimeType
} from "../../lib/world-operator/resource-read-policy.ts";
import {
  MAX_RESOURCE_REQUEST_BODY_BYTES,
  readJsonBody
} from "../../lib/server/resource-body.ts";
import type { OperatorMission, OperatorObjective } from "../../types/operator.ts";

const objective = (id: string, overrides: Partial<OperatorObjective> = {}): OperatorObjective => ({
  criterion: "located",
  dependsOn: [],
  description: id,
  evidenceIds: [],
  id,
  optional: false,
  state: "ready",
  ...overrides
});

test("evidence freshness rejects future acquisition and preserves the clock bound", () => {
  const now = Date.parse("2026-09-20T12:00:00.000Z");
  assert.equal(isEvidenceFresh("2026-09-20T11:59:59.000Z", 2_000, now), true);
  assert.equal(isEvidenceFresh("2026-09-20T11:59:59.999Z", 2_000, now, 50), true);
  assert.equal(isEvidenceFresh("2026-09-20T12:00:00.001Z", 2_000, now, 50), false);
  assert.equal(isEvidenceFresh("2026-09-20T11:59:00.000Z", 2_000, now, 50), false);
});

test("objective readiness requires every required dependency to be accepted", () => {
  const first = objective("first", { state: "accepted" });
  const second = objective("second", { dependsOn: ["first"] });
  const third = objective("third", { dependsOn: ["first", "missing"] });
  assert.equal(objectiveDependenciesReady(second, new Set(["first"]), [first, second]), true);
  assert.equal(objectiveDependenciesReady(third, new Set(["first"]), [first, third]), false);
});

test("optional dependencies do not block a ready objective", () => {
  const optional = objective("optional", { optional: true });
  const dependent = objective("dependent", { dependsOn: ["optional"] });
  assert.equal(objectiveDependenciesReady(dependent, new Set(), [optional, dependent]), true);
});

test("mission ready objectives only expose unblocked ready work", () => {
  const mission: OperatorMission = {
    agentIds: [],
    deadlineAt: null,
    description: "test mission",
    id: "mission-1",
    objectives: [
      objective("accepted", { state: "accepted" }),
      objective("next", { dependsOn: ["accepted"] }),
      objective("blocked", { dependsOn: ["unknown"] })
    ],
    progressCount: 1,
    revision: "2",
    state: "active",
    updatedAt: null
  };
  assert.deepEqual(missionReadyObjectives(mission).map((item) => item.id), ["next"]);
});

test("native adapter never reads a public privileged token", () => {
  const source = readFileSync(fileURLToPath(new URL("../../lib/world-operator/native-client.ts", import.meta.url)), "utf8");
  assert.doesNotMatch(source, /NEXT_PUBLIC_[A-Z0-9_]*TOKEN/);
});

const resource = {
  byteLength: "68",
  id: "perception_image_1",
  schema: "image/png",
  sha256: "a".repeat(64)
};

test("resource reads require a full authorized reference and bounded range", () => {
  const request = parseResourceReadRequest({
    context: { kind: "observation", observationId: "observation-1" },
    length: 68,
    offset: 0,
    resource
  });
  assert.equal(sameResource(request.resource, resource), true);
  assert.equal(sameResource(request.resource, { ...resource, sha256: "b".repeat(64) }), false);
  assert.throws(
    () => parseResourceReadRequest({ ...request, length: 69 }),
    (error: unknown) => typeof error === "object" && error !== null && "status" in error && error.status === 416
  );
  assert.equal(safeMimeType(resource.schema), "image/png");
});

test("resource request bodies stay bounded without trusting content-length", async () => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(MAX_RESOURCE_REQUEST_BODY_BYTES + 1));
      controller.close();
    }
  });
  await assert.rejects(
    () => readJsonBody(new Request("http://localhost", { body, duplex: "half", method: "POST" })),
    (error: unknown) => typeof error === "object" && error !== null && "status" in error && error.status === 413
  );

  const falseLengthBody = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(MAX_RESOURCE_REQUEST_BODY_BYTES + 1));
      controller.close();
    }
  });
  await assert.rejects(
    () => readJsonBody(new Request("http://localhost", {
      body: falseLengthBody,
      duplex: "half",
      headers: { "content-length": "0" },
      method: "POST"
    })),
    (error: unknown) => typeof error === "object" && error !== null && "status" in error && error.status === 413
  );
});

test("u64 resource fields reject oversized digit strings before bigint conversion", () => {
  assert.throws(
    () => parseResourceReadRequest({
      context: { kind: "map", mapId: "map-1", revision: "1" },
      length: 1,
      offset: 0,
      resource: { ...resource, byteLength: "1".repeat(21) }
    }),
    (error: unknown) => typeof error === "object" && error !== null && "status" in error && error.status === 400
  );
});
