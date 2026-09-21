import { disableInstrumentation } from "eve/instrumentation";

// Keep this deterministic qualification local; no managed Agent Runs export.
export default disableInstrumentation();
