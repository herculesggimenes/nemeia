import assert from "node:assert/strict";
import test from "node:test";
import { Identity, Timestamp } from "spacetimedb";
import {
  canonicalJson,
  parseCanonicalJson,
  resourceRefFromJson,
  resourceRefToJson,
} from "../src/json.ts";

test("canonical JSON sorts keys and preserves bigint decimal text", () => {
  const encoded = canonicalJson({ z: 4n, a: { y: 2, x: 1 }, list: [3n, 1n] });
  assert.equal(encoded, '{"a":{"x":1,"y":2},"list":["3","1"],"z":"4"}');
  assert.deepEqual(parseCanonicalJson(encoded), { a: { x: 1, y: 2 }, list: ["3", "1"], z: "4" });
});

test("canonical JSON rejects cyclic arrays and parse validation is explicit", () => {
  const cyclic: unknown[] = [];
  cyclic.push(cyclic);
  assert.throws(() => canonicalJson(cyclic), /cyclic/);
  const parsed = parseCanonicalJson('{"id":"ok"}', (value): value is { id: string } => (
    value !== null && typeof value === "object" && "id" in value && typeof value.id === "string"
  ));
  assert.deepEqual(parsed, { id: "ok" });
  assert.throws(() => parseCanonicalJson('{"id":4}', (value): value is { id: string } => (
    value !== null && typeof value === "object" && "id" in value && typeof value.id === "string"
  )));
});

test("canonical JSON preserves timestamp and identity losslessly", () => {
  const timestamp = new Timestamp(1_234_567n);
  const identity = new Identity("01".padStart(64, "0"));
  assert.equal(
    canonicalJson({ identity, timestamp }),
    '{"identity":"' + identity.toHexString() + '","timestamp":"1970-01-01T00:00:01.234567Z"}',
  );
});

test("ResourceRef byteLength crosses JSON as decimal and returns bigint", () => {
  const reference = { id: "resource-1", schema: "point-cloud/v1", sha256: "a".repeat(64), byteLength: 9_007_199_254_740_993n };
  const detached = resourceRefToJson(reference);
  assert.equal(detached.byteLength, "9007199254740993");
  assert.equal(resourceRefFromJson(detached).byteLength, reference.byteLength);
});

test("invalid ResourceRef JSON is rejected", () => {
  assert.throws(() => resourceRefFromJson({ id: "x", schema: "s", sha256: "0", byteLength: "1" }));
  assert.throws(() => resourceRefFromJson({
    id: "x",
    schema: "s",
    sha256: "0".repeat(64),
    byteLength: "18446744073709551616",
  }));
});
