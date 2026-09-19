// Planning-only website content. These strings are displayed, never imported by a worker.
export const activityCode = `interface AgentActivity {
  agentId: string; // durable Nemeia identity; not an Eve session or a Unit
  eve?: { sessionId: string; turnId?: string; stepIndex?: number }; // runtime-owned correlation IDs
  state: "idle" | "ready" | "thinking" | "waiting"; // read-only projection of pending work, Eve events and domain dependencies
  waitingOn: readonly string[]; // execution, resource, message or condition references
  paused: boolean; // authoritative administrative configuration from the world
  synchronized: boolean; // current subscription readiness; independent of activity
} // No Nemeia thread table, conversation log, step lease or second execution loop.
// An Eve session waiting for input may mean domain-idle OR waiting on a physical action.
// A reset/expired Eve session does not cancel its Nemeia missions, grants or executions.`;

export const wakeCode = `interface WorldWake {
  id: string; // stable delivery-batch identity; not an execution or Eve turn ID
  worldId: string; agentId: string; // authenticated, authorized route to a logical agent
  eventIds: readonly string[]; // retained messages and important occurrences that need handling
  changedEntityIds: readonly string[]; // coalesced dirty keys, not every sensor sample
  rescan: boolean; // rebuild the authorized projection after reconnect or dirty-key overflow
} // A small adapter envelope, not a second conversation or general-purpose event bus.
// The adapter derives the Eve continuation address from [worldId, agentId].
// Do not key it by Unit, subscription or mission: each agent may have many of those.
// A wake accepted by Eve is not proof that these events were handled.`;

const channelCode = `// World channel adapter example.
import { defineChannel, POST } from "eve/channels";
import { worldBridge } from "../lib/world-bridge"; // trusted Nemeia integration boundary

export default defineChannel({
  turnPolicy: "queue", // ordinary updates wait; Eve's default is steer
  state: { worldId: "", agentId: "" }, // trusted routing metadata, not a copied world
  routes: [POST("/nemeia/wake", async (request, { from }) => {
    const wake = await worldBridge.authorizeWake(request); // authenticate bridge; validate scope, pause, size and retry identity
    const address = JSON.stringify([wake.worldId, wake.agentId]); // one stable channel address per logical agent
    const session = await from(address).send(wake.message, {
      auth: wake.auth, // verified Eve auth; never accept model-selected credentials
      state: { worldId: wake.worldId, agentId: wake.agentId },
    });
    return Response.json({ sessionId: session.id }, { status: 202 }); // accepted, not handled or physically executed
  })],
  events: {
    async "step.started"(_event, channel, ctx) {
      await worldBridge.refreshProjection(channel.state, ctx); // reauthorize and select a consistent context just before inference
    },
  },
});
// Bridge delivery receipts, retry handling and immutable context persistence are omitted here.
// Delivery requires idempotent reconciliation; acceptance alone does not guarantee handling.`;

const sandboxCode = `// Sandbox configuration example.
import { defineSandbox } from "eve/sandbox";
import { justbash } from "eve/sandbox/just-bash";
import { nemeiaCommand, mountWorldProjection } from "./lib/world-bridge"; // trusted host-side integrations

export default defineSandbox({
  backend: justbash({
    autoInstall: false, // pin compatible Eve + just-bash dependencies
    customCommands: [nemeiaCommand], // registered CustomCommand; no real nemeia executable is required
    filesystem: mountWorldProjection, // compose a read-only /world mount with Eve's writable workspace
  }),
});
// The filesystem factory receives defaultFilesystem; preserve Eve-owned workspace, temp and home paths.
// Bind every read/command to the active authenticated Eve session in trusted host code.
// Model-controlled files, env vars and command flags cannot select another agent or principal.
// Eve's stock just-bash backend has no network isolation and rejects setNetworkPolicy().
// Restrict host egress or qualify an adapted backend before sensitive autonomous use.`;

const workspaceCode = `// Per-step projection; world files are views, not a second database.
const workspace = {
  "/world/current.json": "Manifest: context ID, freshness, scope, versions and referenced immutable files",
  "/world/contexts/decision-context-1/mission-log.json": "Compact MissionLog summary: all assigned missions, descriptions, objectives, progress and outcomes; deeper details through authorized reads",
  "/world/contexts/decision-context-1/entities.json": "Relevant entities and independently timed components",
  "/world/contexts/decision-context-1/local-maps.json": "Retained checkpoint heads, frame-qualified views, unlocated evidence and current localization status",
  "/world/contexts/decision-context-1/units.json": "Capabilities, assignments, availability and active executions",
  "/world/contexts/decision-context-1/messages.json": "Exact retained messages for this context",
  "/workspace/": "Eve-owned writable notes and scratch work; never authoritative world state",
};
// Freeze one bounded context per step. Refresh at a later step, not halfway through its reads.
// These files can be rebuilt from durable world records. Deleting an Eve session never deletes its local map.
// Persist context identity outside disposable sandbox files when retries/audit depend on it.
// Latest state coalesces; must-handle events retain identities and explicit handling outcomes.`;

const commandCode = `// Shell interface examples; commands are shown, not executed.
const commands = [
  "cat /world/current.json", // inspect the current frozen context manifest
  "cat /world/contexts/decision-context-1/mission-log.json", // inspect every assignment before selecting work; fetch detailed MissionViews as needed
  "nemeia action request --file /workspace/approach.json", // parse a typed ApproachRequest; trusted bridge injects caller identity
  "nemeia execution get execution-1", // reconcile the authoritative receipt, including after an ambiguous result
  "nemeia message send --file /workspace/advice.json", // existing AgentCoordination rules, not an Eve-private mission chat
];
// Reads use the projection. Writes call existing validated world operations.
// Redirection into /world must fail; changing a scratch JSON file never commits world state.
// Reuse execution-1 on retry. Eve step retries do not guarantee exactly-once physical effects.
// A bash approval is not per-command authorization; enforce action-specific policy in the bridge/reducer.`;

const principles = [
  ["Eve owns the agent lifecycle", "sessions, turns, history, checkpoints and tools", "Use Eve for the agent loop, conversation history, compaction, session state, tool orchestration, cancellation and subagents. Nemeia does not implement another thread/turn/step scheduler or runtime ledger. Its durable Agent remains a domain identity linked to an Eve channel address. A session can end or reset without erasing missions, assignments or execution receipts. Pin and qualify runtime dependencies before deployment.", "Nemeia Agent → Eve channel address → Eve-owned session / turns / steps"],
  ["World channel adapter", "subscriptions become useful, bounded deliveries", "The Nemeia adapter watches authorized world subscriptions, coalesces replaceable state and retains required messages/events. It applies cadence and wake rules before calling Eve; one callback per camera frame must not become one model turn. Route by the world and logical agent, not by mission or Unit. Use queue for ordinary updates so they do not steer an active turn. Eve may fold queued messages into a turn; there is no one-event/one-turn promise. Pause or revocation blocks domain actions immediately; cancelling Eve reasoning is a separate operation, never physical stop.", "world subscriptions → relevance + coalescing → channel wake → Eve"],
  ["World model in just-bash", "read-only projected files; writable scratch space", "Expose a bounded authorized world projection under /world and preserve Eve's writable /workspace. The model can inspect JSON with shell tools instead of receiving the whole world in every prompt. A trusted adapter selects a consistent snapshot immediately before inference, after any queue delay, and freezes that context for the step. Names such as current.json and the CLI below are Nemeia design choices. The mount must enforce read-only access across all filesystem operations, including rename, links and path traversal; a naming convention is not protection.", "read /world → reason in Eve → propose through nemeia → validated world write"],
  ["Host-side command boundary", "convenient shell access without new authority", "Eve supports just-bash custom commands and a filesystem factory. A registered nemeia command runs trusted host code; it validates the parsed command, derives the principal from the active session and calls the existing domain contract. Keep database credentials and privileged clients out of files and environment variables visible to the model. Recheck grants, mission state, assignment revisions and evidence at every action. No generic SQL writer, shell-to-host execution, arbitrary HTTP proxy or raw robot command belongs in this bridge.", "CLI syntax is convenience · domain reducers remain authority"],
  ["Delivery and retries", "Eve durability does not replace domain receipts", "Eve owns its workflow checkpoints and session inbox. Nemeia still owns the narrow delivery handoff for world events: retain source event IDs, bounded pending batches and delivery/handling receipts until reconciled. A send acknowledgement is not a handled acknowledgement; a turn finishing does not prove every included event was handled. Interrupted Eve steps can rerun. Keep command retry IDs stable and reconcile world/local execution receipts after ambiguous results. Session reset must not lose outstanding messages. This is an adapter delivery responsibility, not a second thread runtime.", "world event ID ≠ wake batch ID ≠ Eve turn ID ≠ execution ID"],
  ["Limits and integration qualification", "interpreter isolation is not network isolation", "The stock Eve just-bash backend is a pure-JS interpreter with no real binaries and no network isolation; do not claim that setNetworkPolicy protects it. Custom commands run in the host process. Before sensitive or autonomous use, constrain host egress or qualify an adapted backend, limit command/time/output sizes, and test the read-only mount and identity binding. Eve subagents are reasoning helpers, not automatically new Nemeia agents with Unit grants. Keep specialized perception and deterministic control systems outside the LLM loop. Correlate Eve session/turn IDs with the existing Laminar/OTel plan; do not introduce another trace provider or silently drop approved content capture.", "Eve runs reasoning · Nemeia authorizes intent · local systems control hardware"],
];

export function renderEve({section,codeRow,proseRow}, number="06c") {
  const ownership = `<div class="architecture-rows">
<div class="architecture-row"><strong>Eve</strong><div>Sessions, turns, history, compaction, checkpoints, tool orchestration and runtime event streams.</div></div>
<div class="architecture-row"><strong>Nemeia adapter</strong><div>World subscriptions, relevance/coalescing, authenticated channel delivery, scoped context projection and command translation.</div></div>
<div class="architecture-row"><strong>Nemeia world + systems</strong><div>Missions, agent/Unit authority, admission, evidence, execution receipts and independent robot-local control.</div></div>
</div>`;
  const definitions = [
    ["eve-channel", "World channel adapter", "one continuation address per world/agent", "The trusted bridge authenticates deliveries and routes them by world and agent. The adapter refreshes scoped context at the reasoning step boundary.", channelCode],
    ["eve-sandbox", "just-bash sandbox", "native backend plus narrow Nemeia extensions", "Custom commands mediate domain operations; a read-only filesystem mount exposes world context. Enforce identity binding, host egress restrictions and bounded command execution.", sandboxCode],
    ["eve-workspace", "World workspace", "inspect the world as scoped structured files", "Keep native mission/entity/Unit information architecture. Files are read-only projections with acquisition times and versions, not mutable authority. Scratch files remain disposable.", workspaceCode],
    ["eve-commands", "World commands", "existing contracts behind a small CLI", "These illustrative commands simplify model interaction; they do not change permissions, admission or idempotency. No command runs from this documentation site.", commandCode],
  ].map(([id,title,summary,description,code],i)=>codeRow("object",i,title,summary,description,code,id)).join("\n");
  const references = `<p class="reference-note">Runtime references: <a href="https://eve.dev/docs/channels/custom">custom channels</a> · <a href="https://eve.dev/docs/sandbox">sandboxes and just-bash</a> · <a href="https://eve.dev/docs/concepts/execution-model-and-durability">execution and durability</a> · <a href="https://eve.dev/docs/concepts/context-control">context control</a>.</p>`;
  return section("eve-runtime",number,"Agent runtime · Eve","Eve runs the agent. A world channel and just-bash bridge expose Nemeia's domain model; no separate Nemeia thread runtime is needed.",`${ownership}<div class="abstraction-list">${principles.map((row,i)=>proseRow(i,...row)).join("\n")}</div><div class="object-list">${definitions}</div>${references}`);
}

export const flowCode = {
  cadence: `const scheduling = {
  policies: ["world changes: coalesced and rate-limited", "team messages: retained and prioritized"],
  channelAddress: JSON.stringify(["world-demo", "navigator"]), // not one session per subscription
  turnPolicy: "queue", // Eve owns serialization; do not restart model generation for each observation
};
// The bridge emits a bounded wake only when useful. Later state updates remain coalesced.
// An offline Unit does not trigger repetitive LLM polling; availability or coordination can wake the agent.
// Idle/ready/thinking/waiting are derived UI states, not another runtime state machine.`,
  prepared: `const worldContext = {
  id: "decision-context-1", worldId: "world-demo", agentId: "navigator",
  missionId: "mission-1", missionRevision: "3", assignmentRevision: "1",
  eventIds: ["message-1"], changedEntityIds: ["backpack-A"],
  geometryVersion: "1", semanticVersion: "1", // decimal JSON representation of SDK u64
}; // selected from consistent authorized state at Eve's step boundary, not at initial enqueue time
const preparedStep = {
  id: "step-1", contextId: worldContext.id, // illustrative trace aliases; real step coordinates come from Eve
  sessionId: "eve-session-1", turnId: "turn_0", stepIndex: 0,
  manifest: "/world/current.json", // points to this step's frozen context; model reads details with just-bash
};
// Eve owns history and checkpointing. The adapter keeps event-handling receipts across session resets.
// A registered nemeia command submits the existing typed request; it never mutates world files.`,
};
