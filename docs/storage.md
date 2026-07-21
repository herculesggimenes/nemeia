# Nemeia Storage

> **Archived governance design.** These Event Log requirements belong to the
> optional NEM governance extension. World state itself is defined by
> [`world-runtime.md`](./world-runtime.md).

Nemeia's normative storage primitive is the NEM-1 append-only Event Log. Runtime
data should be queryable through APIs and projections, but those projections
must be reproducible from the log plus pinned versions.

## Storage Goals

```text
query missions, runs, authorizations, events, tool calls, and attention seams
query scene snapshots and entity projections
query observations, geometry, affordances, and provenance
query robot telemetry and perception outputs
store images, masks, point clouds, audio, and videos by database-backed refs
support replay, reports, debugging, evaluation, and training-data extraction
avoid depending on local paths for app correctness
```

## Recommended V0

Use Postgres as the first implementation of the Event Log and materialized
projections. Postgres is an implementation choice, not the NEM source-of-truth
abstraction.

```text
Postgres
  event_log
  missions
  runs
  authorizations
  anomalies
  registry_state
  idempotency_records
  scene_projection_snapshots
  entity_projection_snapshots
  attention_contracts
  attention_seams
  replay_artifacts
  normalized_status_cache
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

## Embedded Reference Storage

The reference implementation also includes a file-backed Event Log for local
development, conformance tests, and small embedded deployments. It is not the
preferred fleet-scale source of truth, but it must still preserve the NEM-1
properties:

```text
append before ack
monotonic seq
replay after restart
fail closed on corrupt records
durable fsync on append
```

The file-backed log stores newline-delimited JSON records. On startup it
validates every persisted line before serving reads or accepting new appends.
Restore uses the same validator and rejects corrupt or non-monotonic `seq`
records before replacing the active log.

The local backup/restore contract is:

```text
backup(destination)
  validate active log
  copy bytes to destination
  fsync destination
  return event_count and last_seq

restore(source)
  validate source log
  write active log through a temp file
  fsync temp file
  atomic rename over active log
  fsync parent directory
  reload in-memory projection cursor
  continue seq from restored tail
```

Operators still need to choose deployment-specific policy outside the reference
code: where logs live, how often backups are taken, how long backups are kept,
how backups leave the robot/host, and how recovery is rehearsed.

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
latest scene projection for mission
latest entities and affordances visible to robot
all events for a run
all Authorizations for a run
all tool calls that proposed robot-affecting runs
all observations contributing to entity ent_123
all scene snapshots where backpack was detected
all emergency stops in a time window
```

Use `jsonb` for flexible payloads, with typed columns for fields we query often:

```text
mission_id
run_id
robot_id
source
event_type
entity_id
authorization_id
timestamp
created_at
seq
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

Do not make ClickHouse the source of truth for v0. Treat it later as an
analytical mirror fed from the Event Log.

## Storage Decision

```text
v0:
  Postgres-backed append-only Event Log
  materialized projections for Mission API reads
  Postgres-backed artifact refs
  optional object-store-compatible backend later

not v0:
  local filesystem as runtime source of truth
  ClickHouse as primary store
  projections that cannot be reproduced from log records and version pins
```
