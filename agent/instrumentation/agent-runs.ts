import { disableInstrumentation } from "eve/instrumentation";

// Eve enables this remote destination in preview/production when its slot is
// absent. Remote export requires a separately approved destination/profile;
// metadata-only capture alone does not authorize sending data to Vercel.
export default disableInstrumentation();
