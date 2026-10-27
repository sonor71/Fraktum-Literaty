-- INSERT ... RETURNING must be readable before creator membership is inserted.
-- Generated with: supabase migration new chat_conversation_creator_returning
begin;
alter table public.lit_conversations enable row level security;
do $$
declare existing record;
begin
  -- Reconcile historical policy names without leaving permissive OR policies.
  -- An unknown FOR ALL policy must be split by an operator, not silently lost.
  if exists(select 1 from pg_policies where schemaname='public' and tablename='lit_conversations' and cmd='ALL') then
    raise exception 'Split lit_conversations FOR ALL policies before applying creator RETURNING migration';
  end if;
  for existing in select policyname from pg_policies
    where schemaname='public' and tablename='lit_conversations' and cmd in ('SELECT','INSERT')
  loop execute format('drop policy %I on public.lit_conversations',existing.policyname);end loop;
end $$;
create policy "lit conversations creator insert" on public.lit_conversations
  for insert to authenticated
  with check ((select auth.uid()) = created_by);
create policy "lit conversations participant read" on public.lit_conversations
  for select to authenticated
  using (created_by = (select auth.uid())
    or private.lit_is_conversation_member(id, (select auth.uid())));
commit;
