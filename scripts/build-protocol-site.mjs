import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { foundations, objects, services, tables, examples, decisions } from "../docs/protocol-content.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (path) => readFileSync(resolve(root, path), "utf8");
const escape = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-");
const protocol = read("contracts/protocol/protocol.ts");
const fixture = read("contracts/protocol/example.ts");
const region = (source, name) => {
  const match = source.match(new RegExp(`// region ${name}\\n([\\s\\S]*?)// endregion`));
  if (!match) throw new Error(`Missing region ${name}`);
  return match[1].trim();
};
const contract = (name) => {
  const match = protocol.match(new RegExp(`export interface ${name} \\{[\\s\\S]*?^\\}[^\\n]*`, "m"));
  if (!match) throw new Error(`Missing interface ${name}`);
  return match[0];
};
const summary = (kind, index, title, description) => `<summary><span class="${kind}-index">${String(index + 1).padStart(2,"0")}</span><span><span class="${kind}-title">${escape(title)}</span><span class="${kind}-summary">${escape(description)}</span></span><span class="${kind}-toggle" aria-hidden="true"></span></summary>`;
const codeRow = (kind, index, title, description, prose, code, id) => `<details class="${kind}-item" id="${id}">${summary(kind,index,title,description)}<div class="${kind}-body"><div class="${kind}-description"><p>${escape(prose)}</p></div><div class="${kind}-code"><pre><code class="language-ts">${escape(code)}</code></pre></div></div></details>`;
const proseRow = (index, title, description, prose, example = "") => `<details class="abstraction" id="${slug(title)}"><summary><span class="abstraction-index">${String(index+1).padStart(2,"0")}</span><span><span class="abstraction-title">${escape(title)}</span><span class="abstraction-summary">${escape(description)}</span></span><span class="toggle" aria-hidden="true"></span></summary><div class="abstraction-body"><p>${escape(prose)}</p>${example ? `<code>${escape(example)}</code>` : ""}</div></details>`;
const section = (id, number, title, description, body) => `<section class="section" id="${id}" aria-labelledby="${id}-title"><div class="section-inner"><div class="section-intro"><div><div class="section-label">${number} / ${escape(title)}</div><h2 id="${id}-title">${escape(title)}</h2></div><p>${escape(description)}</p></div>${body}</div></section>`;
const table = (index, item) => `<details class="schema-item" id="table-${item.name}">${summary("schema",index,item.name,item.summary)}<div class="schema-body"><div class="schema-description"><p>${escape(item.description)}</p></div><div class="column-table-wrap"><table class="column-table"><thead><tr><th scope="col">Name</th><th scope="col">Type</th><th scope="col">Description</th></tr></thead><tbody>${item.columns.map(row=>`<tr>${row.map(cell=>`<td>${escape(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table></div><p class="reference-note">${escape(item.constraints)}</p></div></details>`;

const diagram = `<section class="diagram-section" id="how-it-works" aria-label="How Nemeia works"><div class="diagram-inner section-inner"><h1 class="section-label">Nemeia / protocol</h1><p class="reference-note">Canonical implementation target · pre-production · no backward-compatibility requirement</p><div class="diagram-shell" role="img" aria-label="Sensors produce evidence; trusted systems commit world state; clients discover affordances and request actions; executors produce new evidence. All decisions are recorded in one journal."><div class="diagram-header"><span class="diagram-label">CORE LOOP</span><span>same meaning · simulation or hardware</span></div><div class="diagram">${[
  ["sense","Sense","Frames become timestamped observations.","FrameRef → Observation"],
  ["world","Compose","Associate identities; commit complete changes.","Entity + Component + Relationship"],
  ["affordance","Discover","Derive what is possible from current evidence.","Action → Affordance"],
  ["action","Execute","One attempt; local control for hardware.","ActionRequest → Execution"],
  ["event","Observe again","Measurements, not intent, close the loop.","Evidence → world changes"],
].map(([tone,title,description,code],i)=>`${i ? '<div class="diagram-arrow" aria-hidden="true"></div>' : ""}<div class="diagram-node" data-tone="${tone}"><span class="node-meta">0${i+1}</span><strong>${title}</strong><p>${description}</p><code>${escape(code)}</code></div>`).join("")}</div><div class="diagram-foot"><div><strong>Journal</strong><p>CloudEvents + atomic decisions + resumable cursors</p></div><div><strong>One world</strong><p>UI, Scene, attention and replay are readers of the same state.</p></div></div></div></div></section>`;

const architecture = `<div class="architecture-rows">${[
  ["Core host", "Client / agent → WorldService → executor → journal + world"],
  ["Perception", "RobotDriver → ObservationSink → association / projector → WorldWriter"],
  ["Physical host", "Executor → ControlGate / Session → RobotDriver → device"],
  ["Readers", "WorldSnapshot + events → UI / Scene / attention / replay"],
  ["Optional", "Admission / approval · remote JOSE grant · retained resources · prediction"],
].map(([title,description])=>`<div class="architecture-row"><strong>${title}</strong><div>${escape(description)}</div></div>`).join("")}</div><p class="architecture-note">Start with one modular host and one database. Interfaces express ownership, not microservices. Keep local control independent of the world database. The host uses OS supervision and sandboxing; it is not a new operating system.</p>`;

// Standards descriptions and primary-source links have one owner: the normative spec.
const standardSection = read("docs/protocol.md").split("## 11.")[1].split("## 12.")[0];
const standardRows = standardSection.split("\n").filter(line=>line.startsWith("| ")).slice(2);
const inlineLinks = (value) => {
  const escaped = escape(value);
  return escaped.replace(/\[([^\]]+)\]\((https:\/\/[^ )]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
};
const standards = `<div class="column-table-wrap"><table class="column-table"><thead><tr><th scope="col">Concern</th><th scope="col">Established basis</th><th scope="col">Nemeia adds</th></tr></thead><tbody>${standardRows.map(line=>`<tr>${line.split("|").slice(1,-1).map(value=>`<td>${inlineLinks(value.trim())}</td>`).join("")}</tr>`).join("")}</tbody></table></div><p class="reference-note">Exact standard formats: CloudEvents, JSON Schema, Problem Details and JOSE. ROS geometry/action mappings are semantic mappings, not a claim of ROS wire compatibility. Transactions and outbox are patterns, not another custom transport. No message broker, workflow engine or mandatory ROS deployment is required.</p>`;

const main = `<main id="main-content">${diagram}
${section("abstractions","01","Core abstractions","Eight foundations; no parallel hierarchy of mission, run and authorization objects.",`<div class="abstraction-list">${foundations.map((row,i)=>proseRow(i,...row)).join("\n")}</div>`)}
${section("objects","02","Objects & definitions","Complete checked types, including world-view shape, evidence, geometry, execution and transport primitives.",`<div class="object-list">${objects.map(([id,title,summary,description],i)=>{
  let code=region(protocol,id);
  for (const [name] of services) code=code.replace(contract(name),"");
  return codeRow("object",i,title,summary,description,code.trim(),`object-${id}`);
}).join("\n")}</div>`)}
${section("architecture","03","Architecture","One state owner, one execution owner and one physical control authority. Optional modules do not redefine the core.",architecture)}
${section("contracts","04","Service contracts","Open each boundary independently. Types above are shared; comments describe each method. These are host-side interfaces, not a list of separately deployed servers.",`<div class="contract-list">${services.map(([name,summary,description],i)=>codeRow("contract",i,name,summary,description,contract(name),`contract-${slug(name)}`)).join("\n")}</div>`)}
${section("tables","05","Database tables","Two core tables. Add caches or retained bytes only when needed. Physical controllers keep their own local state and receipts; these are logical schemas, not deployed migrations.",`<div class="schema-list">${tables.map((item,i)=>table(i,item)).join("\n")}</div>`)}
${section("example","06","End-to-end information flow","Go2 approaches a detected backpack. The trace uses the exact types above and makes every boundary visible. It does not execute hardware commands.",`<div class="example-list">${examples.map(([id,title,summary,description],i)=>codeRow("example",i,title,summary,description,region(fixture,id),id)).join("\n")}</div>`)}
${section("decisions","07","Simplification decisions","Fewer independent authorities; more explicit identity, time, atomicity and failure behavior.",`<div class="abstraction-list">${decisions.map((row,i)=>proseRow(i,...row)).join("\n")}</div>`)}
${section("standards","08","Established standards & patterns","Reuse mechanisms that already exist. Nemeia defines world and action meaning, not replacement infrastructure.",standards)}
${section("status","09","Implementation target","Nemeia is a prototype. This page is the source for the next implementation, not a claim that these guarantees already exist.",`<div class="architecture-rows">${[
  ["1 · Contracts", "Generate JSON schemas and OpenAPI clients; replace old contract files and handwritten validators."],
  ["2 · Durable core", "Atomic changes, persistent request receipts, one session lifetime and gap-free cursor resumption."],
  ["3 · Perception", "Explicit association, independent facet times, complete geometry and incremental world projection."],
  ["4 · Execution", "Bind one action in simulation and hardware; qualify local stop, watchdog, cancellation and restart behavior."],
  ["5 · Consumers", "Render the same world in UI/CLI. Add approval, remote grants or durable attention only for a concrete need."],
].map(([title,description])=>`<div class="architecture-row"><strong>${title}</strong><div>${description}</div></div>`).join("")}</div>`)}
</main>`;

const current = read("docs/index.html");
if (!/<main id="main-content">[\s\S]*?<\/main>/.test(current)) throw new Error("Missing page shell");
const html = current.replace(/<main id="main-content">[\s\S]*?<\/main>/,main);
if (process.argv.includes("--check")) {
  if (current !== html || read("dist/index.html") !== html) throw new Error("Protocol page out of date; run npm run build:protocol-site");
  console.log(`Protocol page synchronized: ${services.length} contracts, ${tables.length} tables, ${examples.length} example stages.`);
} else {
  writeFileSync(resolve(root,"docs/index.html"),html);
  writeFileSync(resolve(root,"dist/index.html"),html);
}
