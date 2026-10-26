# FRAKTUM Studio control audit

Task branch: `codex/20261026-studio-connections`, based on latest `main` at
`326a819222d33dd676ad7c3731cc4582795c8c27`.

## Scope and behavior

No active Create control is a demo/future placeholder. Controls disabled at an
empty history, protected page, unavailable direction or inactive connection mode
represent a current precondition. Unrelated social features remain outside scope.

| Controls | Implementation and persistence |
| --- | --- |
| New project, work/fragment/draft/post, document/book | Existing wizard routes to the actual editor or post form; verified-author cloud APIs remain in use |
| Project selection, page selection, previous/next | Flush current canvas, preserve chosen project/page in local state and browser history, scroll the list only |
| Page list | Own vertical scrollbar at every breakpoint, bounded/reserved viewport height, overscroll containment; 5/50/100/200-page browser cases |
| Add book/document page | Structured page creation followed by local save and cloud autosave |
| Delete ordinary page | Confirmation for text/images/background/connections; cover/title and final document sheet are protected; indices clamp correctly |
| Save, Ctrl/Cmd+S | Actual queued cloud save; failures are visible; no local-only publication claim |
| New version | Retains structured canvas/relations, resets version identity and schedules cloud persistence |
| Preview / book mode | Existing publication-card preview plus shared read-only composition in book spreads |
| Publish/update publication, send/open evaluation | Cloud API first; publication/evaluation status changes after acknowledgement; no fabricated local XP |
| Close evaluation | Persists closed status through the cloud queue; fragment visibility is independent of evaluation-open status |
| Insert / layout ribbon tabs | Scrolls to media panel / toggles page grid |
| Bold, italic, underline, strike | Real formatting command plus editor snapshot/history; sanitizer now retains vetted font-weight/font-style/text-decoration properties |
| Font family/size, color/highlight, headings, line spacing | Real editable content changes; size converts obsolete FONT markup to sanitized SPAN styles; persistence/history preserved |
| Align, lists, indent/outdent, link, clear formatting | Existing rich-text commands; unsupported selection/command failures now give feedback |
| Undo/redo buttons | Use EditorRoot rather than disconnected browser history; disabled when the corresponding history is empty |
| Add text, note, card | Existing object mechanics; cards use `type:text, role:connection-card` and editable note styling |
| Upload / media library / background | Existing Storage uploads and durable asset references; background/media placement paths preserved |
| Drag/resize/rotation, layout/wrap, opacity/radius, text fill, layers, lock | Existing object handlers and history; the SVG reads live DOM geometry during gestures |
| Visible duplicate/forward/back/lock/delete toolbar | Toolbar outside scaled page; delete removes the placement and dangling links in one history transaction; the media-library file is retained |
| Delete/Backspace, duplicate shortcut, arrow movement | Existing keyboard mechanics remain; editable fields retain ordinary text-input keys |
| Connect/type/cancel | Explicit second-object mode, source outline, Escape/empty-canvas cancellation, no self-links or duplicate ordered/type links |
| Select relationship/type/label/reverse/delete | SVG hit paths and keyboard selection, plus an inspector list; edits use EditorRoot and autosave; deleting a line retains its objects |
| TCG | Visible launcher, dispatcher/import/CSS, unused launcher helper and its configuration removed; Auth session/OTP APIs retained |

The primary model is `canvas.connections`, never SVG/DOM markup. Old pages gain
an empty array. Normalization, book-state restoration and cloud serialization
preserve valid relationships and remove dangling references. Straight paths use
rectangle-edge anchors including rotation. Cause/dependency use arrows; relation
is solid, dependency dashed, hypothesis dotted. Meaning does not rely on color.
Editor and published reader/book-preview share the renderer; read-only variants
contain no relationship actions or tab targets.

## Regression coverage and execution

- `tests/unit/connections.test.js`: normalization/validation, duplicate/self/dangling
  links, rotated anchors and geometry updates, history, serialization/state reload,
  and protected-page deletion. EditorRoot.record now clones its before-snapshot
  before mutation, fixing a discovered history defect.
- `tests/integration/studio-persistence.test.js`: published work JSON in both modes,
  fragment visibility/evaluation separation, no serialized SVG markup.
- `tests/e2e/studio-connections.test.js`: page count/scroll matrices, real pointer
  movement before pointerup, uploaded/media images, connection editing/history,
  local/cloud/reload across all project modes, independent reader context,
  new versions, project switches, page confirmation and text/note/card deletion.
- Existing media E2E selectors now explicitly target the new visible toolbar.
  The Create audit checks rendered action dispatch coverage and missing handlers.
- The inherited review CI test keeps one route and denies only the first POST.
  It waits for the successful retry HTTP response and asserts exactly one fixture
  POST/row, unchanged typed body, original failure safety and reload restoration.
  This repairs a pre-existing failing baseline; no assertions were removed.
- CI uses the pinned lockfile, without a second unpinned tool installation, and
  now includes integration tests as well as existing checks.

Commands executed: `npm run lint`, `npm run typecheck`, `npm test`,
`npm run test:integration`, `npm run build`, `npm run test:e2e`.
The build uses the same explicitly non-production Supabase coordinates as CI;
actual credentials are absent in this workspace. Build output is retained outside
the checkout; tracked generated dist files are unchanged.

Final counts and the GitHub Actions URL are reported with the PR handoff.

Local result: lint/typecheck/build passed; 85 unit and 31 integration tests passed;
full E2E 47 passed, 0 failed, 1 pre-existing managed-browser RTP skip.

## Limits

Page deletion has confirmation but no page-level undo: the existing history is
scoped to the active canvas. Object and relationship mutations support undo/redo.
Routes are straight segments; automatic obstacle routing is not implemented.
Cloud/browser tests use explicit fixtures; production Supabase and physical mobile
devices have not been exercised. The existing actual RTP test can skip under the
managed browser policy; this task does not change or conceal that outcome.
No database migration or new runtime variable is needed for relationship JSON.
The existing work/version/taxonomy backend still uses separate HTTP requests;
this task does not introduce a transactional publishing RPC.
