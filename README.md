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
Components such as `locomotion`, `transform`, `observable`, `portable`, and
`audio` give entities state and abilities. Actions declare the components they
need, and the runtime derives the current affordances from the world itself.

## Status

The first World Runtime slice is implemented:

- deterministic entity, component, and relationship state;
- action registration and actor/target requirement matching;
- live affordance derivation;
- action execution with component, relationship, and event effects;
- a vendor-neutral robot runtime boundary;
- an operator World panel that projects live connection, locomotion, camera,
  spatial sensing, audio, power, and pose data into a `core.robot` entity.

The next implementation slice is semantic perception: turn camera, LiDAR, and
scene observations into additional entities and relationships, then bind
physical action packs to the same actions used in simulation.

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

See [docs/world-runtime.md](./docs/world-runtime.md) for the full explanation,
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

The earlier authorization-first NEM Suite implementation remains in packages
such as `mission-api/`, `mission-server/`, `policy/`, `supervisor/`, and
`replay/`. It is archived as an optional future governance extension; it is not
required by the World Runtime. See
[docs/archive/governance/README.md](./docs/archive/governance/README.md).

## Run The Operator

```bash
cd frontend
npm install
npm run dev
```

The server binds to `0.0.0.0:5173`. Open `http://<host-ip>:5173` from another
machine on the network, or `http://localhost:5173` on the host.

## Validate

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
