export class SimDriver {
  #robotId;
  #clock;
  #connected = false;
  #lastStatusAt;
  #safeStateActive = true;
  #faults = [];
  #setpoints = [];
  #safeStateCommands = [];
  #events = [];
  #nextSeq = 1;

  constructor({ robotId = "go2", clock = () => new Date() } = {}) {
    this.#robotId = robotId;
    this.#clock = clock;
    this.#lastStatusAt = clock();
  }

  manifest() {
    return {
      driver: this.#robotId,
      version: "0.1.0",
      action_spaces: [
        {
          name: "base_velocity_3d",
          kind: "continuous",
          hard_caps: { vx_mps: 0.25, vy_mps: 0.15, yaw_rps: 0.35 },
          observables: { velocity: "measured", force: "none" }
        }
      ],
      native_actions: [{ name: "damp", interruptible: true, safety_action: true }],
      streams: [{ name: "camera_front", type: "rgb", hz: 30 }],
      safe_state: {
        kind: "hold_posture",
        balance_loop: "driver_maintained",
        max_entry_ms: 20,
        on_total_loss: { behavior: "vendor:damp", within_ms: 300 }
      }
    };
  }

  connect() {
    this.#connected = true;
    this.#lastStatusAt = this.#clock();
    this.#emit("driver.connected", {});
  }

  disconnect() {
    this.#connected = false;
    this.#emit("driver.disconnected", {});
  }

  markStatusFresh() {
    this.#lastStatusAt = this.#clock();
  }

  status() {
    const heartbeat_age_ms = Math.max(0, this.#clock().getTime() - this.#lastStatusAt.getTime());
    return {
      robot_id: this.#robotId,
      heartbeat_age_ms,
      battery: { pct: 100, power_headroom: "nominal" },
      safe_state_active: this.#safeStateActive,
      pose: {
        frame_id: "map",
        position: [0, 0, 0],
        rotation_xyzw: [0, 0, 0, 1],
        age_ms: heartbeat_age_ms
      },
      faults: this.#connected ? [...this.#faults] : ["driver_disconnected"],
      vendor_display: { mode: this.#safeStateActive ? "safe_state" : "sim_motion" }
    };
  }

  set_setpoint(action_space, setpoint) {
    this.#safeStateActive = false;
    this.#setpoints.push({ action_space, setpoint, at: this.#clock().toISOString() });
    this.#lastStatusAt = this.#clock();
    this.#emit("driver.setpoint_applied", { action_space, setpoint });
    return { ack: true };
  }

  execute_discrete(action, params, deadline_ms) {
    this.#safeStateActive = false;
    this.#setpoints.push({
      action_space: action,
      setpoint: params,
      deadline_ms,
      at: this.#clock().toISOString()
    });
    this.#lastStatusAt = this.#clock();
    this.#emit("driver.native_action", { action, params, deadline_ms });
    return { ack: true };
  }

  command_safe_state() {
    this.#safeStateActive = true;
    this.#safeStateCommands.push({ at: this.#clock().toISOString() });
    this.#lastStatusAt = this.#clock();
    this.#emit("driver.safe_state_commanded", {});
    return { ack: true };
  }

  events({ after = 0 } = {}) {
    return this.#events.filter((event) => event.seq > after);
  }

  appliedSetpoints() {
    return [...this.#setpoints];
  }

  safeStateCommands() {
    return [...this.#safeStateCommands];
  }

  #emit(event_type, payload, severity = 0) {
    this.#events.push({
      seq: this.#nextSeq++,
      schema_version: 1,
      source: `driver:${this.#robotId}`,
      event_type,
      severity,
      timestamp: this.#clock().toISOString(),
      robot_id: this.#robotId,
      refs: [],
      payload
    });
  }
}
