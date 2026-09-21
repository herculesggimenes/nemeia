#!/usr/bin/env bash
set -euo pipefail

# Sole single-host automatic wake owner. All Eve workers and this process must
# use this SAME absolute local WAL. No NFS/shared-host SQLite deployment.
: "${NEMEIA_AGENT_LEDGER:?Set the same absolute WAL path used by Eve}"
case "$NEMEIA_AGENT_LEDGER" in /*) ;; *) echo 'NEMEIA_AGENT_LEDGER must be absolute' >&2; exit 64 ;; esac
bridge_ledger=$(realpath -m -- "$NEMEIA_AGENT_LEDGER")
bridge_module=$(realpath -- "$(dirname -- "${BASH_SOURCE[0]}")/../lib/world-bridge/operational-bridge.ts")
bridge_project=$(realpath -- "$(dirname -- "${BASH_SOURCE[0]}")/../..")
mkdir -p -- "$(dirname -- "$bridge_ledger")"
export NEMEIA_AGENT_LEDGER="$bridge_ledger"
cd -- "$bridge_project"

# Kernel lifetime, no expiring lease or stale-PID recovery. Do not unlink the
# lock file: its inode identifies ownership. Exit 73 means another owner.
exec flock --exclusive --nonblock --conflict-exit-code 73 --no-fork \
  "$bridge_ledger.wake-owner.lock" \
  node --input-type=module -e \
  'const { createJiti } = await import("jiti"); const { runOperationalBridge } = await createJiti(import.meta.url).import(process.argv[1]); await runOperationalBridge();' \
  "$bridge_module"
