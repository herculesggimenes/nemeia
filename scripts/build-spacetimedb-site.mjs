import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { ownership, objectRows, contractRows, tableNotes, exampleRows, failureRows } from "../docs/spacetimedb-content.mjs";
import { renderIntelligence } from "../docs/intelligence-content.mjs";
import { renderTracing } from "../docs/tracing-content.mjs";
import { renderClients } from "../docs/client-content.mjs";
import { renderMissions } from "../docs/mission-content.mjs";
import { missionsContractCode } from "../docs/mission-model-content.mjs";
import { renderAgents } from "../docs/agent-content.mjs";
import { renderEve } from "../docs/eve-content.mjs";
import { renderWorldPlan, objectCode, objectPlanningCode, worldMemoryCode, coordinationCode, plannedTables, v0FlowCode } from "../docs/world-view-content.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = path => readFileSync(resolve(root,path),"utf8");
const escape = value => String(value).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
const slug = value => value.toLowerCase().replace(/[^a-z0-9]+/g,"-");
const region = (source,name) => {
  const match = source.match(new RegExp(`// region ${name}\\n([\\s\\S]*?)// endregion`));
  if (!match) throw new Error(`Missing region ${name}`);
  return match[1].trim();
};
const summary = (kind,index,title,description) => `<summary><span class="${kind}-index">${String(index+1).padStart(2,"0")}</span><span><span class="${kind}-title">${escape(title)}</span><span class="${kind}-summary">${escape(description)}</span></span><span class="${kind}-toggle" aria-hidden="true"></span></summary>`;
const codeRow = (kind,index,title,description,prose,code,id) => `<details class="${kind}-item" id="${id}">${summary(kind,index,title,description)}<div class="${kind}-body"><div class="${kind}-description"><p>${escape(prose)}</p></div><div class="${kind}-code"><pre><code class="language-ts">${escape(code)}</code></pre></div></div></details>`;
const proseRow = (index,title,description,prose,example="") => `<details class="abstraction" id="${slug(title)}"><summary><span class="abstraction-index">${String(index+1).padStart(2,"0")}</span><span><span class="abstraction-title">${escape(title)}</span><span class="abstraction-summary">${escape(description)}</span></span><span class="toggle" aria-hidden="true"></span></summary><div class="abstraction-body"><p>${escape(prose)}</p><code>${escape(example)}</code></div></details>`;
const section = (id,number,title,description,body) => `<section class="section" id="${id}" aria-labelledby="${id}-title"><div class="section-inner"><div class="section-intro"><div><div class="section-label">${number} / ${escape(title)}</div><h2 id="${id}-title">${escape(title)}</h2></div><p>${escape(description)}</p></div>${body}</div></section>`;
const sources = Object.fromEntries(["values","contracts","schema","example"].map(name=>[name,read(`contracts/spacetimedb/${name}.ts`)]));

// Reuse unchanged SDK columns; explicit documentation-only planning deltas are not implemented schema.
const tables = plannedTables([...sources.schema.matchAll(/export const (\w+) = table\(\{ name: "([^"]+)", public: false \}, \{\n([\s\S]*?)\n\}\);/g)].map(([,accessor,name,body]) => ({accessor,name,columns:body.split("\n").map(line=>{
  const match = line.match(/^\s+(\w+): (.+), \/\/ (.+)$/);
  if (!match) throw new Error(`Undocumented column in ${name}: ${line}`);
  const [,column,builder,description] = match;
  const constraints = [...builder.matchAll(/\.(primaryKey|unique|autoInc|index)\([^)]*\)/g)].map(m=>({primaryKey:"PK",unique:"unique",autoInc:"auto",index:"indexed"}[m[1]]));
  const type = builder.replace(/\.(primaryKey|unique|autoInc|index)\([^)]*\)/g,"").replace(/t\.option\((.*)\)/,"Option<$1>").replace(/t\.(\w+)\(\)/g,"$1").replace("identity","Identity").replace("timestamp","Timestamp").replace("actionBinding.rowType","ActionBinding");
  return [column,type,`${constraints.length ? constraints.join(", ")+". " : ""}${description}`];
})})));
if (tables.length !== Object.keys(tableNotes).length) throw new Error("Table descriptions differ from schema");
const tableHtml = tables.map((item,i)=>{
  const [description,notes]=tableNotes[item.name];
  return `<details class="schema-item" id="table-${item.name}">${summary("schema",i,item.name,description)}<div class="schema-body"><div class="column-table-wrap" tabindex="0" role="region" aria-label="${item.name} columns"><table class="column-table"><thead><tr><th scope="col">Name</th><th scope="col">Type</th><th scope="col">Description</th></tr></thead><tbody>${item.columns.map(row=>`<tr>${row.map(cell=>`<td>${escape(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></div><p class="reference-note">${escape(notes)}</p></div></details>`;
}).join("\n");

const diagram = `<section class="diagram-section" id="how-it-works" aria-label="Nemeia model"><div class="diagram-inner section-inner"><h1 class="section-label">Nemeia / architecture</h1><div class="diagram-shell"><div class="diagram-header"><span class="diagram-label">WORLD AND DECISION LOOP</span></div><div class="diagram">${[
  ["Perception","Camera, depth, audio and telemetry become evidence.","observe + associate"],
  ["World","Durable entities, evidence, mission progress and local map revisions.","retain → refine → recover"],
  ["Awareness","Automatic Unit observations; nearby state when a usable frame exists.","subscriptions → bounded context"],
  ["Agents","Agents use world context to coordinate missions and propose actions.","context → decision → intent"],
  ["Execution","Admission checks authority and evidence; local systems control Units.","validate → execute → measure"],
].map(([title,description,code],i)=>`${i?'<div class="diagram-arrow" aria-hidden="true"></div>':""}<div class="diagram-node"><span class="node-meta">0${i+1}</span><strong>${title}</strong><p>${description}</p><code>${escape(code)}</code></div>`).join("")}</div><div class="diagram-foot"><div><strong>Feedback → world</strong><p>Measurements update the world. Intent, predictions and sent commands never stand in for observed outcomes.</p></div><div><strong>Trace the whole step</strong><p>Inspect compiled context, selected evidence, model inputs, outputs and action results under a controlled capture policy.</p></div></div></div></div></section>`;

const platform = [
  ["reducer","Native reducer · cancel_execution","atomic lifecycle change and audit","Cancellation intent and its audit event commit in one transaction. The controller confirms safe closure separately; recording cancellation does not prove that hardware has stopped."],
  ["view","Native view · visible_executions","authorization on the server","Private base tables stay inaccessible to ordinary clients. This public view returns only rows permitted by the authenticated member role. Apply the same membership boundary to world read views and dedicated worker projections; a client-side WHERE filter is not access control."],
].map(([id,title,summary,description],i)=>codeRow("object",i,title,summary,description,region(sources.schema,id),`sdk-${id}`)).join("\n");
const implementationChoices = `<div class="abstraction-list">${[
  ["World storage · SpacetimeDB", "typed state, atomic changes and subscriptions", "Typed tables retain current world state and checkpoint metadata. Immutable map chunks and evidence stay in retained blob storage. Reducers validate atomic changes; authorized subscriptions maintain read caches. World records and retained resources recover together after restart.", "world rows + retained map resources → recoverable local knowledge"],
  ["Perception & decisions · specialized workers", "choose tools by task and cadence", "YOLOE handles frequent detection, with SAM3 available for selective refinement. Spatial/audio workers produce structured evidence. Typesafe, LLMs and rules consume prepared context; none owns a separate world or bypasses admission.", "one observation boundary · one action boundary"],
  ["Agent runtime · Eve", "world channel and scoped sandbox", "Eve owns sessions, turns, checkpoints, history and tool orchestration. A custom world channel turns relevant subscription changes into bounded deliveries; just-bash exposes a scoped world projection and trusted domain commands. The adapter owns relevance, authorization and delivery reconciliation.", "subscriptions → Eve channel → just-bash world access → domain admission"],
  ["Diagnostics · Laminar + OpenTelemetry", "inspect application content as well as timing", "Capture approved step context, prompts, responses, selected evidence and tool results in Laminar. OpenTelemetry supplies span structure and propagation. Exclude credentials, bound retention and restrict access; sensitive application content is not automatically forbidden. Export stays outside the control path.", "context + evidence + decisions + outcomes → diagnostic traces"],
].map((row,i)=>proseRow(i,...row)).join("\n")}</div>`;

const subscription = `// Illustrative client fragment after generating bindings for the completed module.
import { DbConnection } from "./module_bindings";

const connection = DbConnection.builder()
  .withUri(worldEndpoint) // trusted deployment setting, not a URL from a model
  .withDatabaseName(worldDatabase)
  .withToken(identityToken) // production identity plus server-side membership
  .withConfirmedReads(true) // do not trade durability for early execution
  .onConnect(conn => {
    conn.subscriptionBuilder()
      .onApplied(() => { /* mark this scope ready; reconcile current state */ })
      .subscribe(["SELECT * FROM visible_executions"]);
  })
  .build();

// Row callbacks mark relevant state dirty; world-managed awareness decides when to prepare context.
// UI reads the SDK cache directly. A reasoning worker freezes a projection before inference.
// Controller clients reconcile rows and claim authorized work; delivery is never a motor command.
// Initial inserts also occur on subscription/reconnect; they are not new-execution events.
// Generate bindings instead of maintaining a second handwritten HTTP/snapshot/delta client.`;
const readRows = `<div class="architecture-rows">${[
  ["UI / decision worker", "Authorized missions, retained entities, local maps, components and outcomes. Nemeia derives the agent's interests from Unit assignments, direct observations and world-managed awareness policy. UIs render the cache; the adapter freezes a bounded context before inference."],
  ["Controller", "Its robot's executions and necessary unit/target evidence. Private tables plus scoped views; no subscribeToAllTables shortcut."],
  ["Freshness", "Subscriptions update when data changes. Evidence can become stale without a write, so evaluate acquisition timestamps with the current world clock."],
  ["History", "Read bounded audit pages through an authorized history boundary when needed. Audit sequence is not the SDK subscription cursor; a reconnect gives current state, not missed transitions."],
].map(([title,body])=>`<div class="architecture-row"><strong>${title}</strong><div>${escape(body)}</div></div>`).join("")}</div>`;

const refs = [
  ["Local coordinate frames","https://raw.githubusercontent.com/ros-infrastructure/rep/master/rep-0105.rst","ROS reference for independent mobile-platform frames; local operation need not wait for global localization."],
  ["Collaborative mapping reference","https://arxiv.org/html/2211.01538","D²SLAM: local frames, discovery, near/far estimation and evidence-backed alignment."],
  ["Reducers","https://spacetimedb.com/docs/functions/reducers/","Atomic module operations; no external IO inside reducers."],
  ["Views","https://spacetimedb.com/docs/functions/views/","Read-only projections with caller identity."],
  ["Subscription semantics","https://spacetimedb.com/docs/clients/subscriptions/semantics/","Consistent initialization and atomic committed cache updates."],
  ["TypeScript SDK","https://spacetimedb.com/docs/clients/typescript/","Generated clients, connections and subscription APIs."],
  ["Durability and event tables","https://spacetimedb.com/docs/upgrade/","Confirmed reads and the distinction between transient events and persisted tables."],
  ["Table storage","https://spacetimedb.com/docs/tables/","Typed, memory-resident state with durable backing."],
  ["Engine license","https://github.com/clockworklabs/SpacetimeDB/blob/master/LICENSE.txt","Verify release-specific deployment terms before fleet use."],
];
const main = `<main id="main-content">${diagram}
${section("ownership","01","Foundations & ownership","The world foundations, mission intent and operating roles. Units are controllable entities; agents decide; World Masters govern; systems implement the work.",`<div class="abstraction-list">${ownership.map((row,i)=>proseRow(i,...row)).join("\n")}</div>`)}
${section("objects","02","Objects & world view","WorldView projects durable entities, evidence, local maps, missions and executions. Each spatial estimate retains its coordinate frame and acquisition time.",`<div class="object-list">${objectRows.map(([file,id,title,summary,description],i)=>codeRow("object",i,title,summary,description,objectPlanningCode(id,objectCode[id] ?? region(sources[file],id)),`object-${id}`)).join("\n")}</div>`)}
${renderWorldPlan({section,proseRow})}
${renderMissions({section,codeRow,proseRow,region})}
${renderAgents({section,proseRow})}
${section("contracts","03","Service contracts","Typed boundaries for world storage, perception, missions, coordination and execution. Each contract defines authority, validation and retry behavior; it need not be a separate microservice.",`<div class="contract-list">${contractRows.map(([id,title,summary,description],i)=>codeRow("contract",i,title,summary,description,id === "world-memory" ? worldMemoryCode : id === "missions" ? missionsContractCode : id === "coordination" ? coordinationCode : region(sources.contracts,id),`contract-${id}`)).join("\n")}</div>`)}
${section("tables","04","Database tables",`${tables.length} private tables hold world records, local maps, assignments, progress and execution receipts. Authorized views expose the relevant state to each client. Eve owns conversation and runtime persistence.`,`<div class="schema-list">${tableHtml}</div>`)}
${section("platform","05","Implementation choices","Storage, inference, agent runtime and tracing support the domain model through explicit boundaries.",`${implementationChoices}<div class="object-list">${platform}</div>${readRows}${codeRow("example",0,"Subscribe and reconcile","generated client pattern","Generated bindings expose authorized views. Subscription initialization and committed changes update the local cache; clients reconcile current state before acting.",subscription,"sdk-subscribe")}`)}
${renderIntelligence({section,codeRow,proseRow,region},"06")}
${renderClients({section,codeRow,proseRow,region},"06b")}
${renderEve({section,codeRow,proseRow},"06c")}
${section("example","07","End-to-end information flow","Find a blue backpack and inspect the kitchen passage. One agent coordinates both missions, navigates Go2 to a useful viewpoint, and turns shared observations into independently accepted findings.",`<div class="example-list">${exampleRows.map(([id,title,summary,description],i)=>codeRow("example",i,title,summary,description,v0FlowCode[id],`flow-${id}`)).join("\n")}</div>`)}
${renderTracing({section,codeRow,proseRow,region},"08")}
${section("boundaries","09","Failure & deployment boundaries","A fast shared-state engine does not remove uncertainty, authority checks, network failures or robot-local safety responsibilities.",`<div class="abstraction-list">${failureRows.map((row,i)=>proseRow(i,...row)).join("\n")}</div>`)}
${section("references","10","Implementation references","This document specifies intended architecture, not deployment status. Interfaces and examples describe the contracts; production use requires integration, security and failure testing.",`<div class="architecture-rows">${refs.map(([title,url,description])=>`<div class="architecture-row"><strong><a href="${url}">${title}</a></strong><div>${escape(description)}</div></div>`).join("")}</div>`)}
</main>`;

const shell=read("docs/index.html");
const html=shell.replace(/<main id="main-content">[\s\S]*?<\/main>/,main)
  .replace(/<title>[^<]*<\/title>/,"<title>Nemeia · Architecture</title>")
  .replace(/<meta name="description" content="[^"]*">/,'<meta name="description" content="Nemeia architecture: durable world state, local maps, missions, agents, Unit control, service contracts and evidence-backed execution.">');
// One architecture. Preserve the existing /spacetimedb/ bookmark as an identical alias.
for (const path of ["docs/index.html","dist/index.html","docs/spacetimedb/index.html","dist/spacetimedb/index.html"]) {
  if(process.argv.includes("--check")) {
    if(read(path)!==html) throw new Error(`Out of date: ${path}`);
  } else { mkdirSync(resolve(root,path,".."),{recursive:true}); writeFileSync(resolve(root,path),html); }
}
console.log(`SpacetimeDB page synchronized: ${tables.length} tables, ${contractRows.length} contracts, ${exampleRows.length} flow stages.`);
