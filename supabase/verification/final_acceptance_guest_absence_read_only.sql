-- READ ONLY: final acceptance guest only, on Sadeeman ujdzysbowngtkwndgoqf.
-- Every returned count must be zero. Never execute cleanup from this file.
begin read only;
with target as (select '92ccd881-60f2-4189-b3dd-05bf712d89ce'::uuid as id)
select
  (select count(*) from auth.users where id=t.id) as auth_users,
  (select count(*) from auth.identities where user_id=t.id) as auth_identities,
  (select count(*) from auth.sessions where user_id=t.id) as auth_sessions,
  (select count(*) from auth.refresh_tokens where user_id::text=t.id::text) as refresh_tokens,
  (select count(*) from public.sadeeman_conversations where owner_id=t.id) as conversations,
  (select count(*) from public.sadeeman_messages where owner_id=t.id) as messages,
  (select count(*) from public.sadeeman_turns where owner_id=t.id) as turns,
  (select count(*) from public.sadeeman_tool_executions where owner_id=t.id) as tool_executions,
  (select count(*) from public.sadeeman_audit_events where owner_id=t.id) as audit_events,
  (select count(*) from public.sadeeman_memories where owner_id=t.id) as memories,
  (select count(*) from public.sadeeman_consents where owner_id=t.id) as consents,
  (select count(*) from public.sadeeman_requests where owner_id=t.id) as requests,
  (select count(*) from public.sadeeman_session_revocations where owner_id=t.id) as session_revocations,
  (select count(*) from public.sadeeman_travel_profiles where owner_id=t.id) as travel_profiles,
  (select count(*) from storage.objects o
    where to_jsonb(o)->>'owner_id'=t.id::text or to_jsonb(o)->>'owner'=t.id::text) as storage_objects
from target t;
rollback;
