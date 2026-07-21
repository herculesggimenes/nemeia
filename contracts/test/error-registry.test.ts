import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ERROR_REGISTRY } from "../src/error-registry.ts";

test("error registry module matches source-controlled registry JSON", async () => {
  const registry = JSON.parse(await readFile(new URL("../registries/error-codes.json", import.meta.url), "utf8"));
  const jsonEntries = Object.fromEntries(registry.values.map((entry) => [entry.code, { status: entry.status, retryable: entry.retryable }]));

  assert.deepEqual(ERROR_REGISTRY, jsonEntries);
});
