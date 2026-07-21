export class AttentionError extends Error {
  constructor(error_code, message, details = {}) {
    super(message);
    this.name = "AttentionError";
    this.error_code = error_code;
    this.details = details;
  }
}
