// Selected website specification only. No application module imports these planning types.
export const missionCode = {
  "mission-criteria": `type ObjectiveCriterion =
  | { tag: "observed"; value: {
      entityId: string; // existing target identity, bound before mission creation
      facet: { tag: "geometry" | "semantic" }; // which retained measurement is required
      maxAgeMs: number; // positive u32; maximum acquisition age when progress is recorded
    } }
  | { tag: "approached"; value: {
      targetId: string; // later motion objective; requires qualified local navigation
      standoffM: number; // finite positive target distance in meters
    } }; // Nemeia criteria, not MMO-standard types; each needs an installed validator
interface ObjectiveSpec {
  id: string; // unique within this mission
  description: string; // explains the objective; does not itself prove completion
  dependsOn: readonly string[]; // all named objectives must complete first; no cycles
  optional: boolean; // optional objectives cannot gate required ones
  criterion: ObjectiveCriterion; // measurable outcome, not the agent's execution plan
} // 1–32 objectives, at least one required; validate targets and dependency references.
// V0 uses observed milestones. Continuous freshness remains an action check.
// Do not add a generic count until distinct-item identity and deduplication are defined.`,
  "mission-spec": `interface MissionSpec {
  description: string; // World Master's intended outcome and context; replaces the ambiguous goal field
  objectives: readonly ObjectiveSpec[]; // explicit, server-validated completion conditions
  deadlineAt?: Timestamp; // optional world-clock deadline; not a motor timeout
  template?: PackagePin; // optional immutable authoring provenance; inline spec is authoritative
} // No Unit IDs, subscription settings, radius, speed or execution duration.
type MissionState = "active" | "closing" | "succeeded" | "failed" | "cancelled";
type MissionOutcome = "succeeded" | "failed" | "cancelled";
interface Mission {
  id: string; // one accepted instance; a repeat or changed specification uses a new ID
  owner: Identity; // creating World Master, derived from authenticated identity
  spec: MissionSpec; // immutable description, objectives and constraints
  state: { tag: MissionState }; // domain lifecycle, independent of agent focus
  revision: bigint; // lifecycle/assignment fence, not a progress counter
  closingOutcome?: { tag: MissionOutcome }; // pending result while linked physical work closes safely
  createdAt: Timestamp; // initial objective readiness; not the start of robot motion
  updatedAt: Timestamp; // last lifecycle or assignment change
} // A mission remains active while its agent works on another mission.`,
  "mission-evidence": `type MissionEvidence =
  | { tag: "observation"; value: { observationId: string } } // load retained acquisition, association and requested facet
  | { tag: "execution"; value: { executionId: string } }; // load matching measured outcome and safe-closure receipt
type ObjectiveProgress =
  | { objectiveId: string; status: "pending" } // no accepted proof; readiness is derived separately
  | { objectiveId: string; status: "completed";
      evidence: MissionEvidence; // validated proof, not an LLM success assertion
      recordedAt: Timestamp; // authoritative progress commit time
    }; // read projection; pending entries need no persisted row
// mission_objective_progress stores one immutable completion proof per mission/objective.
// Repeated submission returns the first accepted proof; it never increments a counter.
// One observation may support multiple objectives only when each validator independently accepts it.
// Completion remains recorded as evidence ages; future actions still require fresh measurements.`,
};

export const missionViewCode = `interface MissionView {
  mission: Readonly<Mission>; // accepted specification and authoritative lifecycle
  objectiveProgress: readonly ObjectiveProgress[]; // one derived entry for every objective, including pending ones
  readyObjectiveIds: readonly string[]; // pending objectives whose dependencies are complete, while active and before deadline
  participants: readonly Row<"missionAgent">[]; // World Master assignments; separate from Unit authority
} // Join mission + mission_objective_progress + mission_agent; do not persist this view.
// Ready means eligible for work, not that a Unit is available or an action is safe.`;

export const missionLogCode = `interface MissionLog {
  agentId: string; // one logical agent can have several assigned missions at once
  entries: readonly MissionView[]; // authorized assignments and retained outcomes, ordered by stable mission ID
} // Derived quest-log-style view, also called the mission board; not an audit log or new table.
// World Master assigns missions. The agent chooses its next work across this log.
// A compact summary covers every assignment; authorized reads supply deeper details.
// Choosing a focus neither pauses other missions nor changes their objectives or deadlines.
// Independent outcomes can progress while the agent is reasoning about another mission.
// The shared Unit reservation prevents conflicting physical work across the entire log.`;

export const missionsContractCode = `interface Missions {
  createMission(input: { id: string; spec: MissionSpec }): Promise<void>; // World Master only; validate description/objectives, targets and deadline; activate + audit
  readMissionLog(input: { agentId: string }): Promise<MissionLog>; // own agent or authorized World Master; projected from assignments, missions and progress
  recordObjectiveProgress(input: { missionId: string; objectiveId: string; evidence: MissionEvidence }): Promise<void>; // validate proof/readiness; atomically record progress + audit and request closure if all required objectives complete
  cancelMission(input: { missionId: string; expectedRevision: bigint }): Promise<void>; // record cancellation, block new work and reconcile linked executions
  reconcileMission(input: { missionId: string }): Promise<void>; // enforce deadline/completion; terminal result requires confirmed safe physical closure
} // Descriptive service boundary, not a separate microservice or handwritten transport.
// Read views/subscriptions maintain the mission log; assignment is a WorldMasters operation.
// Agents submit evidence, never status flags, percentages or mutable success counters.`;
