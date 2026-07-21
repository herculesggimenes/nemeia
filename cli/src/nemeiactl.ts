import { randomUUID } from "node:crypto";
import { MissionApi } from "../../mission-api/src/mission-api.ts";
import { EventLog } from "../../mission-server/src/event-log.ts";
import { MissionServer } from "../../mission-server/src/mission-server.ts";
import { SceneProjector } from "../../scene/src/scene-projector.ts";
import { SimDriver } from "../../supervisor/src/sim-driver.ts";
import { SupervisorKernel } from "../../supervisor/src/supervisor-kernel.ts";
import { CliError, toErrorBody } from "./cli-errors.ts";

const EXIT = {
  ok: 0,
  blocked: 3,
  invalid: 4,
  infra: 5,
  timeout: 6,
  auth: 7
};

const TOKEN_FOR_PRINCIPAL = {
  agent: "agent-token",
  operator: "operator-token",
  reader: "read-token"
};

export class NemeiaCtl {
  #api;
  #localApi;
  #eventLog;
  #principal;
  #operatorToken;
  #apiUrl;
  #supervisorUrl;
  #defaultMissionId = null;
  #currentToolCall = null;
  #apiRequestCount = 0;

  constructor({ api, apiUrl = null, eventLog = new EventLog(), principal = "agent", operatorToken = "operator-token", supervisorUrl = null } = {}) {
    this.#localApi = api ?? new MissionApi({ eventLog });
    this.#api = this.#localApi;
    this.#eventLog = eventLog;
    this.#principal = principal;
    this.#operatorToken = operatorToken;
    this.#apiUrl = apiUrl;
    this.#supervisorUrl = supervisorUrl;
  }

  static withSim({ robotId = "go2", clock = () => new Date() } = {}) {
    const eventLog = new EventLog({ clock });
    const scene = new SceneProjector({ eventLog, clock });
    const driver = new SimDriver({ robotId, clock });
    driver.connect();
    const missionServer = new MissionServer({ eventLog, scene, driverManifest: driver.manifest(), clock });
    const supervisor = new SupervisorKernel({
      robotId,
      driver,
      trustedPublicKey: missionServer.publicKey,
      clock
    });
    const api = new MissionApi({
      eventLog,
      missionServer,
      scene,
      supervisors: new Map([[robotId, supervisor]]),
      drivers: new Map([[robotId, driver]]),
      clock
    });
    return new NemeiaCtl({ api, eventLog });
  }

  async run(argv, env = {}) {
    let invocation;
    try {
      invocation = parseArgv(argv);
    } catch (error) {
      const body = toErrorBody(error);
      return { exitCode: EXIT.invalid, stdout: `${JSON.stringify(body)}\n`, body };
    }

    const command_id = makeCommandId();
    const turn_id = invocation.flags["turn-id"] ?? env.NEMEIA_TURN_ID ?? null;
    const principal = invocation.flags.principal ?? this.#principal;
    const previousApi = this.#api;
    const previousToolCall = this.#currentToolCall;
    const previousApiRequestCount = this.#apiRequestCount;
    this.#api = this.#apiFor(invocation.flags["api-url"] ?? env.NEMEIA_API_URL ?? this.#apiUrl);
    this.#currentToolCall = { argv: [...argv], principal, turn_id, command_id };
    this.#apiRequestCount = 0;

    try {
      const response = await this.#dispatch(invocation, { command_id, principal });
      if (this.#apiRequestCount === 0) {
        this.#appendToolCall(this.#currentToolCall);
      }
      return {
        exitCode: exitCodeForStatus(response.status),
        stdout: render(response.body, invocation),
        body: response.body,
        response
      };
    } catch (error) {
      const exitCode = error?.exitCode ?? EXIT.infra;
      const body = toErrorBody(error);
      return {
        exitCode,
        stdout: render(body, invocation),
        body
      };
    } finally {
      this.#api = previousApi;
      this.#currentToolCall = previousToolCall;
      this.#apiRequestCount = previousApiRequestCount;
    }
  }

  async #dispatch(invocation, context) {
    switch (invocation.group) {
      case "health":
        return this.#apiRequest({ method: "GET", path: "/health", principal: context.principal });
      case "robot":
        return this.#robot(invocation, context);
      case "scene":
        return this.#scene(invocation, context);
      case "entity":
        return this.#entity(invocation, context);
      case "mission":
        return this.#mission(invocation, context);
      case "run":
        return this.#run(invocation, context);
      case "events":
        return this.#events(invocation, context);
      case "replay":
        return this.#replay(invocation, context);
      case "anomaly":
        return this.#anomaly(invocation, context);
      default:
        throw new CliError("UNKNOWN_COMMAND", `Unknown command group ${invocation.group}.`, {
          exitCode: EXIT.invalid,
          recommended_action: "Run `nemeiactl health --json` to verify the CLI is reachable."
        });
    }
  }

  async #robot(invocation, context) {
    switch (invocation.verb) {
      case "list":
        return this.#apiRequest({ method: "GET", path: "/robots", principal: context.principal });
      case "status":
        return this.#apiRequest({ method: "GET", path: `/robots/${requiredPositional(invocation, 0, "robot_id")}/status`, principal: context.principal });
      case "stop":
        return this.#robotStop(requiredPositional(invocation, 0, "robot_id"), invocation, context);
      case "clear-stop":
        return this.#apiRequest({
          method: "POST",
          path: `/robots/${requiredPositional(invocation, 0, "robot_id")}/clear-stop`,
          principal: "operator",
          idempotencyKey: context.command_id
        });
      case "move":
        return this.#robotMove(requiredPositional(invocation, 0, "robot_id"), invocation, context);
      case "action":
        return this.#robotAction(requiredPositional(invocation, 0, "robot_id"), requiredPositional(invocation, 1, "action"), invocation, context);
      default:
        throw new CliError("UNKNOWN_COMMAND", `Unknown robot verb ${invocation.verb}.`, { exitCode: EXIT.invalid });
    }
  }

  async #robotStop(robot_id, invocation, context) {
    try {
      return await this.#apiRequest({
        method: "POST",
        path: `/robots/${robot_id}/stop`,
        principal: context.principal,
        idempotencyKey: context.command_id
      });
    } catch (error) {
      const supervisorUrl = invocation.flags["supervisor-url"] ?? this.#supervisorUrl;
      if (!supervisorUrl || error?.error_code !== "API_UNREACHABLE") {
        throw error;
      }
      return this.#supervisorStopFallback({
        robot_id,
        supervisorUrl: String(supervisorUrl),
        toolCall: this.#currentToolCall
      });
    }
  }

  async #robotMove(robot_id, invocation, { command_id, principal }) {
    const mission_id = await this.#missionIdForRobot(robot_id, invocation);
    const proposed = await this.#apiRequest({
      method: "POST",
      path: "/runs",
      principal,
      idempotencyKey: command_id,
      body: {
        mission_id,
        robot_id,
        verb: "bounded_move",
        args: {
          x: requiredNumberFlag(invocation, "x"),
          y: numberFlag(invocation, "y", 0),
          yaw: numberFlag(invocation, "yaw", 0),
          duration_ms: numberFlag(invocation, "duration-ms", 400)
        },
        reason: "nemeiactl robot move"
      }
    });
    if (!invocation.flags.approve || proposed.status >= 400) {
      return proposed;
    }
    return this.#apiRequest({
      method: "POST",
      path: `/runs/${proposed.body.id}/approve`,
      principal: "operator",
      idempotencyKey: `${command_id}:approve`,
      body: { reason: "nemeiactl --approve" }
    });
  }

  async #robotAction(robot_id, action, invocation, { command_id, principal }) {
    const mission_id = await this.#missionIdForRobot(robot_id, invocation);
    const proposed = await this.#apiRequest({
      method: "POST",
      path: "/runs",
      principal,
      idempotencyKey: command_id,
      body: {
        mission_id,
        robot_id,
        verb: `native:${action}`,
        args: { duration_ms: numberFlag(invocation, "duration-ms", 200) },
        reason: `nemeiactl robot action ${action}`
      }
    });
    if (!invocation.flags.approve || proposed.status >= 400) {
      return proposed;
    }
    return this.#apiRequest({
      method: "POST",
      path: `/runs/${proposed.body.id}/approve`,
      principal: "operator",
      idempotencyKey: `${command_id}:approve`,
      body: { reason: "nemeiactl --approve" }
    });
  }

  async #scene(invocation, context) {
    if (invocation.verb !== "get" && invocation.verb !== "refresh") {
      throw new CliError("UNKNOWN_COMMAND", `Unknown scene verb ${invocation.verb}.`, { exitCode: EXIT.invalid });
    }
    return this.#apiRequest({ method: "GET", path: "/scene", principal: context.principal });
  }

  async #entity(invocation, context) {
    if (invocation.verb !== "get") {
      throw new CliError("UNKNOWN_COMMAND", `Unknown entity verb ${invocation.verb}.`, { exitCode: EXIT.invalid });
    }
    const query = new URLSearchParams();
    if (invocation.flags.include !== undefined) {
      query.set("include", String(invocation.flags.include));
    }
    return this.#apiRequest({
      method: "GET",
      path: `/entities/${requiredPositional(invocation, 0, "entity_id")}${query.size ? `?${query}` : ""}`,
      principal: context.principal
    });
  }

  async #mission(invocation, context) {
    if (invocation.verb === "get") {
      const mission_id = invocation.flags.id ?? invocation.positionals[0] ?? (await this.#missionIdForRobot(invocation.flags.robot ?? "go2", invocation));
      return this.#apiRequest({ method: "GET", path: `/missions/${mission_id}`, principal: context.principal });
    }
    if (invocation.verb === "rule" && invocation.positionals[0] === "get") {
      return {
        status: 200,
        body: { rules: [] }
      };
    }
    throw new CliError("UNKNOWN_COMMAND", `Unknown mission command ${invocation.verb ?? ""}.`, { exitCode: EXIT.invalid });
  }

  async #run(invocation, context) {
    const run_id = requiredPositional(invocation, 0, "run_id");
    switch (invocation.verb) {
      case "get":
        return this.#apiRequest({ method: "GET", path: `/runs/${run_id}`, principal: context.principal });
      case "approve":
        return this.#apiRequest({
          method: "POST",
          path: `/runs/${run_id}/approve`,
          principal: "operator",
          idempotencyKey: context.command_id,
          body: { ...(invocation.flags.reason ? { reason: String(invocation.flags.reason) } : {}) }
        });
      case "reject":
        return this.#apiRequest({
          method: "POST",
          path: `/runs/${run_id}/reject`,
          principal: "operator",
          idempotencyKey: context.command_id,
          body: { ...(invocation.flags.reason ? { reason: String(invocation.flags.reason) } : {}) }
        });
      case "replay":
        return this.#apiRequest({ method: "GET", path: `/runs/${run_id}/replay`, principal: context.principal });
      default:
        throw new CliError("UNKNOWN_COMMAND", `Unknown run verb ${invocation.verb ?? ""}.`, { exitCode: EXIT.invalid });
    }
  }

  async #events(invocation, context) {
    if (invocation.verb !== "tail") {
      throw new CliError("UNKNOWN_COMMAND", `Unknown events verb ${invocation.verb}.`, { exitCode: EXIT.invalid });
    }
    const query = new URLSearchParams();
    if (invocation.flags.after !== undefined) {
      query.set("after", String(invocation.flags.after));
    }
    if (invocation.flags.limit !== undefined) {
      query.set("limit", String(invocation.flags.limit));
    }
    for (const flag of ["event-type", "event-types", "theme", "themes", "mission-id", "run-id", "robot-id", "source", "since", "until"]) {
      if (invocation.flags[flag] !== undefined) {
        query.set(flag.replaceAll("-", "_"), String(invocation.flags[flag]));
      }
    }
    return this.#apiRequest({ method: "GET", path: `/events${query.size ? `?${query}` : ""}`, principal: context.principal });
  }

  async #replay(invocation, context) {
    if (invocation.verb !== "command") {
      throw new CliError("UNKNOWN_COMMAND", `Unknown replay verb ${invocation.verb}.`, { exitCode: EXIT.invalid });
    }
    return this.#apiRequest({ method: "GET", path: `/runs/${requiredPositional(invocation, 0, "command_id")}/replay`, principal: context.principal });
  }

  async #anomaly(invocation, context) {
    switch (invocation.verb) {
      case "list": {
        const query = new URLSearchParams();
        for (const [flag, apiName] of [["status", "status"], ["severity", "severity"], ["mission", "mission_id"], ["capability", "capability"]]) {
          if (invocation.flags[flag] !== undefined) {
            query.set(apiName, String(invocation.flags[flag]));
          }
        }
        return this.#apiRequest({ method: "GET", path: `/anomalies${query.size ? `?${query}` : ""}`, principal: context.principal });
      }
      case "create":
        return this.#apiRequest({
          method: "POST",
          path: "/anomalies",
          principal: "operator",
          idempotencyKey: context.command_id,
          body: {
            severity: stringFlag(invocation, "severity", "warning"),
            mission_id: requiredStringFlag(invocation, "mission"),
            ...(invocation.flags.run ? { run_id: invocation.flags.run } : {}),
            ...(invocation.flags.capability ? { capability: invocation.flags.capability } : {}),
            ...(invocation.flags.driver ? { driver: invocation.flags.driver } : {}),
            expected: requiredStringFlag(invocation, "expected"),
            observed: requiredStringFlag(invocation, "observed"),
            evidence_refs: listFlag(invocation, "evidence-ref"),
            ...(invocation.flags.owner ? { owner: invocation.flags.owner } : {}),
            ...(invocation.flags["closure-criteria"] ? { closure_criteria: invocation.flags["closure-criteria"] } : {})
          }
        });
      case "close":
        return this.#apiRequest({
          method: "PATCH",
          path: `/anomalies/${requiredPositional(invocation, 0, "anomaly_id")}`,
          principal: "operator",
          idempotencyKey: context.command_id,
          body: {
            status: "closed",
            ...(invocation.flags.owner ? { owner: invocation.flags.owner } : {}),
            evidence_refs: listFlag(invocation, "evidence-ref"),
            ...(invocation.flags.resolution ? { resolution: invocation.flags.resolution } : {})
          }
        });
      default:
        throw new CliError("UNKNOWN_COMMAND", `Unknown anomaly verb ${invocation.verb}.`, { exitCode: EXIT.invalid });
    }
  }

  async #missionIdForRobot(robot_id, invocation) {
    if (invocation.flags.mission) {
      return String(invocation.flags.mission);
    }
    if (this.#defaultMissionId) {
      return this.#defaultMissionId;
    }
    const response = await this.#apiRequest({
      method: "POST",
      path: "/missions",
      principal: "operator",
      idempotencyKey: `cli-default:${robot_id}`,
      body: { preset: "cli.default", robot_ids: [robot_id] }
    });
    if (response.status >= 400) {
      throw new CliError(response.body.error_code, response.body.message, { exitCode: exitCodeForStatus(response.status), details: response.body.details ?? {} });
    }
    this.#defaultMissionId = response.body.id;
    return this.#defaultMissionId;
  }

  async #apiRequest({ method, path, principal, body = {}, idempotencyKey }) {
    const headers = {
      authorization: `Bearer ${this.#tokenForPrincipal(principal)}`,
      ...(this.#currentToolCall ? { "x-nemeia-tool-call": JSON.stringify(this.#currentToolCall) } : {}),
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {})
    };
    this.#apiRequestCount += 1;
    return this.#api.handle({ method, path, headers, body });
  }

  #tokenForPrincipal(principal) {
    if (principal === "operator") {
      return this.#operatorToken;
    }
    return TOKEN_FOR_PRINCIPAL[principal] ?? TOKEN_FOR_PRINCIPAL.agent;
  }

  #apiFor(apiUrl) {
    return apiUrl ? new MissionApiHttpClient({ baseUrl: String(apiUrl) }) : this.#localApi;
  }

  #appendToolCall({ argv, principal, turn_id, command_id }) {
    return this.#eventLog.append({
      schema_version: 1,
      source: "nemeiactl",
      event_type: "tool.call",
      severity: 0,
      payload: {
        argv: [...argv],
        principal,
        turn_id,
        command_id
      }
    });
  }

  async #supervisorStopFallback({ robot_id, supervisorUrl, toolCall }) {
    const response = await new SupervisorHttpClient({ baseUrl: supervisorUrl }).stop({ source: "nemeiactl:stop_via_fallback" });
    if (toolCall) {
      this.#appendToolCall(toolCall);
    }
    const event = this.#eventLog.append({
      schema_version: 1,
      source: "nemeiactl",
      event_type: "robot.stop_via_fallback",
      severity: 1,
      robot_id,
      payload: {
        command_id: toolCall?.command_id ?? null,
        event_name: "stop_via_fallback",
        principal: toolCall?.principal ?? null,
        supervisor_url: supervisorUrl,
        stop: response.body
      }
    });
    return {
      status: response.status,
      body: {
        ...response.body,
        event_id: `evt_${event.seq}`,
        fallback: "supervisor",
        robot_id
      }
    };
  }
}

export class MissionApiHttpClient {
  #baseUrl;

  constructor({ baseUrl }) {
    this.#baseUrl = String(baseUrl).replace(/\/+$/, "");
  }

  async handle({ method, path, headers = {}, body = {} }) {
    let response;
    try {
      response = await fetch(`${this.#baseUrl}${path}`, {
        method,
        headers: {
          "content-type": "application/json",
          ...headers
        },
        ...(method === "GET" || method === "HEAD" ? {} : { body: JSON.stringify(body ?? {}) })
      });
    } catch (error) {
      throw new CliError("API_UNREACHABLE", "Mission API server is unreachable.", {
        exitCode: EXIT.infra,
        details: { cause: error instanceof Error ? error.message : String(error) }
      });
    }
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: await readResponseBody(response)
    };
  }
}

export class SupervisorHttpClient {
  #baseUrl;

  constructor({ baseUrl }) {
    this.#baseUrl = String(baseUrl).replace(/\/+$/, "");
  }

  async stop({ source }) {
    let response;
    try {
      response = await fetch(`${this.#baseUrl}/stop`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source })
      });
    } catch (error) {
      throw new CliError("SUPERVISOR_UNREACHABLE", "Supervisor Kernel server is unreachable.", {
        exitCode: EXIT.infra,
        details: { cause: error instanceof Error ? error.message : String(error) }
      });
    }
    return {
      status: response.status,
      body: await readResponseBody(response)
    };
  }
}

async function readResponseBody(response) {
  const text = await response.text();
  if (!text.trim()) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new CliError("API_RESPONSE_INVALID", "Mission API server returned invalid JSON.", { exitCode: EXIT.infra, details: { status: response.status } });
  }
}

export function parseArgv(argv) {
  const tokens = [...argv];
  const group = tokens.shift();
  if (!group) {
    throw new CliError("UNKNOWN_COMMAND", "Missing command group.", { exitCode: EXIT.invalid });
  }

  const flags = {};
  const positionals = [];
  while (tokens.length > 0) {
    const token = tokens.shift();
    if (token.startsWith("--")) {
      const raw = token.slice(2);
      const [key, inline] = raw.split("=", 2);
      if (!key) {
        throw new CliError("INVALID_ARGUMENT", `Invalid flag ${token}.`, { exitCode: EXIT.invalid });
      }
      if (inline !== undefined) {
        flags[key] = inline;
      } else if (tokens[0] && !tokens[0].startsWith("--")) {
        flags[key] = tokens.shift();
      } else {
        flags[key] = true;
      }
    } else {
      positionals.push(token);
    }
  }

  return {
    group,
    verb: positionals.shift() ?? null,
    positionals,
    flags
  };
}

function render(body, invocation) {
  if (invocation.flags.pretty) {
    return `${JSON.stringify(body, null, 2)}\n`;
  }
  return `${JSON.stringify(body)}\n`;
}

function requiredPositional(invocation, index, name) {
  const value = invocation.positionals[index];
  if (!value) {
    throw new CliError("INVALID_ARGUMENT", `Missing ${name}.`, { exitCode: EXIT.invalid });
  }
  return value;
}

function numberFlag(invocation, name, fallback) {
  const value = invocation.flags[name];
  if (value === undefined) {
    return fallback;
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new CliError("INVALID_ARGUMENT", `--${name} must be a finite number.`, { exitCode: EXIT.invalid });
  }
  return number;
}

function requiredNumberFlag(invocation, name) {
  if (invocation.flags[name] === undefined) {
    throw new CliError("INVALID_ARGUMENT", `Missing --${name}.`, { exitCode: EXIT.invalid });
  }
  return numberFlag(invocation, name);
}

function stringFlag(invocation, name, fallback) {
  return invocation.flags[name] === undefined ? fallback : String(invocation.flags[name]);
}

function requiredStringFlag(invocation, name) {
  if (invocation.flags[name] === undefined) {
    throw new CliError("INVALID_ARGUMENT", `Missing --${name}.`, { exitCode: EXIT.invalid });
  }
  return String(invocation.flags[name]);
}

function listFlag(invocation, name) {
  const value = invocation.flags[name];
  if (value === undefined || value === true) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => String(entry).split(",")).filter(Boolean);
  }
  return String(value).split(",").filter(Boolean);
}

function makeCommandId() {
  return `cmd_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

function exitCodeForStatus(status) {
  if (status < 400) {
    return EXIT.ok;
  }
  if (status === 401 || status === 403) {
    return EXIT.auth;
  }
  if (status === 408) {
    return EXIT.timeout;
  }
  if (status === 409 || status === 423) {
    return EXIT.blocked;
  }
  if (status >= 500) {
    return EXIT.infra;
  }
  return EXIT.invalid;
}
