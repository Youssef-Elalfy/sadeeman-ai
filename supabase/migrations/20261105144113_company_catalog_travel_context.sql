-- PROPOSED M3 migration. Not approved/applied to Cloud. No seed data or row-destructive operation.
create table public.sadeeman_company_packages (
 id uuid primary key default gen_random_uuid(), document jsonb not null,
 code text generated always as (document->>'code') stored not null unique,
 title text generated always as (document->>'title') stored not null,
 destination text generated always as (document->>'destination') stored not null,
 days integer generated always as ((document->>'days')::integer) stored not null,
 is_demo boolean generated always as ((document->>'isDemo')::boolean) stored not null,
 published boolean generated always as ((document->>'status')='published') stored not null,
 updated_at timestamptz not null default now(),
 check(jsonb_typeof(document)='object' and document ?& array['id','price','approval','description','nights','departures','inclusions','exclusions','activities'] and document->>'id'=id::text and octet_length(document::text)<=32000),
 check(length(code) between 1 and 200 and length(title) between 1 and 200 and length(destination) between 1 and 200),
 check(days between 1 and 90), check(jsonb_typeof(document->'isDemo')='boolean'),
 check(document->>'status' in ('draft','published','archived')),
 check(jsonb_typeof(document->'price')='object' and jsonb_typeof(document->'approval')='object'),
 check(not published or is_demo or (nullif(document#>>'{approval,sourceRef}','') is not null and nullif(document#>>'{approval,verifiedAt}','') is not null))
);
create index on public.sadeeman_company_packages(published,is_demo,days);
alter table public.sadeeman_company_packages enable row level security;
alter table public.sadeeman_company_packages force row level security;
create policy readable_company_catalog on public.sadeeman_company_packages for select to authenticated
 using ((select auth.uid()) is not null and (select public.sadeeman_session_active()) and published and
 (not is_demo or coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb#>>'{app_metadata,catalog_demo}','false')='true'));
revoke all on public.sadeeman_company_packages from public,anon,authenticated;
grant select on public.sadeeman_company_packages to authenticated;

create function public.sadeeman_catalog(p_action text,p_payload jsonb default '{}') returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb; begin
 if (select auth.uid()) is null or not public.sadeeman_session_active() then raise exception 'UNAUTHORIZED'; end if;
 if p_action='get' then select document into result from public.sadeeman_company_packages where id=(p_payload->>'id')::uuid; return result; end if;
 if p_action<>'search' then raise exception 'NOT_FOUND'; end if;
 select coalesce(jsonb_agg(x.document order by x.price asc nulls last,x.code),'[]') into result from (
 select p.document,p.code,(p.document#>>'{price,amountMinor}')::bigint as price from public.sadeeman_company_packages p
 where (p_payload->>'destination' is null or exists(select 1 from jsonb_array_elements_text(coalesce(p_payload->'destinationVariants',jsonb_build_array(p_payload->>'destination'))) q where strpos(lower(p.destination),lower(q))>0 or strpos(lower(p.title),lower(q))>0 or exists(select 1 from jsonb_array_elements_text(coalesce(p.document->'aliases','[]')) a where strpos(lower(a),lower(q))>0)))
 and (p_payload->>'days' is null or p.days=(p_payload->>'days')::integer)
 and (p_payload->>'currency' is null or p.document#>>'{price,currency}'=p_payload->>'currency')
 and (p_payload->>'maxPriceMinor' is null or (p.document#>>'{price,amountMinor}')::bigint<=(p_payload->>'maxPriceMinor')::bigint)
 order by price asc nulls last,p.code limit 20
 )x;
 return result;
end $$;
revoke all on function public.sadeeman_catalog(text,jsonb) from public,anon;
grant execute on function public.sadeeman_catalog(text,jsonb) to authenticated;

create table public.sadeeman_travel_profiles (
 conversation_id uuid primary key, owner_id uuid not null default auth.uid(),tenant_id uuid not null default auth.uid() check(tenant_id=owner_id),
 version integer not null check(version>0),state jsonb not null check(jsonb_typeof(state)='object' and state ?& array['version','constraints','options'] and (state->>'version')::integer=version and octet_length(state::text)<=16000),
 updated_at timestamptz not null default now(),
 foreign key(conversation_id,owner_id) references public.sadeeman_conversations(id,owner_id) on delete cascade
);
create index on public.sadeeman_travel_profiles(owner_id,conversation_id);
alter table public.sadeeman_travel_profiles enable row level security;
alter table public.sadeeman_travel_profiles force row level security;
create policy own_travel_profile on public.sadeeman_travel_profiles to authenticated
 using(owner_id=(select auth.uid()) and tenant_id=(select auth.uid()) and (select public.sadeeman_session_active()))
 with check(owner_id=(select auth.uid()) and tenant_id=(select auth.uid()) and (select public.sadeeman_session_active()));
revoke all on public.sadeeman_travel_profiles from public,anon,authenticated;
grant select,insert,update on public.sadeeman_travel_profiles to authenticated;
create function public.sadeeman_travel_profile(p_action text,p_payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare cid uuid:=(p_payload->>'conversationId')::uuid; old_state jsonb; expected integer:=(p_payload->>'expectedVersion')::integer; candidate jsonb:=p_payload->'state'; begin
 if (select auth.uid()) is null or not public.sadeeman_session_active() then raise exception 'UNAUTHORIZED'; end if;
 perform 1 from public.sadeeman_conversations where id=cid for update;
 if not found then raise exception 'NOT_FOUND'; end if;
 select state into old_state from public.sadeeman_travel_profiles where conversation_id=cid;
 if p_action='get' then return old_state; end if;
 if p_action<>'save' then raise exception 'NOT_FOUND'; end if;
 if old_state=candidate then return '{"persisted":true}'; end if;
 if expected is null or coalesce((old_state->>'version')::integer,0)<>expected or candidate->>'version' is null or (candidate->>'version')::integer<>expected+1 then raise exception 'VERSION_CONFLICT'; end if;
 insert into public.sadeeman_travel_profiles(conversation_id,version,state) values(cid,expected+1,candidate)
 on conflict(conversation_id) do update set version=excluded.version,state=excluded.state,updated_at=now()
 where public.sadeeman_travel_profiles.owner_id=(select auth.uid());
 return '{"persisted":true}';
end $$;
revoke all on function public.sadeeman_travel_profile(text,jsonb) from public,anon;
grant execute on function public.sadeeman_travel_profile(text,jsonb) to authenticated;
create function public.sadeeman_commit_travel_turn(p_payload jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$ begin
 perform public.sadeeman_commit_turn(p_payload-'travelState'-'expectedTravelVersion');
 perform public.sadeeman_travel_profile('save',jsonb_build_object('conversationId',p_payload->'conversationId','expectedVersion',p_payload->'expectedTravelVersion','state',p_payload->'travelState'));
 return '{"persisted":true}';
end $$;
revoke all on function public.sadeeman_commit_travel_turn(jsonb) from public,anon;
grant execute on function public.sadeeman_commit_travel_turn(jsonb) to authenticated;
