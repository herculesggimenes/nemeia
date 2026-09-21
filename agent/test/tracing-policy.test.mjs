import assert from "node:assert/strict";
import test from "node:test";
import { NonBlockingTraceSink, sanitizeTraceValue } from "../lib/tracing-policy.ts";

test("trace sanitization removes credentials and signed URLs", () => {
  const value = sanitizeTraceValue({
    authorization: "Bearer secret",
    signedUrl: "https://example.test/media?sig=secret",
    nested: { apiKey: "sk-test", ok: "bounded" },
  });
  assert.deepEqual(value, {
    authorization: "[redacted]",
    signedUrl: "[redacted]",
    nested: { apiKey: "[redacted]", ok: "bounded" },
  });
});

test("long secret-bearing values are redacted before size truncation", () => {
  const value = sanitizeTraceValue({
    payload: `${"prefix-".repeat(100)} sk-longsecret-value`,
    redirect: `${"x".repeat(700)}https://example.test/?signature=secret`,
    wide: Object.fromEntries(Array.from({ length: 100 }, (_, index) => [`key-${index}`, "value"])),
  });
  assert.equal(value.payload, "[redacted]");
  assert.equal(value.redirect, "[redacted]");
  assert.ok(Object.keys(value.wide).length <= 64);
});

test("exporter failure is diagnostic loss and does not block the caller", async () => {
  const records = [];
  const sink = new NonBlockingTraceSink(async (record) => {
    records.push(record);
    throw new Error("Laminar unavailable");
  });
  assert.doesNotThrow(() => sink.emit({
    name: "world.read",
    correlation: { sessionId: "session", turnId: "turn", stepIndex: 0, decisionId: "decision" },
    attributes: { authorization: "secret", ok: "yes" },
  }));
  await sink.flush();
  assert.equal(records[0].attributes.authorization, "[redacted]");
  assert.equal(sink.dropped, 1);
});

test("bounded trace queue drops only diagnostics under a blocked exporter", async () => {
  let release;
  const sink = new NonBlockingTraceSink(() => new Promise((resolve) => { release = resolve; }), 1);
  sink.emit({ name: "first", correlation: {}, attributes: {} });
  sink.emit({ name: "second", correlation: {}, attributes: {} });
  assert.equal(sink.dropped, 1);
  release();
  await sink.flush();
});
