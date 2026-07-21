import { AttentionError } from "./attention-errors.ts";

const CONSTANTS = { INFO: 0, WARNING: 1, CRITICAL: 2, true: true, false: false };
const NUMERIC_PATHS = new Set(["event.severity", "inbox.pending_count", "inbox.pending_age", "inbox.max_severity"]);
const STRING_PATHS = new Set(["event.theme", "event.type", "event.robot_id", "event.entity_id", "event.source", "mission.id", "mission.principal", "mission.bound_entity"]);
const BOOLEAN_PATHS = new Set(["mission.turn_active"]);
const MAX_COST = 50;

export function compilePredicate(source, { maxCost = MAX_COST } = {}) {
  const parser = new Parser(tokenize(String(source ?? "").trim()));
  const ast = parser.parse();
  const cost = nodeCost(ast);
  if (cost > maxCost) {
    throw new AttentionError("CEL_COST_EXCEEDED", "Wake predicate exceeds static cost ceiling.", { cost, max_cost: maxCost });
  }
  typeCheck(ast);
  return {
    source: String(source ?? ""),
    cost,
    evaluate: (env) => Boolean(evaluate(ast, env)),
    nextTimerAt: (env, now) => nextTimerAt(ast, env, now)
  };
}

function tokenize(source) {
  if (!source || source === "false") {
    return [{ type: "boolean", value: false }];
  }
  const tokens = [];
  let index = 0;
  while (index < source.length) {
    const rest = source.slice(index);
    const whitespace = rest.match(/^\s+/);
    if (whitespace) {
      index += whitespace[0].length;
      continue;
    }
    const string = rest.match(/^"([^"\\]|\\.)*"/);
    if (string) {
      tokens.push({ type: "string", value: JSON.parse(string[0]) });
      index += string[0].length;
      continue;
    }
    const number = rest.match(/^\d+(\.\d+)?/);
    if (number) {
      tokens.push({ type: "number", value: Number(number[0]) });
      index += number[0].length;
      continue;
    }
    const operator = rest.match(/^(>=|<=|==|!=|>|<|&&|\|\||[()])/);
    if (operator) {
      tokens.push({ type: "operator", value: operator[0] });
      index += operator[0].length;
      continue;
    }
    const identifier = rest.match(/^[A-Za-z_][A-Za-z0-9_.]*/);
    if (identifier) {
      const value = identifier[0];
      tokens.push(value in CONSTANTS ? { type: typeof CONSTANTS[value] === "boolean" ? "boolean" : "number", value: CONSTANTS[value] } : { type: "identifier", value });
      index += value.length;
      continue;
    }
    throw new AttentionError("CEL_PARSE_ERROR", "Wake predicate contains unsupported syntax.", { at: index });
  }
  return tokens;
}

class Parser {
  #tokens;
  #index = 0;

  constructor(tokens) {
    this.#tokens = tokens;
  }

  parse() {
    const expr = this.#or();
    if (this.#peek()) {
      throw new AttentionError("CEL_PARSE_ERROR", "Wake predicate has trailing tokens.", { token: this.#peek().value });
    }
    return expr;
  }

  #or() {
    let left = this.#and();
    while (this.#match("||")) {
      left = { type: "logical", op: "||", left, right: this.#and() };
    }
    return left;
  }

  #and() {
    let left = this.#comparison();
    while (this.#match("&&")) {
      left = { type: "logical", op: "&&", left, right: this.#comparison() };
    }
    return left;
  }

  #comparison() {
    let left = this.#primary();
    const token = this.#peek();
    if (token?.type === "operator" && [">=", "<=", ">", "<", "==", "!="].includes(token.value)) {
      this.#index += 1;
      left = { type: "comparison", op: token.value, left, right: this.#primary() };
    }
    return left;
  }

  #primary() {
    const token = this.#peek();
    if (!token) {
      throw new AttentionError("CEL_PARSE_ERROR", "Wake predicate ended unexpectedly.");
    }
    this.#index += 1;
    if (token.type === "operator" && token.value === "(") {
      const expr = this.#or();
      if (!this.#match(")")) {
        throw new AttentionError("CEL_PARSE_ERROR", "Wake predicate is missing a closing parenthesis.");
      }
      return expr;
    }
    if (["number", "string", "boolean"].includes(token.type)) {
      return { type: "literal", value: token.value, valueType: token.type };
    }
    if (token.type === "identifier") {
      return { type: "path", path: token.value, valueType: pathType(token.value) };
    }
    throw new AttentionError("CEL_PARSE_ERROR", "Wake predicate contains an unexpected token.", { token: token.value });
  }

  #match(value) {
    if (this.#peek()?.value === value) {
      this.#index += 1;
      return true;
    }
    return false;
  }

  #peek() {
    return this.#tokens[this.#index] ?? null;
  }
}

function typeCheck(node) {
  if (node.type === "logical") {
    if (typeCheck(node.left) !== "boolean" || typeCheck(node.right) !== "boolean") {
      throw new AttentionError("CEL_TYPE_ERROR", "Logical operators require boolean operands.", { op: node.op });
    }
    return "boolean";
  }
  if (node.type === "comparison") {
    const left = typeCheck(node.left);
    const right = typeCheck(node.right);
    if (left !== right) {
      throw new AttentionError("CEL_TYPE_ERROR", "Comparison operands must have the same type.", { op: node.op, left, right });
    }
    if (["<", "<=", ">", ">="].includes(node.op) && left !== "number") {
      throw new AttentionError("CEL_TYPE_ERROR", "Ordered comparisons require numeric operands.", { op: node.op });
    }
    return "boolean";
  }
  return node.valueType;
}

function pathType(path) {
  if (NUMERIC_PATHS.has(path)) {
    return "number";
  }
  if (STRING_PATHS.has(path)) {
    return "string";
  }
  if (BOOLEAN_PATHS.has(path)) {
    return "boolean";
  }
  throw new AttentionError("CEL_TYPE_ERROR", "Wake predicate references an unknown field.", { path });
}

function evaluate(node, env) {
  if (node.type === "literal") {
    return node.value;
  }
  if (node.type === "path") {
    const value = valueAtPath(env, node.path);
    if (node.valueType === "number" && !Number.isFinite(value)) {
      throw new AttentionError("CEL_RUNTIME_ERROR", "Wake predicate numeric field is not finite.", { path: node.path, value });
    }
    return value;
  }
  if (node.type === "logical") {
    return node.op === "&&" ? evaluate(node.left, env) && evaluate(node.right, env) : evaluate(node.left, env) || evaluate(node.right, env);
  }
  const left = evaluate(node.left, env);
  const right = evaluate(node.right, env);
  switch (node.op) {
    case ">=":
      return left >= right;
    case "<=":
      return left <= right;
    case ">":
      return left > right;
    case "<":
      return left < right;
    case "==":
      return left === right;
    case "!=":
      return left !== right;
    default:
      return false;
  }
}

function valueAtPath(env, path) {
  if (path === "event.theme") {
    return env.event.theme;
  }
  if (path === "event.type") {
    return env.event.type;
  }
  return path.split(".").reduce((value, key) => value?.[key], env);
}

function nodeCost(node) {
  if (node.type === "literal" || node.type === "path") {
    return 1;
  }
  return 1 + nodeCost(node.left) + nodeCost(node.right);
}

function nextTimerAt(node, env, now) {
  const current = Number(now instanceof Date ? now.getTime() : new Date(now).getTime());
  if (!Number.isFinite(current)) {
    throw new AttentionError("CEL_RUNTIME_ERROR", "Wake predicate timer received an invalid current time.", { now });
  }
  return timerForFalseNode(node, env, current);
}

function timerForFalseNode(node, env, nowMs) {
  if (evaluate(node, env)) {
    return null;
  }
  if (node.type === "logical") {
    const leftTimer = timerForFalseNode(node.left, env, nowMs);
    const rightTimer = timerForFalseNode(node.right, env, nowMs);
    if (node.op === "||") {
      return minDate(leftTimer, rightTimer);
    }
    return maxDate(leftTimer, rightTimer);
  }
  if (node.type === "comparison") {
    return comparisonTimer(node, env, nowMs);
  }
  return null;
}

function comparisonTimer(node, env, nowMs) {
  const normalized = pendingAgeComparison(node);
  if (!normalized) {
    return null;
  }
  const age = Number(valueAtPath(env, "inbox.pending_age"));
  if (!Number.isFinite(age)) {
    throw new AttentionError("CEL_RUNTIME_ERROR", "Wake predicate pending_age is not finite.", { value: age });
  }
  const { op, threshold } = normalized;
  if (!Number.isFinite(threshold)) {
    return null;
  }
  if ((op === ">=" && age < threshold) || (op === "==" && age < threshold)) {
    return new Date(nowMs + Math.max(0, threshold - age));
  }
  if (op === ">" && age <= threshold) {
    return new Date(nowMs + Math.max(1, threshold - age + 1));
  }
  return null;
}

function pendingAgeComparison(node) {
  if (node.left.type === "path" && node.left.path === "inbox.pending_age" && node.right.type === "literal" && node.right.valueType === "number") {
    return { op: node.op, threshold: node.right.value };
  }
  if (node.right.type === "path" && node.right.path === "inbox.pending_age" && node.left.type === "literal" && node.left.valueType === "number") {
    return { op: reverseComparison(node.op), threshold: node.left.value };
  }
  return null;
}

function reverseComparison(op) {
  return { ">=": "<=", "<=": ">=", ">": "<", "<": ">", "==": "==", "!=": "!=" }[op] ?? op;
}

function minDate(left, right) {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  return left.getTime() <= right.getTime() ? left : right;
}

function maxDate(left, right) {
  if (!left || !right) {
    return null;
  }
  return left.getTime() >= right.getTime() ? left : right;
}
