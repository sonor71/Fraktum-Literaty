# Profile and Supabase security stabilization

This change has been validated against an isolated PostgreSQL engine (PGlite) and
browser API fixtures. It has **not** been applied to, or audited against, production.
The environment has no linked Supabase project or Supabase operator credential.
The Supabase Security Advisor therefore remains an outstanding live check.

## Causes and corrections

- The production `UPDATE public.lit_profiles` grant was absent from migration
  history. `202610260001_profile_media_permissions.sql` records it and enables an
  owner update boundary even when an older permissive policy exists.
- A table update grant also exposes privileged columns. A `SECURITY INVOKER`
  trigger blocks direct `anon`/`authenticated` writes to verification/admin/XP/
  reputation fields. It permits trusted definer award/moderation routines; checking
  JWT role instead of `current_user` here would break those legitimate updates.
- Profile media used one overwritable URL with CDN caching. Uploads now use unique
  paths, switch the profile pointer only after Storage succeeds, remove abandoned
  uploads after a failed pointer update, and clean up replaced objects. Removal
  detaches the pointer before deleting bytes. Cleanup failures are visible in UI.
- The avatar/banner policies lacked DELETE, and ownership rules differed. The
  migration gives avatars, banners and work assets the same user-folder rules,
  including restrictive boundaries against older broad policies. MIME types and
  byte limits match client validation. These are public image buckets; they do not
  provide private draft-media access control.
- `null` server media paths and cleared profile text were overwritten with stale
  local fallbacks. Server values now win, including explicit deletion/empty text.
- Text/profile-details saves were independent requests and could partially
  succeed. `lit_save_my_profile(jsonb,jsonb)` applies editable fields, books, links
  and genre/topic preferences in one transaction under the caller's RLS.
- Completed books from another author exposed owner editor controls in a reader's
  profile. They now expose the reading action; authors retain their own controls.

## EXECUTE review

| Routine | Purpose | Client access |
| --- | --- | --- |
| `lit_create_evaluation_session(integer)` | Build the current user's evaluation queue | authenticated, with `auth.uid()` check |
| `lit_complete_evaluation_item(uuid,integer)` | Complete an item owned by the current session user | authenticated, with session ownership check |
| `lit_evaluate_my_achievements()` | Calculate current user's awards from server counts | authenticated, never client-supplied progress |
| `lit_resolve_author_verification(uuid,text)` | Approve/reject an author request | authenticated **only through persisted `is_admin` gate**, or service role |
| `lit_resolve_author_verification_internal_<oid>` | Retained installed legacy implementation | no PUBLIC/anon/authenticated EXECUTE; service/operator only |
| `lit_save_my_profile(jsonb,jsonb)` and taxonomy/detail replacement RPCs | Save caller-owned data | authenticated `SECURITY INVOKER`, RLS enforced |

`202610260002_verification_rpc_guard.sql` discovers the actual installed legacy
function and retains its body/return type under an internal name. It creates a
wrapper that reads `lit_profiles.is_admin` from the database, rather than accepting
client metadata. It handles the expected UUID/text input signature only, aborts
transactionally on unfamiliar overloads, and can be re-run without nesting gates.
If the legacy function is absent, it reports a notice; it does not fabricate the
missing moderation implementation. Client grants on unrelated definer functions
are preserved for individual operator review.

All newly introduced taxonomy, profile detail/preference, fragment, evaluation,
annotation and achievement tables in the committed v0.19+ history enable RLS.
Taxonomy read policies distinguish active catalogues and published/owned works;
profile preference mutations are owner-scoped; awards lack client write policies.
Existing pre-v0.19 tables/functions/policies still require a live inventory. The
current history does not establish their grants or guarantee production parity.

## Reproducible checks

```bash
node --test tests/unit/profile.test.js tests/unit/profile-view.test.js
node --test tests/integration/profile-media.test.js tests/integration/profile-security-sql.test.js
```

The SQL integration suite creates a clearly labeled test-only prerequisite schema,
executes the real identity and new migrations, and checks direct privilege
escalation, foreign row/object writes, admin and trusted-award access, transactional
rollback, anonymous denial, repeatability and unsupported-signature rollback.
The prerequisite fixture is not a production baseline or proof of live RLS parity.

## Production actions still required

1. Link using an authorized operator credential supplied securely in the execution
   environment. Do not put credentials in chat, source files or deploy commands.
2. Export the real Literature schema/history and follow
   `supabase/baseline/README.md`. Earlier migrations are still missing; do not run
   `db reset` or mark migrations repaired without matching their SQL effects.
3. Compare migration history and preview the additive changes:

   ```bash
   supabase link --project-ref "$SUPABASE_PROJECT_REF"
   supabase migration list --linked
   supabase db push --linked --dry-run
   ```

4. After checking the preview against the linked project, apply with
   `supabase db push --linked`, run `supabase/security_audit.sql` through an
   authorized read-only SQL connection, and run Supabase Dashboard Security Advisor.
   No reset or global blanket revoke is part of this procedure.
5. Verify ordinary account self-approval fails; persisted admins can approve;
   avatar/banner save/replace/delete and profile/preferences survive fresh-device
   login; and unrelated TCG objects remain intact. Check all effective EXECUTE
   grants and any writable public-schema warning from the inventory individually.

The SQL inventory complements the advisor; it is not presented as an advisor run.
