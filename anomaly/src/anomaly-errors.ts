export class AnomalyError extends Error {
  constructor(error_code, message, details = {}) {
    super(message);
    this.name = "AnomalyError";
    this.error_code = error_code;
    this.details = details;
  }
}
