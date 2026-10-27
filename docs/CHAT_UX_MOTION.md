# Chat UX and motion

## Rendering and transport boundaries

Routine chat operations never call `render()` or replace `#app`. The drawer,
composer, tab panels and keyed message bubbles remain mounted. Large page
navigation still uses `transitionPage`; reparenting the persistent chat shell
preserves its input, draft and scroll positions. Notifications, post likes,
sidebar toggles and toast feedback also update locally.

| Module | Responsibility |
| --- | --- |
| `src/chat/ChatStore.js` | Cached conversations, pending/failed messages, ID reconciliation |
| `src/chat/ChatController.js` | Selection, drafts/views, optimistic sends, cancellation on account change |
| `src/chat/ChatView.js` | Keyed thread/message updates, message status, scroll and accessibility |
| `src/chat/ChatTransport.js` | Serial 1,800 ms polling and a replaceable transport contract |
| `src/chat/SupabaseChatRepository.js` | Current backend adapter; the view has no Supabase API dependency |
| `src/motion/ModalLifecycle.js` | Local modal entrance/exit, focus trap/restoration and stale-animation protection |

The transport/repository contract is:

```js
fetchThreads()                         // -> { threads, people }
fetchMessages(threadId)                 // -> message DTO[]
sendMessage(threadId, {clientId, text})  // -> confirmed message DTO
createGroup({clientId, title, memberIds}) // -> confirmed thread DTO
subscribe({getThreadId, onThreads, onMessages, onError})
unsubscribe()
```

The DTO uses `id`, `fromId`, `from`, `text`, `createdAt`, `time` and `mine`.
The store adds `clientId`, `status` (`sending`, `sent`, `failed`) and `error`.
The local temporary ID is `client:<UUID>`; the request uses that UUID as the
server primary key. An acknowledgement, a poll arriving before acknowledgement,
and a retry reconcile to one bubble. A duplicate-key response is resolved by
reading the exact ID scoped to sender and conversation. Retry never generates
another message UUID. An obsolete account's response cannot repopulate the UI.

Opening a conversation starts at its latest messages. Polls keep readers near
the bottom at the bottom, preserve history readers' position and show a
“Новые сообщения ↓” control. Status changes preserve the message text node.
Existing messages never replay entrance animations on polling. Thread drafts
and tab list positions remain in memory while switching conversations/tabs.

`markRead` is not exposed: this schema has no documented read-receipt contract.
A future transport can implement subscriptions without changing ChatView or
optimistic state; receipt support should be added with a real repository API.

## Motion and accessibility

`src/motion/Motion.css` defines 100/140/200/260 ms interaction/content/panel
tokens and standard/emphasized/exit easings. Drawer and attached toggle share
one transform. Tab underlines use transform; conversation/tab crossfades use
inert, aria-hidden snapshots removed after opacity/transform animations.
Message entrances apply only to unseen IDs. Modal exit completes before removal.
Existing unrelated Studio animations are outside this change.

Reduced motion disables CSS motion and skips Web Animations API transitions.
Tabs support arrow/Home/End navigation and selected states; dialogs trap Tab,
close on Escape and restore focus. Errors preserve entered data and expose
operation feedback. Async buttons immediately show busy/disabled feedback;
message sends keep the composer available for the next message.

## RLS migration and deployment

Created using Supabase CLI 2.75.0:

```sh
supabase migration new chat_conversation_creator_returning
```

Migration: `20261027113527_chat_conversation_creator_returning.sql`.
It retains RLS, permits authenticated inserts only for `auth.uid() = created_by`,
and SELECT only for the creator or
`private.lit_is_conversation_member(id, auth.uid())`. Thus INSERT RETURNING works
before creator membership exists. Historical SELECT/INSERT policy names are
reconciled; UPDATE/DELETE policies are untouched. An unknown FOR ALL policy
aborts rather than silently changing its other permissions.

Prerequisites are the existing conversation tables and private membership
function. The pre-repository production schema is still unavailable; the SQL
integration test supplies its minimal documented contract and executes the
actual migration in PostgreSQL, including a failing pre-migration RETURNING.
It proves creator RETURNING, outsider denial, membership insertion/read, anon
denial and repeatable application. It is not a live production schema test.

Follow `supabase/baseline/README.md` before a linked deployment. Compare
`supabase migration list --linked`, reconcile the already-applied production
hotfix and review `supabase db push --dry-run` before an operator pushes.
No production migration, schema reset or linked database write was performed
for this PR. No new environment variables or runtime dependencies are required.

## Remaining backend coupling and limits

- `cloud.js` still supplies Supabase REST table/RPC queries and DTO mapping for
  conversations, membership, messages and profiles. Replace the repository
  adapter and transport when moving servers.
- Auth uses the existing shared Supabase session/refresh/OTP adapter in
  `cloud.js`; Storage URLs/uploads use existing profile/editor asset services.
  Both must receive replacement adapters during migration.
- Calls and notifications still use their existing Supabase signaling/tables
  outside ChatTransport; this task does not migrate WebRTC signaling.
- Group creation is two HTTP writes, not a transaction. Unchanged-form retries
  reuse a conversation UUID and ignore duplicate memberships using the existing
  `(conversation_id, user_id)` unique key. A partial failure can leave a
  creator-owned conversation without memberships. Editing the form starts a new
  operation; atomic group creation needs a server transaction in a future API.
- Initial history fetch is limited to the newest 250 messages. No pagination,
  receipt API or offline durable outbox was added. Pending/failed messages and
  drafts are in memory; reloading discards unconfirmed local state.
- HTTP browser fixtures and PostgreSQL tests do not verify live Supabase,
  physical mobile devices, WebSocket behavior or production network latency.
- Typecheck retains the repository's existing editor TypeScript scope; new chat
  JavaScript is covered by lint, unit/integration tests and browser execution.

## Validation

All required scripts are run for this task: lint, typecheck, unit, integration,
build (CI fixture configuration) and E2E. The E2E suite checks optimistic/confirmed
messages, Retry, polling identity, old/near-bottom scroll, first-open position,
page-navigation drafts, mobile/desktop selection, both group failure stages,
modal lifecycle, reduced motion and Chrome performance.

The inherited review retry regression on main also required the existing
one-shot denial route fix and waiting for the actual POST response; all review
assertions remain. CI now uses lockfile dependencies and runs integration tests.

Chrome DevTools Protocol records timeline Layout/Paint/UpdateLayoutTree events,
Performance counters, long tasks, RAF frame intervals and root DOM mutations.
The motion sample warms initial application layout/audio unlock first. Raw local
artifacts are `/tmp/fraktum-chat-performance.json` and
`/tmp/fraktum-chat-performance-trace.json`. Measurements are diagnostics, not
machine-speed-dependent correctness assertions. A numerical sample and final
test counts are recorded in the PR description.
