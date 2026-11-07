-- ONE read-only handoff: Sadeeman ujdzysbowngtkwndgoqf only. Confirm dashboard ref first.
-- Approved migration FILE SHA256: 770237AB233569FF25899BB4611F0A62D6C98EBB88B08E95B9D0BE6593F47AA0
-- No DDL, data writes, grants, deletes, Auth settings or history repair.
-- Only allowlisted, previously created temporary Auth identities are probed.
-- Controlled SQL claims test the validator, not JWT signature verification.
-- Inactive/no eligible fixture => BLOCKED, never a fabricated expiry PASS.
begin transaction isolation level repeatable read read only;
select set_config('sadeeman_verification.metadata', m.session_security_verification::text, true)
from (
with expected(signature, body_sha256, definer, volatility, result_type, auth_execute) as (
  values
    ('sadeeman_private.current_session_valid()', '0e9fccbebdf31f269dcca8eb67e14da05b66fb5e3ca7efb4b608bec4ee5a57bd', true, 's', 'boolean', true),
    ('public.sadeeman_session_active()', '46ff22e118d4f5574dcf461d55955d77d5334b3aa5d3b976d0411616b312a127', false, 's', 'boolean', true),
    ('sadeeman_private.guard_consent()', null, false, 'v', 'trigger', false),
    ('sadeeman_private.guard_memory()', null, false, 'v', 'trigger', false)
), functions as (
  select e.signature, p.oid is not null as present,
    coalesce(p.prosecdef=e.definer and p.provolatile::text=e.volatility
      and pg_get_function_result(p.oid)=e.result_type and p.pronargs=0
      and (select lanname from pg_language where oid=p.prolang)=case when e.signature='public.sadeeman_session_active()' then 'sql' else 'plpgsql' end
      and pg_get_userbyid(p.proowner)='postgres'
      and p.proconfig = array['search_path=""']
      and has_function_privilege('authenticated',p.oid,'EXECUTE')=e.auth_execute
      and not has_function_privilege('anon',p.oid,'EXECUTE')
      and not exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
        where a.grantee=0 and a.privilege_type='EXECUTE'),false) as contract_matches,
    case when e.body_sha256 is not null then
      coalesce(encode(sha256(convert_to(replace(p.prosrc,chr(13),''),'UTF8')),'hex')=e.body_sha256,false)
      else null end as approved_body_matches,
    pg_get_functiondef(p.oid) as deployed_definition,
    (select jsonb_agg(jsonb_build_object('grantee',case when a.grantee=0 then 'PUBLIC'
       else pg_get_userbyid(a.grantee) end,'privilege',a.privilege_type,'grantable',a.is_grantable))
     from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a) as execute_acl
  from expected e left join pg_proc p on p.oid=to_regprocedure(e.signature)
), tables as (
  select c.relname,c.relrowsecurity,c.relforcerowsecurity from pg_class c
  join pg_namespace n on n.oid=c.relnamespace
  -- The already-deployed session contract covers these eleven original tables.
  -- Local-only CRM tables have separate FORCE RLS/permission regression coverage.
  where n.nspname='public' and c.relkind='r' and c.relname in ('sadeeman_conversations','sadeeman_turns','sadeeman_messages','sadeeman_consents','sadeeman_memories','sadeeman_requests','sadeeman_audit_events','sadeeman_session_revocations','sadeeman_tool_executions','sadeeman_company_packages','sadeeman_travel_profiles')
), policies as (
  select tablename,policyname,permissive,roles,cmd,qual,with_check
  from pg_policies where schemaname='public' and tablename like 'sadeeman_%'
), auth_access as (
  select r.rolname,r.rolsuper,r.rolbypassrls,
    has_any_column_privilege(r.rolname,'auth.sessions','SELECT') as auth_select,
    has_any_column_privilege(r.rolname,'auth.sessions','INSERT') as auth_insert,
    has_any_column_privilege(r.rolname,'auth.sessions','UPDATE') as auth_update,
    has_table_privilege(r.rolname,'auth.sessions','DELETE') as auth_delete,
    has_schema_privilege(r.rolname,'sadeeman_private','USAGE') as private_usage
  from pg_roles r where r.rolname in ('anon','authenticated')
)
select jsonb_build_object(
  'database_context',jsonb_build_object('database',current_database(),'role',current_user,
    'server_version',current_setting('server_version'),
    'project_ref_setting',current_setting('supabase.project_ref',true),
    'identity_note','A null project_ref_setting is not identity proof; confirm the dashboard project URL'),
  'checks',jsonb_build_object(
    'function_contracts_match',(select count(*)=4 and bool_and(present and contract_matches) from functions),
    'approved_bodies_match',(select count(*)=2 and bool_and(approved_body_matches)
      from functions where approved_body_matches is not null),
    'all_11_application_tables_force_rls',(select count(*)=11 and bool_and(relrowsecurity and relforcerowsecurity) from tables),
    'revocation_policy_roles_and_count_match',(select count(*)=1 and bool_and(policyname='own_sessions'
      and roles=array['authenticated']::name[] and cmd='ALL' and permissive='PERMISSIVE')
      from policies where tablename='sadeeman_session_revocations'),
    'client_auth_access_denied',(select count(*)=2 and bool_and(not rolbypassrls and not rolsuper
      and not auth_select and not auth_insert and not auth_update and not auth_delete) from auth_access),
    'private_schema_usage_matches',(select count(*)=2 and bool_and(private_usage=(rolname='authenticated')) from auth_access),
    'validator_owner_can_bypass_rls',(select rolbypassrls or rolsuper from pg_roles where rolname='postgres')
  ),
  'functions',(select jsonb_agg(to_jsonb(f) order by signature) from functions f),
  'same_name_function_signatures',(select jsonb_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text)
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='sadeeman_private' and p.proname in ('current_session_valid','guard_consent','guard_memory'))
      or (n.nspname='public' and p.proname='sadeeman_session_active')),
  'rls_tables',(select jsonb_agg(to_jsonb(t) order by relname) from tables t),
  'policies_review_required',(select jsonb_agg(to_jsonb(p) order by tablename,policyname) from policies p),
  'client_roles_and_privileges',(select jsonb_agg(to_jsonb(a) order by rolname) from auth_access a),
  'private_schema_acl',(select nspacl::text from pg_namespace where nspname='sadeeman_private'),
  'auth_session_columns',(select jsonb_agg(jsonb_build_object('name',column_name,'type',data_type,'nullable',is_nullable)
    order by ordinal_position) from information_schema.columns
    where table_schema='auth' and table_name='sessions' and column_name in ('id','user_id','not_after')),
  'migration_history',(select jsonb_agg(jsonb_build_object('version',version,'name',name) order by version)
    from supabase_migrations.schema_migrations)
) as session_security_verification
) m;

do $session_checks$
declare
  allowed_owners uuid[] := ARRAY[
-- TEST_OWNER_ALLOWLIST_START
    'f31a82ed-a1e9-4cea-9e3f-da2dc52dbabf'::uuid,
    'aca7b6fb-74b1-40db-b92e-d397383a9528'::uuid,
    'c231fa9b-2307-4505-b18b-d7b0a0062d87'::uuid,
    '6b00784a-42a4-445f-8aa4-64436a4ce264'::uuid
-- TEST_OWNER_ALLOWLIST_END
  ];
  b_owner constant uuid := '6b00784a-42a4-445f-8aa4-64436a4ce264';
  b_session constant uuid := '467a9425-60ba-4814-a2da-abf866d39b4d';
  original_role text := current_user;
  original_sub text := current_setting('request.jwt.claim.sub',true);
  original_claims text := current_setting('request.jwt.claims',true);
  candidate_owner uuid; candidate_session uuid;
  valid_claims jsonb; baseline boolean; missing_rejected boolean;
  expired_rejected boolean; nonexistent_rejected boolean; continuity boolean;
  nonce uuid := gen_random_uuid(); nonce_absent boolean;
  report jsonb := jsonb_build_object('status','BLOCKED_NO_ACTIVE_TEMPORARY_FIXTURE');
  cleanup jsonb;
  metadata jsonb := current_setting('sadeeman_verification.metadata')::jsonb;
begin
  select jsonb_build_object(
    'authUserExists',exists(select 1 from auth.users where id=b_owner),
    'createdWithinRecordedTestWindow',coalesce((select (to_jsonb(u)->>'created_at')::timestamptz between '2026-11-05T20:49:55Z'::timestamptz and '2026-11-05T20:50:25Z'::timestamptz from auth.users u where u.id=b_owner),false),
    'stillAnonymous',coalesce((select (to_jsonb(u)->>'is_anonymous')::boolean from auth.users u where u.id=b_owner),false),
    'authSessionExists',exists(select 1 from auth.sessions where id=b_session and user_id=b_owner),
    'applicationRevocationExists',exists(select 1 from public.sadeeman_session_revocations where session_id=b_session and owner_id=b_owner),
    'conversationsRemaining',(select count(*) from public.sadeeman_conversations where owner_id=b_owner),
    'consentsRemaining',(select count(*) from public.sadeeman_consents where owner_id=b_owner),
    'memoriesRemaining',(select count(*) from public.sadeeman_memories where owner_id=b_owner),
    'note','Observation only. No identity deletion is authorized by this report; review exact temporary scope before cleanup.'
  ) into cleanup;
  if (metadata->'checks'->>'function_contracts_match')::boolean
     and (metadata->'checks'->>'approved_bodies_match')::boolean then
    select s.user_id,s.id into candidate_owner,candidate_session
    from auth.sessions s join auth.users u on u.id=s.user_id
    where s.user_id=any(allowed_owners)
      and coalesce((to_jsonb(u)->>'is_anonymous')::boolean,false)
      and (s.not_after is null or s.not_after>statement_timestamp())
      and not exists(select 1 from public.sadeeman_session_revocations r where r.session_id=s.id)
      and not exists(select 1 from public.sadeeman_conversations c where c.owner_id=s.user_id)
      and not exists(select 1 from public.sadeeman_consents c where c.owner_id=s.user_id)
      and not exists(select 1 from public.sadeeman_memories m where m.owner_id=s.user_id)
    order by s.id limit 1;
    if found then
      select not exists(select 1 from auth.sessions where id=nonce) into nonce_absent;
      valid_claims:=jsonb_build_object('sub',candidate_owner,'session_id',candidate_session,
        'exp',floor(extract(epoch from statement_timestamp()))+300,'role','authenticated','is_anonymous',true);
      perform set_config('request.jwt.claim.sub',candidate_owner::text,true);
      perform set_config('request.jwt.claims',valid_claims::text,true);
      perform set_config('role','authenticated',true);
      select public.sadeeman_session_active() into baseline;
      perform set_config('request.jwt.claims',(valid_claims-'session_id')::text,true);
      select not public.sadeeman_session_active() into missing_rejected;
      perform set_config('request.jwt.claims',jsonb_set(valid_claims,'{exp}','0'::jsonb)::text,true);
      select not public.sadeeman_session_active() into expired_rejected;
      perform set_config('request.jwt.claims',jsonb_set(valid_claims,'{session_id}',to_jsonb(nonce::text))::text,true);
      select not public.sadeeman_session_active() into nonexistent_rejected;
      perform set_config('request.jwt.claims',valid_claims::text,true);
      select public.sadeeman_session_active() into continuity;
      perform set_config('role',original_role,true);
      report:=jsonb_build_object('status',case when baseline and missing_rejected and expired_rejected
          and nonexistent_rejected and nonce_absent and continuity then 'PASS_CONTROLLED_SQL_CLAIMS' else 'FAIL' end,
        'baselineActive',baseline,'missingSessionClaimRejected',missing_rejected,
        'expiredClaimRejected',expired_rejected,'nonexistentSessionRejected',nonexistent_rejected,
        'nonexistentFixtureConfirmed',nonce_absent,'continuityRestored',continuity,
        'notAfterBoundary','NOT_EXERCISED_NO_AUTH_ROW_MUTATION',
        'scope','Existing empty temporary identity only; no signed JWT minted or sent');
    end if;
  else report:=jsonb_build_object('status','BLOCKED_DEPLOYED_DEFINITION_OR_PERMISSION_DRIFT');
  end if;
  perform set_config('role',original_role,true);
  perform set_config('request.jwt.claim.sub',coalesce(original_sub,''),true);
  perform set_config('request.jwt.claims',coalesce(original_claims,''),true);
  perform set_config('sadeeman_verification.probes',report::text,true);
  perform set_config('sadeeman_verification.cleanup',cleanup::text,true);
exception when others then
  perform set_config('role',original_role,true);
  perform set_config('request.jwt.claim.sub',coalesce(original_sub,''),true);
  perform set_config('request.jwt.claims',coalesce(original_claims,''),true);
  perform set_config('sadeeman_verification.probes',jsonb_build_object('status','BLOCKED_SQL_PROBE_ERROR','sqlstate',sqlstate)::text,true);
end
$session_checks$;

select current_setting('sadeeman_verification.metadata')::jsonb || jsonb_build_object(
  'cloud_session_probes',current_setting('sadeeman_verification.probes')::jsonb,
  'test_b_cleanup',nullif(current_setting('sadeeman_verification.cleanup',true),'')::jsonb,
  'current_record_counts',jsonb_build_object(
    'conversations',(select count(*) from public.sadeeman_conversations),
    'consents',(select count(*) from public.sadeeman_consents),
    'memories',(select count(*) from public.sadeeman_memories),
    'company_packages',(select count(*) from public.sadeeman_company_packages)),
  'limits','Counts are a current snapshot, not proof of historical preservation; private API exposure and current official advisors need separate evidence.'
) as session_security_verification;
rollback;
