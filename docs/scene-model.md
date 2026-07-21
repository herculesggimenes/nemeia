# Scene Model

This document is explanatory guidance for NEM-8. The normative contract is
[`nem-suite-specification.md`](./nem-suite-specification.md): Scene is a
projection over the Event Log, and World Twin is a deterministic derivation from
a pinned Scene tuple.

Nemeia should use a Box3D-style physical proxy inside the World Twin and attach
semantic state from the Scene projection on top of it. The core split is:

```text
World
  Body
    Shape
      Geometry
      Material
      Filter
Semantic layer
  Entity
  Observation
  Relation
  Affordance
  Task memory
```

The physical layer answers geometry, motion, contact, advisory clearance, and
simulation questions. The semantic layer answers identity, meaning, provenance,
confidence, freshness, affordance, and task-relevance questions.

This avoids a single overloaded "object" record that tries to be a detector output, a semantic entity, a physical collision body, a memory item, and a planning target at the same time.

## Physical Layer

The physical layer should intentionally mirror the Box3D vocabulary.

| Concept | Meaning |
|---|---|
| `World` | A coherent physical scene snapshot or simulation state. Owns bodies, shapes, contacts, sensors, and physics metadata. |
| `Body` | A physical thing with pose, velocity, motion type, sleep/active state, and one or more shapes. |
| `Shape` | Collision or sensor geometry attached to a body. Shapes use local transforms relative to their body. |
| `Geometry` | The primitive or mesh representation: box, capsule, sphere, hull, mesh, height field, point cloud proxy, or keepout volume. |
| `Material` | Physical interaction parameters such as friction, restitution, density, rolling resistance, and application-specific surface tags. |
| `Filter` | Collision categories and masks: robot, static obstacle, dynamic object, human, keepout, sensor-only, unknown, fragile. |
| `Contact` | Runtime relation produced by physics: touching, separated, normal, impulse, penetration estimate, and involved shapes. |
| `Sensor` | Non-solid shape used for triggers such as keepout zones, robot reach volumes, camera frustums, or semantic interest regions. |

Bodies should be typed like Box3D:

```text
static:
  walls, floor, fixed furniture, known map geometry

kinematic:
  robot command previews, tracked humans, commanded robot body proxies

dynamic:
  movable objects, unstable clutter, simulation-only props
```

## Semantic Layer

Semantic entities attach meaning to physical bodies without replacing them.

```text
SemanticEntity
  id
  labels
  class_hint
  confidence
  provenance
  body_refs
  observation_refs
  affordances
  relations
  task_state
```

Examples:

```text
entity: obj_table_01
labels: ["table", "coffee table"]
body_refs: ["body_table_01"]
affordances: ["support_surface", "obstacle"]

entity: robot_go2
labels: ["go2", "quadruped"]
body_refs: ["body_go2_collision", "body_go2_keepout"]
affordances: ["mobile_robot", "camera_source"]
```

The model should allow many-to-many links:

```text
one entity -> multiple bodies
  chair: seat body, back body, leg bodies

multiple entities -> one body
  closed cabinet: cabinet entity and door entity may share a coarse static body at low perception confidence

one observation -> multiple candidate entities
  uncertain detector output: "backpack or suitcase"
```

## Observations

Observations are not entities. They are evidence used to create, update, merge, or retire entities and bodies.

```text
Observation
  id
  source_component_id
  timestamp
  frame_id
  sensor_pose
  labels
  confidence
  geometry_estimate
  artifact_refs
  entity_candidates
  raw_payload_ref
```

Observation examples:

```text
camera detection
segmentation mask
depth cluster
lidar obstacle cluster
operator correction
VLM label
ROS/Nav2 costmap obstacle
Isaac/PhysX ground-truth object
Box3D replay event
```

Observations should keep provenance so Nemeia can explain why it believes an object exists and can later extract training/evaluation data.

## Relations

Relations should be explicit records derived from semantic and physical state.

```text
Relation
  subject_entity_id
  predicate
  object_entity_id optional
  body_or_shape_refs optional
  confidence
  source
  timestamp
```

Useful predicates:

```text
near
on
inside
supports
blocks
reachable_by
visible_from
in_front_of
left_of
hazard_to
touching
inside_keepout
candidate_goal_pose_for
```

Physical relations such as `touching`, `inside_keepout`, and `blocks` can be backed by Box3D queries. Semantic relations such as `is_mug`, `belongs_to_kitchen`, or `fragile` come from perception, memory, or operator input.

## Example JSON

```json
{
  "world": {
    "id": "world_live_go2",
    "frame_id": "map",
    "timestamp": "2026-07-04T00:00:00.000Z",
    "bodies": [
      {
        "id": "body_table_01",
        "type": "static",
        "pose": {
          "position": [2.0, 0.4, -1.0],
          "rotation_xyzw": [0.0, 0.0, 0.0, 1.0]
        },
        "shapes": [
          {
            "id": "shape_table_top_01",
            "kind": "solid",
            "geometry": {
              "type": "box",
              "half_extents": [1.2, 0.08, 0.6]
            },
            "local_pose": {
              "position": [0.0, 0.0, 0.0],
              "rotation_xyzw": [0.0, 0.0, 0.0, 1.0]
            },
            "material": {
              "friction": 0.7,
              "restitution": 0.1
            },
            "filter": {
              "category": "static_obstacle",
              "collides_with": ["robot", "dynamic_object"]
            }
          }
        ]
      }
    ],
    "entities": [
      {
        "id": "obj_table_01",
        "labels": ["table", "coffee table"],
        "class_hint": "furniture.table",
        "confidence": 0.86,
        "body_refs": ["body_table_01"],
        "affordances": ["support_surface", "obstacle"],
        "observation_refs": ["obs_cam_1742", "obs_depth_1743"]
      }
    ]
  }
}
```

## Mission API Queries

The model-facing runtime should not manipulate raw Box3D objects directly. It
should read compact NEM-8 projections through the Mission API and `nemeiactl`:

```text
nemeiactl scene get
nemeiactl scene get --since ssg_123
nemeiactl entity ent_table_01
nemeiactl run create --robot go2 --verb approach --target ent_table_01
```

The runtime sees semantic summaries and selected physical query results:

```text
target entity
linked physical body
advisory or enforcing clearance check
freshness/confidence
CheckResult
```

not raw hull vertices or full collision internals by default.

## Projection Shape

Scene is not a separate source-of-truth store. Persist observations as Event Log
records and materialize projections only when they can be reproduced from the
log plus pinned versions.

Useful materialized projections:

```text
scene_projection_snapshots
entity_projection_snapshots
world_twin_artifacts
artifact_metadata
```

For v0, a scene projection can cache compact JSONB plus typed columns for common
queries:

```text
scene_snapshot_id
mission_id
robot_id
timestamp
ontology_version
label_map_version
entity_count
freshness_ms
projection_jsonb
```

The important requirement is that entity ids remain stable enough for replay,
binding, debugging, and dataset extraction. The Event Log remains authoritative.

## Nemeia Naming

Use `Scene` for the NEM-8 belief projection.

Use `World Twin` for the deterministic physical derivation from a pinned Scene
tuple.

Use `Physics World` for the Box3D/PhysX-compatible physical proxy inside the
World Twin.

This keeps the architecture precise:

```text
Event Log observations -> Scene projection -> World Twin -> checks
```

## Box3D And PhysX Compatibility

The physical layer should stay close enough to Box3D that it can compile into a Box3D world for fast local checks.

It should also be compatible with PhysX/Isaac concepts:

```text
Body -> rigid actor / articulation link proxy
Shape -> collider
Material -> physics material
Filter -> collision groups
World -> scene/stage snapshot
```

Box3D is the lightweight runtime kernel. PhysX/Isaac can consume the same scene model for high-fidelity simulation when needed.
