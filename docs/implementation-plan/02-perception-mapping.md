# Perception, mapping, association, and spatial qualification

Scope: acquisition adapters, progressive local maps, object perception and
association, provenance, and the navigation-input qualification boundary. It
does not own mission/command lifecycle, motion, or stop. No rooms or fabricated
boxes are included.

## Evidence and gaps

Confirmed in (`docs/protocol-spacetimedb.md`,
`docs/spatial-model-content.mjs`, `docs/intelligence-content.mjs`, and the
published `docs/index.html`): mapping and semantic perception run independently;
image-only evidence is valid; unknown depth remains unknown; local frames are
independent and reset by immutable frame IDs; `local_map`/`map_revision` retain
native layers and evidence coverage; and a navigation input must be a
frame-qualified pose tied to a local-map checkpoint. The intended object path is
YOLOE + tracker for frequent candidates, selective SAM3 for ambiguity, then
validated camera/range association.

`driver-go2/src/go2-driver.ts` is control-oriented: its manifest declares
camera and telemetry streams plus `base_velocity_3d`; `open_stream()` only
checks a manifest and delegates to transport. Fake-transport tests prove no
physical sensor capability. The manifest lacks LiDAR, point-cloud, IMU,
odometry, calibration, and map-export streams; measure all rates from records.

The frontend has transport evidence but is not an acquisition system.
`frontend/lib/robots/unitree/go2-topics.ts` names WebRTC subscriptions for
compressed voxel LiDAR, LiDAR state, robot/USLAM poses, low state, and sport
state. `go2-store.ts` keeps guessed LiDAR bytes/resolution/origin and latest
pose/frame; `go2-webrtc.ts` parses the envelope. There is no capture clock,
session identity, recorder, transform/calibration provenance, point-cloud
validation, native checkpoint, or retry boundary. Video is not retained evidence.

Scene/world-twin prototypes are non-authoritative.
`scene/src/scene-projector.ts` derives stable IDs from `track_id` or labels,
collapses events by latest sequence, and accepts arbitrary geometry payloads;
`world-twin/src/world-twin.ts` turns scene geometry into AABB/circle clearance
proxies. Tests show fusion-shaped fixtures, not calibrated fusion.
`contracts/spacetimedb/values.ts` has useful frame/resource/timestamp/transform
shapes, but `schema.ts` still has global `world_config.frameId`, one current
pose/geometry row per entity, and “World Master” comments. Resolve these before
implementation; do not extend either prototype as a second world model.

Go2 skill references support raw/deskewed cloud, IMU, odom, height/grid,
USLAM, low/sport state, and camera, while warning about drift, distortion,
occlusion, loop closure, and clock sync.

## Smallest boundary and defaults

Use one `PerceptionAcquisitionAdapter` per Unit and one `LocalMapPublisher`
outside reducers. The adapter owns
transport decoding, source sessions/sequences, capture and receive times,
clock-error estimates, native message bytes, and producer/package pins. The
map publisher owns native mapper input/output, immutable resource persistence,
manifest digests, input-coverage ranges, frame identity, and compare-and-set
head publication. SpacetimeDB owns only validated observation metadata,
track/entity association, frame/map/revision records, and resource references;
it never performs sensor IO or SLAM.

Default acquisition order is recorded data first, then a Unitree DDS/ROS2
adapter where the host environment supports it, with the current browser WebRTC
path retained as a viewer/prototype source. Prefer native cloud/map products
from the vendor/ROS path rather than inventing a frontend voxel format. Keep
`sensor_msgs/PointCloud2` or the exact Unitree native encoding, schema version,
frame ID, acquisition time, fields, and `is_dense` metadata intact. Keep
`nav_msgs/OccupancyGrid` as a 2-D derived layer with explicit unknown cells;
never interpret an absent cell as free space.

Each camera/model or producer restart creates a new producer session, but does
not automatically create a new spatial origin. A new immutable `spatial_frame`
ID is required only when the map/localization origin resets, unless qualified
relocalization proves safe reuse of the existing frame. Eve session reset
changes neither producer sessions nor spatial frames. Any adapter restart may
recover the last committed checkpoint, but it does not prove current
localization. Require relocalization before spatial reuse; start a fresh frame
only when the origin reset or qualified relocalization shows the old frame
cannot be reused. Pose, geometry, semantic facets, and transforms keep their
own acquisition timestamps. A fusion record must list exact input frames,
transform/calibration resource digests, pose-history interval, motion
compensation policy, occlusion/quality checks, and predecessor observations.
Matching a label, nearest point, or concurrent arrival is a fail-closed reject.

Image-only YOLOE detections may create/update an observed-object track with a
2-D box/mask and evidence reference. A metric geometry facet is published only
after camera intrinsics/distortion, LiDAR extrinsics, time relation, valid pose,
and compatible surface support pass qualification. Partial surfaces remain
partial; no full box or height is inferred. SAM3 is optional and selective; it
may refine a retained frame but cannot bypass association gates. Dynamic tracks
and occupancy aging are separate from static map geometry.

Navigation input qualification owns the answer to “is this measured local pose
usable?”: frame exists, checkpoint is retained, localization age/error is within
installed policy, route space is known enough for the installed local planner,
and unknown space is not free. It emits a qualified input plus evidence refs;
the navigation adapter/controller owns route execution, watchdog, live obstacle
checks, stop, and measured completion. A new map revision is not automatically
a cancellation; a reset frame, invalidated pose, or failed live gate is.

## Task packets and planned acceptance checks

1. **Recorded acquisition and normalization** — proposed scope:
`perception/acquisition` adapter additions and fixtures.
Dependencies: a versioned fixture format and the coordinator’s final
`ObservationInput`/resource contract. Planned tests: replay camera/LiDAR/pose
fixtures with dropped, duplicated, reordered, and delayed messages; verify
stable session/sequence IDs, preserved capture time, receive-time separation,
bounded clock error, schema rejection, and no duplicate observation on retry.
Acceptance gate: a recorded run can be replayed deterministically without
robot/network access and produces raw evidence references.

2. **Progressive native local map** — proposed scope: `perception/mapping`,
resource-store adapter, and map/checkpoint contract tests; no reducer-side file
or SLAM IO. Dependencies:
packet 1 and durable resource storage. Planned tests: ingest native occupancy,
point-cloud, and mapper-export fixtures; commit parent-linked manifests only
after digest/coverage verification; idempotently retry the same manifest; reject
wrong parent or incomplete reference closure; recover the last head after an
interruption before and after head commit; restore without claiming current
localization. Acceptance gate: no-motion recorded mapping creates a durable,
reopenable local checkpoint from a producer-supplied native surface/cloud or
occupancy product, with its native coverage/unknown semantics preserved. This
precedes any autonomous navigation; physical navigation additionally requires a
separately qualified occupancy/traversability product.

3. **YOLOE tracking and selective refinement** — proposed scope:
`perception/` model/runtime manifest, bounded latest-frame queue, and
`PerceptionIngress` producer. Dependencies: packet 1 and evidence storage.
Planned tests: replay frames with one latest pending frame and bounded in-flight
work; reject stale completions as fresh measurements; preserve tracker-session
identity across retries and create a new session after reset; prove model,
prompt profile, checkpoint digest, runtime, input size, and timing provenance
are retained. Qualification benchmark on the local RTX 3060 12 GB must measure
end-to-end p50/p95, memory, dropped frames, candidate recall/precision on the
“blue backpack” fixture, and CPU/GPU contention. Do not set a frequency until
these results exist. SAM3 remains an opt-in ambiguity/refinement packet behind
the same observation contract.

4. **Calibrated association and spatial qualification** — proposed scope:
`perception/association`, calibration/transform resource schema, map/object
fixtures, and navigation-input validator. Dependencies: packets 1–3 and a
qualified calibration source for the fusion subset. Planned tests: accept aligned camera/LiDAR
support with acquisition-time transforms; reject clock skew, missing
extrinsics, occlusion, inconsistent surfaces, frame reset, stale pose, and
label-only/nearest-point matches; preserve image-only fallback and partial
geometry; qualify a local pose only inside retained checkpoint and localization
policies. Acceptance gate: repeated observations refine one producer-scoped
track without merging distinct same-label objects. Q4 is not required for E9/G4
native-map or image-only sensing;
camera/range-derived metric geometry and dependent actions remain disabled on
failure. Q5-qualified native-LiDAR navigation may proceed when both gates pass.

## Failure, recovery, and security

Fail closed on malformed binary/schema, missing timestamps, non-finite geometry,
clock uncertainty beyond policy, calibration digest mismatch, stale transforms,
unknown localization, resource checksum failure, mapper crash, or missing
checkpoint references. Continue retaining raw/image evidence and native map
knowledge when calibration/fusion fails; do not silently delete or downgrade
it. On adapter restart, reconcile durable session and resource receipts before
republishing. Never reuse a producer or tracker session after its restart;
retain the spatial frame when its origin is unchanged. If localization is
uncertain, block spatial reuse pending qualified relocalization; start a new
frame only when reuse is not qualified. Never reuse old coordinates for motion.

Only enrolled producer identities may publish observations for their Unit and
facets; bind package/model/calibration provenance server-side, not from payload
claims. Treat images, labels, masks, and model text as untrusted data. Keep
credentials, signed URLs, and raw media out of SpacetimeDB live rows. Enforce
resource size/rate limits, bounded inference concurrency, retention/reference
closure, and explicit backpressure. A database outage must not inhibit local
stop, and this workstream must not expose raw Unitree motion topics.

## Blockers, defaults, and cross-workstream conflicts

Blockers: no recorded native Go2 sensor dataset is currently evidenced in the
repository; no calibration artifact or clock model is present; no selected
host-side DDS/ROS2 runtime is part of this workspace; and physical navigation
capability is unverified. Proposed defaults are replay fixtures, one local
frame, native Unitree/ROS products, and image-only perception first.

Implementation obligations: use the settled `World Operator` role name;
implement independent immutable spatial frames rather than the prototype global
`world_config.frameId`; publish retained native bytes through the trusted local
disk `world-resources/` gateway; key current pose/geometry facets by
`(entity, frame)` and retain supporting observations as evidence history rather
than inventing a parallel history store; and hand navigation execution to
`local-controller/` plus the qualified `driver-go2/` transport without owning
command lifecycle. Blocked Q2 does not block world
storage or deterministic perception replay. The frontend may visualize
acquisition, but is not the authoritative recorder or map store.

## Primary references (checked 2026-09-19)

- Nemeia selected design: `docs/protocol-spacetimedb.md`, `docs/spatial-model-content.mjs`, `docs/intelligence-content.mjs`, `docs/index.html`.
- Unitree ROS2/DDS support and recorded-bag example: [unitreerobotics/unitree_ros2 README](https://github.com/unitreerobotics/unitree_ros2/blob/master/README.md) (checked 2026-09-19).
- Unitree native Go2 message declarations: [unitree_sdk2 go2 publisher headers](https://github.com/unitreerobotics/unitree_sdk2/blob/main/include/unitree/dds_wrapper/robots/go2/go2_pub.h) (checked 2026-09-19).
- Native representations: [ROS `PointCloud2`](https://raw.githubusercontent.com/ros2/common_interfaces/rolling/sensor_msgs/msg/PointCloud2.msg), [ROS `OccupancyGrid`](https://raw.githubusercontent.com/ros2/common_interfaces/rolling/nav_msgs/msg/OccupancyGrid.msg) (checked 2026-09-19).
- Coordinate semantics: [ROS REP-105](https://raw.githubusercontent.com/ros-infrastructure/rep/master/rep-0105.rst) (checked 2026-09-19).
- Navigation boundary pattern: [Nav2 `NavigateToPose.action`](https://raw.githubusercontent.com/ros-navigation/navigation2/main/nav2_msgs/action/NavigateToPose.action) (checked 2026-09-19).
- Model qualification references: [Ultralytics YOLOE](https://docs.ultralytics.com/models/yoloe) and [Meta SAM3](https://github.com/facebookresearch/sam3/blob/main/README.md) (checked 2026-09-19).
- Mapping implementation reference only, not an integration assumption: [FAST-LIVO2](https://github.com/hku-mars/FAST-LIVO2) (checked 2026-09-19).
