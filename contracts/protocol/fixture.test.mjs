import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import * as example from "./example.ts";
import { services, tables } from "../../docs/protocol-content.mjs";

test("example preserves input, event and recording times", () => {
  const { observation, observationEvent, recordedObservation } = example;
  assert.equal(observation.semantic.observedAt, example.camera.capturedAt);
  assert.equal(observation.geometry.observedAt, example.lidar.capturedAt);
  assert.ok(Date.parse(observationEvent.time) > Date.parse(observation.geometry.observedAt));
  assert.ok(Date.parse(recordedObservation.recordedAt) > Date.parse(observationEvent.time));
  assert.equal(observationEvent.specversion, "1.0");
  assert.equal(new URL(observationEvent.source).protocol, "urn:");
  assert.equal(observation.retained.length, 0);
});

test("world fixture preserves evidence and has no dangling relationship", () => {
  const { snapshot, backpack, observation, delta } = example;
  const identities = new Set(snapshot.entities.map(entity => entity.id));
  for (const relationship of snapshot.relationships) {
    assert.ok(identities.has(relationship.subjectId));
    assert.ok(identities.has(relationship.objectId));
  }
  assert.equal(snapshot.cursor, delta.to);
  assert.deepEqual(backpack.components["core.geometry"].evidence.observationIds, [observation.id]);
  assert.notEqual(backpack.id, observation.trackId);
  assert.equal(observation.geometry.value.kind, "boundingBox3D");
  assert.ok(observation.geometry.value.sizeM.every(value => value > 0));
  assert.equal(Math.hypot(...observation.geometry.value.pose.orientation), 1);
});

test("one execution identity and measured completion; fixture performs no IO", () => {
  const { accepted, running, succeeded, request, finalObservation, finalPose, sent, admission } = example;
  assert.equal(accepted.request.requestId, request.requestId);
  assert.equal(accepted.id, running.id);
  assert.equal(running.id, succeeded.id);
  assert.equal(admission.executionId, accepted.id);
  assert.equal(sent.confirmation, "sent");
  assert.ok(Math.hypot(sent.sent.vxMps, sent.sent.vyMps) <= admission.limits.maxLinearMps);
  const target = finalObservation.geometry.value.pose.positionM;
  const actor = finalPose.components["core.pose"].value.pose.positionM;
  assert.ok(Math.abs(Math.hypot(target[0]-actor[0], target[1]-actor[1])-succeeded.output.distanceM) < 1e-9);
  assert.equal(succeeded.output.observationId, finalObservation.id);
  assert.equal(example.closed.safeState, "confirmed");
});

test("each service and database table has its own disclosure; no action controls", () => {
  const html = readFileSync(new URL("../../docs/index.html", import.meta.url), "utf8");
  assert.equal((html.match(/class="contract-item"/g) ?? []).length, services.length);
  assert.equal((html.match(/class="schema-item"/g) ?? []).length, tables.length);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const [,id] of html.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.includes(id));
  assert.doesNotMatch(html, /<(?:button|form|input)\b/i);
  assert.doesNotMatch(html, /(?:href|src)="(?:world-runtime\/|README\.md|scene-model\.md)/);
  assert.doesNotMatch(html, /MissionService|ExecutionGrant|bbox_3d/);
  assert.doesNotMatch(html, /\bbox[23]\b/);
  assert.match(html, /kind: &quot;boundingBox3D&quot;/);
  assert.match(html, /kind: &quot;boundingBox2D&quot;/);
  assert.match(html, /name="viewport"/);
  assert.match(html, /@media \(max-width: 600px\)/);
  for (const [,script] of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new vm.Script(script);
});

test("syntax rendering preserves copied code and escapes markup", () => {
  const html = readFileSync(new URL("../../docs/index.html", import.meta.url), "utf8");
  const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  let rendered = "";
  const source = 'export interface X {\n  read(): Promise<string>; // <description>\n}';
  const code = {
    textContent: source,
    classList: { contains: () => false, add: () => {} },
    closest: (selector) => selector === "pre" ? {dataset:{}} : {classList:{add:()=>{}}},
    set innerHTML(value) { rendered = value; },
  };
  const sandbox = { document: { querySelectorAll: () => [code] } };
  for (const [,script] of blocks) vm.runInNewContext(script,sandbox);
  assert.match(rendered, /&lt;description&gt;/);
  const plain = rendered.replace(/<[^>]*>/g, "").replaceAll("&lt;","<").replaceAll("&gt;",">").replaceAll("&amp;","&").replaceAll("&quot;",'"');
  assert.equal(plain, source);
});
