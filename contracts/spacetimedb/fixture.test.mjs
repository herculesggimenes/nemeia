import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import * as example from "./example.ts";
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

test("both pages preserve read-only behavior, usable links and inert syntax highlighting",()=>{
  for(const path of ["../../docs/index.html","../../docs/spacetimedb/index.html"]){
    const page=readFileSync(new URL(path,import.meta.url),"utf8");
    const ids=[...page.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
    assert.equal(new Set(ids).size,ids.length);
    for(const [,id] of page.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.includes(id));
    assert.match(page,/href="\/spacetimedb\/"/);
    assert.match(page,/SAM3/); assert.match(page,/Typesafe/); assert.match(page,/LLMs/);
    assert.match(page,/DecisionContext/); assert.match(page,/TargetSelector/);
    assert.doesNotMatch(page,/<(?:button|form|input)\b/i);
    assert.doesNotMatch(page,/console\.typesafe\.ai\/login|herculesggimenes|TYPESAFE_API_KEY/);
    for(const [,script] of page.matchAll(/<script>([\s\S]*?)<\/script>/g)){
      new vm.Script(script);
      assert.doesNotMatch(script,/fetch\(|WebSocket\(|XMLHttpRequest|localStorage/);
    }
  }
});
