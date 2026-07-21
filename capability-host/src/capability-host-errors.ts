export class CapabilityHostError extends Error {
  constructor(error_code, message, details = {}) {
    super(message);
    this.name = "CapabilityHostError";
    this.error_code = error_code;
    this.details = details;
  }
}
