# Unitree Integration

This note consolidates the findings from the `Explain unitree_ui backend` session and maps them into Nemeia's architecture.

## What `unitree_ui` Actually Does

`/Users/hgimenes/src/unitree_ui` is not a backend-heavy robot server. It is a browser app with a thin local proxy layer.

Important source files:

```text
/Users/hgimenes/src/unitree_ui/src/connection/local-connector.ts
/Users/hgimenes/src/unitree_ui/src/connection/remote-connector.ts
/Users/hgimenes/src/unitree_ui/src/connection/webrtc.ts
/Users/hgimenes/src/unitree_ui/src/protocol/data-channel.ts
/Users/hgimenes/src/unitree_ui/src/protocol/topics.ts
/Users/hgimenes/src/unitree_ui/src/proxy-plugin.ts
/Users/hgimenes/src/unitree_ui/server/ble_server.py
```

The browser owns the `RTCPeerConnection`.

The local proxy exists because direct browser requests to robot-local endpoints can hit CORS and private-network restrictions. It does not mean local/AP control goes through a remote server.

```text
Unitree UI browser
  -> local Vite proxy
  -> Go2 HTTP/WebRTC signaling endpoint on LAN/AP
  -> direct WebRTC media/data connection with robot
```

Remote mode is different:

```text
Unitree UI browser
  -> local Vite proxy
  -> Unitree cloud APIs
  -> TURN/WebRTC relay
  -> robot
```

BLE is separate from the main WebRTC control path:

```text
Unitree UI browser
  -> local Vite /ble-api proxy
  -> Python BLE server on localhost:5051
  -> robot or Unitree remote
```

## Unitree Connection Flow

For local Go2 mode:

```text
connectLocal(ip, mode)
  -> probe robot port 9991 /con_notify, then old 8081 /offer fallback
  -> create WebRTC offer
  -> POST offer through local proxy with X-Robot-Host
  -> decrypt or parse SDP answer
  -> set remote description
  -> wait for data channel open
```

The WebRTC connection:

```text
RTCPeerConnection
  -> recv-only video transceiver
  -> sendrecv audio transceiver
  -> ordered data channel named "data"
  -> ontrack(video) emits robot camera MediaStream
  -> onmessage parses JSON or binary-framed Unitree messages
```

After validation, Unitree UI enables streams and subscribes to topics:

```text
publishTyped("", "on", DATA_CHANNEL_TYPE.VID)
publishTyped("", "on", DATA_CHANNEL_TYPE.AUD)
subscribe(RTC_TOPIC.LOW_STATE)
subscribe(RTC_TOPIC.LF_SPORT_MOD_STATE)
subscribe(RTC_TOPIC.LIDAR_ARRAY)
subscribe(RTC_TOPIC.ROBOT_ODOM)
```

## Important Unitree Topics

These are Unitree-specific and should not leak into the model-facing API.

```text
rt/api/sport/request               action/service requests
rt/wirelesscontroller              joystick-style velocity control
rt/utlidar/voxel_map_compressed    live Go2 voxel/LiDAR frame
rt/utlidar/robot_pose              robot odometry pose
rt/lf/lowstate                     low-level robot state
rt/lf/sportmodestate               sport-mode state
rt/lowcmd                          low-level command topic
```

Common sport command ids from `unitree_ui/src/protocol/topics.ts`:

```text
1001 Damp
1002 BalanceStand
1003 StopMove
1004 StandUp
1005 StandDown
1006 RecoveryStand
1008 Move
1009 Sit
1010 RiseSit
```

## Nemeia Integration Shape

Nemeia should not copy `unitree_ui` directly into the UI and let every button publish raw Unitree topics.

The model-facing and operator-facing contract should be Nemeia commands and Nemeia events:

```text
Nemeia frontend
  -> Nemeia app server / control plane
  -> Unitree adapter
  -> Unitree WebRTC signaling, data channel, media, topics
```

For the very first working version, we can keep the browser-owned WebRTC pattern from `unitree_ui` because it avoids building a media relay:

```text
Nemeia frontend
  -> /api/robots/go2/proxy/*
  -> Go2 local HTTP signaling endpoint
  -> browser-owned WebRTC media/data connection
```

But even in this simplified version, controls should still pass through a Nemeia command layer before publishing Unitree data-channel messages.

## V0 Scope

Build a local Go2 viewer first.

Include:

```text
settings page:
  robot id
  connection mode: AP or local network
  robot IP
  test connection
  connect / disconnect

camera artifact:
  replace mock canvas with robot MediaStream video
  keep Nemeia detection overlays separate from the stream

point-cloud artifact:
  first consume normalized Float32Array point frames
  later add Unitree compressed voxel decoding in a worker

control artifact:
  emergency stop
  damp
  balance stand
  stop move
  bounded velocity command
```

Exclude from v0:

```text
Unitree cloud remote mode
BLE provisioning
audio transmit
gamepad/BLE remote relay
lowcmd direct control
full SLAM map editing
autonomous policy execution
```

## Frontend Module Shape

Add a Unitree adapter feature with a narrow Nemeia-facing API:

```text
frontend/components/unitree/
  unitree-camera-view.tsx
  unitree-point-cloud-view.tsx
  go2-control-panel.tsx

frontend/lib/robots/unitree/
  go2-connection.ts
  go2-webrtc.ts
  go2-data-channel.ts
  go2-topics.ts
  go2-commands.ts
  go2-types.ts
```

The UI should talk to a hook like this:

```ts
type Go2ConnectionConfig = {
  robotId: string;
  ip: string;
  mode: "AP" | "STA-L";
};

type Go2Command =
  | { type: "emergency_stop" }
  | { type: "damp" }
  | { type: "balance_stand" }
  | { type: "stop_move" }
  | { type: "move"; vx: number; vy: number; yaw: number; durationMs: number };

type Go2Event =
  | { type: "connection_state"; state: "idle" | "connecting" | "connected" | "failed" | "disconnected" }
  | { type: "camera_stream"; stream: MediaStream }
  | { type: "robot_status"; battery?: number; mode?: string; heartbeatMs?: number }
  | { type: "point_cloud_frame"; frameId: string; positions: Float32Array; colors?: Float32Array }
  | { type: "command_ack"; commandId: string; ok: boolean; message?: string };
```

## API Proxy Shape

The first Next.js proxy route can mirror `unitree_ui`'s `/robot-api/*` idea:

```text
POST /api/robots/go2/proxy/con_notify
POST /api/robots/go2/proxy/con_ing_<suffix>
POST /api/robots/go2/proxy/offer
HEAD /api/robots/go2/proxy/
```

The browser sends:

```text
X-Robot-Host: 192.168.12.1:9991
```

The route forwards to:

```text
http://192.168.12.1:9991/con_notify
http://192.168.12.1:9991/con_ing_<suffix>
http://192.168.12.1:8081/offer
```

This proxy should only perform transport-level forwarding in v0. It should not own motion policy.

## Command Mapping

Nemeia commands should be mapped in one place.

```text
Nemeia command       Unitree transport
emergency_stop       local Nemeia state gate + sport StopMove/Damp
damp                 req rt/api/sport/request api_id 1001
balance_stand        req rt/api/sport/request api_id 1002
stop_move            req rt/api/sport/request api_id 1003
move bounded         rt/wirelesscontroller for short duration, then zero command
```

Movement commands need hard bounds:

```text
max duration
max vx/vy/yaw
zero command on release/timeout
blocked while emergency stop is active
event log for every command
```

Do not expose raw `rt/lowcmd` in v0.

## Nemeia Runtime Contract

Runtime/model tools should never need Unitree topic names.

The model should use commands like:

```text
nemeiactl robot status go2
nemeiactl robot stop go2
nemeiactl robot move go2 --x 0.2 --yaw 0 --duration-ms 500
nemeiactl robot action go2 damp
nemeiactl robot action go2 balance-stand
```

Those commands should produce normalized component events:

```json
{
  "id": "evt_go2_command_001",
  "component_id": "go2.control",
  "component_type": "robot_control",
  "event_type": "command_ack",
  "source_robot_id": "go2",
  "payload": {
    "command": "damp",
    "ok": true
  }
}
```

## Recommended Implementation Order

1. Add Go2 settings UI for IP/mode and test connection.
2. Add Next proxy route for local robot signaling.
3. Port the minimal WebRTC/data-channel code from `unitree_ui`.
4. Replace the camera mock with a `MediaStream` video artifact.
5. Subscribe to status and odometry topics; normalize them into `RobotStatus`.
6. Add read-only point-cloud frames.
7. Add `damp`, `balance_stand`, and `stop_move` through a Nemeia command adapter.
8. Add bounded `move` with automatic zeroing and emergency-stop gating.
9. Only then consider cloud remote mode, BLE, audio, policies, or low-level control.
