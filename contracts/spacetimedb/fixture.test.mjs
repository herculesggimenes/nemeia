import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import * as example from "./example.ts";
import { correlationExample, laminarInitialization, decisionSpanOptions, metadataSpanOptions } from "./tracing.ts";
import { contractRows, tableNotes, exampleRows } from "../../docs/spacetimedb-content.mjs";

test("sensor facets retain independent acquisition times and complete measured geometry",()=>{
  const { input, camera, lidar, geometryRow }=example;
  assert.equal(input.semantic.observedAt,camera.capturedAt);
  assert.equal(input.geometry.observedAt,lidar.capturedAt);
  assert.equal(geometryRow.observationId,input.id);
  assert.equal(geometryRow.value.tag,"boundingBox3D");
  assert.ok(Object.values(geometryRow.value.value.sizeM).every(x=>x>0));
  assert.equal(Math.hypot(...Object.values(geometryRow.value.value.pose.orientation)),1);
});

test("one execution is the request receipt through claim, control and measured completion",()=>{
  const { request, accepted, running, succeeded, reservedRobot, localStarted, localClosed, finalActor, finalTarget, completion }=example;
  for(const row of [accepted,running,succeeded]) assert.equal(row.id,request.executionId);
  assert.equal(reservedRobot.activeExecutionId,running.id);
  assert.equal(localStarted.controllerEpoch,running.controllerEpoch);
  assert.equal(localClosed.safeState,"confirmed");
  const actor=finalActor.value.positionM;
  const target=finalTarget.value.value.pose.positionM;
  assert.ok(Math.abs(Math.hypot(target.x-actor.x,target.y-actor.y)-completion.value.distanceM)<1e-9);
  assert.equal(completion.value.actorObservationId,finalActor.observationId);
  assert.equal(completion.value.targetObservationId,finalTarget.observationId);
  assert.ok(succeeded.updatedAt.microsSinceUnixEpoch>finalTarget.observedAt.microsSinceUnixEpoch);
});

test("each contract and table has an independent disclosure and all columns come from schema",()=>{
  const page=readFileSync(new URL("../../docs/spacetimedb/index.html",import.meta.url),"utf8");
  assert.equal((page.match(/class="contract-item"/g)??[]).length,contractRows.length);
  assert.equal((page.match(/class="schema-item"/g)??[]).length,Object.keys(tableNotes).length);
  for(const [id] of exampleRows) assert.ok(page.includes(`id="flow-${id}"`));
  const schema=readFileSync(new URL("./schema.ts",import.meta.url),"utf8");
  const columns=[...schema.matchAll(/^  (\w+): .+, \/\/ .+$/gm)];
  for(const [,name] of columns) assert.ok(page.includes(`<td>${name}</td>`),name);
  assert.match(page,/SpacetimeDB 2.10.1/);
  assert.match(page,/not a deployed or integration-tested backend/);
});

test("root and bookmark show the same model-first Nemeia architecture",()=>{
  assert.equal(readFileSync(new URL("../../docs/index.html",import.meta.url),"utf8"),readFileSync(new URL("../../docs/spacetimedb/index.html",import.meta.url),"utf8"));
  for(const path of ["../../docs/index.html","../../docs/spacetimedb/index.html"]){
    const page=readFileSync(new URL(path,import.meta.url),"utf8");
    const ids=[...page.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
    assert.equal(new Set(ids).size,ids.length);
    for(const [,id] of page.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.includes(id));
    assert.doesNotMatch(page,/Core protocol|SpacetimeDB variant|Design variant|<nav class="protocol-nav"/);
    assert.match(page,/<title>Nemeia · Architecture<\/title>/);
    const opening=page.split('<section class="section" id="ownership"')[0];
    assert.doesNotMatch(opening,/SpacetimeDB|YOLOE|SAM3|Typesafe|Laminar/);
    assert.match(opening,/Client context/);
    assert.match(page,/Implementation choices/);
    assert.match(page,/id="clients"/);
    assert.match(page,/ClientSteps/);
    assert.match(page,/SAM3/); assert.match(page,/Typesafe/); assert.match(page,/LLMs/);
    assert.match(page,/YOLOE/); assert.match(page,/Laminar/); assert.match(page,/OpenTelemetry/);
    assert.match(page,/id="tracing"/); assert.match(page,/privacy boundary/);
    assert.match(page,/DecisionContext/); assert.match(page,/TargetSelector/);
    assert.doesNotMatch(page,/<(?:button|form|input)\b/i);
    assert.doesNotMatch(page,/console\.typesafe\.ai\/login|herculesggimenes|TYPESAFE_API_KEY/);
    for(const [,script] of page.matchAll(/<script>([\s\S]*?)<\/script>/g)){
      new vm.Script(script);
      assert.doesNotMatch(script,/fetch\(|WebSocket\(|XMLHttpRequest|localStorage/);
    }
  }
});

test("trace profiles support controlled content and a restricted metadata fallback",()=>{
  assert.deepEqual(laminarInitialization.instrumentModules,{});
  assert.equal(laminarInitialization.disableBatch,false);
  assert.equal(decisionSpanOptions.ignoreInput,false);
  assert.equal(decisionSpanOptions.ignoreOutput,false);
  assert.equal(metadataSpanOptions.ignoreInput,true);
  assert.equal(metadataSpanOptions.ignoreOutput,true);
  assert.equal(correlationExample["nemeia.observation_ref"],example.input.id);
  assert.equal(correlationExample["nemeia.context_ref"],example.decisionStage.contextId);
  assert.equal(correlationExample["nemeia.execution_ref"],example.request.executionId);
  assert.equal(correlationExample["nemeia.step_ref"],example.preparedStep.id);
  assert.equal(example.preparedStep.contextId,example.decisionStage.contextId);
  assert.deepEqual(example.preparedStep.changedEntityIds,[example.backpack.id]);
  assert.ok(Object.values(correlationExample).every(value=>["string","number"].includes(typeof value)));
  assert.doesNotMatch(JSON.stringify(correlationExample),/prompt|transcript|https?:|token|capturedAt|positionM/);
});
