import { errorMetadata } from "../../contracts/src/error-registry.ts";
import { lintModelVisibleText } from "../../attention/src/rendering-lint.ts";

const ERROR_TEXT_MAX_LENGTH = 500;

export class MissionApiError extends Error {
  constructor(error_code, message, options = {}) {
    super(message);
    const metadata = errorMetadata(error_code);
    this.name = "MissionApiError";
    this.error_code = error_code;
    this.status = options.status ?? metadata.status;
    this.details = options.details ?? {};
    this.recommended_action = options.recommended_action;
    this.retryable = options.retryable ?? metadata.retryable;
  }
}

export function errorResponse(error) {
  const metadata = errorMetadata(error?.error_code ?? "INTERNAL_ERROR");
  const status = error?.status ?? metadata.status;
  const recommended_action = safeRecommendedAction(error?.recommended_action);
  return {
    status,
    headers: { "content-type": "application/json" },
    body: {
      error_code: error?.error_code ?? "INTERNAL_ERROR",
      message: String(error?.message ?? "Unexpected Mission API error.").slice(0, ERROR_TEXT_MAX_LENGTH),
      retryable: error?.retryable ?? metadata.retryable,
      ...(error?.details && Object.keys(error.details).length > 0 ? { details: error.details } : {}),
      ...(recommended_action ? { recommended_action } : {})
    }
  };
}

function safeRecommendedAction(value) {
  if (!value) {
    return null;
  }
  const text = String(value).slice(0, ERROR_TEXT_MAX_LENGTH);
  try {
    lintModelVisibleText(text, { field: "recommended_action", maxLength: ERROR_TEXT_MAX_LENGTH });
    return text;
  } catch {
    return null;
  }
}
