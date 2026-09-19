import { t, type Infer } from "spacetimedb";

// region agent-scope
export const ReadScope = t.enum("ReadScope", {
  world: t.unit(), // explicitly granted access to the whole recorded world, not omniscience
  entities: t.array(t.string()), // explicit entity IDs; current components and authorized incident relations
}); // mission participation additionally exposes that mission, its credits and shared execution outcomes
export const SubscriptionPolicy = t.object("SubscriptionPolicy", {
  missionIds: t.array(t.string()), // interest within authorized participation, never a permission grant
  entityIds: t.array(t.string()), // bounded interest within read scope; references must be live
  facets: t.array(t.string()), // installed vocabulary: pose, geometry, semantic, control, assignment
  wakeOn: t.array(t.string()), // installed triggers: objective_ready, meaningful_change, availability, message, execution, deadline
  minIntervalMs: t.u32(), // minimum time between steps triggered by this subscription; zero allows immediate eligibility
  maxWaitMs: t.u32(), // desired batching bound after meaningful work arrives; not a compute guarantee
  priority: t.u8(), // bounded scheduler priority; no execution authority or safety meaning
}); // validated allowlists and bounds; no arbitrary predicate/code language
export type SubscriptionPolicy = Infer<typeof SubscriptionPolicy>;
// endregion

// region agent-runtime
export type AgentScheduleState = "idle" | "ready" | "thinking" | "waiting"; // scheduling, not connectivity or administrative pause
export interface AgentRuntime {
  agentId: string; // durable logical decision-maker, independent of hardware and worker process
  state: AgentScheduleState; // idle: no useful work; ready: queued for budget; thinking: one step; waiting: external dependency
  activeStepId?: string; // at most one durably leased reasoning step across all this agent's subscriptions
  waitingOn: readonly string[]; // execution, resource, message or condition references; still accept new useful work
  nextWakeAt?: string; // UTC deadline or evidence-expiry timer; meaningful events can wake sooner
  connected: boolean; // transport health is independent from state; no new physical proposals while unsynchronized
} // worker-local durable inbox/step ledger owns scheduling; optional UI projection is not another world authority
// Administrative pause is stored on agent; it blocks new inference/admission and initiates safe closure.
// A reconnect/crash reconciles the step lease and any durable outcome before starting another step.
// endregion
