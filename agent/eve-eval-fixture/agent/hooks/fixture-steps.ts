// Reuse the host's production step identity/context preparation.  Keeping
// this as a re-export prevents the fixture from inventing a second authority
// or context-pinning implementation.
export { default } from "../../../hooks/world-step-receipts.ts";
