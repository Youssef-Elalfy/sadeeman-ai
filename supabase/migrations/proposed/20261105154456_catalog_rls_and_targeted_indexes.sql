-- PROPOSAL ONLY. Logically equivalent catalog visibility; no broader role or row access.
alter policy readable_company_catalog on public.sadeeman_company_packages to authenticated
using (
  (select auth.uid()) is not null and (select public.sadeeman_session_active()) and published
  and (not is_demo or code like 'masar-demo-%' or (select coalesce(
    nullif(current_setting('request.jwt.claims',true),'')::jsonb#>>'{app_metadata,catalog_demo}',
    'false'
  ))='true')
);
-- Add only the two missing access paths. Reversed equality-key indexes and unique PKs
-- already support the other five advisor-listed foreign keys; do not duplicate them.
create index sadeeman_memories_source_conversation_owner_idx
  on public.sadeeman_memories(source_conversation_id,owner_id);
create index sadeeman_messages_turn_owner_conversation_idx
  on public.sadeeman_messages(turn_id,owner_id,conversation_id);
