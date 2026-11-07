-- Shared PostgreSQL schema. Supabase supplies auth.users/auth.uid and roles.
-- Local-only auth bootstrap lives in apps/api/src/persistence/local.ts, never here.
create schema if not exists sadeeman_private;
revoke all on schema sadeeman_private from public, anon, authenticated;

create table public.sadeeman_conversations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  tenant_id uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  summary text not null default '' check(length(summary)<=4000),
  constraint personal_tenant check(tenant_id=owner_id),
  unique(id,owner_id)
);
create index on public.sadeeman_conversations(owner_id,created_at);
create table public.sadeeman_turns (
  id uuid primary key,
  conversation_id uuid not null,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  tenant_id uuid not null default auth.uid() check(tenant_id=owner_id),
  request_id uuid not null,
  input_hash text not null,
  answer text not null check(length(answer) between 1 and 24000),
  usage jsonb not null,
  created_at timestamptz not null default now(),
  unique(id,owner_id,conversation_id),
  foreign key(conversation_id,owner_id) references public.sadeeman_conversations(id,owner_id) on delete cascade,
  unique(conversation_id,request_id)
);
create index on public.sadeeman_turns(owner_id,conversation_id);
create table public.sadeeman_messages (
  id bigint generated always as identity primary key,
  conversation_id uuid not null,
  turn_id uuid not null,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  tenant_id uuid not null default auth.uid() check(tenant_id=owner_id),
  role text not null check(role in ('user','assistant')),
  content text not null check(length(content) between 1 and 24000),
  foreign key(conversation_id,owner_id) references public.sadeeman_conversations(id,owner_id) on delete cascade,
  foreign key(turn_id,owner_id,conversation_id) references public.sadeeman_turns(id,owner_id,conversation_id) on delete cascade
);
create index on public.sadeeman_messages(owner_id,conversation_id,id);
create table public.sadeeman_consents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  tenant_id uuid not null default auth.uid() check(tenant_id=owner_id),
  purpose text not null check(purpose='travel_preferences'),
  accepted boolean not null,
  version text not null check(version='memory-v1'),
  recorded_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique(id,owner_id)
);
create index on public.sadeeman_consents(owner_id,purpose);
create table public.sadeeman_memories (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  tenant_id uuid not null default auth.uid() check(tenant_id=owner_id),
  consent_id uuid not null,
  category text not null check(category in ('travel_style','destination','accessibility','budget','language')),
  content text not null check(length(btrim(content)) between 1 and 500),
  source_conversation_id uuid not null,
  expires_at timestamptz not null,
  version integer not null default 1 check(version>0),
  foreign key(consent_id,owner_id) references public.sadeeman_consents(id,owner_id),
  foreign key(source_conversation_id,owner_id) references public.sadeeman_conversations(id,owner_id) on delete cascade
);
create index on public.sadeeman_memories(owner_id,consent_id,expires_at);
create table public.sadeeman_requests (
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  tenant_id uuid not null default auth.uid() check(tenant_id=owner_id),
  request_id uuid not null, action text not null, fingerprint text not null, resource_id uuid not null,
  primary key(owner_id,request_id,action)
);
create table public.sadeeman_audit_events (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  tenant_id uuid not null check(tenant_id=owner_id),
  action text not null, resource_id uuid, occurred_at timestamptz not null default now()
);
create index on public.sadeeman_audit_events(owner_id,id);
create table public.sadeeman_session_revocations (
  session_id uuid primary key,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  tenant_id uuid not null default auth.uid() check(tenant_id=owner_id),
  revoked_at timestamptz not null default now()
);
create index on public.sadeeman_session_revocations(owner_id);
alter table public.sadeeman_session_revocations enable row level security;
alter table public.sadeeman_session_revocations force row level security;
create policy own_sessions on public.sadeeman_session_revocations to authenticated
 using(owner_id=(select auth.uid()) and tenant_id=(select auth.uid()))
 with check(owner_id=(select auth.uid()) and tenant_id=(select auth.uid()));

create function public.sadeeman_session_active() returns boolean language sql stable security invoker set search_path='' as $$
  select (select auth.uid()) is not null and not exists(
    select 1 from public.sadeeman_session_revocations where session_id=(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'session_id')::uuid
  )
$$;
revoke all on function public.sadeeman_session_active() from public,anon;
grant execute on function public.sadeeman_session_active() to authenticated;

do $$ declare tab text; begin
  foreach tab in array array['sadeeman_conversations','sadeeman_turns','sadeeman_messages','sadeeman_consents','sadeeman_requests','sadeeman_audit_events'] loop
    execute format('alter table public.%I enable row level security',tab);
    execute format('alter table public.%I force row level security',tab);
    execute format('create policy own_rows on public.%I to authenticated using(owner_id=(select auth.uid()) and tenant_id=(select auth.uid()) and (select public.sadeeman_session_active())) with check(owner_id=(select auth.uid()) and tenant_id=(select auth.uid()) and (select public.sadeeman_session_active()))',tab);
  end loop;
end $$;
alter table public.sadeeman_memories enable row level security;
alter table public.sadeeman_memories force row level security;
create policy own_memories on public.sadeeman_memories to authenticated
 using(owner_id=(select auth.uid()) and tenant_id=(select auth.uid()) and (select public.sadeeman_session_active()) and expires_at>now() and exists(select 1 from public.sadeeman_consents c where c.id=consent_id and c.owner_id=(select auth.uid()) and c.accepted and c.revoked_at is null))
 with check(owner_id=(select auth.uid()) and tenant_id=(select auth.uid()) and (select public.sadeeman_session_active()) and expires_at>now() and exists(select 1 from public.sadeeman_consents c where c.id=consent_id and c.owner_id=(select auth.uid()) and c.accepted and c.revoked_at is null));

create function sadeeman_private.guard_consent() returns trigger language plpgsql security invoker set search_path='' as $$ begin
  if new.owner_id<>old.owner_id or new.tenant_id<>old.tenant_id or new.accepted<>old.accepted or new.purpose<>old.purpose or new.version<>old.version or new.recorded_at<>old.recorded_at or (old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at) then raise exception 'CONSENT_REQUIRED'; end if;
  return new;
end $$;
create trigger immutable_consent before update on public.sadeeman_consents for each row execute function sadeeman_private.guard_consent();
create function sadeeman_private.guard_memory() returns trigger language plpgsql security invoker set search_path='' as $$ begin
  if new.expires_at>now()+interval '365 days' then raise exception 'CONSENT_REQUIRED'; end if;
  if not exists(select 1 from public.sadeeman_consents where id=new.consent_id and owner_id=new.owner_id and accepted and revoked_at is null and purpose='travel_preferences' and version='memory-v1') then raise exception 'CONSENT_REQUIRED'; end if;
  return new;
end $$;
create trigger valid_memory before insert or update on public.sadeeman_memories for each row execute function sadeeman_private.guard_memory();

-- The audit SECURITY DEFINER is a private metadata-only trigger. It checks auth.uid,
-- has an empty search_path, accepts no caller input, and is not directly executable.
create function sadeeman_private.record_audit() returns trigger language plpgsql security definer set search_path='' as $$
declare record_owner uuid; record_id uuid;
begin
  if tg_op='DELETE' then record_owner:=old.owner_id; record_id:=old.id; else record_owner:=new.owner_id; record_id:=new.id; end if;
  if record_owner is distinct from (select auth.uid()) then raise exception 'UNAUTHORIZED'; end if;
  insert into public.sadeeman_audit_events(owner_id,tenant_id,action,resource_id) values(record_owner,record_owner,tg_table_name||':'||lower(tg_op),record_id);
  if tg_op='DELETE' then return old; else return new; end if;
end $$;
revoke all on function sadeeman_private.record_audit() from public,anon,authenticated;
create trigger conversation_audit after insert or delete on public.sadeeman_conversations for each row execute function sadeeman_private.record_audit();
create trigger memory_audit after insert or update or delete on public.sadeeman_memories for each row execute function sadeeman_private.record_audit();
create trigger consent_audit after insert or update on public.sadeeman_consents for each row execute function sadeeman_private.record_audit();

-- Privacy deletion must also remove expired/revoked rows hidden by SELECT RLS.
-- This narrowly scoped private helper can only erase the authenticated owner's memory.
create function sadeeman_private.forget_memory(p_memory uuid,p_consent uuid,p_all boolean default false) returns void language plpgsql security definer set search_path='' as $$
declare uid uuid:=(select auth.uid()); begin
  if uid is null or not public.sadeeman_session_active() then raise exception 'UNAUTHORIZED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(uid::text,0));
  delete from public.sadeeman_memories where owner_id=uid and tenant_id=uid and (p_all or id=p_memory or consent_id=p_consent);
end $$;
revoke all on function sadeeman_private.forget_memory(uuid,uuid,boolean) from public,anon;
grant usage on schema sadeeman_private to authenticated;
grant execute on function sadeeman_private.forget_memory(uuid,uuid,boolean) to authenticated;

revoke all on public.sadeeman_conversations,public.sadeeman_turns,public.sadeeman_messages,public.sadeeman_consents,public.sadeeman_memories,public.sadeeman_requests,public.sadeeman_audit_events,public.sadeeman_session_revocations from public,anon,authenticated;
grant select,insert,update,delete on public.sadeeman_conversations,public.sadeeman_turns,public.sadeeman_messages,public.sadeeman_consents,public.sadeeman_memories,public.sadeeman_requests to authenticated;
grant select on public.sadeeman_audit_events to authenticated;
grant select,insert on public.sadeeman_session_revocations to authenticated;
grant usage on sequence public.sadeeman_messages_id_seq to authenticated;

create function public.sadeeman_memory_json(m public.sadeeman_memories) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',m.id,'consentId',m.consent_id,'category',m.category,'content',m.content,'sourceConversationId',m.source_conversation_id,'expiresAt',m.expires_at,'version',m.version)
$$;
revoke all on function public.sadeeman_memory_json(public.sadeeman_memories) from public,anon;
grant execute on function public.sadeeman_memory_json(public.sadeeman_memories) to authenticated;

create function public.sadeeman_operation(p_action text,p_payload jsonb default '{}') returns jsonb language plpgsql security invoker set search_path='' as $$
declare uid uuid:=(select auth.uid()); cid uuid; rid uuid; sid uuid; v jsonb; request_row public.sadeeman_requests; memory_row public.sadeeman_memories; consent_row public.sadeeman_consents; turn_row public.sadeeman_turns; fingerprint text;
begin
  if uid is null then raise exception 'UNAUTHORIZED'; end if;
  sid:=(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'session_id')::uuid;
  if sid is null or not public.sadeeman_session_active() then raise exception 'UNAUTHORIZED'; end if;
  if p_action='identity' then return jsonb_build_object('ownerId',uid); end if;
  if p_action='revoke_session' then insert into public.sadeeman_session_revocations(session_id) values(sid) on conflict do nothing; return '{"revoked":true}'; end if;
  if p_action='create_conversation' then
    if (select count(*) from public.sadeeman_conversations)>=100 then raise exception 'CAPACITY'; end if;
    insert into public.sadeeman_conversations default values returning id into cid; return jsonb_build_object('id',cid);
  elsif p_action='list_conversations' then
    select coalesce(jsonb_agg(row_to_json(x)),'[]') into v from (select c.id,c.created_at as "createdAt",(select count(*) from public.sadeeman_messages m where m.conversation_id=c.id) as "messageCount" from public.sadeeman_conversations c order by c.created_at desc limit 100)x; return v;
  elsif p_action in ('get_conversation','delete_conversation') then
    cid:=(p_payload->>'id')::uuid;
    if not exists(select 1 from public.sadeeman_conversations where id=cid) then raise exception 'NOT_FOUND'; end if;
    if p_action='delete_conversation' then delete from public.sadeeman_conversations where id=cid; return '{"deleted":true}'; end if;
    select jsonb_build_object('id',id,'createdAt',created_at,'summary',summary,'summaryKind','extractive','messages',(select coalesce(jsonb_agg(jsonb_build_object('role',x.role,'content',x.content) order by x.id),'[]') from (select m.id,m.role,m.content from public.sadeeman_messages m where m.conversation_id=cid order by m.id desc limit 40)x)) into v from public.sadeeman_conversations where id=cid; return v;
  elsif p_action in ('commit_turn','get_turn') then
    cid:=(p_payload->>'conversationId')::uuid;
    perform 1 from public.sadeeman_conversations where id=cid for update;
    if not found then raise exception 'NOT_FOUND'; end if;
    select * into turn_row from public.sadeeman_turns where conversation_id=cid and request_id=(p_payload->>'requestId')::uuid;
    if p_action='get_turn' then if not found then return null; end if; return jsonb_build_object('runId',turn_row.id,'answer',turn_row.answer,'inputHash',turn_row.input_hash); end if;
    if found then if turn_row.input_hash<>p_payload->>'inputHash' or turn_row.answer<>p_payload->>'answer' then raise exception 'IDEMPOTENCY_CONFLICT'; end if; return '{"persisted":true}'; end if;
    if (select count(*) from public.sadeeman_turns where conversation_id=cid)>=500 then raise exception 'CAPACITY'; end if;
    insert into public.sadeeman_turns(id,conversation_id,request_id,input_hash,answer,usage) values((p_payload->>'runId')::uuid,cid,(p_payload->>'requestId')::uuid,p_payload->>'inputHash',p_payload->>'answer',p_payload->'usage');
    insert into public.sadeeman_messages(conversation_id,turn_id,role,content) values(cid,(p_payload->>'runId')::uuid,'user',p_payload->>'input'),(cid,(p_payload->>'runId')::uuid,'assistant',p_payload->>'answer');
    update public.sadeeman_conversations set summary=coalesce((select left(string_agg(x.role||': '||left(x.content,160),E'\n' order by x.id),4000) from (select id,role,content from public.sadeeman_messages where conversation_id=cid order by id desc offset 40 limit 20)x),'') where id=cid;
    return '{"persisted":true}';
  elsif p_action in ('record_consent','save_memory','update_memory') then
    fingerprint:=encode(sha256(convert_to(p_payload::text,'UTF8')),'hex');
    -- Lock the user's auth row would require elevated privileges; serialize by transaction advisory lock instead.
    perform pg_advisory_xact_lock(hashtextextended(uid::text,0));
    select * into request_row from public.sadeeman_requests where owner_id=uid and request_id=(p_payload->>'requestId')::uuid and action=p_action;
    if found then
      if request_row.fingerprint<>fingerprint then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
      if p_action='record_consent' then select * into consent_row from public.sadeeman_consents where id=request_row.resource_id; return jsonb_build_object('id',consent_row.id,'accepted',consent_row.accepted,'active',consent_row.accepted and consent_row.revoked_at is null,'version',consent_row.version); end if;
      select * into memory_row from public.sadeeman_memories where id=request_row.resource_id;
      if not found then raise exception 'NOT_FOUND'; end if;
      return public.sadeeman_memory_json(memory_row);
    end if;
    if p_action='record_consent' then
      if not (p_payload->>'accepted')::boolean then
        perform sadeeman_private.forget_memory(null,null,true);
        update public.sadeeman_consents set revoked_at=now() where revoked_at is null;
      end if;
      insert into public.sadeeman_consents(purpose,accepted,version) values(p_payload->>'purpose',(p_payload->>'accepted')::boolean,p_payload->>'version') returning * into consent_row;
      rid:=consent_row.id; v:=jsonb_build_object('id',rid,'accepted',consent_row.accepted,'active',consent_row.accepted and consent_row.revoked_at is null,'version',consent_row.version);
    else
      select * into consent_row from public.sadeeman_consents where id=(p_payload->>'consentId')::uuid and accepted and revoked_at is null and purpose='travel_preferences' and version='memory-v1' for update;
      if not found then raise exception 'CONSENT_REQUIRED'; end if;
      if (p_payload->>'expiresInDays')::int not between 1 and 365 then raise exception 'CONSENT_REQUIRED'; end if;
      if p_action='save_memory' then
        if (select count(*) from public.sadeeman_memories)>=100 then raise exception 'CAPACITY'; end if;
        insert into public.sadeeman_memories(consent_id,category,content,source_conversation_id,expires_at) values(consent_row.id,p_payload->>'category',p_payload->>'content',(p_payload->>'sourceConversationId')::uuid,now()+make_interval(days=>(p_payload->>'expiresInDays')::int)) returning * into memory_row;
      else
        update public.sadeeman_memories set consent_id=consent_row.id,category=p_payload->>'category',content=p_payload->>'content',expires_at=now()+make_interval(days=>(p_payload->>'expiresInDays')::int),version=version+1 where id=(p_payload->>'id')::uuid and version=(p_payload->>'expectedVersion')::int returning * into memory_row;
        if not found then raise exception 'VERSION_CONFLICT'; end if;
      end if;
      rid:=memory_row.id; v:=public.sadeeman_memory_json(memory_row);
    end if;
    insert into public.sadeeman_requests(request_id,action,fingerprint,resource_id) values((p_payload->>'requestId')::uuid,p_action,fingerprint,rid); return v;
  elsif p_action='revoke_consent' then
    perform pg_advisory_xact_lock(hashtextextended(uid::text,0));
    rid:=(p_payload->>'id')::uuid;
    if not exists(select 1 from public.sadeeman_consents where id=rid) then raise exception 'NOT_FOUND'; end if;
    perform sadeeman_private.forget_memory(null,rid,false);
    update public.sadeeman_consents set revoked_at=now() where id=rid and revoked_at is null; return '{"revoked":true}';
  elsif p_action='list_memories' then select coalesce(jsonb_agg(public.sadeeman_memory_json(m)),'[]') into v from (select * from public.sadeeman_memories order by id limit 100)m; return v;
  elsif p_action='delete_memory' then perform sadeeman_private.forget_memory((p_payload->>'id')::uuid,null,false); return '{"deleted":true}';
  elsif p_action='audit' then select coalesce(jsonb_agg(row_to_json(x)),'[]') into v from (select action,resource_id as "resourceId",occurred_at as "occurredAt" from public.sadeeman_audit_events order by id desc limit 100)x; return v;
  end if;
  raise exception 'NOT_FOUND';
end $$;
revoke all on function public.sadeeman_operation(text,jsonb) from public,anon;
grant execute on function public.sadeeman_operation(text,jsonb) to authenticated;
