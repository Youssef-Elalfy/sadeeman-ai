-- PROPOSAL ONLY: dedicated Sadeeman project ujdzysbowngtkwndgoqf.
-- No data cleanup, Auth changes, table/policy changes or permission grants.
-- Run transactionally only after explicit approval and deployed preflight review.
do $audit_preflight$
declare
  audit_oid oid := to_regprocedure('sadeeman_private.record_audit()');
begin
  if audit_oid is null or not exists (
    select 1 from pg_proc p join pg_roles r on r.oid=p.proowner
    where p.oid=audit_oid and p.prosecdef and p.provolatile='v'
      and p.prorettype='pg_catalog.trigger'::regtype
      and r.rolname='postgres' and (r.rolsuper or r.rolbypassrls)
      and p.proconfig=array['search_path=""']::text[]
      and md5(replace(p.prosrc,E'\r\n',E'\n'))='923b0d8cd84a62c21b488a84a3aa4341'
  ) then raise exception 'AUDIT_DEFINITION_PREREQUISITE'; end if;
  if has_function_privilege('anon',audit_oid,'EXECUTE')
     or has_function_privilege('authenticated',audit_oid,'EXECUTE')
     or exists (select 1 from pg_proc p,
       lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
       where p.oid=audit_oid and a.grantee=0 and a.privilege_type='EXECUTE')
  then raise exception 'AUDIT_PERMISSION_PREREQUISITE'; end if;
  if (select count(*) from pg_trigger where tgfoid=audit_oid and not tgisinternal)<>3
     or (select count(*) from pg_trigger where tgfoid=audit_oid and not tgisinternal
       and tgenabled='O' and tgconstraint=0 and (
         (tgrelid='public.sadeeman_conversations'::regclass and tgname='conversation_audit' and tgtype=13)
         or (tgrelid='public.sadeeman_memories'::regclass and tgname='memory_audit' and tgtype=29)
         or (tgrelid='public.sadeeman_consents'::regclass and tgname='consent_audit' and tgtype=21)
       ))<>3
  then raise exception 'AUDIT_TRIGGER_PREREQUISITE'; end if;
  if not exists (select 1 from pg_constraint c
    where c.conrelid='public.sadeeman_audit_events'::regclass
      and c.confrelid='auth.users'::regclass and c.contype='f'
      and c.confdeltype='c' and c.convalidated and not c.condeferrable
      and c.conkey=array[(select attnum from pg_attribute
        where attrelid='public.sadeeman_audit_events'::regclass and attname='owner_id')]::smallint[]
      and c.confkey=array[(select attnum from pg_attribute
        where attrelid='auth.users'::regclass and attname='id')]::smallint[])
  then raise exception 'AUDIT_OWNER_FK_PREREQUISITE'; end if;
end
$audit_preflight$;

-- CREATE OR REPLACE retains the existing function OID, owner and ACL.
create or replace function sadeeman_private.record_audit() returns trigger
language plpgsql volatile security definer set search_path='' as $$
declare record_owner uuid; record_id uuid;
begin
  if tg_op='DELETE' then record_owner:=old.owner_id; record_id:=old.id; else record_owner:=new.owner_id; record_id:=new.id; end if;
  -- An Auth-owner cascade has already removed its parent row. Its owner-bound
  -- audit rows are themselves ON DELETE CASCADE, and a new row would violate
  -- the audit owner FK. This branch neither authorizes a DELETE nor disables a
  -- trigger: RLS/table privileges and the parent FK remain unchanged.
  if tg_op='DELETE' and not exists(select 1 from auth.users where id=record_owner) then
    return old;
  end if;
  if record_owner is distinct from (select auth.uid()) then raise exception 'UNAUTHORIZED'; end if;
  insert into public.sadeeman_audit_events(owner_id,tenant_id,action,resource_id) values(record_owner,record_owner,tg_table_name||':'||lower(tg_op),record_id);
  if tg_op='DELETE' then return old; else return new; end if;
end $$;
