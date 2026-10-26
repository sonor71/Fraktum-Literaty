-- Preserve the legacy moderation implementation without inventing its missing
-- baseline definition. Gate the actual installed overload with a persisted admin check.
begin;
do $migration$
declare fn record; internal_name text; signature text; invocation text; body text; result_statement text;
begin
  for fn in select p.*,pg_get_function_identity_arguments(p.oid) identity_args,
      pg_get_function_arguments(p.oid) full_args,pg_get_function_result(p.oid) result_type
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='lit_resolve_author_verification' and p.prokind='f'
  loop
    -- Re-running this additive reconciliation does not wrap a wrapper again.
    if position('FRAKTUM persisted-admin verification gate' in fn.prosrc)>0 then continue; end if;
    if fn.pronargs<>2 or fn.provariadic<>0 or fn.proargmodes is not null
       or fn.proargtypes[0]<>'uuid'::regtype or fn.proargtypes[1]<>'text'::regtype
       or fn.proargnames is distinct from array['p_request','p_status']::text[] then
      raise exception 'Unsupported lit_resolve_author_verification signature: %. Reconcile its baseline before migration.',fn.identity_args;
    end if;
    internal_name:='lit_resolve_author_verification_internal_'||fn.oid::text;
    signature:=format('public.%I(%s)',internal_name,fn.identity_args);
    execute format('alter function public.lit_resolve_author_verification(%s) rename to %I',fn.identity_args,internal_name);
    execute format('alter function %s set search_path=pg_catalog,public',signature);
    execute format('revoke all on function %s from public,anon,authenticated',signature);
    execute format('grant execute on function %s to service_role',signature);
    invocation:=format('public.%I($1,$2)',internal_name);
    if fn.proretset then result_statement:='return query select * from '||invocation||';';
    elsif fn.prorettype='void'::regtype then result_statement:='perform '||invocation||'; return;';
    else result_statement:='return '||invocation||';'; end if;
    body:=format($gate$
      -- FRAKTUM persisted-admin verification gate
      begin
        if auth.role() is distinct from 'service_role' and
          (auth.uid() is null or not exists(
            select 1 from public.lit_profiles profile where profile.id=auth.uid()
              and coalesce((to_jsonb(profile)->>'is_admin')::boolean,false)
          )) then
          raise exception 'administrator permission required' using errcode='42501';
        end if;
        %s
      end;
    $gate$,result_statement);
    execute format('create function public.lit_resolve_author_verification(%s) returns %s language plpgsql security definer set search_path=pg_catalog,public as %L',fn.full_args,fn.result_type,body);
    execute format('revoke all on function public.lit_resolve_author_verification(%s) from public,anon',fn.identity_args);
    execute format('grant execute on function public.lit_resolve_author_verification(%s) to authenticated,service_role',fn.identity_args);
  end loop;
  if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='lit_resolve_author_verification') then
    raise notice 'Legacy verification RPC is absent; restore the verified production baseline before enabling admin verification.';
  end if;
end $migration$;

-- These auth-dependent SECURITY DEFINER functions have explicit ownership checks
-- in committed source and need authenticated EXECUTE, never anonymous execution.
do $$ declare signature text; begin
  foreach signature in array array[
    'public.lit_create_evaluation_session(integer)',
    'public.lit_complete_evaluation_item(uuid,integer)',
    'public.lit_evaluate_my_achievements()'
  ] loop
    if to_regprocedure(signature) is not null then
      execute 'revoke all on function '||signature||' from public,anon';
      execute 'grant execute on function '||signature||' to authenticated';
      execute 'alter function '||signature||' set search_path=pg_catalog,public';
    end if;
  end loop;
end $$;
notify pgrst,'reload schema';
commit;
