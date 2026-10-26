import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

const reader='10000000-0000-4000-8000-000000000001';
const admin='10000000-0000-4000-8000-000000000002';
const other='10000000-0000-4000-8000-000000000003';
const migration=name=>fs.readFile(new URL(`../../supabase/migrations/${name}`,import.meta.url),'utf8');

// Test-only schema supplies the documented, missing pre-v0.19 prerequisites.
// It does not claim to reproduce production or replace a real schema export.
const fixture=`
  create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth; create schema storage;
  create schema supabase_migrations;
  create table supabase_migrations.schema_migrations(version text primary key,name text);
  grant usage on schema public,auth,storage to anon,authenticated,service_role;
  create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  create function auth.role() returns text language sql as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;
  create table public.lit_profiles (
    id uuid primary key,username text unique not null,nickname text not null,
    first_name text default '',last_name text default '',account_role text default 'reader',
    author_verified boolean default false,is_admin boolean default false,
    xp integer default 0,reviewer_reputation integer default 0,avatar_path text,
    wanted_genres text[] default '{}',unwanted_genres text[] default '{}'
  );
  create table public.lit_works (
    id uuid primary key,author_id uuid references public.lit_profiles(id),title text,
    status text default 'draft',genres text[] default '{}'
  );
  create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
  create table storage.objects(bucket_id text references storage.buckets(id),name text,owner_id text,primary key(bucket_id,name));
  create function storage.foldername(name text) returns text[] language sql immutable as $$select string_to_array(name,'/')$$;
  alter table storage.objects enable row level security;
  grant select,insert,update,delete on public.lit_profiles,storage.objects to authenticated;
  grant select on storage.objects to anon;
  create policy "legacy profile read" on public.lit_profiles for select to authenticated using(true);
  create policy "legacy broad profile update" on public.lit_profiles for update to authenticated using(true) with check(true);
  create policy "legacy profile insert" on public.lit_profiles for insert to authenticated with check(id=auth.uid());
  create policy "legacy broad storage write" on storage.objects for all to authenticated using(true) with check(true);
  insert into public.lit_profiles(id,username,nickname,is_admin) values
    ('${reader}','reader','Reader',false),('${admin}','admin','Admin',true),('${other}','other','Other',false);
  -- Deliberately insecure test implementation demonstrates the gate protects an
  -- installed legacy RPC while preserving its actual return type and behavior.
  create function public.lit_resolve_author_verification(p_request uuid,p_status text)
  returns public.lit_profiles language plpgsql security definer as $$
  declare result public.lit_profiles;
  begin
    update public.lit_profiles set author_verified=(p_status='approved') where id=p_request returning * into result;
    return result;
  end $$;
`;

async function asUser(db,id,role='authenticated'){
  await db.exec(`reset role; set request.jwt.claim.sub='${id}'; set request.jwt.claim.role='${role}'; set role ${role};`);
}
async function apply(db,sql){
  try{await db.exec(sql);}catch(error){await db.exec('rollback');throw error;}
}

test('profile migrations execute in PostgreSQL and enforce ownership, atomicity and admin gates',async t=>{
  const db=new PGlite();
  try{
    await db.exec(fixture);
    await apply(db,await migration('202610040001_identity_discovery.sql'));
    const profileSql=await migration('202610260001_profile_media_permissions.sql');
    const guardSql=await migration('202610260002_verification_rpc_guard.sql');
    await apply(db,profileSql);await apply(db,guardSql);

    await t.test('owner can edit text; broad legacy policies cannot allow editing another profile',async()=>{
      await asUser(db,reader);
      const own=await db.query("update public.lit_profiles set nickname='Edited' where id=$1 returning nickname",[reader]);
      assert.equal(own.rows[0].nickname,'Edited');
      const foreign=await db.query("update public.lit_profiles set nickname='Stolen' where id=$1 returning id",[other]);
      assert.equal(foreign.rows.length,0);
    });
    await t.test('ordinary clients cannot self-verify or grant admin/XP via the direct table grant',async()=>{
      for(const field of ['author_verified=true','is_admin=true','xp=500','reviewer_reputation=500']){
        await assert.rejects(db.query(`update public.lit_profiles set ${field} where id=$1`,[reader]),/managed by the server/);
      }
      await assert.rejects(db.query('select public.lit_resolve_author_verification($1,$2)',[reader,'approved']),/administrator permission required/);
      const internal=await db.query("select proname from pg_proc where proname like 'lit_resolve_author_verification_internal_%'");
      await assert.rejects(db.query(`select public.${internal.rows[0].proname}($1,$2)`,[reader,'approved']),/permission denied/);
      const newUser='10000000-0000-4000-8000-000000000004';
      await asUser(db,newUser);
      await assert.rejects(db.query("insert into public.lit_profiles(id,username,nickname,is_admin) values($1,'new-user','New',true)",[newUser]),/managed by the server/);
      await db.query("insert into public.lit_profiles(id,username,nickname) values($1,'new-user','New')",[newUser]);
      await asUser(db,reader);
    });
    await t.test('administrator and trusted server award routines retain their workflows',async()=>{
      await asUser(db,admin);
      const result=await db.query('select (public.lit_resolve_author_verification($1,$2)).author_verified as verified',[other,'approved']);
      assert.equal(result.rows[0].verified,true);
      await db.exec('reset role');
      await db.exec(`create function public.fixture_award_xp() returns void language sql security definer as $$update public.lit_profiles set xp=xp+5 where id=auth.uid()$$; grant execute on function public.fixture_award_xp() to authenticated;`);
      await asUser(db,reader);
      await db.query('select public.fixture_award_xp()');
      assert.equal((await db.query('select xp from public.lit_profiles where id=$1',[reader])).rows[0].xp,5);
      await asUser(db,reader,'service_role');
      assert.equal((await db.query('select (public.lit_resolve_author_verification($1,$2)).author_verified as verified',[other,'rejected'])).rows[0].verified,false);
      await asUser(db,reader);
    });
    await t.test('text and preferences commit together and roll back on invalid preference references',async()=>{
      const goodProfile={nickname:'Atomic',username:'reader',bio:'Text',first_name:'',last_name:'',interests:['Books'],favorite_topics:[]};
      const details={favoriteBooks:[{title:'A book',authorName:'An author',externalUrl:''}],socialLinks:[],preferences:{wantedGenres:[],unwantedGenres:[],wantedTopics:[],unwantedTopics:[]}};
      await db.query('select public.lit_save_my_profile($1::jsonb,$2::jsonb)',[JSON.stringify(goodProfile),JSON.stringify(details)]);
      assert.equal((await db.query('select nickname from public.lit_profiles where id=$1',[reader])).rows[0].nickname,'Atomic');
      details.preferences.wantedGenres=[999999999];
      await assert.rejects(db.query('select public.lit_save_my_profile($1::jsonb,$2::jsonb)',[JSON.stringify({...goodProfile,nickname:'Must roll back'}),JSON.stringify(details)]),/foreign key/);
      assert.equal((await db.query('select nickname from public.lit_profiles where id=$1',[reader])).rows[0].nickname,'Atomic');
      assert.equal((await db.query('select title from public.lit_profile_favorite_books where user_id=$1',[reader])).rows[0].title,'A book');
      await assert.rejects(db.query('select public.lit_save_my_profile($1::jsonb,$2::jsonb)',[JSON.stringify({is_admin:true}),'{}']),/unsupported profile field/);
    });
    await t.test('each media bucket allows owner insert/replace/delete and denies foreign paths',async()=>{
      for(const bucket of ['lit-avatars','lit-profile-banners','lit-work-assets']){
        await db.exec('reset role');
        await db.query('insert into storage.objects(bucket_id,name) values($1,$2)',[bucket,`${other}/existing.webp`]);
        await asUser(db,reader);
        await db.query('insert into storage.objects(bucket_id,name) values($1,$2)',[bucket,`${reader}/image.webp`]);
        await assert.rejects(db.query('insert into storage.objects(bucket_id,name) values($1,$2)',[bucket,`${other}/image.webp`]),/row-level security/);
        await assert.rejects(db.query('update storage.objects set name=$1 where bucket_id=$2 and name=$3',[`${other}/stolen.webp`,bucket,`${reader}/image.webp`]),/row-level security/);
        assert.equal((await db.query('delete from storage.objects where bucket_id=$1 and name=$2 returning name',[bucket,`${reader}/image.webp`])).rows.length,1);
        assert.equal((await db.query('delete from storage.objects where bucket_id=$1 and name=$2 returning name',[bucket,`${other}/existing.webp`])).rows.length,0);
      }
    });
    await t.test('reconciliation is repeatable; anonymous RPC execution is denied',async()=>{
      await db.exec('reset role');await apply(db,profileSql);await apply(db,guardSql);
      const wrappers=await db.query("select count(*)::integer total from pg_proc where proname like 'lit_resolve_author_verification_internal_%'");
      assert.equal(wrappers.rows[0].total,1);
      await asUser(db,reader,'anon');
      await assert.rejects(db.query('select public.lit_resolve_author_verification($1,$2)',[reader,'approved']),/permission denied/);
    });
    await t.test('the operator audit SQL is read-only and executes against the known fixture metadata',async()=>{
      await db.exec('reset role');
      const audit=await fs.readFile(new URL('../../supabase/security_audit.sql',import.meta.url),'utf8');
      assert.match(audit,/begin transaction read only/);
      const result=await db.exec(audit);
      assert.ok(result.length>=7);
    });
    await t.test('an unsupported installed overload aborts the migration without replacing it',async()=>{
      await db.exec('reset role');
      await db.exec('create function public.lit_resolve_author_verification(p_request uuid,p_status integer) returns integer language sql as $$select p_status$$;');
      await assert.rejects(apply(db,guardSql),/Unsupported lit_resolve_author_verification signature/);
      assert.equal((await db.query("select public.lit_resolve_author_verification($1,7::integer) value",[reader])).rows[0].value,7);
      await asUser(db,reader);
      await assert.rejects(db.query('select public.lit_resolve_author_verification($1,$2::text)',[reader,'approved']),/administrator permission required/);
    });
  }finally{await db.close();}
});
