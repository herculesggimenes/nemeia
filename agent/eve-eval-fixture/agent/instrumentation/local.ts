import { disableInstrumentation } from "eve/instrumentation";

// The actual-eval child process must not write the default local trace sink.
export default disableInstrumentation();
