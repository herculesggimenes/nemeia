import type { DbConnection } from "../../world-client/src/generated/index.ts";
import type {
  ActionIntent as GeneratedActionIntent,
  ActionBindingPolicy as GeneratedActionBindingPolicy,
  Execution as GeneratedExecution,
} from "../../world-client/src/generated/types.ts";
import {
  adaptAcceptedExecutionClaim,
  type AcceptedExecutionClaim,
  type CanonicalJson,
  type ControllerCommand,
  type GeneratedActionIntent as InternalGeneratedActionIntent,
  type GeneratedBindingPolicy,
  normalizedGeneratedRequestProjection,
} from "./local-controller.ts";

/** Type-only anchor for the canonical generated World connection. */
export type CanonicalWorldDbConnection = DbConnection;

/**
 * The current generated module exposes a claimed execution as an execution
 * row. Keep this narrow boundary local until World regenerates a first-class
 * accepted-execution/claim projection.
 */
export type GeneratedExecutionClaim = {
  executionId: string;
  unitId: string;
  controllerEpoch: bigint;
};

export type GeneratedAcceptedExecution = Pick<
  GeneratedExecution,
  "id" | "unitId" | "input" | "state" | "binding"
> & {
  requestDigest?: string;
  normalizedRequest?: CanonicalJson;
  requestFingerprint?: string;
  acceptBy?: unknown;
  objectiveId?: string;
  missionRevision?: bigint;
  assignmentRevision?: bigint;
  bindingVersion?: bigint;
  targetVersion?: bigint;
};

function mapIntent(input: GeneratedActionIntent): InternalGeneratedActionIntent {
  switch (input.tag) {
    case "Navigate":
      return {
        tag: "navigate",
        value: {
          mapId: input.value.mapId,
          basisMapRevision: input.value.basisRevision,
          targetFrameId: input.value.targetFrameId,
          targetPose: input.value.target,
        },
      } satisfies InternalGeneratedActionIntent;
    case "Approach":
      return {
        tag: "approach",
        value: {
          targetId: input.value.targetId,
          standoffM: input.value.standoffM,
          expectedGeometryVersion: input.value.expectedGeometryVersion,
        },
      } satisfies InternalGeneratedActionIntent;
  }
  throw new Error("unsupported_generated_action_intent");
}

function mapPolicy(input: GeneratedActionBindingPolicy): GeneratedBindingPolicy {
  return {
    mode: input.mode.tag === "Simulation" ? "simulation" : "physical",
    maxRunMs: input.maxRunMs,
    maxEvidenceAgeMs: input.maxEvidenceAgeMs,
    maxLinearMps: input.maxLinearMps,
    toleranceM: input.toleranceM,
    executor: input.executor,
  };
}

function mapState(state: GeneratedExecution["state"]): "accepted" | "running" {
  if (state.tag === "Accepted") return "accepted";
  if (state.tag === "Running") return "running";
  throw new Error("claim_not_active");
}

function jsonValue(value: unknown): CanonicalJson {
  if (typeof value === "bigint") return value.toString(10);
  if (value instanceof Date) return value.toISOString();
  if (value !== null && typeof value === "object" && "toISOString" in value && typeof value.toISOString === "function") {
    return value.toISOString();
  }
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  return JSON.parse(JSON.stringify(value)) as CanonicalJson;
}

function completeRequestProjection(
  execution: GeneratedAcceptedExecution,
  input: InternalGeneratedActionIntent,
): CanonicalJson {
  if (execution.normalizedRequest !== undefined) return execution.normalizedRequest;
  const projection: Record<string, CanonicalJson> = {
    input: normalizedGeneratedRequestProjection(input),
  };
  if (execution.requestFingerprint !== undefined) projection.requestFingerprint = execution.requestFingerprint;
  if (execution.acceptBy !== undefined) projection.acceptBy = jsonValue(execution.acceptBy);
  if (execution.objectiveId !== undefined) projection.objectiveId = execution.objectiveId;
  if (execution.missionRevision !== undefined) projection.missionRevision = execution.missionRevision.toString(10);
  if (execution.assignmentRevision !== undefined) projection.assignmentRevision = execution.assignmentRevision.toString(10);
  if (execution.bindingVersion !== undefined) projection.bindingVersion = execution.bindingVersion.toString(10);
  if (execution.targetVersion !== undefined) projection.targetVersion = execution.targetVersion.toString(10);
  return projection;
}

/**
 * Convert the generated accepted execution and generated-row claim into the
 * only command shape admitted by LocalController. The controller epoch comes
 * exclusively from the confirmed claim argument; it is never taken from the
 * request or the model.
 */
export function adaptGeneratedExecutionClaim(input: {
  execution: GeneratedAcceptedExecution;
  claim: GeneratedExecutionClaim;
}): ControllerCommand {
  const { execution, claim } = input;
  const internalInput = mapIntent(execution.input);
  const internal: AcceptedExecutionClaim = {
    execution: {
      id: execution.id,
      unitId: execution.unitId,
      input: internalInput,
      state: mapState(execution.state),
      binding: { policy: mapPolicy(execution.binding) },
      requestDigest: execution.requestDigest,
      normalizedRequest: completeRequestProjection(execution, internalInput),
    },
    claim: {
      executionId: claim.executionId,
      unitId: claim.unitId,
      controllerEpoch: claim.controllerEpoch,
    },
  };
  return adaptAcceptedExecutionClaim(internal);
}

/**
 * Build the same durable command projection for an accepted request that is
 * being cancelled before claim. This is not a claim operation and must never
 * be passed to LocalController.start; the epoch is read from the current
 * generated Unit-control projection solely to bind the cancellation receipt.
 */
export function adaptGeneratedExecutionCancellation(input: {
  execution: GeneratedAcceptedExecution;
  controllerEpoch: bigint;
}): ControllerCommand {
  return adaptGeneratedExecutionClaim({
    // The cancellation projection only needs the persisted intent/binding;
    // normalize it through the accepted-row adapter without treating this as
    // a server claim or allowing it to reach LocalController.start.
    execution: { ...input.execution, state: { tag: "Accepted" } },
    claim: {
      executionId: input.execution.id,
      unitId: input.execution.unitId,
      controllerEpoch: input.controllerEpoch,
    },
  });
}
