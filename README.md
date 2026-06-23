# Nemeia

Nemeia is an open-source robotics operator console and agent runtime experiment. It is designed around Codex-style threads, turns, tools, and durable runtime state, adapted for robots that expose sensors, controls, telemetry, and long-running component streams.

The current implementation is a local web console for operating and debugging a Unitree Go2. It provides a dockable workspace for conversation, robot modules, camera, LiDAR / SLAM, controls, speaker output, and telemetry stats.

## Status

Nemeia is early and actively changing. The frontend is usable today as a local operator console; the broader app-server, agent runtime, perception, and multi-robot control plane are still being designed and implemented.

Current focus:

- Dockable web workspace for robotics modules
- Go2 WebRTC camera, speaker, control, and telemetry surfaces
- LiDAR / SLAM point-cloud visualization with Go2 pose/model rendering
- Control pane for Go2 safety, locomotion modes, actions, joystick input, and robot audio files
- Stats panel that exposes the Go2 runtime store as full telemetry
- Strict frontend checks with Oxlint, TypeScript, production build, and Playwright smoke tests

## Architecture Direction

Nemeia separates operator UI, agent runtime, and robot control infrastructure:

```text
Web console
  -> Runtime / Executive
  -> App Server / Control Plane
  -> Robot, sensor, audio, perception, and policy modules
  -> Safety / Monitoring
```

The model-facing runtime is intended to use a small tool surface, centered on `bash`, while robot and perception operations are exposed through command-line or API surfaces backed by a long-running app server.

See the architecture notes in [`docs/`](./docs):

- [`docs/components.md`](./docs/components.md)
- [`docs/runtime.md`](./docs/runtime.md)
- [`docs/storage.md`](./docs/storage.md)
- [`docs/unitree-integration.md`](./docs/unitree-integration.md)
- [`docs/web-app.md`](./docs/web-app.md)

## Repository Layout

```text
nemeia/
  docs/       architecture and design notes
  frontend/   Next.js operator console
  tools/      local helper scripts
```

## Frontend Stack

- Next.js
- React
- TypeScript
- Tailwind CSS
- shadcn/Radix-style UI primitives
- Dockview
- Three.js
- Zustand
- Playwright smoke tests
- Oxlint

## Run Locally

```bash
cd frontend
npm install
npm run dev
```

Open:

```text
http://localhost:5173
```

## Checks

Fast local validation:

```bash
cd frontend
npm run check:fast
```

Full validation:

```bash
cd frontend
npm run check
```

`npm run check` runs:

- TypeScript
- Oxlint
- frontend architecture rules
- Next.js production build
- Playwright smoke tests

## Go2 Notes

The Go2 integration expects the robot to be reachable on the configured Go2 network and uses browser/WebRTC-facing surfaces in the frontend. Some robot services require the host network route to the Go2 LAN to be configured correctly.

The UI currently exposes:

- Front camera
- LiDAR / SLAM point cloud
- Go2 control pane
- Speaker output
- Robot audio file playback
- Runtime stats / telemetry
- Go2 connection and power-management settings

## License

Nemeia is licensed under the Apache License 2.0. See [`LICENSE`](./LICENSE).
