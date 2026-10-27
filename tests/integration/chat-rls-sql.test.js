import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

const creator='10000000-0000-4000-8000-000000000001',member='10000000-0000-4000-8000-000000000002',stranger='10000000-0000-4000-8000-000000000003';
const conversation='20000000-0000-4000-8000-000000000001';
// The pre-repository chat schema is not included in the production baseline.
// Execute the real migration against its minimal documented PostgreSQL contract.
const schema=`
create role anon;create role authenticated;
create schema auth;create schema private;
create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema public,auth,private to anon,authenticated;
create table public.lit_conversations(id uuid primary key,conversation_type text,title text,created_by uuid not null,work_id uuid);
create table public.lit_conversation_members(conversation_id uuid references public.lit_conversations(id),user_id uuid,role text,primary key(conversation_id,user_id));
alter table public.lit_conversations enable row level security;
alter table public.lit_conversation_members enable row level security;
grant select,insert on public.lit_conversations,public.lit_conversation_members to authenticated,anon;
create function private.lit_is_conversation_member(p_id uuid,p_user uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.lit_conversation_members where conversation_id=p_id and user_id=p_user)$$;
create policy "legacy conversations insert" on public.lit_conversations for insert to authenticated with check(auth.uid()=created_by);
create policy "legacy member read" on public.lit_conversations for select to authenticated using(private.lit_is_conversation_member(id,auth.uid()));
create policy "owner adds members" on public.lit_conversation_members for insert to authenticated with check(exists(select 1 from public.lit_conversations where id=conversation_id and created_by=auth.uid()));
create policy "member membership read" on public.lit_conversation_members for select to authenticated using(user_id=auth.uid());
`;
async function asUser(db,id,role='authenticated'){await db.exec(`reset role;set request.jwt.claim.sub='${id}';set role ${role}`);}
test('conversation migration fixes INSERT RETURNING while preserving creator/member isolation and RLS',async t=>{
  const db=new PGlite();
  try{
    await db.exec(schema);
    await asUser(db,creator);
    await assert.rejects(db.query('insert into public.lit_conversations values($1,\'project\',\'Before\',$2,null) returning id',[conversation,creator]),/row-level security/);
    await db.exec('reset role');
    const migration=await fs.readFile(new URL('../../supabase/migrations/20261027113527_chat_conversation_creator_returning.sql',import.meta.url),'utf8');
    await db.exec(migration);await db.exec(migration);
    await t.test('authenticated creator inserts a project and reads RETURNING before joining',async()=>{
      await asUser(db,creator);
      const result=await db.query('insert into public.lit_conversations values($1,\'project\',\'After\',$2,null) returning id',[conversation,creator]);assert.equal(result.rows[0].id,conversation);
    });
    await t.test('an unrelated authenticated user cannot read or spoof the creator',async()=>{
      await asUser(db,stranger);assert.equal((await db.query('select * from public.lit_conversations')).rows.length,0);
      await assert.rejects(db.query('insert into public.lit_conversations values($1,\'project\',\'Spoof\',$2,null) returning id',['20000000-0000-4000-8000-000000000002',creator]),/row-level security/);
      await assert.rejects(db.query('insert into public.lit_conversation_members values($1,$2,\'member\')',[conversation,stranger]),/row-level security/);
    });
    await t.test('creator can add memberships; member can then read the conversation',async()=>{
      await asUser(db,creator);await db.query('insert into public.lit_conversation_members values($1,$2,\'owner\'),($1,$3,\'member\')',[conversation,creator,member]);
      await asUser(db,member);assert.equal((await db.query('select id from public.lit_conversations')).rows[0].id,conversation);
    });
    await t.test('anon cannot create or read conversations even with table grants',async()=>{
      await asUser(db,creator,'anon');assert.equal((await db.query('select * from public.lit_conversations')).rows.length,0);
      await assert.rejects(db.query('insert into public.lit_conversations values($1,\'project\',\'Anon\',$2,null)',['20000000-0000-4000-8000-000000000003',creator]),/row-level security/);
    });
    await db.exec('reset role');assert.equal((await db.query("select relrowsecurity from pg_class where oid='public.lit_conversations'::regclass")).rows[0].relrowsecurity,true);
  }finally{await db.close();}
});
