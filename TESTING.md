# Development and regression checks

Use the existing checkout; cloud tasks are isolated and do not need another
worktree. Install the locked development dependencies from the repository root:

```bash
npm ci --include=dev --cache /tmp/fraktum-npm-cache --no-fund --no-audit
npm run lint
npm run typecheck
npm test
npm run test:integration
npm run build
npm run test:e2e
```

`npm run test:all` runs these checks in that order. The browser application and
production build require genuine `VITE_SUPABASE_URL` and
`VITE_SUPABASE_PUBLISHABLE_KEY` values, supplied through environment settings or an
ignored `.env.local`. Missing configuration intentionally fails before replacing
the existing build artifact. Never put a service-role key in browser configuration.

Start development with `PORT=5173 npm run dev`. Verify the app shell,
`/runtime-config.js`, JavaScript modules and manifest with local HTTP requests,
then use the configured project's real Auth/profile flows. Processes must restart
in a new cloud task; see the saved environment startup instructions.

## What the automated checks establish

- ESLint checks JavaScript undefined names and the configured correctness rules.
  TypeScript currently checks the editor's TypeScript model, not every JavaScript
  module in the application.
- Node unit tests cover media/history/save queuing, routing/sharing, sanitization,
  call lifecycle/diagnostics/config, profile validation and unavailable controls.
- Integration tests exercise explicit HTTP request/response contracts and actual
  PostgreSQL SQL/RLS behavior in PGlite against an isolated prerequisite schema.
  The prerequisite schema is a fixture, not an invented production migration.
- Browser tests use `playwright-core` and `/usr/bin/chromium`. Set `CHROMIUM_PATH`
  only to another permitted installed Chromium when necessary. Missing browser
  support is an error, not a silently passing smoke check.
- Browser API fixtures are isolated from production and fail on unknown endpoints.
  They test the real rendered UI: OTP, sessions, errors/loading, share/permalinks,
  history, drawer geometry, profiles/media, feed/reactions, DM/groups and editor
  interactions/reload/recovery. Viewports include 360, 390, 430, 1366 and 1920px.
- The RTP test uses the production CallSession controller in separate browser
  contexts, covering audio/video, both directions and repeated calls. Under the
  cloud-managed `disable_non_proxied_udp` policy without TURN it explicitly skips
  and reports why. Never bypass managed policies or count this as a passed call.

Synthetic API sessions, generated media and fixture coordinates are test inputs.
They do not replace production implementations or demonstrate actual OTP delivery,
production Storage/RLS, real account-to-account calls or NAT/TURN interoperability.
Expected HTTP failures are asserted separately; unexpected page errors and console
errors fail the relevant browser scenarios.

## Required live acceptance

With an authorized test Supabase project and two accounts, check registration/OTP,
login/logout/session refresh; avatar/banner upload/replace/remove; profile taxonomy;
post upload/like/comment/share and a permalink opened on another device; DM/group
messages; document/draft/fragment/book save, publish and fresh-device media restore.
Verify image drag/resize/flow/free/delete/history and multiple images on mobile and
desktop. Confirm ordinary users cannot self-verify or mutate another user's rows.

Run Security Advisor and `supabase/security_audit.sql`, reconcile the missing
historical baseline, and compare production migration history before applying
additive changes. Use two allowed browsers and real accounts to establish audible
and visible media in both directions, mute/camera switching, reject, hangup,
repeated calls and relay behavior. Optional TURN variables and the checklist are
in `REALTIME_AND_CALLS.md`.

Passing local fixtures or a copied static build is not the production definition
of done. See `docs/STABILIZATION_REPORT.md` for the actual run and known limits.
