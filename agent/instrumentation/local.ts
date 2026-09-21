import { disableInstrumentation, isInstrumentationDisabled } from "eve/instrumentation";
import { localTraces } from "eve/instrumentation/otel";
import otelPolicy from "./otel.ts";

// Keep Eve's local metadata destination available alongside the single OTel
// policy. A disabled SDK/no-op profile must disable destinations as well:
// otherwise Eve still attempts provider registration for their processors.
const disabled = isInstrumentationDisabled(otelPolicy)
  || ["off", "false", "0"].includes(process.env.EVE_TRACES?.trim().toLowerCase() ?? "");

export default disabled ? disableInstrumentation() : localTraces({
  exportPolicy: {
    span: () => ({ redact: true, inputs: true, outputs: true }),
  },
});
