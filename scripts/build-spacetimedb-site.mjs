import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { ownership, objectRows, contractRows, tableNotes, exampleRows, failureRows } from "../docs/spacetimedb-content.mjs";
import { renderIntelligence } from "../docs/intelligence-content.mjs";
import { renderTracing } from "../docs/tracing-content.mjs";
import { renderClients } from "../docs/client-content.mjs";
import { renderMissions } from "../docs/mission-content.mjs";
import { renderAgents } from "../docs/agent-content.mjs";

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

// Derive every column/type/description from the checked SDK schema, not a second handwritten schema.
const tables = [...sources.schema.matchAll(/export const (\w+) = table\(\{ name: "([^"]+)", public: false \}, \{\n([\s\S]*?)\n\}\);/g)].map(([,accessor,name,body]) => ({accessor,name,columns:body.split("\n").map(line=>{
  const match = line.match(/^\s+(\w+): (.+), \/\/ (.+)$/);
  if (!match) throw new Error(`Undocumented column in ${name}: ${line}`);
  const [,column,builder,description] = match;
  const constraints = [...builder.matchAll(/\.(primaryKey|unique|autoInc|index)\([^)]*\)/g)].map(m=>({primaryKey:"PK",unique:"unique",autoInc:"auto",index:"indexed"}[m[1]]));
  const type = builder.replace(/\.(primaryKey|unique|autoInc|index)\([^)]*\)/g,"").replace(/t\.option\((.*)\)/,"Option<$1>").replace(/t\.(\w+)\(\)/g,"$1").replace("identity","Identity").replace("timestamp","Timestamp").replace("actionBinding.rowType","ActionBinding");
  return [column,type,`${constraints.length ? constraints.join(", ")+". " : ""}${description}`];
})}));
if (tables.length !== Object.keys(tableNotes).length) throw new Error("Table descriptions differ from schema");
const tableHtml = tables.map((item,i)=>{
  const [description,notes]=tableNotes[item.name];
  return `<details class="schema-item" id="table-${item.name}">${summary("schema",i,item.name,description)}<div class="schema-body"><div class="column-table-wrap" tabindex="0" role="region" aria-label="${item.name} columns"><table class="column-table"><thead><tr><th scope="col">Name</th><th scope="col">Type</th><th scope="col">Description</th></tr></thead><tbody>${item.columns.map(row=>`<tr>${row.map(cell=>`<td>${escape(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></div><p class="reference-note">${escape(notes)}</p></div></details>`;
}).join("\n");

const diagram = `<section class="diagram-section" id="how-it-works" aria-label="Nemeia model"><div class="diagram-inner section-inner"><h1 class="section-label">Nemeia / architecture</h1><div class="diagram-shell"><div class="diagram-header"><span class="diagram-label">WORLD AND DECISION LOOP</span><span>observation, decision and control run independently</span></div><div class="architecture-rows"><div class="architecture-row"><strong>World Masters</strong><div>Set missions → assign agent teams → grant Unit control and visibility.</div></div><div class="architecture-row"><strong>Agents · Units · Systems</strong><div>Agents coordinate Units to achieve shared objectives. Units are controllable entities. Systems handle perception, pathfinding and execution.</div></div></div><div class="diagram">${[
  ["Perception","Camera, depth, audio and telemetry become evidence.","observe + associate"],
  ["World","Shared entities, mission progress, assignments and outcomes.","facts + intent + authority"],
  ["Subscriptions","Scoped changes and team messages feed each agent's inbox.","many interests → one inbox"],
  ["Agents","Collaborate; compile context when useful; choose eligible Units.","context → proposed action"],
  ["Execution","Systems validate, reserve the Unit and execute under local limits.","admit → execute → measure"],
].map(([title,description,code],i)=>`${i?'<div class="diagram-arrow" aria-hidden="true"></div>':""}<div class="diagram-node"><span class="node-meta">0${i+1}</span><strong>${title}</strong><p>${description}</p><code>${escape(code)}</code></div>`).join("")}</div><div class="diagram-foot"><div><strong>Feedback → world</strong><p>Measurements update the world. Intent, predictions and sent commands never stand in for observed outcomes.</p></div><div><strong>Trace the whole step</strong><p>Inspect compiled context, selected evidence, model inputs, outputs and action results under a controlled capture policy.</p></div></div></div></div></section>`;

const platform = [
  ["module","Native module schema",`${tables.length} private tables, one state owner`,"Checked against the pinned SpacetimeDB 2.10.1 TypeScript SDK. These are schema and function examples, not a deployed or integration-tested backend."],
  ["reducer","Native reducer · cancel_execution","atomic lifecycle change and audit","This concrete SDK example shows a real transaction boundary. It records cancellation intent, not a claim that hardware has stopped. The other reducer behaviors are design contracts to implement."],
  ["view","Native view · visible_executions","authorization on the server","Private base tables stay inaccessible to ordinary clients. This public view returns only rows permitted by the authenticated member role. Apply the same membership boundary to world read views and dedicated worker projections; a client-side WHERE filter is not access control."],
].map(([id,title,summary,description],i)=>codeRow("object",i,title,summary,description,region(sources.schema,id),`sdk-${id}`)).join("\n");
const implementationChoices = `<div class="abstraction-list">${[
  ["World storage · SpacetimeDB", "selected implementation, not a Nemeia primitive", "Typed tables persist the shared world. Reducers validate atomic changes; authorized subscriptions maintain consistent read caches. The SDK examples below show this binding. Nemeia's entities, evidence, actions and ownership rules define the model; adopting another backend would still have to preserve those guarantees.", "World → tables · writes → reducers · readers → subscriptions"],
  ["Perception & decisions · specialized workers", "choose tools by task and cadence", "YOLOE handles frequent detection, with SAM3 available for selective refinement. Spatial/audio workers produce structured evidence. Typesafe, LLMs and rules consume prepared context; none owns a separate world or bypasses admission. These integrations are specified, not connected by this page.", "one observation boundary · one action boundary"],
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

// Row callbacks mark relevant state dirty; the client's wake policy decides when to prepare context.
// UI reads the SDK cache directly. A reasoning worker freezes a projection before inference.
// Controller clients reconcile rows and claim authorized work; delivery is never a motor command.
// Initial inserts also occur on subscription/reconnect; they are not new-execution events.
// Generate bindings instead of maintaining a second handwritten HTTP/snapshot/delta client.`;
const readRows = `<div class="architecture-rows">${[
  ["UI / decision worker", "Authorized views of missions, objective credits, live entities, components, relations and action bindings. Each client selects its relevant scope. UIs render the cache; reasoning workers prepare detached mission context at their own cadence."],
  ["Controller", "Its robot's executions and necessary unit/target evidence. Private tables plus scoped views; no subscribeToAllTables shortcut."],
  ["Freshness", "Subscriptions update when data changes. Evidence can become stale without a write, so evaluate acquisition timestamps with the current world clock."],
  ["History", "Read bounded audit pages through an authorized history boundary when needed. Audit sequence is not the SDK subscription cursor; a reconnect gives current state, not missed transitions."],
].map(([title,body])=>`<div class="architecture-row"><strong>${title}</strong><div>${escape(body)}</div></div>`).join("")}</div>`;

const refs = [
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
${section("objects","02","Objects & world view","Typed geometry, independently timed evidence, a narrow action contract and a read-only world projection.",`<div class="object-list">${objectRows.map(([file,id,title,summary,description],i)=>codeRow("object",i,title,summary,description,region(sources[file],id),`object-${id}`)).join("\n")}</div>`)}
${renderMissions({section,codeRow,proseRow,region})}
${renderAgents({section,proseRow})}
${section("contracts","03","Service contracts","Each boundary has one owner. These interfaces specify behavior, not separate microservices. The selected database binding implements world writes as reducers.",`<div class="contract-list">${contractRows.map(([id,title,summary,description],i)=>codeRow("contract",i,title,summary,description,region(sources.contracts,id),`contract-${id}`)).join("\n")}</div>`)}
${section("tables","04","Database tables",`The selected SpacetimeDB implementation maps this model to ${tables.length} private tables, including shared missions, agents, Unit assignments, subscription policies and addressed messages. Columns come from the checked schema; durable worker inbox/step storage remains separate.`,`<div class="schema-list">${tableHtml}</div>`)}
${section("platform","05","Implementation choices","Concrete tools underneath the model. These are implementation targets, not live integrations or new foundational abstractions.",`${implementationChoices}<div class="object-list">${platform}</div>${readRows}${codeRow("example",0,"Subscribe and reconcile","generated client pattern","This consumer fragment assumes generated bindings for the completed module. Only schema/function examples and domain fixtures are type-checked here; connection behavior still requires a running-server integration test.",subscription,"sdk-subscribe")}`)}
${renderIntelligence({section,codeRow,proseRow,region},"06")}
${renderClients({section,codeRow,proseRow,region},"06b")}
${section("example","07","End-to-end information flow","A World Master assigns one mission to Navigator and Scene analyst. They collaborate; Navigator selects its Go2 Unit for approach. Static, type-checked fixtures follow evidence, team messages, scheduling, execution and shared mission completion. They perform no IO.",`<div class="example-list">${exampleRows.map(([id,title,summary,description],i)=>codeRow("example",i,title,summary,description,region(sources.example,id),`flow-${id}`)).join("\n")}</div>`)}
${renderTracing({section,codeRow,proseRow,region},"08")}
${section("boundaries","09","Failure & deployment boundaries","A fast shared-state engine does not remove uncertainty, authority checks, network failures or robot-local safety responsibilities.",`<div class="abstraction-list">${failureRows.map((row,i)=>proseRow(i,...row)).join("\n")}</div>`)}
${section("references","10","Implementation references","The schema and fixtures are checked examples. World services, durable client steps, controlled content tracing and robot-local execution still require integration and failure testing.",`<div class="architecture-rows">${refs.map(([title,url,description])=>`<div class="architecture-row"><strong><a href="${url}">${title}</a></strong><div>${escape(description)}</div></div>`).join("")}</div>`)}
</main>`;

const shell=read("docs/index.html");
const html=shell.replace(/<main id="main-content">[\s\S]*?<\/main>/,main)
  .replace(/<title>[^<]*<\/title>/,"<title>Nemeia · Architecture</title>")
  .replace(/<meta name="description" content="[^"]*">/,'<meta name="description" content="Nemeia: perception, shared world state, missions and objectives, client subscriptions, decisions, bounded execution and end-to-end tracing.">');
// One architecture. Preserve the existing /spacetimedb/ bookmark as an identical alias.
for (const path of ["docs/index.html","dist/index.html","docs/spacetimedb/index.html","dist/spacetimedb/index.html"]) {
  if(process.argv.includes("--check")) {
    if(read(path)!==html) throw new Error(`Out of date: ${path}`);
  } else { mkdirSync(resolve(root,path,".."),{recursive:true}); writeFileSync(resolve(root,path),html); }
}
console.log(`SpacetimeDB page synchronized: ${tables.length} tables, ${contractRows.length} contracts, ${exampleRows.length} flow stages.`);
