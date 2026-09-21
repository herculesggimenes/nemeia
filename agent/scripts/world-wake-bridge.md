# Explicit single-host world wake bridge

Eve `info`, `build`, and module discovery are world-I/O-free. Authenticated
`onSession` and step hooks lazily initialize read/projection/action access.
These Eve workers **never dispatch automatic wakes**, even with a wake URL set.

Start the separate operational relay explicitly, under the host's ordinary
process supervisor, after configuring the same local absolute
`NEMEIA_AGENT_LEDGER` path for both Eve and the relay:

```sh
bash agent/scripts/world-wake-bridge.sh
```

Required configuration: `NEMEIA_WORLD_URI`, `NEMEIA_WORLD_DATABASE`,
`NEMEIA_WORLD_ID`, `NEMEIA_AGENT_ID`, `NEMEIA_AGENT_LEDGER`,
`NEMEIA_EVE_WAKE_URL` (loopback HTTP `/wake` only),
`NEMEIA_WORLD_AUTH_ISSUER`, `NEMEIA_WORLD_AUTH_AUDIENCE`,
`NEMEIA_WORLD_AUTH_SECRET`, and `NEMEIA_AGENT_OWNER_PRINCIPAL_ID`.
The owner is `issuer:subject`; optionally supply `NEMEIA_WORLD_AUTH_SUBJECT`.
`NEMEIA_WORLD_TOKEN` is the generated client's scoped credential, when required.
Keep all credentials in trusted process configuration, never sandbox files.
The repo's pinned `jiti` runner resolves the generated TypeScript SDK; the
launcher changes to the project directory for that dependency resolution.

`flock` holds the canonical WAL's `.wake-owner.lock` inode for the process's
entire lifetime. A second launcher exits **73 before opening SQLite or
connecting**. The kernel releases ownership on exit/crash. Never unlink the
lock file while a bridge may be running. This is a single-host/local-WAL
deployment, not an NFS, multi-host, or multi-ledger ownership mechanism.

The native WorldClient subscriptions feed the existing bounded coalescer. One
transport delivery is pending at a time; retries use the persisted wake ID and
payload. A capped, unref transport timer observes shared-WAL releases from Eve
hooks; it does not schedule model steps. SIGINT/SIGTERM aborts transport, closes
subscriptions/timers, and settles the in-flight WAL receipt before SQLite closes.

## Conservative uncertainty handling

Ledger open/restart never clears activity. Busy sessions remain visibly `held`
until Eve's public turn/session lifecycle records a release. A durable
reservation is written **before** the custom channel calls `from.send`.
If that attempt loses its result or crashes before binding the session receipt,
the same wake is held (HTTP 409 on another channel attempt), never resent.
Failures before the channel's send reservation can safely retry the transport.

This is **not automatic reconciliation of ambiguous deliveries**. The public
custom-channel send API does not provide a caller-selected idempotency key or
a delivery receipt usable after that crash window. An old `session.waiting`
stream tail also cannot prove that a newer accepted delivery completed.
Unresolved records require explicit investigation using Eve's authenticated
public session stream and deployment-owner intervention. No TTL, stale-PID
guess, automatic session reset, or new recovery API clears them. Must-handle
sources remain pending separately; send acceptance is not domain handling.

Local evidence commands (no inference or WorldDB mutations):

```sh
node --experimental-strip-types --test agent/test/operational-bridge.test.mjs agent/test/runtime-import-safety.test.mjs
NEMEIA_TEST_COMPILER=1 node --experimental-strip-types --test agent/test/runtime-import-safety.test.mjs
```

The first command uses local stubs and temporary WALs; the second also runs
actual Eve info/build in a temporary copy of the production definitions.
Neither is actual-DB automatic-wake qualification. That requires an exclusive
fixture window and a deterministic model; G2/G3 must be rerun separately.
