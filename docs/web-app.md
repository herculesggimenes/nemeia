# Nemeia Frontend

> **Archived governance design.** This document preserves the earlier
> Mission-cockpit frontend plan. The selected World Operator interface is
> governed by [`protocol-spacetimedb.md`](./protocol-spacetimedb.md); use the
> [runbook](./implementation-plan/RUNBOOK.md) and
> [execution status](./implementation-plan/EXECUTION.md) for current commands
> and evidence. This prototype note is not current API or startup authority.

Nemeia should use a web console as the primary operator cockpit. The frontend is
a client of the NEM Mission API: it displays missions, runs, approvals,
Authorizations, Supervisor/Driver status, Scene projections, Attention digests,
Replay, anomalies, and stop state.

## Frontend Pattern

```text
route-level shell
feature-specific components
shared UI primitives
domain actions/data adapters
stores/hooks near the feature that uses them
```

Unitree UI:

```text
/Users/hgimenes/src/unitree_ui
  Vite
  TypeScript
  Three.js
  connection/status UI
  topic/protocol handling
  SLAM/voxel workers
  robot visualization
```

Detailed Unitree wiring plan:

```text
docs/unitree-integration.md
```

Unitree UI's useful pattern:

```text
robot connection status
heartbeat/state indicators
Three.js scene rendering
map/point-cloud concepts
robot service/action panels
operator logger panel
```

## V0 Stack

```text
frontend:
  Next.js
  React
  TypeScript
  Tailwind
  Radix UI primitives
  Three.js / React Three Fiber
  lucide-react

mock runtime:
  static fixtures
  mocked Mission API responses
  mocked Event Log tail
  mocked Scene projections
  mocked NormalizedStatus
  mocked Run and Authorization lifecycle events
```

Use Next.js for the frontend shell, with simple local pages and client components for the operator console. We do not need SSR-heavy flows, auth-heavy routing, or a marketing site.

## Repo Structure

Use `frontend/` as the local web console package.

```text
nemeia/
  frontend/
    package.json
    tsconfig.json
    app/
      layout.tsx
      globals.css
      (app)/
        layout.tsx
        page.tsx
        settings/
          page.tsx

    components/
      layout/
        app-shell.tsx

      ui/
        button.tsx
        dialog.tsx
        tabs.tsx
        tooltip.tsx
        badge.tsx
        separator.tsx
        scroll-area.tsx

      thread/
        conversation-page.tsx
        nemeia-chat-thread.tsx

      artifacts/
        artifact-workspace.tsx

      unitree/
        unitree-camera-view.tsx
        unitree-point-cloud-view.tsx

      settings-page.tsx

    lib/
      mock-data.ts
      utils.ts

    types/
      nemeia.ts
```

## V0 Screen

Start with one usable operator console, not a landing page.

```text
top bar:
  connection state
  active robot
  active mission
  emergency stop

left:
  robots
  missions
  runs
  event filters

center:
  operator thread/chat
  run timeline
  prompt input

right:
  scene entity list
  selected object detail
  robot telemetry
  approval/replay/evidence panel

bottom or expandable:
  3D scene view
```

Emergency stop should be visible at all times. Approval panels must show checks,
enforcement modes, expiry, abort triggers, evidence refs, and predicted sweep
when available.

## Mock Data Contract

Design the frontend against the NEM Mission API and projection shapes.

```text
Mission
Run
Authorization
CheckResult
EventEnvelope
SceneSnapshot
Entity
NormalizedStatus
ArtifactRef
AttentionDigest
Replay
Anomaly
```

Mock event flow:

```text
mock websocket
  -> event_log_tail
  -> run_state_update
  -> scene_projection_update
  -> normalized_status_update
```

Example Event Log record:

```json
{
  "seq": 48211,
  "schema_version": 1,
  "source": "perception:fusion-rgb-lidar@1.2",
  "event_type": "scene.observation",
  "severity": 0,
  "timestamp": "2026-07-07T10:00:00.000Z",
  "robot_id": "go2",
  "mission_id": "msn_123",
  "refs": ["artifact:frame_123"],
  "payload": {
    "streams": ["camera_front"],
    "labels": ["red_backpack"],
    "confidence": 0.86,
    "geometry": { "type": "bbox_2d", "frame_id": "camera_front" },
    "artifact_refs": ["artifact:frame_123"]
  }
}
```

## Visualization Components To Borrow From Unitree UI

Borrow concepts first:

```text
connection modes
WebSocket/WebRTC status indicators
topic/protocol validation
heartbeat handling
SLAM/voxel worker shape
map/point-cloud visual model
Three.js scene rendering
robot status panels
service/action panels
logger panel
```

Nemeia-specific visualization:

```text
Scene entities and affordances
robot poses
object masks and boxes
LiDAR-projected object points
free-space / advisory clearance layer
active Run target
Authorization and check status
Event Log tail
Replay timeline
```

## Mission API Contract

Keep the frontend shaped for these NEM resources:

```text
GET /robots
GET /robots/{id}/status
GET /robots/{id}/verbs
POST /missions
POST /runs
POST /runs/{id}/approve
POST /runs/{id}/reject
GET /runs/{id}/replay
POST /robots/{id}/stop
POST /robots/{id}/clear-stop
GET /scene
GET /entities/{id}
GET /missions/{id}/attention
POST /anomalies
```

Future WebSocket message types:

```text
subscribe
unsubscribe
event_log_tail
run_state_update
scene_projection_update
normalized_status_update
attention_digest
supervisor_event
driver_event
stop_state_update
```

Future bash helper path:

```text
AI SDK bash tool
  -> nemeiactl
  -> Mission API
  -> Run / Authorization / Replay
```

## Iterative Build Plan

1. Frontend shell
   Use the existing Next.js app in `frontend/` with app shell, top bar,
   sidebar, run timeline, scene panel, robot panel, and emergency button.

2. Mock data stores
   Add mocked Mission, Run, Authorization, Event Log, Scene, NormalizedStatus,
   Attention, Replay, Anomaly, and artifact stores.

3. Mock realtime stream
   Add a mocked WebSocket/event source that periodically emits Event Log
   records, run updates, normalized status, and Scene projection updates.

4. 3D scene view
   Add Three.js scene with robot pose, object nodes, simple point samples, and selected-object detail.

5. Interaction polish
   Wire entity selection, event filtering, robot selection, panel resizing,
   approval panels, replay navigation, and artifact previews.

6. Mission API adapter
   Replace mock client with the real Mission API and Event Log tail when the
   Mission Server exists.
