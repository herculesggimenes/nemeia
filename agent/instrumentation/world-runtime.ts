import { defineInstrumentation } from "eve/instrumentation";
import { NonBlockingTraceSink } from "../lib/tracing-policy.ts";

const sink = new NonBlockingTraceSink(() => undefined);

function correlation(scope: {
  readonly sessionId: string;
  readonly turnId: string;
  readonly stepIndex: number;
  readonly attemptId?: string;
}) {
  return {
    sessionId: scope.sessionId,
    turnId: scope.turnId,
    stepIndex: scope.stepIndex,
    ...(scope.attemptId === undefined ? {} : { attemptId: scope.attemptId }),
  };
}

export default defineInstrumentation({
  tracePolicy: () => ({ emit: true, recordInputs: false, recordOutputs: false }),
  events: {
    "step.attempt.started": (event) => {
      sink.emit({
        name: event.type,
        correlation: correlation(event.scope),
        attributes: { attemptIndex: event.scope.attemptIndex, attemptId: event.scope.attemptId },
      });
    },
    "step.attempt.completed": (event) => {
      sink.emit({
        name: event.type,
        correlation: correlation(event.scope),
        attributes: { attemptIndex: event.scope.attemptIndex, attemptId: event.scope.attemptId },
      });
    },
    "step.attempt.failed": (event) => {
      sink.emit({
        name: event.type,
        correlation: correlation(event.scope),
        attributes: { attemptIndex: event.scope.attemptIndex, attemptId: event.scope.attemptId },
      });
    },
  },
  flush: () => sink.flush(),
});

export { sink as worldTraceSink };
