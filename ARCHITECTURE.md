# FRAKTUM Literature — current architecture

The application is a browser ES-module client served by `server.mjs` in
development and copied to `dist/` by `build.mjs` for Vercel. Runtime configuration
is generated before app startup from the deployment environment. Supabase Auth,
Postgres REST/RPC and Storage provide the production backend; localStorage holds
the current browser session and a cache of draft/UI state, not a substitute cloud
backend. Production state starts without seeded demo entities.

- `src/app.js` owns bootstrap, event dispatch and legacy application orchestration.
  `src/pages.js` renders the shell and pages; the right chat shell keeps drawer and
  edge control on one transformed container.
- `src/navigation/` owns route parsing, post permalinks, native/clipboard sharing
  and page transition policy. History captures selected entities and scroll.
- `src/cloud.js` implements authenticated REST/RPC/Storage contracts. Refresh-token
  rotation is single-flight; errors retain service/status context. Browser bundles
  may contain publishable Supabase keys, never service-role credentials.
- `src/profile/` validates editable profile data and prepares cropped media. Profile
  text/details use one transaction; immutable Storage paths prevent stale CDN
  images. Replaced/deleted objects are cleaned up after pointer changes succeed.
- `src/editor/` owns structured image normalization, asset uploads, serialization,
  legacy recovery, history, image errors and serial cloud-save queuing. Document,
  draft, fragment and book share the canvas/media model and composition renderer.
  Images store asset path/URL, page, geometry, layers, flow/wrap and caption/alt.
  Legacy binary images pause persistence visibly until their original source is
  recovered to Storage; the original local snapshot is preserved.
- `src/CallSession.js` owns one peer connection and its stream lifecycle, ordered
  signaling, early ICE queue, timeouts, controls and optional diagnostics.
  `webrtc-config.js` builds STUN/TURN settings. Supabase transports signals; media
  uses native WebRTC. Group calls are explicitly unavailable.
- `src/security/SanitizeHtml.js` sanitizes rich text on ingress/render. SQL RLS,
  grants and persisted-admin checks are the authorization boundary.
- `src/feedback/OperationFeedback.js` provides visible errors and pending/duplicate
  submission handling without remounting an unsaved form.

Remaining boundaries are explicit: private notes are device-local; community
mutations and author replies await cloud contracts; pre-v0.19 production schema
history is missing. Current work images use public buckets, so private draft
media must not be treated as access-controlled. See `docs/FUNCTIONALITY_AUDIT.md`
and `docs/STABILIZATION_REPORT.md` for verification scope and acceptance gaps.
