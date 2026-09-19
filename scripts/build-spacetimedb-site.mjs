import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { ownership, objectRows, contractRows, tableNotes, exampleRows, failureRows } from "../docs/spacetimedb-content.mjs";
import { renderIntelligence } from "../docs/intelligence-content.mjs";
import { renderTracing } from "../docs/tracing-content.mjs";

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

const diagram = `<section class="diagram-section" id="how-it-works" aria-label="Nemeia with SpacetimeDB"><div class="diagram-inner section-inner"><h1 class="section-label">Nemeia / SpacetimeDB protocol</h1><p class="reference-note">Implementation target · shared world state, specialized workers, robot-local execution</p><div class="diagram-shell" role="img" aria-label="Sensors feed YOLOE and optional SAM3 perception. SpacetimeDB owns structured world state. Typesafe, LLMs and rules propose actions. Local controllers execute and return measured evidence. Privacy-filtered OpenTelemetry spans go to Laminar, outside the control path."><div class="diagram-header"><span class="diagram-label">WORLD AND DECISION LOOP</span><span>models outside transactions · control outside the database</span></div><div class="diagram">${[
  ["Inputs","Camera, LiDAR, audio, telemetry.","frames + acquisition times"],
  ["Perception","YOLOE frequent; SAM3 selective. Spatial and audio workers.","observations + association"],
  ["SpacetimeDB","Reducers commit typed world state.","tables + authorized subscriptions"],
  ["Decisions","Typesafe, LLMs and rules read the same world.","context → proposed action"],
  ["Execution","Admission and claim; robot-local control.","receipts + measured feedback"],
].map(([title,description,code],i)=>`${i?'<div class="diagram-arrow" aria-hidden="true"></div>':""}<div class="diagram-node"><span class="node-meta">0${i+1}</span><strong>${title}</strong><p>${description}</p><code>${escape(code)}</code></div>`).join("")}</div><div class="diagram-foot"><div><strong>Feedback → world</strong><p>Measured observations return through ingestion. UI reads authorized views; raw media stays elsewhere.</p></div><div><strong>Tracing → Laminar</strong><p>OpenTelemetry spans across workers, decisions and execution. Privacy-filtered; never a control dependency.</p></div></div></div></div></section>`;

const platform = [
  ["module","Native module schema","thirteen private tables, one state owner","Checked against the pinned SpacetimeDB 2.10.1 TypeScript SDK. These are schema and function examples, not a deployed or integration-tested backend."],
  ["reducer","Native reducer · cancel_execution","atomic lifecycle change and audit","This concrete SDK example shows a real transaction boundary. It records cancellation intent, not a claim that hardware has stopped. The other reducer behaviors are design contracts to implement."],
  ["view","Native view · visible_executions","authorization on the server","Private base tables stay inaccessible to ordinary clients. This public view returns only rows permitted by the authenticated member role. Apply the same membership boundary to world read views and dedicated worker projections; a client-side WHERE filter is not access control."],
].map(([id,title,summary,description],i)=>codeRow("object",i,title,summary,description,region(sources.schema,id),`sdk-${id}`)).join("\n");

const subscription = `// Illustrative client fragment after generating bindings for the completed module.
import { DbConnection } from "./module_bindings";

const connection = DbConnection.builder()
  .withUri(worldEndpoint) // trusted deployment setting, not a URL from a model
  .withDatabaseName(worldDatabase)
  .withToken(identityToken) // production identity plus server-side membership
  .withConfirmedReads(true) // do not trade durability for early execution
  .onConnect(conn => {
    conn.subscriptionBuilder()
      .onApplied(() => { /* the subscribed cache is ready to read */ })
      .subscribe(["SELECT * FROM visible_executions"]);
  })
  .build();

// UI reads the SDK cache. A worker treats rows as reconciliation input, never as motor commands.
// Initial inserts also occur on subscription/reconnect; they are not new-execution events.
// Generate bindings instead of maintaining a second handwritten HTTP/snapshot/delta client.`;
const readRows = `<div class="architecture-rows">${[
  ["UI / decision worker", "Authorized views of live entities, pose, geometry, semantic, relations and action bindings. Subscribe to relevant state; assemble a detached task context without copying database authority."],
  ["Controller", "Its robot's executions and necessary actor/target evidence. Private tables plus scoped views; no subscribeToAllTables shortcut."],
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
${section("ownership","01","Foundations & ownership","Nemeia's eight foundations use native tables, transactions and subscriptions. Each boundary has one owner.",`<div class="abstraction-list">${ownership.map((row,i)=>proseRow(i,...row)).join("\n")}</div>`)}
${section("objects","02","Objects & world view","Typed geometry, independently timed evidence, a narrow action contract and a read-only world projection.",`<div class="object-list">${objectRows.map(([file,id,title,summary,description],i)=>codeRow("object",i,title,summary,description,region(sources[file],id),`object-${id}`)).join("\n")}</div>`)}
${section("contracts","03","Service & reducer contracts","Each boundary has one owner. These interfaces specify behavior; generated SDK bindings come from the completed module, not these handwritten design interfaces.",`<div class="contract-list">${contractRows.map(([id,title,summary,description],i)=>codeRow("contract",i,title,summary,description,region(sources.contracts,id),`contract-${id}`)).join("\n")}</div>`)}
${section("tables","04","Database tables","Thirteen typed tables for this slice. More explicit data shapes replace generic journal machinery; all base tables are private. Columns below come from the checked schema.",`<div class="schema-list">${tableHtml}</div>`)}
${section("platform","05","Native SpacetimeDB mechanics","Schema, transaction and authorized-view examples use the real SDK. Model inference and physical execution remain external.",`<div class="object-list">${platform}</div>${readRows}${codeRow("example",0,"Subscribe and reconcile","generated client pattern","This consumer fragment assumes generated bindings for the completed module. Only schema/function examples and domain fixtures are type-checked here; connection behavior still requires a running-server integration test.",subscription,"sdk-subscribe")}`)}
${renderIntelligence({section,codeRow,proseRow,region},"06")}
${section("example","07","End-to-end information flow","One Go2 approaches a backpack. Static, type-checked fixtures show ingestion, decision, admission, claim, physical execution and measured completion; they do not execute anything.",`<div class="example-list">${exampleRows.map(([id,title,summary,description],i)=>codeRow("example",i,title,summary,description,region(sources.example,id),`flow-${id}`)).join("\n")}</div>`)}
${renderTracing({section,codeRow,proseRow,region},"08")}
${section("boundaries","09","Failure & deployment boundaries","A fast shared-state engine does not remove uncertainty, authority checks, network failures or robot-local safety responsibilities.",`<div class="abstraction-list">${failureRows.map((row,i)=>proseRow(i,...row)).join("\n")}</div>`)}
${section("references","10","Platform basis","Implementation target, not a deployed backend. Next: complete reducers/views, benchmark perception locally, test privacy-filtered tracing, evaluate decisions in shadow mode, then qualify local control.",`<div class="architecture-rows">${refs.map(([title,url,description])=>`<div class="architecture-row"><strong><a href="${url}">${title}</a></strong><div>${escape(description)}</div></div>`).join("")}</div>`)}
</main>`;

const shell=read("docs/index.html");
const html=shell.replace(/<main id="main-content">[\s\S]*?<\/main>/,main)
  .replace(/<title>[^<]*<\/title>/,"<title>Nemeia · SpacetimeDB protocol</title>")
  .replace(/<meta name="description" content="[^"]*">/,'<meta name="description" content="Nemeia protocol: SpacetimeDB world state, YOLOE and SAM3 perception, Typesafe decisions, Laminar tracing, contracts and end-to-end execution.">');
// One architecture. Preserve the existing /spacetimedb/ bookmark as an identical alias.
for (const path of ["docs/index.html","dist/index.html","docs/spacetimedb/index.html","dist/spacetimedb/index.html"]) {
  if(process.argv.includes("--check")) {
    if(read(path)!==html) throw new Error(`Out of date: ${path}`);
  } else { mkdirSync(resolve(root,path,".."),{recursive:true}); writeFileSync(resolve(root,path),html); }
}
console.log(`SpacetimeDB page synchronized: ${tables.length} tables, ${contractRows.length} contracts, ${exampleRows.length} flow stages.`);
