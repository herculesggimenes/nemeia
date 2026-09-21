# Native operator verification

E7 passed the actual native mutation flow; E12 cutover is released and applied.
`/` redirects to `/missions`. The selected app has no RobotRuntime/workbench
startup, legacy cockpit handler, or robot HTTP proxy. `/settings`, `/docs`, and
`/framework` remain read-only. Useful driver source and user data are preserved.

Both `npm run dev` and `npm run start` bind only `127.0.0.1:5173`. Operator
credentials are manually entered into a password field and kept in per-tab
memory. Only URI/database configuration may use public build variables.
Resource routes use fixed server URI/database/private-root configuration and the
caller's bearer token; they never bootstrap an anonymous browser with a token.

## Safe aggregate checks

From `frontend/`, using the retained owned service:

```sh
npx next typegen
NEMEIA_ISOLATED_BUILD=1 NEMEIA_UI_URL=http://127.0.0.1:5183 npm run check:internal
```

The isolated build flag prevents Next from cleaning the retained `.next/e7`
development cache. Normal production build/start may omit it when no owned
development service is being retained. After switching route inventories, use
`next typegen` to replace stale generated validators.

This is an optional frontend internal check, separate from the root Playwright
E2E default.

The replacement smoke suite is credential-free and cannot write World state.
Before HTTP probes, it audits every app source and transitive local import for
legacy startup and verifies that only the two native resource handlers remain.
It tests default auth gating, desktop/mobile layout, readonly settings/docs, and
eight empty retired endpoint requests returning 404. Retirement probes never
carry a robot host, real robot identifier, action payload, or credential.
Browser requests are fenced before navigation, and WebRTC is disabled.

Smoke artifacts use `test-results/smoke` exclusively: Playwright cleans its
output directory, so it must not own the parent qualification artifact folder.
No trace, HAR, video, or browser auth state is saved.

## Real native adapter and bytes

Integration owns the held database and provides the mode-0600 handoff at
`.artifacts/qualification/current-handoff.json`. The launcher passes public
URI/database and private server resource-root configuration only, never tokens:

```sh
node scripts/start-native-fixture.mjs
```

Default frontend URL is `http://127.0.0.1:5183`; `NEMEIA_UI_PORT` overrides the
port. Do not stop Integration services or compete for a development lock.

Read-only cutover verification, with a retained accepted E7 mission:

```sh
NEMEIA_UI_URL=http://127.0.0.1:5183 \
NEMEIA_REVIEW_MISSION='E7 review 29cd139f' \
timeout 180s node scripts/verify-native-ui.mjs --cutover
```

The helper reads the scoped operator token file internally, checks
`world_operator` scope/readiness, and verifies retained PNG digest, ranges,
authorization, image decoding, desktop/mobile layout and reconnect. The optional
review-mission argument verifies existing accepted proof, rejection feedback,
and completed-review copy without mutation. Screenshots are taken only after
the password field is removed and stored in `test-results/native-e12`.

The browser fence permits only the configured native database subscription,
canonical websocket-token authentication exchange, local Next development
socket, static app paths, and scoped immutable resource reads. Unexpected HTTP,
socket, legacy API and WebRTC requests fail verification before transmission.
No hardware or G3 qualification is implied by this frontend check.

## Mutation qualification — explicit allocation only

```sh
NEMEIA_UI_URL=http://127.0.0.1:5183 timeout 180s node scripts/verify-native-ui.mjs --mutate
```

This creates distinct missions, assigns the same Agent to multiple missions,
changes the shared simulator Unit grant, rejects and accepts candidate evidence,
and checks real revision conflict/disconnect/reconnect. It must never overlap
G2/G3 permission or grant changes. E7 already passed: do not replay it merely
to obtain screenshots. Cutover verification explicitly refuses `--mutate`.

## Remaining limitations

Map rendering is an honest native metadata/frame-coordinate list, not a fabricated
spatial overlay. Evidence can be stale; retained bytes remain reviewable with that
state visible. Feedback catch-up is bounded; a recent-window fallback preserves
nearby feedback and explicitly reports skipped history. Revision-conflict errors
may still arrive from World as an opaque SDK error; the UI does not invent a
domain-specific explanation.

Production builds emit a ResourceGateway dynamic-filesystem tracing
warning. Qualification traced-file checks found no credential or fixture paths.
Root Integration owns dependency-lock reconciliation; frontend metadata declares
canonical world-client/world-resources and no world-runtime dependency.
