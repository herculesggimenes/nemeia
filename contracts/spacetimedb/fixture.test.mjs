import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import * as example from "./example.ts";
import { correlationExample, laminarInitialization, decisionSpanOptions, metadataSpanOptions } from "./tracing.ts";
import { contractRows, tableNotes, exampleRows } from "../../docs/spacetimedb-content.mjs";
import { inspectionSpec } from "./missions.ts";
import ts from "../../frontend/node_modules/typescript/lib/typescript.js";
import { fileURLToPath } from "node:url";
import { missionCode, missionViewCode, missionLogCode, missionsContractCode } from "../../docs/mission-model-content.mjs";
import { v0FlowCode, objectPlanningCode, objectCode, worldMemoryCode } from "../../docs/world-view-content.mjs";
import { spatialTypesCode, navigationCode } from "../../docs/spatial-model-content.mjs";

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
  const { request, accepted, running, succeeded, reservedUnit, localStarted, localClosed, finalUnit, finalTarget, completion }=example;
  for(const row of [accepted,running,succeeded]) assert.equal(row.id,request.executionId);
  assert.equal(reservedUnit.activeExecutionId,running.id);
  assert.equal(localStarted.controllerEpoch,running.controllerEpoch);
  assert.equal(localClosed.safeState,"confirmed");
  const unit=finalUnit.value.positionM;
  const target=finalTarget.value.value.pose.positionM;
  assert.ok(Math.abs(Math.hypot(target.x-unit.x,target.y-unit.y)-completion.value.distanceM)<1e-9);
  assert.equal(completion.value.unitObservationId,finalUnit.observationId);
  assert.equal(completion.value.targetObservationId,finalTarget.observationId);
  assert.ok(succeeded.updatedAt.microsSinceUnixEpoch>finalTarget.observedAt.microsSinceUnixEpoch);
});

test("each planned contract and table has an independent disclosure",()=>{
  const page=readFileSync(new URL("../../docs/spacetimedb/index.html",import.meta.url),"utf8");
  assert.equal((page.match(/class="contract-item"/g)??[]).length,contractRows.length);
  assert.equal((page.match(/class="schema-item"/g)??[]).length,Object.keys(tableNotes).length);
  for(const [id] of exampleRows) assert.ok(page.includes(`id="flow-${id}"`));
  for(const name of ["rootFrameId","headRevisionId","parentRevision","manifest","awarenessPolicy"]) assert.ok(page.includes(`<td>${name}</td>`),name);
  assert.match(page,/This document specifies intended architecture, not deployment status/);
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
    assert.match(opening,/<strong>Awareness<\/strong>/);
    assert.doesNotMatch(opening,/<strong>Client context<\/strong>/);
    assert.match(page,/Implementation choices/);
    assert.match(page,/id="clients"/);
    assert.match(page,/id="clients-title">Client subscriptions/);
    assert.match(page,/id="subscription-scope"/);
    assert.match(page,/id="decisions-feedback"/);
    assert.match(page,/WorldWake/);
    assert.match(page,/id="eve-runtime"/);
    assert.match(page,/World channel adapter/);
    assert.match(page,/customCommands/);
    assert.match(page,/no network isolation/);
    assert.doesNotMatch(page,/interface AgentSteps|interface PreparedStep|interface AgentRuntime/);
    assert.match(page,/id="missions"/);
    assert.match(page,/id="contract-missions"/);
    assert.match(page,/id="object-mission-view"/);
    assert.match(page,/id="table-mission_objective_progress"/);
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

test("subscription fixture gives the prepared step independent pending-work arrays",()=>{
  const { subscribedAgent, preparedStep, decisionStage } = example;
  assert.equal(subscribedAgent.ready,true);
  assert.equal(subscribedAgent.wakeReason,"message");
  assert.equal(preparedStep.agentId,subscribedAgent.agentId);
  assert.deepEqual(preparedStep.changedEntityIds,subscribedAgent.changedEntityIds);
  assert.notEqual(preparedStep.changedEntityIds,subscribedAgent.changedEntityIds);
  assert.deepEqual(preparedStep.eventIds,subscribedAgent.eventIds);
  assert.notEqual(preparedStep.eventIds,subscribedAgent.eventIds);
  assert.equal(decisionStage.contextId,preparedStep.contextId);
  assert.equal(subscribedAgent.missionId,example.activeMission.id);
  assert.equal(preparedStep.missionRevision,example.assignedMission.revision);
  const clients=readFileSync(new URL("../../docs/client-content.mjs",import.meta.url),"utf8");
  assert.match(clients,/Subscription access never grants execution permission/);
  assert.match(clients,/not every subscriber needs a durable inbox/);
});

test("mission fixtures connect intent, action, objective proof and safe completion",()=>{
  const { activeMission, request, accepted, succeeded, approachCredit, closingMission, completedMission, localClosed }=example;
  assert.equal(request.mission.missionId,activeMission.id);
  assert.equal(request.mission.expectedRevision,example.assignedMission.revision);
  assert.equal(accepted.missionId,activeMission.id);
  const objective=activeMission.spec.objectives.find(o=>o.id===request.mission.objectiveId);
  assert.equal(objective.criterion.tag,"approached");
  assert.deepEqual(objective.criterion.value,{targetId:request.targetId,standoffM:request.standoffM});
  assert.equal(approachCredit.key,JSON.stringify([activeMission.id,objective.id]));
  assert.equal(approachCredit.evidence.value.executionId,succeeded.id);
  assert.equal(closingMission.state.tag,"closing");
  assert.equal(completedMission.state.tag,"succeeded");
  assert.equal(localClosed.safeState,"confirmed");
  assert.ok(accepted.createdAt.microsSinceUnixEpoch>=activeMission.createdAt.microsSinceUnixEpoch);
  assert.ok(approachCredit.recordedAt.microsSinceUnixEpoch>=succeeded.updatedAt.microsSinceUnixEpoch);
  assert.ok(completedMission.updatedAt.microsSinceUnixEpoch<activeMission.spec.deadlineAt.microsSinceUnixEpoch);
  for (const field of ["actorIds","unitIds","maxLinearMps","maxRunMs"]) assert.ok(!(field in activeMission.spec));
  assert.ok(accepted.binding.maxLinearMps>0);
  assert.ok(accepted.binding.maxRunMs>0);
});

test("shared mission, Unit grant, addressed advice and independent subscription policies are distinct",()=>{
  const {team,navigator,analyst,go2Assignment,advice,subscriptions,request,accepted,scheduling,assignedMission,activeMission}=example;
  assert.deepEqual(new Set(team.map(row=>row.agentId)),new Set([navigator.id,analyst.id]));
  assert.ok(team.every(row=>row.missionId===activeMission.id && row.active));
  assert.equal(assignedMission.revision,activeMission.revision+BigInt(team.length));
  assert.equal(request.assignment.agentId,go2Assignment.agentId);
  assert.equal(request.assignment.revision,go2Assignment.revision);
  assert.equal(request.unitId,go2Assignment.unitId);
  assert.ok(go2Assignment.actionNames.includes("approach@1"));
  assert.ok(accepted.requestedBy.isEqual(navigator.principal));
  assert.equal(accepted.agentId,navigator.id);
  assert.notEqual(go2Assignment.agentId,analyst.id);
  assert.equal(advice.fromAgentId,analyst.id);
  assert.equal(advice.toAgentId,navigator.id);
  assert.deepEqual(example.preparedStep.eventIds,[advice.id]);
  assert.ok(subscriptions.length>1 && subscriptions.every(row=>row.agentId===navigator.id));
  assert.notEqual(subscriptions[0].policy.minIntervalMs,subscriptions[1].policy.minIntervalMs);
  assert.deepEqual(scheduling.map(row=>row.state),["idle","ready","thinking","waiting"]);
});

test("published design includes roles, authority fences and separate cadences without old Actor vocabulary",()=>{
  const page=readFileSync(new URL("../../docs/index.html",import.meta.url),"utf8");
  for(const id of ["unit","agent","world-master","teams","contract-world-masters","contract-coordination","object-unit-agent-view","object-agent-scope","object-agent-runtime","table-agent","table-mission_agent","table-unit_assignment","table-local_map","table-agent_message"]){
    assert.ok(page.includes(`id="${id}"`),id);
  }
  assert.doesNotMatch(page,/actorId|ActorView|robot_control|ClientSteps|owner\/admin|Owner\/admin|mission speed/);
  const agentSource=readFileSync(new URL("../../docs/agent-content.mjs",import.meta.url),"utf8");
  assert.match(agentSource,/read scope ≠ Unit control grant ≠ execution reservation/);
  assert.match(agentSource,/until the local executor confirms safe closure/);
});

test("architecture documents durable local knowledge, automatic awareness and recovery",()=>{
  const page=readFileSync(new URL("../../docs/index.html",import.meta.url),"utf8");
  for(const id of ["local-world","object-local-map","object-world-view","contract-world-memory","table-spatial_frame","table-map_revision","flow-resume"]) assert.ok(page.includes(`id="${id}"`),id);
  assert.doesNotMatch(page,/putSubscription|id="table-agent_subscription"|world-frame 3D box|Shared frame, e\.g\. map/);
  const worldView=page.split('id="object-world-view"')[1].split('</details>')[0];
  assert.match(worldView,/localMaps/); assert.match(worldView,/poses:/);
  const flow=page.split('id="example"')[1].split('<section class="section" id="tracing"')[0];
  assert.match(flow,/relocalization_required/);
  assert.match(flow,/mission-2/);
  assert.match(flow,/satisfies MissionSpec/);
  assert.match(flow,/recordObjectiveProgress/);
  for (const text of ["Find the blue backpack", "Inspect the passage", "satisfies MissionFinding", "satisfies NavigateRequest", "World Master reviews", "obstructed", "obs-2"]) assert.ok(flow.includes(text), text);
  assert.doesNotMatch(flow,/Acquire a fresh semantic observation|Acquire a fresh local geometry measurement/);
  assert.ok(page.includes('id="object-mission-finding"'));
  assert.ok(page.includes('id="object-mission-place"'));
  assert.ok(page.includes('id="flow-discovery"'));
  assert.match(v0FlowCode.mission, /searchArea: \{ tag: "description", value: \{ text: "the living area" \} \}/);
  assert.match(v0FlowCode.mission, /region: \{ tag: "description", value: \{ text: "the passage to the kitchen" \} \}/);
  assert.doesNotMatch(v0FlowCode.mission, /searchAreaId:|regionId:|entityId:/);
  assert.match(v0FlowCode.navigation, /targetPose:/);
  assert.match(v0FlowCode.discovery, /kind: "occupancy"/);
  assert.doesNotMatch(flow, /opening-1|firstSurvey|sizeM: \[0.4, 0.3, 0.7\]/);
  assert.match(v0FlowCode.inputs, /tag: "pointCloud"/);
  assert.match(v0FlowCode.naming, /satisfies LocalMapManifest/);
  assert.match(v0FlowCode.findings, /regionRevision: 1n/);
  for (const id of ["object-spatial-map", "object-navigation", "table-region", "flow-naming"]) assert.ok(page.includes(`id="${id}"`), id);
  assert.match(v0FlowCode.findings, /searchAreaId: "space-1"/);
  assert.match(v0FlowCode.findings, /regionId: "passage-1"/);
  assert.doesNotMatch(flow, /regions are already named|resolve them before accepting|targetId: &quot;kitchen-doorway&quot;/);
  assert.doesNotMatch(page,/local_map_checkpoint|minNewObservations|spec\.goal|goal:|creditObjective|id="table-mission_credit"/);
  assert.doesNotMatch(flow,/fromAgentId|toAgentId|analystPrincipal|readScope:/);
  const worldConfig=page.split('id="table-world_config"')[1].split('</details>')[0];
  assert.doesNotMatch(worldConfig,/<td>frameId<\/td>/);
  assert.match(worldConfig,/awarenessPolicy/);
});

test("architecture reads as a reference without release callouts or change-history copy",()=>{
  const page=readFileSync(new URL("../../docs/index.html",import.meta.url),"utf8");
  const opening=page.split('<section class="section" id="ownership"')[0];
  assert.ok(!opening.includes('class="architecture-rows"'),"diagram has no redundant role, log or release callouts");
  assert.ok(!/\bv0\b|(?:first|this) slice|planning.only|release gate|supersedes the scaffold|replaces (goal|the ambiguous)|reviewed against|SpacetimeDB 2\.10\.1|Eve 0\.63\.0/i.test(page),"no editorial release/change-history language");
  for(const label of ["World memory &amp; local maps","MissionSpec","ObjectiveProgress","MissionLog","AgentCoordination","expectedRevision","controllerEpoch"]) assert.ok(page.includes(label),label);
});

test("mission planning examples use the declared description/objectives/log/progress contracts",()=>{
  const page=readFileSync(new URL("../../docs/index.html",import.meta.url),"utf8");
  for(const id of ["description","mission-log","objective-progress","cross-mission-coordination","object-mission-log"]) assert.ok(page.includes(`id="${id}"`),id);
  assert.ok(page.includes("one logical agent can have several assigned missions"));
  assert.doesNotMatch(page,/id="table-mission_log"/); // the log is a view, not duplicated storage
  const path=fileURLToPath(new URL("./mission-plan-check.ts",import.meta.url));
  const source=[
    'import { Identity, Timestamp, t, type Infer } from "spacetimedb";',
    'import type { Row, WorldMasters } from "./contracts.ts";',
    ...["geometry", "evidence"].map(id => objectPlanningCode(id, readFileSync(new URL("./values.ts", import.meta.url), "utf8").split(`// region ${id}\n`)[1].split("// endregion")[0])),
    objectPlanningCode("action", readFileSync(new URL("./values.ts", import.meta.url), "utf8").split("// region action\n")[1].split("// endregion")[0]),
    spatialTypesCode, navigationCode, objectCode["local-map"], worldMemoryCode,
    ...Object.values(missionCode), missionViewCode, missionLogCode, missionsContractCode,
    ...Object.values(v0FlowCode),
  ].join("\n\n");
  const configPath=fileURLToPath(new URL("./tsconfig.json",import.meta.url));
  const config=ts.readConfigFile(configPath,ts.sys.readFile);
  const {options}=ts.parseJsonConfigFileContent(config.config,ts.sys,fileURLToPath(new URL("./",import.meta.url)));
  const host=ts.createCompilerHost(options);
  const read=host.readFile;
  host.readFile=file=>file===path?source:read(file);
  const exists=host.fileExists;
  host.fileExists=file=>file===path||exists(file);
  const program=ts.createProgram([path],options,host);
  const errors=ts.getPreEmitDiagnostics(program);
  assert.equal(errors.length,0,ts.formatDiagnosticsWithColorAndContext(errors,{getCurrentDirectory:host.getCurrentDirectory,getCanonicalFileName:file=>file,getNewLine:()=>"\n"}));
});

test("the mission graph fixture specifies parallel roots and ordered milestones",()=>{
  const objectives=inspectionSpec.objectives;
  const ids=new Set(objectives.map(o=>o.id));
  assert.equal(ids.size,objectives.length);
  assert.ok(objectives.length>0 && objectives.length<=32);
  const visited=new Set();
  const visiting=new Set();
  const visit=id=>{
    assert.ok(!visiting.has(id),"acyclic graph");
    if(visited.has(id)) return;
    visiting.add(id);
    const node=objectives.find(o=>o.id===id);
    for(const dependency of node.dependsOn){
      assert.ok(ids.has(dependency));
      assert.ok(node.optional || !objectives.find(o=>o.id===dependency).optional);
      visit(dependency);
    }
    visiting.delete(id); visited.add(id);
  };
  for(const id of ids) visit(id);
  const ready=completed=>objectives.filter(o=>!completed.includes(o.id) && o.dependsOn.every(id=>completed.includes(id))).map(o=>o.id);
  assert.deepEqual(ready([]),["geometry","semantics"]);
  assert.deepEqual(ready(["geometry"]),["semantics"]);
  assert.deepEqual(ready(["geometry","semantics"]),["approach"]);
  assert.deepEqual(ready(["geometry","semantics","approach"]),["resample"]);
  assert.deepEqual(ready([...ids]),[]);
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
  assert.equal(correlationExample["nemeia.mission_ref"],example.activeMission.id);
  assert.equal(correlationExample["nemeia.agent_ref"],example.navigator.id);
  assert.equal(correlationExample["nemeia.unit_ref"],example.request.unitId);
  assert.equal(example.preparedStep.contextId,example.decisionStage.contextId);
  assert.deepEqual(example.preparedStep.changedEntityIds,[example.backpack.id]);
  assert.ok(Object.values(correlationExample).every(value=>["string","number"].includes(typeof value)));
  assert.doesNotMatch(JSON.stringify(correlationExample),/prompt|transcript|https?:|token|capturedAt|positionM/);
});
