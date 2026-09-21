import { disableInstrumentation } from "eve/instrumentation";
import { otel } from "eve/instrumentation/otel";

// Eve 0.63 checks provider ownership after registration. Its bundled SDK skips
// registration when OTEL_SDK_DISABLED=true, which otherwise produces a
// misleading duplicate-provider error. Disable the slot through Eve's public
// API so no provider registration is requested in this mode.
const disabled = process.env.NEMEIA_INSTRUMENTATION_MODE === "local-noop"
  || process.env.OTEL_SDK_DISABLED?.trim().toLowerCase() === "true";

export default disabled ? disableInstrumentation() : otel({
  resource: {
    "service.name": "nemeia-agent-runtime",
    "service.version": "0.1.0",
  },
  // World inputs, outputs, credentials, and signed URLs are metadata-restricted
  // by default. An explicitly approved destination/profile may opt into bounded
  // reviewed capture later; no external capture is enabled here.
  tracePolicy: () => ({ emit: true, recordInputs: false, recordOutputs: false }),
});
