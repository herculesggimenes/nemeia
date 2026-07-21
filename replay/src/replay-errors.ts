export class ReplayError extends Error {
  constructor(error_code, message, details = {}) {
    super(message);
    this.name = "ReplayError";
    this.error_code = error_code;
    this.details = details;
  }
}
