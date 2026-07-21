import assert from "node:assert/strict";
import test from "node:test";
import { MissionApi } from "../src/mission-api.ts";
import { createMissionHttpServer } from "../src/http-server.ts";

test("HTTP server adapter preserves MissionApi status and JSON body", async () => {
  const api = MissionApi.withSim({ clock: fixedClock });
  const server = await listen(createMissionHttpServer({ api }));
  try {
    const httpResponse = await requestJson(server, {
      method: "GET",
      path: "/health",
      headers: { authorization: "Bearer agent-token" }
    });
    const directResponse = await api.handle({
      method: "GET",
      path: "/health",
      headers: { authorization: "Bearer agent-token" }
    });

    assert.equal(httpResponse.status, directResponse.status);
    assert.deepEqual(httpResponse.body, directResponse.body);
    assert.match(httpResponse.headers.get("content-type"), /application\/json/);
  } finally {
    await close(server);
  }
});

test("HTTP server adapter parses JSON bodies and forwards headers", async () => {
  const server = await listen(createMissionHttpServer({ api: MissionApi.withSim({ clock: fixedClock }) }));
  try {
    const created = await requestJson(server, {
      method: "POST",
      path: "/missions",
      headers: {
        authorization: "Bearer operator-token",
        "idempotency-key": "idem_http_mission"
      },
      body: { preset: "preset_go2", robot_ids: ["go2"] }
    });
    const replayed = await requestJson(server, {
      method: "POST",
      path: "/missions",
      headers: {
        authorization: "Bearer operator-token",
        "idempotency-key": "idem_http_mission"
      },
      body: { preset: "preset_go2", robot_ids: ["go2"] }
    });

    assert.equal(created.status, 201);
    assert.equal(replayed.body.id, created.body.id);
  } finally {
    await close(server);
  }
});

test("HTTP server adapter returns structured malformed JSON errors", async () => {
  const server = await listen(createMissionHttpServer({ api: MissionApi.withSim({ clock: fixedClock }) }));
  try {
    const url = serverUrl(server, "/missions");
    const response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: "Bearer operator-token",
        "idempotency-key": "idem_bad_json",
        "content-type": "application/json"
      },
      body: "{bad json"
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.error_code, "JSON_INVALID");
    assert.equal(body.retryable, false);
  } finally {
    await close(server);
  }
});

test("HTTP server adapter surfaces MissionApi errors over HTTP", async () => {
  const server = await listen(createMissionHttpServer({ api: MissionApi.withSim({ clock: fixedClock }) }));
  try {
    const response = await requestJson(server, {
      method: "POST",
      path: "/missions",
      headers: { authorization: "Bearer agent-token", "idempotency-key": "idem_denied" },
      body: { preset: "preset_go2", robot_ids: ["go2"] }
    });

    assert.equal(response.status, 403);
    assert.equal(response.body.error_code, "AUTH_FORBIDDEN");
  } finally {
    await close(server);
  }
});

async function requestJson(server, { method, path, headers = {}, body }) {
  const response = await fetch(serverUrl(server, path), {
    method,
    headers: {
      ...headers,
      ...(body === undefined ? {} : { "content-type": "application/json" })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return {
    status: response.status,
    headers: response.headers,
    body: await response.json()
  };
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function serverUrl(server, path) {
  const address = server.address();
  return `http://${address.address}:${address.port}${path}`;
}

function fixedClock() {
  return new Date("2026-07-07T17:00:00.000Z");
}
