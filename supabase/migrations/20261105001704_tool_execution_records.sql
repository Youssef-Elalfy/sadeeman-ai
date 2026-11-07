-- Additive M2 observability only. No CRM, messaging, booking or automation tables/actions.
create table public.sadeeman_tool_executions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  tenant_id uuid not null default auth.uid() check(tenant_id=owner_id),
  conversation_id uuid not null,
  run_id uuid not null,
  call_id text not null check(call_id ~ '^[A-Za-z0-9._:-]{1,160}$'),
  tool_name text not null check(tool_name ~ '^[a-z_]{1,80}$'),
  status text not null check(status in ('ok','unavailable','rejected','failed')),
  result_code text check(result_code ~ '^[A-Z_]{1,80}$'),
  duration_ms integer not null check(duration_ms between 0 and 120000),
  occurred_at timestamptz not null,
  foreign key(conversation_id,owner_id) references public.sadeeman_conversations(id,owner_id) on delete cascade,
  unique(owner_id,run_id,call_id)
);
create index on public.sadeeman_tool_executions(owner_id,conversation_id,occurred_at);
alter table public.sadeeman_tool_executions enable row level security;
alter table public.sadeeman_tool_executions force row level security;
create policy own_tool_records on public.sadeeman_tool_executions to authenticated
 using(owner_id=(select auth.uid()) and tenant_id=(select auth.uid()) and (select public.sadeeman_session_active()))
 with check(owner_id=(select auth.uid()) and tenant_id=(select auth.uid()) and (select public.sadeeman_session_active()));
revoke all on public.sadeeman_tool_executions from public,anon,authenticated;
grant select,insert on public.sadeeman_tool_executions to authenticated;

create function public.sadeeman_save_tool_executions(p_payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare uid uuid:=(select auth.uid()); cid uuid:=(p_payload->>'conversationId')::uuid; item jsonb;
begin
  if uid is null or not public.sadeeman_session_active() then raise exception 'UNAUTHORIZED'; end if;
  if not exists(select 1 from public.sadeeman_conversations where id=cid) then raise exception 'NOT_FOUND'; end if;
  if jsonb_typeof(p_payload->'toolExecutions') is distinct from 'array' or jsonb_array_length(p_payload->'toolExecutions')>20 then raise exception 'CAPACITY'; end if;
  for item in select value from jsonb_array_elements(p_payload->'toolExecutions') loop
    insert into public.sadeeman_tool_executions(conversation_id,run_id,call_id,tool_name,status,result_code,duration_ms,occurred_at)
    values(cid,(p_payload->>'runId')::uuid,item->>'callId',item->>'toolName',item->>'status',item->>'resultCode',(item->>'durationMs')::integer,(item->>'occurredAt')::timestamptz)
    on conflict(owner_id,run_id,call_id) do nothing;
  end loop;
  return '{"persisted":true}';
end $$;
revoke all on function public.sadeeman_save_tool_executions(jsonb) from public,anon;
grant execute on function public.sadeeman_save_tool_executions(jsonb) to authenticated;

create function public.sadeeman_commit_turn(p_payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$ begin
  -- One transaction: a failed metadata insert rolls back both messages and the turn.
  perform public.sadeeman_operation('commit_turn',p_payload-'toolExecutions');
  perform public.sadeeman_save_tool_executions(p_payload);
  return '{"persisted":true}';
end $$;
revoke all on function public.sadeeman_commit_turn(jsonb) from public,anon;
grant execute on function public.sadeeman_commit_turn(jsonb) to authenticated;

create function public.sadeeman_list_tool_executions(p_conversation_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb; begin
  if (select auth.uid()) is null or not public.sadeeman_session_active() then raise exception 'UNAUTHORIZED'; end if;
  if not exists(select 1 from public.sadeeman_conversations where id=p_conversation_id) then raise exception 'NOT_FOUND'; end if;
  select coalesce(jsonb_agg(row_to_json(x)),'[]') into result from (
    select run_id as "runId",call_id as "callId",tool_name as "toolName",status,result_code as "resultCode",duration_ms as "durationMs",occurred_at as "occurredAt"
    from public.sadeeman_tool_executions where conversation_id=p_conversation_id order by occurred_at desc limit 200
  )x;
  return result;
end $$;
revoke all on function public.sadeeman_list_tool_executions(uuid) from public,anon;
grant execute on function public.sadeeman_list_tool_executions(uuid) to authenticated;
