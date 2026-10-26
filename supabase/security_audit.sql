-- Read-only audit for the linked production project. Run after reconciling the
-- real baseline; results complement, rather than replace, Supabase Security Advisor.
begin transaction read only;

-- Effective EXECUTE includes inherited PUBLIC privileges. Inspect every public
-- SECURITY DEFINER, including older routines absent from this repository.
select n.nspname schema,p.proname,pg_get_function_identity_arguments(p.oid) arguments,
  pg_get_userbyid(p.proowner) owner,p.proconfig,
  has_function_privilege('anon',p.oid,'EXECUTE') anon_execute,
  has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated_execute,
  has_function_privilege('service_role',p.oid,'EXECUTE') service_execute,
  case
    when p.proname='lit_resolve_author_verification' then 'Persisted admin gate required; authenticated admins + service'
    when p.proname like 'lit_resolve_author_verification_internal_%' then 'Legacy implementation: no PUBLIC/anon/authenticated execute'
    when p.proname in ('lit_create_evaluation_session','lit_complete_evaluation_item','lit_evaluate_my_achievements') then 'Authenticated self-scoped RPC; inspect ownership checks'
    else 'Review definition and callers individually before changing grants'
  end review
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.prosecdef and p.prokind='f'
order by p.proname,arguments;

-- Complete Literature RLS and role grant inventory, including legacy tables.
select n.nspname schema,c.relname,c.relrowsecurity rls_enabled,c.relforcerowsecurity rls_forced,
  has_table_privilege('anon',c.oid,'SELECT') anon_select,
  has_table_privilege('authenticated',c.oid,'SELECT') authenticated_select,
  has_table_privilege('authenticated',c.oid,'INSERT') authenticated_insert,
  has_table_privilege('authenticated',c.oid,'UPDATE') authenticated_update,
  has_table_privilege('authenticated',c.oid,'DELETE') authenticated_delete
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind in ('r','p') and c.relname like 'lit\_%' escape '\'
order by c.relname;

select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check
from pg_policies where (schemaname='public' and tablename like 'lit\_%' escape '\')
  or (schemaname='storage' and tablename='objects')
order by schemaname,tablename,policyname;

select id,public,file_size_limit,allowed_mime_types from storage.buckets
where id in ('lit-avatars','lit-profile-banners','lit-work-assets','lit-post-media');

-- A writable public schema can undermine definer routines that resolve public
-- objects by unqualified name. Review this shared schema with its operator.
select role,has_schema_privilege(role,'public','CREATE') can_create_in_public
from (values('anon'),('authenticated')) roles(role);

select version,name from supabase_migrations.schema_migrations order by version;
rollback;
