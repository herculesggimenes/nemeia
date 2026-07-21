import { AttentionError } from "./attention-errors.ts";

const FORBIDDEN_PATTERNS = [
  /ignore (all )?(previous|prior) (instructions|messages)/i,
  /system prompt/i,
  /developer message/i,
  /you are (now|an?) /i,
  /<script\b/i,
  /```/,
  /\b(?:curl|bash|sh|python|node)\s+-/i
];

export function lintModelVisibleText(text, { maxLength = 2000, field = "text" } = {}) {
  if (typeof text !== "string") {
    throw new AttentionError("RENDER_LINT_TYPE", `${field} must be a string.`);
  }
  if (text.length > maxLength) {
    throw new AttentionError("RENDER_LINT_LENGTH", `${field} exceeds ${maxLength} characters.`, {
      field,
      length: text.length,
      maxLength
    });
  }
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(text)) {
      throw new AttentionError("RENDER_LINT_FORBIDDEN", `${field} contains forbidden model-visible text.`, {
        field,
        pattern: String(pattern)
      });
    }
  }
  return true;
}
