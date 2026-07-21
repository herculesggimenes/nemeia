export class PolicyError extends Error {
  constructor(error_code, message, details = {}) {
    super(message);
    this.name = "PolicyError";
    this.error_code = error_code;
    this.details = details;
  }
}
