import { disableInstrumentation } from "eve/instrumentation";

// Eve owns the worker's global provider. Keep this qualification child local
// and exporter-free; lifecycle evidence is collected from the public session
// events, never from a remote trace sink.
export default disableInstrumentation();
