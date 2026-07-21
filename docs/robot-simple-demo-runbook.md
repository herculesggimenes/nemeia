# Robot Simple Demo Runbook

This runbook is the shortest path from "robot is powered on" to a useful
Nemeia demo without mixing certification, UI validation, and physical motion.

The operator-facing demo should use the standard Nemeia surface:

- Robot connection
- normalized status
- streams
- native actions
- bounded move proposals
- stop / safe-state commands

Vendor-specific transport names belong behind the driver boundary and in
driver implementation docs only.

## Demo Ladder

### 1. Read-only network and service proof

Goal: prove the host can reach the robot and that robot-side services are
healthy. This step must not command motion.

Known robot addresses from previous validation:

- Wi-Fi: `10.0.0.78`
- Wired service subnet: `192.168.123.161`
- mDNS, when available: `unitree.local`

Host checks:

```bash
ip -br addr
ip route
ping -c 1 -W 1 10.0.0.78
ping -c 1 -W 1 192.168.123.161
nc -zvw2 10.0.0.78 22
nc -zvw2 192.168.123.161 22
```

If the wired subnet is used, the host needs an address such as
`192.168.123.51/24` on the wired interface, and the robot is normally at
`192.168.123.161`.

Read-only SSH status check:

```bash
ssh root@192.168.123.161
hostname
uname -a
ip -br addr
systemctl --no-pager --failed
systemctl is-active master_service basic_service motion_switcher robot_state_service
```

Pass criteria:

- SSH connects.
- No failed systemd units relevant to robot control.
- Core robot services are active.
- Network address matches the path being used for the demo.

### 2. Standard interface validation in the cockpit

Goal: prove the UI is wired through the standard robot runtime and that visible
operator controls are no longer a vendor-specific interface.

Start the frontend:

```bash
npm --prefix frontend run dev
```

Open:

```text
http://10.0.0.115:5173/
```

In the operator view:

1. Open the robot connection/settings panel.
2. Enter the currently reachable robot IP.
3. Select the correct connection mode for the network path.
4. Click `Test`.
5. Click `Connect`.
6. Validate camera, LiDAR / SLAM, speaker, microphone, status, and control
   panels from the existing UI.

For browser-side wiring validation, the runtime records standard commands on:

```js
window.nemeiaRobotRuntimeCommands
```

Reset the recorder:

```js
window.nemeiaRobotRuntimeResetCommands()
```

Pass criteria:

- Connection and stream controls operate from the current UI.
- Runtime command records use standard command kinds such as `native_action`.
- Operator-visible text says `Robot`, `Mission`, `Run`, `Authorization`,
  `Supervisor`, or `Driver` concepts instead of exposing transport internals.

### 3. Non-motion standard action demo

Goal: prove the control path can send a low-activity standard action while the
operator can see the result.

Recommended first command:

```text
Damp motors
```

This is still a physical command, but it is the safe-state native action used by
the driver. Run it only when the robot is on the floor, supervised, and the
controller is ready.

Pass criteria:

- The UI dispatches a standard native action.
- The robot enters or remains in the safe state.
- Status updates remain fresh after the command.

### 4. Tiny bounded motion demo

Goal: prove the end-to-end Nemeia motion path using one small approved move.

This step is intentionally gated. Before any physical motion or D1-D7 gauntlet
command, the operator must provide this exact acknowledgement:

```text
I_UNDERSTAND_GO2_HARDWARE_GAUNTLET_RISK
```

Recommended tiny high-level sequence:

1. Stop movement.
2. Stand.
3. Move forward at about `0.03 m/s` for about `400 ms`.
4. Stop movement.
5. Move backward at about `0.03 m/s` for about `400 ms`.
6. Stop movement.

Pass criteria:

- Only one motion authority is active.
- The move is bounded by velocity and duration.
- Stop preempts the command.
- The event log contains the proposal, authorization, execution, and stop
  evidence.

## Current Next Step

If the robot is not reachable, do not debug the frontend first. Bring the
network path back:

1. Confirm the robot is fully booted.
2. Confirm the host is on the same Wi-Fi as the robot, or connect wired
   Ethernet and assign the host `192.168.123.51/24`.
3. Re-run the read-only checks in step 1.
4. Once SSH or WebRTC reachability is confirmed, run the cockpit validation in
   step 2.
