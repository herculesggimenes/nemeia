# Go2 Driver Hardware Gauntlet

This is the physical NEM-5 D1-D7 certification procedure for
`driver:go2@0.2.1`.

The gauntlet moves or interrupts a real Unitree Go2. Run it only with direct
human supervision, a charged battery, a clear floor area, the physical
controller ready, and one active motion authority. The runner must require this
exact acknowledgement before issuing motion:

```text
I_UNDERSTAND_GO2_HARDWARE_GAUNTLET_RISK
```

## Harness Contract

Use `runGo2HardwareGauntlet` from
`driver-go2/src/go2-driver.ts` with a real `Go2Driver` transport and hardware
probe hooks:

- `preflight()` verifies battery, clear area, controller availability, robot
  service state, and single motion authority.
- `measureSafeStateEntry({ context, command })` measures elapsed time from the
  command to verified safe-state entry.
- `killSetpointStream()` interrupts the active setpoint stream and records
  whether the robot reaches safe state.
- `killSupervisorProcess()` kills the Supervisor process and records
  total-loss behavior and whether the platform remains upright.
- `auditObservables(action_spaces)` compares declared measured/inferred
  observables with instrumented ground truth.
- `dropTelemetry()` stops or blocks Go2 telemetry so heartbeat honesty can be
  measured.
- `verifyStreams(streams)` verifies stream rates and sensitivity declarations.

After the run, sign the returned report with
`signGo2DriverGauntletReport(report, privateKey)`.

For an operator-collected outcomes file, the package also provides a report
artifact CLI:

```bash
node driver-go2/src/bin/go2-driver-gauntlet.ts manifest
node driver-go2/src/bin/go2-driver-gauntlet.ts report \
  --outcomes /path/to/d1-d7-outcomes.json \
  --private-key /path/to/driver-gauntlet-ed25519.pem \
  --generated-at 2026-07-07T17:00:00.000Z
```

The output is compact JSON suitable for `GAUNTLET_REPORT` publication. It must
match the source-controlled `gauntletReport` contract: `schema_version: 1`,
`suite_version: 0.2.1`, `conformance_class: DR`, D1-D7 case evidence refs,
`sha256:` report digest, and Ed25519 signature.

## D1-D7 Evidence

- D1: safe state from idle, tiny mid-motion command, and every interruptible
  native action.
- D2: safe state under setpoint-stream command loss.
- D3: Supervisor `kill -9`; observed total-loss behavior matches
  `safe_state.on_total_loss` and the Go2 ends upright.
- D4: measured safe-state entry is no greater than declared `max_entry_ms`.
- D5: velocity observables match ground truth within declared error bands; force
  remains declared as unavailable.
- D6: status freshness stops advancing as fresh when Go2 telemetry stops.
- D7: `camera_front`, `go2_sport_state`, and `go2_low_state` rates are verified.

The signed `GAUNTLET_REPORT` is registry evidence. Do not copy pass/fail trust
state into the `DriverManifest`.
