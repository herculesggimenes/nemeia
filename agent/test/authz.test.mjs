import assert from "node:assert/strict";
import test from "node:test";
import { principalFromSession, requirePrincipal, WorldAuthorizationError } from "../lib/world-bridge/authz.ts";

const initiator = {
  principalId: "owner",
  principalType: "service",
  authenticator: "jwt-hmac",
};

test("initiator ownership does not grant authority when current caller is absent", () => {
  const auth = { current: null, initiator };
  assert.equal(principalFromSession(auth), null);
  assert.throws(() => requirePrincipal(auth), WorldAuthorizationError);
});

test("a current continuation principal remains distinct from the initiator", () => {
  const current = { principalId: "different", principalType: "service", authenticator: "jwt-hmac" };
  assert.deepEqual(principalFromSession({ current, initiator }), current);
});
