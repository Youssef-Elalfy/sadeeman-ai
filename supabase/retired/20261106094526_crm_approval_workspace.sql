-- LOCAL IMPLEMENTATION ONLY. Cloud execution requires separate reviewed approval.
create table public.sadeeman_crm_members (
 tenant_id uuid not null references auth.users(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 primary key(tenant_id,user_id)
);
create table public.sadeeman_crm_reviews (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
 request_id uuid not null, snapshot jsonb not null check(octet_length(snapshot::text)<=16000),
 snapshot_hash text not null, expires_at timestamptz not null default now()+interval '10 minutes',
 record_id uuid, unique(owner_id,request_id)
);
create table public.sadeeman_crm_records (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
 tenant_id uuid not null references auth.users(id) on delete cascade,
 kind text not null check(kind in ('customer','lead','inquiry','note','handoff','quote')),
 title text not null check(length(title) between 1 and 160), details jsonb not null check(octet_length(details::text)<=14000),
 conversation_id uuid references public.sadeeman_conversations(id) on delete set null,
 parent_id uuid references public.sadeeman_crm_records(id) on delete cascade,
 status text not null default 'new' check(status in ('new','qualified','in_progress','waiting','closed','cancelled')),
 assigned_to uuid references auth.users(id) on delete set null,
 consent_review_id uuid not null unique references public.sadeeman_crm_reviews(id),
 version integer not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 expires_at timestamptz not null
);
create index on public.sadeeman_crm_records(tenant_id,kind,status,created_at);
create index on public.sadeeman_crm_records(assigned_to);
create index on public.sadeeman_crm_records(parent_id);
create index on public.sadeeman_crm_records(conversation_id);
create unique index sadeeman_crm_customer_email on public.sadeeman_crm_records(owner_id,lower(trim(details->>'email'))) where kind='customer' and nullif(trim(details->>'email'),'') is not null;
create unique index sadeeman_crm_customer_phone on public.sadeeman_crm_records(owner_id,regexp_replace(details->>'phone','[^0-9]','','g')) where kind='customer' and nullif(details->>'phone','') is not null;
create table public.sadeeman_crm_audit (
 id bigint generated always as identity primary key, tenant_id uuid not null references auth.users(id) on delete cascade,
 actor_id uuid not null references auth.users(id) on delete cascade, resource_id uuid, action text not null, occurred_at timestamptz not null default now()
);
create index on public.sadeeman_crm_audit(tenant_id,id);
create function sadeeman_private.crm_member(t uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.sadeeman_session_active() and exists(select 1 from public.sadeeman_crm_members where tenant_id=t and user_id=auth.uid())
$$;
revoke all on function sadeeman_private.crm_member(uuid) from public,anon;
grant execute on function sadeeman_private.crm_member(uuid) to authenticated;
do $$ declare t text; begin
 foreach t in array array['sadeeman_crm_members','sadeeman_crm_reviews','sadeeman_crm_records','sadeeman_crm_audit'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('alter table public.%I force row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 end loop;
end $$;
create policy crm_members_read on public.sadeeman_crm_members to authenticated using(public.sadeeman_session_active() and (tenant_id=auth.uid() or user_id=auth.uid()));
create policy crm_reviews_read on public.sadeeman_crm_reviews to authenticated using(public.sadeeman_session_active() and owner_id=auth.uid() and expires_at>now());
create policy crm_records_read on public.sadeeman_crm_records to authenticated using(public.sadeeman_session_active() and expires_at>now() and (owner_id=auth.uid() or (assigned_to=auth.uid() and sadeeman_private.crm_member(tenant_id))));
create policy crm_audit_read on public.sadeeman_crm_audit to authenticated using(public.sadeeman_session_active() and tenant_id=auth.uid());

create function sadeeman_private.crm_operation(a text,p jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); r public.sadeeman_crm_reviews; x public.sadeeman_crm_records; v jsonb; rid uuid; h text; n integer; off integer;
begin
 if u is null or not public.sadeeman_session_active() then raise exception 'UNAUTHORIZED'; end if;
 if octet_length(p::text)>20000 then raise exception 'CAPACITY'; end if;
 if a='crm_review' then
  if p->'acceptedReviewStorage' is distinct from 'true'::jsonb then raise exception 'CONSENT_REQUIRED'; end if;
  update public.sadeeman_crm_reviews set snapshot='{}',snapshot_hash='expired' where owner_id=u and expires_at<=now() and record_id is null;
  v:=p->'snapshot';
  if v is null or v->>'kind' is null or v->>'title' is null or v->>'retentionDays' is null or jsonb_typeof(v->'details') is distinct from 'object' or v->>'kind' not in ('customer','lead','inquiry','note','handoff','quote') or length(v->>'title') not between 1 and 160 or (v->>'retentionDays')::int not between 1 and 365 then raise exception 'INVALID_REQUEST'; end if;
  if v->>'conversationId' is not null and not exists(select 1 from public.sadeeman_conversations where id=(v->>'conversationId')::uuid and owner_id=u) then raise exception 'NOT_FOUND'; end if;
  if v->>'parentId' is not null and not exists(select 1 from public.sadeeman_crm_records where id=(v->>'parentId')::uuid and owner_id=u and expires_at>now()) then raise exception 'NOT_FOUND'; end if;
  if v->>'recordId' is not null then
   if v->>'expectedVersion' is null then raise exception 'INVALID_REQUEST'; end if;
   if v->>'parentId'=v->>'recordId' then raise exception 'INVALID_REQUEST'; end if;
   if not exists(select 1 from public.sadeeman_crm_records where id=(v->>'recordId')::uuid and owner_id=u and expires_at>now()) then raise exception 'NOT_FOUND'; end if;
  end if;
  h:=encode(sha256(convert_to(v::text,'UTF8')),'hex');
  select * into r from public.sadeeman_crm_reviews where owner_id=u and request_id=(p->>'requestId')::uuid;
  if found then if r.expires_at<=now() then raise exception 'CONSENT_REQUIRED'; end if; if r.snapshot_hash<>h then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
  else insert into public.sadeeman_crm_reviews(owner_id,request_id,snapshot,snapshot_hash) values(u,(p->>'requestId')::uuid,v,h) returning * into r; end if;
  return jsonb_build_object('id',r.id,'snapshot',r.snapshot,'hash',r.snapshot_hash,'expiresAt',r.expires_at);
 elsif a='crm_cancel_review' then
  update public.sadeeman_crm_reviews set snapshot='{}',snapshot_hash='cancelled',expires_at=now() where id=(p->>'id')::uuid and owner_id=u and record_id is null;
  return '{"updated":true}';
 elsif a='crm_approve' then
  select * into r from public.sadeeman_crm_reviews where id=(p->>'id')::uuid and owner_id=u for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p->'approved' is distinct from 'true'::jsonb or p->>'hash' is distinct from r.snapshot_hash then raise exception 'CONSENT_REQUIRED'; end if;
  if r.record_id is not null then return jsonb_build_object('id',r.record_id,'replayed',true); end if;
  if r.expires_at<=now() then raise exception 'CONSENT_REQUIRED'; end if;
  v:=r.snapshot;
  if v->>'recordId' is not null then
   select * into x from public.sadeeman_crm_records where id=(v->>'recordId')::uuid and owner_id=u and expires_at>now() for update;
   if not found then raise exception 'NOT_FOUND'; end if;
   if x.version is distinct from (v->>'expectedVersion')::int then raise exception 'VERSION_CONFLICT'; end if;
   -- Parent linkage is immutable on updates; avoids cycles and cross-owner cascades.
   update public.sadeeman_crm_records set title=v->>'title',details=(v->'details') || jsonb_build_object('notes',coalesce(x.details->'notes','[]')),kind=v->>'kind',version=version+1,updated_at=now(),expires_at=now()+((v->>'retentionDays')::int*interval '1 day'),consent_review_id=r.id where id=x.id;
   update public.sadeeman_crm_reviews set snapshot='{}',snapshot_hash='superseded' where id=x.consent_review_id;
   rid:=x.id;
  else
  insert into public.sadeeman_crm_records(owner_id,tenant_id,kind,title,details,conversation_id,parent_id,consent_review_id,expires_at)
   values(u,u,v->>'kind',v->>'title',v->'details',(v->>'conversationId')::uuid,(v->>'parentId')::uuid,r.id,now()+((v->>'retentionDays')::int*interval '1 day')) returning id into rid;
  end if;
  update public.sadeeman_crm_reviews set record_id=rid where id=r.id;
  insert into public.sadeeman_crm_audit(tenant_id,actor_id,resource_id,action) values(u,u,rid,'approved_create');
  return jsonb_build_object('id',rid,'replayed',false);
 elsif a='crm_list' then
  n:=least(greatest(coalesce((p->>'limit')::int,20),1),100); off:=greatest(coalesce((p->>'offset')::int,0),0);
  select coalesce(jsonb_agg(to_jsonb(t)),'[]') into v from (
   select * from public.sadeeman_crm_records where expires_at>now() and (owner_id=u or (assigned_to=u and sadeeman_private.crm_member(tenant_id)))
   and (p->>'kind' is null or kind=p->>'kind') and (p->>'status' is null or status=p->>'status')
   and (coalesce(p->>'search','')='' or title ilike '%' || replace(replace(p->>'search','%','\%'),'_','\_') || '%')
   order by case when p->>'sort'='title' then title end asc, created_at desc,id limit n offset off
  )t; return v;
 elsif a='crm_get' or a='crm_update' or a='crm_delete' or a='crm_note' then
  select * into x from public.sadeeman_crm_records where id=(p->>'id')::uuid and (owner_id=u or (assigned_to=u and sadeeman_private.crm_member(tenant_id))) for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if a<>'crm_delete' and x.expires_at<=now() then raise exception 'NOT_FOUND'; end if;
  if a='crm_get' then return to_jsonb(x); end if;
  if a='crm_delete' then
   if x.owner_id<>u then raise exception 'UNAUTHORIZED'; end if;
   -- Retention consent revocation erases contact/snapshot data, including child records.
   with recursive tree as(select id from public.sadeeman_crm_records where id=x.id union all select c.id from public.sadeeman_crm_records c join tree t on c.parent_id=t.id)
   update public.sadeeman_crm_reviews set snapshot='{}',snapshot_hash='revoked' where owner_id=u and record_id in (select id from tree);
   delete from public.sadeeman_crm_records where id=x.id;
  elsif a='crm_update' then
   if x.version<>(p->>'expectedVersion')::int then raise exception 'VERSION_CONFLICT'; end if;
   if p->>'assignedTo' is not null and (x.owner_id<>u or not exists(select 1 from public.sadeeman_crm_members where tenant_id=x.tenant_id and user_id=(p->>'assignedTo')::uuid)) then raise exception 'UNAUTHORIZED'; end if;
   update public.sadeeman_crm_records set status=coalesce(p->>'status',status), assigned_to=case when p ? 'assignedTo' then (p->>'assignedTo')::uuid else assigned_to end,version=version+1,updated_at=now() where id=x.id;
  else
   if length(p->>'note') not between 1 and 1000 or jsonb_array_length(coalesce(x.details->'notes','[]'))>=30 then raise exception 'CAPACITY'; end if;
   update public.sadeeman_crm_records set details=jsonb_set(details,'{notes}',coalesce(details->'notes','[]') || jsonb_build_array(jsonb_build_object('text',p->>'note','actorId',u,'at',now()))),version=version+1,updated_at=now() where id=x.id;
  end if;
  insert into public.sadeeman_crm_audit(tenant_id,actor_id,resource_id,action) values(x.tenant_id,u,x.id,a);
  return jsonb_build_object('updated',true);
 elsif a='crm_members' then
  if p ? 'userId' then
   if p->'remove'='true'::jsonb then delete from public.sadeeman_crm_members where tenant_id=u and user_id=(p->>'userId')::uuid;
   else insert into public.sadeeman_crm_members values(u,(p->>'userId')::uuid) on conflict do nothing; end if;
   insert into public.sadeeman_crm_audit(tenant_id,actor_id,resource_id,action) values(u,u,(p->>'userId')::uuid,'staff_authorized');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('userId',user_id)),'[]') into v from public.sadeeman_crm_members where tenant_id=u; return v;
 elsif a='crm_audit' then
  select coalesce(jsonb_agg(to_jsonb(t)),'[]') into v from (select action,resource_id,occurred_at from public.sadeeman_crm_audit where tenant_id=u order by id desc limit 100)t; return v;
 end if;
 raise exception 'INVALID_REQUEST';
end $$;
revoke all on function sadeeman_private.crm_operation(text,jsonb) from public,anon;
grant execute on function sadeeman_private.crm_operation(text,jsonb) to authenticated;
create function public.sadeeman_crm_operation(p_action text,p_payload jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$ select sadeeman_private.crm_operation(p_action,p_payload) $$;
revoke all on function public.sadeeman_crm_operation(text,jsonb) from public,anon;
grant execute on function public.sadeeman_crm_operation(text,jsonb) to authenticated;
