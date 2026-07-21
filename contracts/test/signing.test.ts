import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { canonicalize } from "../src/canonical-json.ts";
import { signCanonicalJson, verifyCanonicalJson } from "../src/signing.ts";

test("canonicalize sorts object keys recursively", () => {
  assert.equal(canonicalize({ b: 2, a: { d: 4, c: 3 } }), '{"a":{"c":3,"d":4},"b":2}');
});

test("signCanonicalJson signs object excluding signature field", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const artifact = {
    id: "auth_test",
    schema_version: 1,
    payload: { b: 2, a: 1 },
    signature: ""
  };
  const signed = { ...artifact, signature: signCanonicalJson(artifact, privateKey) };

  assert.match(signed.signature, /^ed25519:/);
  assert.equal(verifyCanonicalJson(signed, publicKey), true);
  assert.equal(verifyCanonicalJson({ ...signed, payload: { b: 3, a: 1 } }, publicKey), false);
});
