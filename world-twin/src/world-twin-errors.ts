export class WorldTwinError extends Error {
  constructor(error_code, message, details = {}) {
    super(message);
    this.name = "WorldTwinError";
    this.error_code = error_code;
    this.details = details;
  }
}
