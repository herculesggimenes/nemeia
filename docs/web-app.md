# Nemeia Frontend

Nemeia should use a web console as the primary operator interface. V0 should focus on the frontend only, with mocked data and mocked realtime events. The real app server/control plane can come later.

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
  mocked websocket event source
  mocked semantic scene graph snapshots
  mocked robot telemetry
  mocked thread/turn events
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
  active goal
  emergency stop

left:
  robots
  component queues
  thread/subthread list

center:
  main thread/chat
  turn events
  prompt input

right:
  semantic scene graph object list
  selected object detail
  robot telemetry
  artifacts/camera

bottom or expandable:
  3D scene view
```

Emergency stop should be visible at all times, even while mocked.

## Mock Data Contract

Design the frontend against the shape we expect from the future app server.

```text
Thread
Turn
ThreadItem
ComponentEvent
SemanticSceneGraphSnapshot
SceneObject
RobotStatus
ArtifactRef
Goal
ToolCall
ToolResult
```

Mock event flow:

```text
mock websocket
  -> component_event
  -> scene_graph_snapshot
  -> thread_event
  -> robot_status
```

Example component event:

```json
{
  "id": "evt_001",
  "component_id": "go2.camera.front",
  "component_type": "camera",
  "event_type": "object_detected",
  "timestamp": "2026-06-19T10:00:00Z",
  "robot_id": "go2",
  "payload": {
    "object_id": "obj_backpack",
    "label": "red_backpack"
  },
  "confidence": 0.86,
  "freshness_ms": 120
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
Semantic Scene Graph nodes/edges
robot poses
object masks and boxes
LiDAR-projected object points
free-space/costmap layer
active goal target
current turn/tool status
component queue event stream
```

## Later App Server Contract

Do not build this in v0, but keep the frontend shaped for it.

Future app server/control plane:

```text
Python FastAPI
WebSocket
SQLite
component queues
semantic scene graph snapshots
robot adapters
perception workers
```

Future WebSocket message types:

```text
subscribe
unsubscribe
component_event
thread_event
scene_graph_snapshot
robot_status
tool_request
tool_result
robot_command
emergency_stop
```

Future bash helper path:

```text
AI SDK bash tool
  -> nemeiactl helper CLI
  -> long-lived WebSocket connection
  -> app server/control plane
```

## Iterative Build Plan

1. Frontend shell
   Create Vite React app in `frontend/` with app shell, top bar, sidebar, main thread panel, scene panel, robot panel, and emergency button.

2. Mock data stores
   Add mocked thread, robot, scene graph, component queue, and artifact stores.

3. Mock realtime stream
   Add a mocked WebSocket/event source that periodically emits component events, robot status, and scene graph snapshots.

4. 3D scene view
   Add Three.js scene with robot pose, object nodes, simple point samples, and selected-object detail.

5. Interaction polish
   Wire object selection, thread event filtering, robot selection, panel resizing, and artifact previews.

6. Future app server adapter
   Replace mock client with real WebSocket client when the app server/control plane exists.
