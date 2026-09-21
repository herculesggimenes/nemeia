import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createNativeNetworkPolicy, installNativeNetworkFence } from "../../scripts/native-ui-safety.mjs";

const policy = createNativeNetworkPolicy({
  baseURL: "http://127.0.0.1:5183", uri: "http://127.0.0.1:38377", databaseName: "nemeia-local-loopback",
});

test("frontend development and production entrypoints bind only loopback by default", () => {
  const { scripts } = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  assert.equal(scripts.dev, "next dev -H 127.0.0.1 -p 5173");
  assert.equal(scripts.start, "next start -H 127.0.0.1 -p 5173");
});

test("E7 request policy denies legacy actions, other databases and robot network", () => {
  assert.equal(policy.allowHttp("http://127.0.0.1:5183/missions"), true);
  assert.equal(policy.allowHttp("http://127.0.0.1:5183/api/world/resources/read", "POST"), true);
  assert.equal(policy.allowHttp("http://127.0.0.1:5183/api/world/resources/references", "POST"), true);
  assert.equal(policy.allowHttp("http://127.0.0.1:5183/"), true);
  assert.equal(policy.allowHttp("http://127.0.0.1:5183/%61pi/robots/go2/proxy/action", "POST"), false);
  assert.equal(policy.allowHttp("http://127.0.0.1:5183/framework", "POST"), false);
  assert.equal(policy.allowHttp("http://127.0.0.1:38377/v1/identity/websocket-token", "POST"), true);
  assert.equal(policy.allowHttp("http://127.0.0.1:38377/v1/identity/websocket-token", "GET"), false);
  assert.equal(policy.allowHttp("http://127.0.0.1:38377/v1/identity", "POST"), false);
  for (const path of ["robots/go2/proxy/stop", "mission/cockpit/reset", "mission/cockpit/robots/unit/stop", "mission/cockpit/runs/run/decision", "world/unexpected-write"]) {
    assert.equal(policy.allowHttp(`http://127.0.0.1:5183/api/${path}`), false);
  }
  assert.equal(policy.allowHttp("http://192.168.123.161/action"), false);
  assert.equal(policy.allowHttp("http://127.0.0.1:38377/v1/database/nemeia-local-loopback/call/assign_unit"), false);
  assert.equal(policy.allowSocket("ws://127.0.0.1:38377/v1/database/nemeia-local-loopback/subscribe"), true);
  assert.equal(policy.allowSocket("ws://127.0.0.1:5183/_next/webpack-hmr"), true);
  assert.equal(policy.allowSocket("ws://127.0.0.1:38377/v1/database/other/subscribe"), false);
  assert.equal(policy.allowSocket("ws://192.168.123.161/v1/database/nemeia-local-loopback/subscribe"), false);
});

test("E7 fence aborts forbidden requests before forwarding, not after observing them", async () => {
  let httpHandler;
  let socketHandler;
  let initRegistered = false;
  const violations: string[] = [];
  await installNativeNetworkFence({
    route: async (_pattern, handler) => { httpHandler = handler; },
    routeWebSocket: async (_pattern, handler) => { socketHandler = handler; },
    addInitScript: async () => { initRegistered = true; },
  }, policy, violations);
  let forwarded = 0;
  let aborted = 0;
  await httpHandler({
    request: () => ({ url: () => "http://127.0.0.1:5183/api/robots/go2/proxy/action", method: () => "POST" }),
    continue: () => { forwarded += 1; }, abort: () => { aborted += 1; },
  });
  await socketHandler({
    url: () => "ws://192.168.123.161/actions", connectToServer: () => { forwarded += 1; }, close: () => { aborted += 1; },
  });
  assert.equal(forwarded, 0);
  assert.equal(aborted, 2);
  assert.equal(initRegistered, true);
  assert.deepEqual(violations, ["forbidden_http_request_blocked", "forbidden_socket_blocked"]);
});
