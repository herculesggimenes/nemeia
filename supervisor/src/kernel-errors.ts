export class KernelError extends Error {
  constructor(error_code, message, details = {}) {
    super(message);
    this.name = "KernelError";
    this.error_code = error_code;
    this.details = details;
  }
}
