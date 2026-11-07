-- READ ONLY. Run ONLY in Sadeeman ujdzysbowngtkwndgoqf.
-- Verify the dashboard/connector target independently; a SQL literal is not
-- proof of project identity. No DELETE, simulated claims or test user creation.
begin read only;

select p.oid::regprocedure::text as function_name,r.rolname as owner,
  p.prosecdef as security_definer,p.provolatile,p.proconfig,p.proacl::text,
  md5(replace(p.prosrc,E'\r\n',E'\n')) as normalized_body_md5,
  md5(replace(p.prosrc,E'\r\n',E'\n'))='923b0d8cd84a62c21b488a84a3aa4341' as matches_original_body,
  md5(replace(p.prosrc,E'\r\n',E'\n'))='6877280a66f8e6e4a2b8ada7dbfb61f9' as matches_proposed_body,
  pg_get_functiondef(p.oid) as definition,
  has_function_privilege('anon',p.oid,'EXECUTE') as anon_can_execute,
  has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_can_execute,
  exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    where a.grantee=0 and a.privilege_type='EXECUTE') as public_can_execute
from pg_proc p join pg_roles r on r.oid=p.proowner
where p.oid=to_regprocedure('sadeeman_private.record_audit()');

select t.tgname,t.tgrelid::regclass::text as table_name,t.tgenabled,t.tgtype,
  pg_get_triggerdef(t.oid,true) as definition
from pg_trigger t where t.tgfoid=to_regprocedure('sadeeman_private.record_audit()')
  and not t.tgisinternal order by t.tgname;

select conname,conrelid::regclass::text as table_name,
  pg_get_constraintdef(oid,true) as definition,convalidated,condeferrable
from pg_constraint where contype='f' and conrelid='public.sadeeman_audit_events'::regclass;

select c.relname,c.relrowsecurity,c.relforcerowsecurity,c.relacl::text
from pg_class c where c.relnamespace='public'::regnamespace
  and c.relname in ('sadeeman_conversations','sadeeman_memories','sadeeman_consents','sadeeman_audit_events');
select schemaname,tablename,policyname,roles,cmd,qual,with_check
from pg_policies where schemaname='public'
  and tablename in ('sadeeman_conversations','sadeeman_memories','sadeeman_consents','sadeeman_audit_events')
order by tablename,policyname;

-- Exact interrupted fixture only; never output emails, phone values or tokens.
select u.id,u.created_at,u.is_anonymous,
  nullif(u.email,'') is null as no_email,nullif(u.phone,'') is null as no_phone,
  u.created_at between '2026-11-07T02:45:06Z'::timestamptz and '2026-11-07T02:45:23Z'::timestamptz as creation_matches_test_window,
  (select count(*) from auth.identities i where i.user_id=u.id and i.provider<>'anonymous') as nonanonymous_identities,
  (select count(*) from auth.sessions s where s.user_id=u.id) as auth_sessions,
  exists(select 1 from auth.sessions s where s.user_id=u.id and s.id='0d6cc702-7bae-4fd9-a635-18abd6260cef') as known_session_belongs_to_user,
  (select count(*) from public.sadeeman_conversations c where c.owner_id=u.id) as conversations,
  exists(select 1 from public.sadeeman_conversations c where c.owner_id=u.id and c.id='dcbf9b61-aeef-476a-a3bc-568fa744673b') as known_conversation_belongs_to_user,
  (select count(*) from public.sadeeman_messages m where m.owner_id=u.id) as messages,
  (select count(*) from storage.objects o where to_jsonb(o)->>'owner_id'=u.id::text or to_jsonb(o)->>'owner'=u.id::text) as storage_objects
from auth.users u where u.id='6ee07be3-69b5-41cd-b388-d8a382be0d50';

-- May be reused AFTER supported Auth deletion; all should then be zero.
select
  (select count(*) from auth.users where id='6ee07be3-69b5-41cd-b388-d8a382be0d50') as users,
  (select count(*) from auth.sessions where user_id='6ee07be3-69b5-41cd-b388-d8a382be0d50') as sessions,
  (select count(*) from auth.refresh_tokens where user_id::text='6ee07be3-69b5-41cd-b388-d8a382be0d50') as refresh_tokens,
  (select count(*) from public.sadeeman_conversations where owner_id='6ee07be3-69b5-41cd-b388-d8a382be0d50') as conversations,
  (select count(*) from public.sadeeman_messages where owner_id='6ee07be3-69b5-41cd-b388-d8a382be0d50') as messages,
  (select count(*) from public.sadeeman_audit_events where owner_id='6ee07be3-69b5-41cd-b388-d8a382be0d50') as audit_events;
rollback;
