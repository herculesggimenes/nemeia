import type { JsonValue } from "./world-bridge/types.ts";

export type TypesafeQuestionType = "choice" | "score" | "noul";

export interface TypesafeQuestion {
  readonly id: string;
  readonly type: TypesafeQuestionType;
  readonly instructions: string;
  readonly criteria?: Readonly<Record<string, string>> | readonly string[] | string;
}

export interface TypesafeRequest {
  readonly model: "jev-1.13.0";
  readonly state: JsonValue;
  readonly questions: readonly TypesafeQuestion[];
}

export interface TypesafeProviderResponse {
  readonly answers: Readonly<Record<string, unknown>>;
}

export interface RecordedTypesafeProvider {
  evaluate(request: TypesafeRequest): Promise<TypesafeProviderResponse>;
}

export interface ChoiceAnswer {
  readonly choice: string;
  readonly probabilities: Readonly<Record<string, number>>;
  readonly confidence: number;
}

export interface ScoreAnswer {
  readonly score: number;
  readonly legend: readonly string[];
  readonly probabilities: readonly number[];
  readonly confidence: number;
}

export interface NoulAnswer {
  readonly noul: number;
}

export type TypesafeDecision =
  | { readonly kind: "choice"; readonly answer: ChoiceAnswer }
  | { readonly kind: "score"; readonly answer: ScoreAnswer }
  | { readonly kind: "noul"; readonly answer: NoulAnswer; readonly yes: boolean }
  | { readonly kind: "abstain"; readonly reason: "below-threshold" | "malformed" | "timeout" | "provider-error" };

export interface TypesafeThresholds {
  readonly minConfidence?: number;
  readonly minNoulYes?: number;
  readonly maxNoulNo?: number;
}

const MODEL = "jev-1.13.0" as const;

function finiteUnit(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function normalizeChoice(raw: unknown, question: TypesafeQuestion): ChoiceAnswer | null {
  const value = record(raw);
  if (value === null || typeof value.choice !== "string" || !finiteUnit(value.confidence)) return null;
  const probabilities = record(value.probabilities);
  if (probabilities === null || Object.values(probabilities).some((item) => !finiteUnit(item))) return null;
  const criteria = question.criteria;
  const allowed = criteria !== undefined && !Array.isArray(criteria) && typeof criteria === "object" ? Object.keys(criteria) : null;
  if (allowed !== null && !allowed.includes(value.choice)) return null;
  return { choice: value.choice, probabilities: probabilities as Record<string, number>, confidence: value.confidence };
}

function normalizeScore(raw: unknown, question: TypesafeQuestion): ScoreAnswer | null {
  const value = record(raw);
  if (value === null || !finiteNumber(value.score) || !finiteUnit(value.confidence) || !Array.isArray(value.legend)) return null;
  if (value.legend.some((item) => typeof item !== "string")) return null;
  if (!Array.isArray(value.probabilities) || value.probabilities.some((item) => !finiteUnit(item))) return null;
  const legend = value.legend as string[];
  const probabilities = value.probabilities as number[];
  if (legend.length === 0 || probabilities.length !== legend.length) return null;
  if (value.score < 0 || value.score > legend.length - 1) return null;
  return { score: value.score, legend, probabilities, confidence: value.confidence };
}

function normalizeNoul(raw: unknown): NoulAnswer | null {
  const value = record(raw);
  return value !== null && finiteUnit(value.noul) ? { noul: value.noul } : null;
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

/**
 * A narrow, recorded-fixture-friendly TypeSafe boundary. It never imports or
 * creates the paid provider client; production can inject a reviewed adapter
 * while deterministic tests inject recorded answers.
 */
export class TypesafeAdapter {
  private readonly provider: RecordedTypesafeProvider;

  constructor(provider: RecordedTypesafeProvider) {
    this.provider = provider;
  }

  async evaluate(
    state: JsonValue,
    question: TypesafeQuestion,
    thresholds: TypesafeThresholds = {},
  ): Promise<TypesafeDecision> {
    const minConfidence = thresholds.minConfidence ?? 0.7;
    if (!finiteUnit(minConfidence)) return { kind: "abstain", reason: "malformed" };
    try {
      const response = await this.provider.evaluate({ model: MODEL, state, questions: [question] });
      const raw = response.answers[question.id];
      if (question.type === "choice") {
        const answer = normalizeChoice(raw, question);
        if (answer === null) return { kind: "abstain", reason: "malformed" };
        return answer.confidence >= minConfidence
          ? { kind: "choice", answer }
          : { kind: "abstain", reason: "below-threshold" };
      }
      if (question.type === "score") {
        const answer = normalizeScore(raw, question);
        if (answer === null) return { kind: "abstain", reason: "malformed" };
        return answer.confidence >= minConfidence
          ? { kind: "score", answer }
          : { kind: "abstain", reason: "below-threshold" };
      }
      const answer = normalizeNoul(raw);
      if (answer === null) return { kind: "abstain", reason: "malformed" };
      const minYes = thresholds.minNoulYes ?? 0.8;
      const maxNo = thresholds.maxNoulNo ?? 0.2;
      if (!finiteUnit(minYes) || !finiteUnit(maxNo) || maxNo >= minYes) {
        return { kind: "abstain", reason: "malformed" };
      }
      if (answer.noul >= minYes) return { kind: "noul", answer, yes: true };
      if (answer.noul <= maxNo) return { kind: "noul", answer, yes: false };
      return { kind: "abstain", reason: "below-threshold" };
    } catch (error) {
      return { kind: "abstain", reason: isTimeout(error) ? "timeout" : "provider-error" };
    }
  }
}
