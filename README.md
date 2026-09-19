# Nemeia

Nemeia is an open-source World Runtime for AI agents in physical and simulated
environments. It gives agents a consistent way to understand what exists, what
each thing can do, how things relate, and which interactions are possible now.

The simplest mental model is **The Sims for agents**:

```text
sense -> entities -> components -> available interactions
      -> execute an action -> update the world -> repeat
```

A robot, person, room, backpack, camera, or simulated character is an entity.
Components such as `core.pose`, `core.geometry`, `core.sensor`, and
`core.power` describe entities. Actions declare the components they
need, and the runtime derives the current affordances from the world itself.

## Status

Pre-production prototype. The [Nemeia protocol](./docs/protocol-spacetimedb.md) is the selected
implementation target, with [checked contracts](./contracts/spacetimedb/contracts.ts),
an [end-to-end example](./contracts/spacetimedb/example.ts), and a
[design review](./docs/protocol-review.md). Existing packages are experiments,
not a completed implementation of that protocol.

SpacetimeDB is the selected world-storage implementation. It does not define
Nemeia's foundational model or the perception, client and execution boundaries.

The new design replaces previous contracts outright. There is no requirement
to preserve old APIs, formats, databases, or archived protocol designs.

## Core Model

| Primitive | Purpose |
|---|---|
| World | Holds current entities, relationships, actions, and events. |
| Entity | Gives one thing a stable identity. |
| Component | Adds composable state or ability to an entity. |
| Relationship | Connects two entities with a directed fact. |
| Affordance | Describes an action currently available to an actor and target. |
| Action | Applies a meaningful change to the world. |
| System | Continuously senses, updates, executes, or emits events. |

See [the Nemeia protocol](./docs/protocol-spacetimedb.md) for the full explanation,
[the architecture website](./docs/) for a visual walkthrough,
[the visual framework story](http://localhost:5173/framework), and
[the detailed documentation](http://localhost:5173/docs).

## Repository Layout

```text
nemeia/
  world-runtime/    entity, component, relationship, affordance, and action core
  scene/            semantic scene projection
  world-twin/       deterministic spatial state and clearance checks
  driver-go2/       physical robot adapter behind the standard runtime boundary
  frontend/         operator console, World panel, sensing, and controls
  docs/             framework, architecture, and integration notes
```

Prototype packages such as `mission-api/`, `mission-server/`, `policy/`,
`supervisor/`, and `replay/` are reviewed experiments. Replace or remove them
as the canonical protocol's vertical slices land; do not build adapters to
preserve their current APIs.

## Run The Operator

```bash
cd frontend
npm install
npm run dev
```

The server binds to `0.0.0.0:5173`. Open `http://<host-ip>:5173` from another
machine on the network, or `http://localhost:5173` on the host.

## Validate

Check the canonical protocol declarations, example and generated page:

```bash
npm run check:protocol
```

Run every package and frontend check:

```bash
npm run check
```

Run only the World Runtime:

```bash
npm run check:world-runtime
```

The operator can connect to a robot and inspect live data without movement.
Physical movement remains a separate, explicitly supervised validation step.

## License

Nemeia is licensed under the Apache License 2.0. See [LICENSE](./LICENSE).
