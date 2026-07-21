# Nemeia World Runtime

Nemeia is a framework for creating interactive physical and simulated worlds
for AI agents. Its core model is deliberately small:

```text
Sense
  -> create or update entities
  -> attach components
  -> derive interactions
  -> execute an action
  -> apply effects, relationships, and events
  -> repeat
```

## Core Primitives

| Primitive | Meaning |
|---|---|
| World | The current collection of entities, relationships, actions, and events. |
| Entity | A stable identity for one thing in the world. |
| Component | Composable state or ability attached to an entity. |
| Relationship | A directed fact connecting two entities. |
| Affordance | An action currently available between an actor and optional target. |
| Action | A meaningful operation that changes world state. |
| System | A continuous process that senses, updates, executes, or emits events. |
| Event | An ordered record of a world change. |

An entity is only an ID, label, type, and component map. Components carry the
meaning. A robot may have `connection`, `locomotion`, `camera`, `lidar`,
`audio`, `power`, and `transform`. A backpack may have `transform`,
`observable`, and `portable`.

Actions declare the components they require from the actor and target. The
runtime derives affordances by matching those requirements against current
world state. For example:

```text
Robot.locomotion + Backpack.transform -> approach(Robot, Backpack)
Robot.perception + Backpack.observable -> inspect(Robot, Backpack)
Robot.manipulator + Backpack.portable  -> pick_up(Robot, Backpack)
```

Executing an action may update components, create relationships, return a
result, and emit events. The next available interactions are then derived from
the updated world.

## Hardware And Simulation

The world model is vendor-neutral. Adapters project a simulator or physical
machine into the same components. An action such as `approach` keeps its
meaning while its implementation changes between a simulated character,
wheeled robot, quadruped, or humanoid.

Physical adapters retain local stop, timeout, and hard-limit behavior. Those
are implementation guarantees, not prerequisites for understanding or using
the World Runtime.

## Current Implementation

`world-runtime/` implements:

- entity creation, updates, removal, and deterministic snapshots;
- component composition;
- directed relationships;
- action registration;
- actor/target affordance derivation;
- action execution with component effects and relationship changes;
- ordered world events.

The operator World panel projects the standard robot runtime into a live
`core.robot` entity. Connection, locomotion, sensing, audio, power, and pose
telemetry update its components and therefore its available interactions.

## Archived Governance Extension

The earlier NEM Suite work on authentication, Mission policy, approval,
Authorization, Supervisor enforcement, and replay is preserved in the
repository. It is no longer the core framework or the default conceptual path.
It may later return as an optional governance extension around action execution.

The original documents remain available at:

- `docs/nem-suite-specification.md`
- `docs/nem-suite-redesign-plan.md`
