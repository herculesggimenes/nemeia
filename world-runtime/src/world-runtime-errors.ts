export class WorldRuntimeError extends Error {
  code: string;
  details: Record<string, unknown>;

  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "WorldRuntimeError";
    this.code = code;
    this.details = structuredClone(details);
  }
}
