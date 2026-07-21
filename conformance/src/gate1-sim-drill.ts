import { EventLog } from "../../mission-server/src/event-log.ts";
import { MissionServer } from "../../mission-server/src/mission-server.ts";
import { ReplayBuilder } from "../../replay/src/replay-builder.ts";
import { SimDriver } from "../../supervisor/src/sim-driver.ts";
import { SupervisorKernel } from "../../supervisor/src/supervisor-kernel.ts";

export function runGate1SimDrill({ startTime = "2026-07-07T17:00:00.000Z" } = {}) {
  let nowMs = Date.parse(startTime);
  const clock = () => new Date(nowMs);
  const advanceMs = (ms) => {
    nowMs += ms;
  };

  const eventLog = new EventLog({ clock });
  const server = new MissionServer({ eventLog, clock });
  const driver = new SimDriver({ robotId: "go2", clock });
  driver.connect();
  const kernel = new SupervisorKernel({
    robotId: "go2",
    driver,
    trustedPublicKey: server.publicKey,
    clock
  });

  const mission = server.createMission({
    idempotencyKey: "gate1-mission",
    preset: { id: "preset_gate1_sim", version: "0.2.1" },
    robot_ids: ["go2"],
    principal: "operator"
  });
  const proposedRun = server.proposeRun({
    idempotencyKey: "gate1-run",
    mission_id: mission.id,
    robot_id: "go2",
    verb: "follow",
    args: { max_speed_mps: 0.15, max_yaw_rps: 0.2, watchdog_ms: 100, max_duration_ms: 1_000 },
    reason: "Gate 1 sim drill bounded stream command.",
    expected_result: "Supervisor clamps, executes, and stops to safe state.",
    proposed_by: "agent"
  });
  const { run, authorization } = server.approveRun({
    idempotencyKey: "gate1-approve",
    run_id: proposedRun.id,
    operator: "op_gate1",
    reason: "Approved for conformance drill."
  });

  const accepted = kernel.execute(authorization);
  kernel.submitChunk({
    auth_id: authorization.id,
    seq: 1,
    setpoint: { vx_mps: 0.25, vy_mps: 0, yaw_rps: 0.35 }
  });
  const activeTick = kernel.tick();
  advanceMs(10);
  const stop = kernel.stop({ source: "operator_stop" });
  bridgeKernelEvents({ eventLog, server, events: kernel.events() });

  const replay = new ReplayBuilder({
    eventLog,
    getAuthorization: (id) => (id === authorization.id ? authorization : null)
  }).buildRunReplay(run.id);

  const report = {
    schema_version: 1,
    suite: "NEM Gate 1 simulation drill",
    suite_version: "0.2.1",
    result: gate1Pass({ accepted, activeTick, stop, replay, driver, authorization, server }) ? "pass" : "fail",
    mission_id: mission.id,
    run_id: run.id,
    authorization_id: authorization.id,
    checks: gate1Checks({ accepted, activeTick, stop, replay, driver, authorization, server }),
    replay_event_types: replay.events.map((event) => event.event_type)
  };

  return {
    mission,
    run,
    authorization,
    accepted,
    activeTick,
    stop,
    replay,
    driver,
    server,
    eventLog,
    report
  };
}

function bridgeKernelEvents({ eventLog, server, events }) {
  for (const event of events) {
    const bridged = {
      schema_version: event.schema_version,
      source: event.source,
      event_type: event.event_type,
      severity: event.severity,
      robot_id: event.robot_id,
      mission_id: event.mission_id,
      run_id: event.run_id,
      refs: event.refs,
      payload: event.payload
    };
    if (event.event_type.startsWith("authorization.")) {
      server.recordAuthorizationEvent(bridged);
    } else {
      eventLog.append(bridged);
    }
  }
}

function gate1Pass(input) {
  return gate1Checks(input).every((check) => check.result === "pass");
}

function gate1Checks({ accepted, activeTick, stop, replay, driver, authorization, server }) {
  return [
    check("signed_authorization_required", replay.authorizations.some((entry) => entry.signature === authorization.signature)),
    check("supervisor_accepts_authorization", accepted.state === "active" && accepted.authorization_id === authorization.id),
    check("post_grant_clamp", activeTick.chunk_ack?.applied_setpoint?.vx_mps === 0.15 && activeTick.chunk_ack?.applied_setpoint?.yaw_rps === 0.2),
    check("stop_live_during_execution", stop.stop_state === true && replay.events.some((event) => event.event_type === "authorization.stopped")),
    check("safe_state_after_stop", driver.status().safe_state_active === true),
    check("mission_server_projects_run_terminal_state", server.getRun(authorization.run_id).state === "aborted" && replay.events.some((event) => event.event_type === "run.aborted")),
    check("run_causal_events_have_run_id", replay.events.every((event) => event.run_id === authorization.run_id)),
    check("replay_contains_authorization", replay.authorization_ids.includes(authorization.id))
  ];
}

function check(name, ok) {
  return {
    name,
    result: ok ? "pass" : "fail"
  };
}
