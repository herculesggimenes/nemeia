import assert from "node:assert/strict";
import test from "node:test";
import { EventLog } from "../../mission-server/src/event-log.ts";
import { EventLogSessionStore } from "../src/session-store.ts";

test("EventLogSessionStore persists issued sessions through the Event Log", () => {
  const eventLog = new EventLog({ clock: fixedClock });
  const issuer = new EventLogSessionStore({ eventLog, clock: fixedClock });
  issuer.issue({ token: "issued-token", principal: "agent", grants: ["read", "agent"], source: "operator:test" });

  const reconstructed = new EventLogSessionStore({ eventLog, clock: fixedClock });
  assert.deepEqual(reconstructed.authenticate("issued-token"), { principal: "agent", grants: ["agent", "read"] });

  const events = eventLog.read({ event_type: "auth.session.issued" }).items;
  assert.equal(events.length, 1);
  assert.equal(events[0].payload.principal, "agent");
  assert.equal(events[0].payload.token_hash.startsWith("sha256:"), true);
  assert.equal(JSON.stringify(events[0].payload).includes("issued-token"), false);
});

test("EventLogSessionStore enforces revocation and expiry", () => {
  const eventLog = new EventLog({ clock: fixedClock });
  const store = new EventLogSessionStore({ eventLog, clock: fixedClock });
  store.issue({
    token: "short-token",
    principal: "reader",
    grants: ["read"],
    expires_at: "2026-07-07T17:00:01.000Z"
  });
  store.issue({ token: "revoked-token", principal: "reader", grants: ["read"] });
  store.revoke({ token: "revoked-token" });

  assert.deepEqual(store.authenticate("short-token", { at: new Date("2026-07-07T17:00:00.500Z") }), { principal: "reader", grants: ["read"] });
  assert.throws(() => store.authenticate("short-token", { at: new Date("2026-07-07T17:00:01.000Z") }), /expired/);
  assert.throws(() => store.authenticate("revoked-token"), /revoked/);
});

function fixedClock() {
  return new Date("2026-07-07T17:00:00.000Z");
}
