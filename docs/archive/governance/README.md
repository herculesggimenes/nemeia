# Archived Governance Extension

Status: archived experiment; optional future extension.

This directory records the disposition of the earlier governance-first NEM
Suite architecture. Its implementation remains source-controlled in the
existing Mission, policy, authorization, supervisor, replay, and conformance
packages so no work is lost and historical tests remain reproducible.

These packages are no longer the default Nemeia runtime. The active core is
`world-runtime/`, documented in `docs/world-runtime.md`.

If governance returns, it should wrap `WorldRuntime.execute()` through a narrow
action-execution middleware interface. Entity creation, component updates,
relationship modeling, and affordance discovery must not depend on it.
