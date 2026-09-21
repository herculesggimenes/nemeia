import { readFileSync } from "node:fs";
import { DeliveryLedger } from "../../lib/world-bridge/delivery-ledger.ts";
import { WorldContextProjector } from "../../lib/world-bridge/context-projector.ts";
import type { StepIdentity, WorldPrincipal, WorldReadPort } from "../../lib/world-bridge/types.ts";

let principal: WorldPrincipal | null = null;
const stepByTurn = new Map<string, number>();
let serializedPrepare = Promise.resolve();
let projector: WorldContextProjector | undefined;
const preparedByPrincipal = new Map<string, Awaited<ReturnType<WorldContextProjector["prepare"]>>>();

function configuredPath(name: "NEMEIA_EVAL_STATE_FILE" | "NEMEIA_EVAL_LEDGER_FILE"): string {
  const value = process.env[name];
  if (value === undefined) throw new Error("fixture state and ledger files must be configured");
  return value;
}

function configuredAgentId(): string {
  return process.env.NEMEIA_AGENT_ID ?? "fixture-agent";
}

const world: WorldReadPort = {
  async readProjection({ principal: current }) {
    if (principal === null || current.principalId !== principal.principalId) throw new Error("world read denied");
    const state = JSON.parse(readFileSync(configuredPath("NEMEIA_EVAL_STATE_FILE"), "utf8")) as {
      readonly revision: string;
      readonly value: string;
    };
    return {
      worldId: "fixture-world",
      agentId: configuredAgentId(),
      worldRevision: state.revision,
      missionLog: [
        { missionId: "fixture-mission", description: "qualification", lifecycle: "active", readyObjectiveIds: ["objective"], pendingObjectiveIds: [] },
      ],
      summary: { value: state.value },
      sourceIds: ["fixture-source"],
      dirtyKeys: ["fixture.value"],
      mustHandleIds: [],
      rescanRequired: false,
      acquisitionTimes: [new Date().toISOString()],
      evidence: [],
    };
  },
};

export function setFixturePrincipal(current: WorldPrincipal): void {
  principal = current;
}

export function fixtureWorldReadPort(): WorldReadPort {
  return world;
}

export function fixtureContextFiles(principalId: string) {
  return preparedByPrincipal.get(principalId)?.files ?? null;
}

function getProjector(): WorldContextProjector {
  if (projector !== undefined) return projector;
  projector = new WorldContextProjector({
    ledger: new DeliveryLedger(configuredPath("NEMEIA_EVAL_LEDGER_FILE")),
    world,
    worldId: "fixture-world",
    agentId: configuredAgentId(),
    maxContextBytes: 16 * 1024,
  });
  return projector;
}

export function noteStep(turnId: string, stepIndex: number): void {
  stepByTurn.set(turnId, stepIndex);
}

export function prepareFixtureContext(sessionId: string, turnId: string) {
  if (principal === null) throw new Error("fixture principal is not authenticated");
  const step: StepIdentity = {
    sessionId,
    turnId,
    stepIndex: stepByTurn.get(turnId) ?? 0,
  };
  const currentPrincipal = principal;
  serializedPrepare = serializedPrepare.then(async () => {
    const context = await getProjector().prepare(step, currentPrincipal);
    preparedByPrincipal.set(currentPrincipal.principalId, context);
    return context;
  });
  return serializedPrepare;
}
