# Nemeia Storage

Nemeia should avoid using the local filesystem as the normal runtime store. Runtime data should be queryable through databases and APIs.

## Storage Goals

```text
query threads, turns, goals, events, tool calls, component events
query semantic scene graph snapshots
query robot telemetry and perception outputs
store images, masks, point clouds, audio, and videos by database-backed refs
support replay, debugging, evaluation, and training-data extraction
avoid depending on local paths for app correctness
```

## Recommended V0

Use Postgres as the primary store.

```text
Postgres
  threads
  turns
  goals
  rollout items
  component events
  semantic scene graph snapshots
  robot status samples
  tool calls/results
  artifact metadata
  small binary artifacts if needed
```

Use database-backed artifact refs instead of filesystem paths:

```text
artifact_id
artifact_type
content_type
size_bytes
checksum
created_at
source_component_id
thread_id optional
turn_id optional
storage_backend
storage_key
metadata jsonb
```

For v0, `storage_backend` can be:

```text
postgres_blob
```

Later it can become:

```text
s3
minio
r2
gcs
```

without changing thread/scene/event records.

## Binary Data

Small and medium artifacts can live in Postgres initially:

```text
images
masks
audio clips
small point-cloud samples
debug snapshots
```

Large/high-rate artifacts should still be referenced by database rows, but stored in an object-store-compatible backend:

```text
full video recordings
large point clouds
long audio streams
dense map archives
training datasets
```

The runtime should not expose raw file paths to the agent. It should expose refs:

```text
image_ref=artifact:img_123
mask_ref=artifact:mask_456
cloud_ref=artifact:cloud_789
audio_ref=artifact:aud_321
```

## Query Shape

Postgres should be enough for v0 queries:

```text
latest scene graph for thread
latest objects visible to robot
all events for a turn
all tool calls that moved robot
all component events for object obj17
all perception snapshots where backpack was detected
all emergency stops in a time window
```

Use `jsonb` for flexible payloads, with typed columns for fields we query often:

```text
thread_id
turn_id
robot_id
component_id
event_type
object_id
timestamp
created_at
status
```

## When To Add ClickHouse

Add ClickHouse when telemetry volume or analytics queries outgrow Postgres.

Good ClickHouse candidates:

```text
high-frequency robot telemetry
high-volume component events
perception latency metrics
policy rollout metrics
long-term fleet analytics
evaluation traces
```

Do not make ClickHouse the source of truth for v0. Treat it later as an analytical mirror fed from Postgres/component events.

## Storage Decision

```text
v0:
  Postgres for source of truth
  Postgres-backed artifact refs
  optional object-store-compatible backend later

not v0:
  local filesystem as runtime source of truth
  ClickHouse as primary store
```
