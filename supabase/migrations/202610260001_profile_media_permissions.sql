-- Reconcile the production profile UPDATE grant and complete media lifecycle policies.
-- Additive only; this is not a replacement for the missing pre-v0.19 baseline.
begin;

grant update on table public.lit_profiles to authenticated;
grant select on table public.lit_profiles to authenticated;
alter table public.lit_profiles enable row level security;
drop policy if exists "literature profile owner update" on public.lit_profiles;
create policy "literature profile owner update" on public.lit_profiles
  for update to authenticated using(id=auth.uid()) with check(id=auth.uid());
-- Restrict even older permissive UPDATE policies to the owner. Definer moderation
-- RPCs retain their existing privileged path; ordinary REST requests cannot use it.
drop policy if exists "literature profile update boundary" on public.lit_profiles;
create policy "literature profile update boundary" on public.lit_profiles as restrictive
  for update to authenticated using(id=auth.uid()) with check(id=auth.uid());
drop policy if exists "literature own profile read" on public.lit_profiles;
create policy "literature own profile read" on public.lit_profiles
  for select to authenticated using(id=auth.uid());

create or replace function public.lit_guard_profile_privileges() returns trigger
language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
  -- current_user, rather than auth.role(), distinguishes direct client writes
  -- from trusted SECURITY DEFINER award/moderation routines. JWT role is unchanged
  -- inside those routines and would otherwise break legitimate XP updates.
  if current_user not in ('anon','authenticated') then return new; end if;
  if tg_op='INSERT' then
    if coalesce((to_jsonb(new)->>'author_verified')::boolean,false)
       or coalesce((to_jsonb(new)->>'is_admin')::boolean,false)
       or coalesce((to_jsonb(new)->>'xp')::numeric,0)<>0
       or coalesce((to_jsonb(new)->>'reviewer_reputation')::numeric,0)<>0 then
      raise exception 'profile privileges are managed by the server' using errcode='42501';
    end if;
  elsif (to_jsonb(new)->'author_verified') is distinct from (to_jsonb(old)->'author_verified')
     or (to_jsonb(new)->'is_admin') is distinct from (to_jsonb(old)->'is_admin')
     or (to_jsonb(new)->'xp') is distinct from (to_jsonb(old)->'xp')
     or (to_jsonb(new)->'reviewer_reputation') is distinct from (to_jsonb(old)->'reviewer_reputation') then
    raise exception 'profile privileges are managed by the server' using errcode='42501';
  end if;
  return new;
end $$;
revoke all on function public.lit_guard_profile_privileges() from public,anon,authenticated;
drop trigger if exists lit_guard_profile_privileges on public.lit_profiles;
create trigger lit_guard_profile_privileges before insert or update on public.lit_profiles
  for each row execute function public.lit_guard_profile_privileges();

grant select,insert,update,delete on public.lit_profile_favorite_books,public.lit_profile_social_links,
  public.lit_profile_genre_preferences,public.lit_profile_topic_preferences to authenticated;
grant select on public.lit_genres,public.lit_topics to anon,authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
 ('lit-avatars','lit-avatars',true,5242880,array['image/jpeg','image/png','image/webp']),
 ('lit-profile-banners','lit-profile-banners',true,8388608,array['image/jpeg','image/png','image/webp']),
 ('lit-work-assets','lit-work-assets',true,12000000,array['image/jpeg','image/png','image/webp','image/gif'])
on conflict(id) do update set public=excluded.public,file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

-- Same path ownership rule for all three buckets. Restrictive boundaries prevent
-- an older permissive policy from allowing another user's object to be mutated.
drop policy if exists "literature media public read" on storage.objects;
create policy "literature media public read" on storage.objects for select to anon,authenticated
  using(bucket_id in ('lit-avatars','lit-profile-banners','lit-work-assets'));
drop policy if exists "literature media owner insert" on storage.objects;
create policy "literature media owner insert" on storage.objects for insert to authenticated
  with check(bucket_id in ('lit-avatars','lit-profile-banners','lit-work-assets') and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists "literature media owner update" on storage.objects;
create policy "literature media owner update" on storage.objects for update to authenticated
  using(bucket_id in ('lit-avatars','lit-profile-banners','lit-work-assets') and (storage.foldername(name))[1]=auth.uid()::text)
  with check(bucket_id in ('lit-avatars','lit-profile-banners','lit-work-assets') and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists "literature media owner delete" on storage.objects;
create policy "literature media owner delete" on storage.objects for delete to authenticated
  using(bucket_id in ('lit-avatars','lit-profile-banners','lit-work-assets') and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists "literature media insert boundary" on storage.objects;
create policy "literature media insert boundary" on storage.objects as restrictive for insert to authenticated
  with check(bucket_id not in ('lit-avatars','lit-profile-banners','lit-work-assets') or (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists "literature media update boundary" on storage.objects;
create policy "literature media update boundary" on storage.objects as restrictive for update to authenticated
  using(bucket_id not in ('lit-avatars','lit-profile-banners','lit-work-assets') or (storage.foldername(name))[1]=auth.uid()::text)
  with check(bucket_id not in ('lit-avatars','lit-profile-banners','lit-work-assets') or (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists "literature media delete boundary" on storage.objects;
create policy "literature media delete boundary" on storage.objects as restrictive for delete to authenticated
  using(bucket_id not in ('lit-avatars','lit-profile-banners','lit-work-assets') or (storage.foldername(name))[1]=auth.uid()::text);

-- Save the text fields, books, links and preferences in one transaction. The old
-- two independent REST requests could report failure after a partial update.
create or replace function public.lit_save_my_profile(p_profile jsonb,p_details jsonb default '{}')
returns public.lit_profiles language plpgsql security invoker set search_path=pg_catalog,public as $$
declare me uuid:=auth.uid(); updated public.lit_profiles;
begin
  if me is null then raise exception 'authentication required' using errcode='42501'; end if;
  if jsonb_typeof(p_profile) is distinct from 'object' or jsonb_typeof(p_details) is distinct from 'object' then
    raise exception 'profile and details must be objects';
  end if;
  if exists(select 1 from jsonb_object_keys(p_profile) key where key not in
    ('nickname','username','first_name','last_name','bio','current_status','interests','favorite_topics')) then
    raise exception 'unsupported profile field' using errcode='42501';
  end if;
  if (p_profile ? 'nickname' and coalesce(btrim(p_profile->>'nickname'),'')='')
     or (p_profile ? 'username' and coalesce(btrim(p_profile->>'username'),'')='') then
    raise exception 'nickname and username are required';
  end if;
  update public.lit_profiles set
    nickname=case when p_profile ? 'nickname' then btrim(p_profile->>'nickname') else nickname end,
    username=case when p_profile ? 'username' then btrim(p_profile->>'username') else username end,
    first_name=case when p_profile ? 'first_name' then coalesce(p_profile->>'first_name','') else first_name end,
    last_name=case when p_profile ? 'last_name' then coalesce(p_profile->>'last_name','') else last_name end,
    bio=case when p_profile ? 'bio' then coalesce(p_profile->>'bio','') else bio end,
    current_status=case when p_profile ? 'current_status' then coalesce(p_profile->>'current_status','') else current_status end,
    interests=case when p_profile ? 'interests' then array(select jsonb_array_elements_text(p_profile->'interests')) else interests end,
    favorite_topics=case when p_profile ? 'favorite_topics' then array(select jsonb_array_elements_text(p_profile->'favorite_topics')) else favorite_topics end
  where id=me returning * into updated;
  if updated.id is null then raise exception 'profile not found or update denied' using errcode='42501'; end if;
  perform public.lit_replace_my_profile_details(
    coalesce(p_details->'favoriteBooks','[]'::jsonb),coalesce(p_details->'socialLinks','[]'::jsonb),
    array(select value::bigint from jsonb_array_elements_text(p_details#>'{preferences,wantedGenres}')),
    array(select value::bigint from jsonb_array_elements_text(p_details#>'{preferences,unwantedGenres}')),
    array(select value::bigint from jsonb_array_elements_text(p_details#>'{preferences,wantedTopics}')),
    array(select value::bigint from jsonb_array_elements_text(p_details#>'{preferences,unwantedTopics}'))
  );
  return updated;
end $$;
revoke all on function public.lit_save_my_profile(jsonb,jsonb) from public,anon;
grant execute on function public.lit_save_my_profile(jsonb,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
