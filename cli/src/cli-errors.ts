export class CliError extends Error {
  constructor(error_code, message, { exitCode = 4, blocked_by, recommended_action, details = {} } = {}) {
    super(message);
    this.name = "CliError";
    this.error_code = error_code;
    this.exitCode = exitCode;
    this.blocked_by = blocked_by;
    this.recommended_action = recommended_action;
    this.details = details;
  }
}

export function toErrorBody(error) {
  const error_code = error?.error_code ?? "INFRA_ERROR";
  return {
    error_code,
    message: String(error?.message ?? "Unexpected CLI failure.").slice(0, 500),
    retryable: error_code === "INFRA_ERROR",
    ...(error?.blocked_by ? { blocked_by: error.blocked_by } : {}),
    ...(error?.recommended_action ? { recommended_action: error.recommended_action } : {}),
    ...(error?.details && Object.keys(error.details).length > 0 ? { details: error.details } : {})
  };
}
