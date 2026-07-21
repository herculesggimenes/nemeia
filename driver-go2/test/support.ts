import { generateKeyPairSync } from "node:crypto";
import { signCanonicalJson } from "../../contracts/src/signing.ts";

export function makeStreamAuthorization({ clock = () => new Date("2026-07-07T17:00:00.000Z") } = {}) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const unsigned = {
    id: "auth_go2_stream",
    schema_version: 1,
    robot_id: "go2",
    run_id: "run_go2_stream",
    mission_id: "msn_go2_stream",
    grant: {
      stream: {
        action_space: "base_velocity_3d",
        limits: { max_speed_mps: 0.12, max_yaw_rps: 0.15 },
        watchdog_ms: 100,
        max_duration_ms: 1_000
      }
    },
    enforcement: { max_speed_mps: "enforcing", max_yaw_rps: "enforcing" },
    streams_granted: ["camera_front"],
    abort_triggers: ["operator_stop", "stream_silence"],
    checks: [],
    issued_at: clock().toISOString(),
    expires_at: new Date(clock().getTime() + 120_000).toISOString(),
    signature: ""
  };
  return {
    publicKey,
    authorization: {
      ...unsigned,
      signature: signCanonicalJson(unsigned, privateKey)
    }
  };
}
