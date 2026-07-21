export class SceneError extends Error {
  constructor(error_code, message, details = {}) {
    super(message);
    this.name = "SceneError";
    this.error_code = error_code;
    this.details = details;
  }
}
