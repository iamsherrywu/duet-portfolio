-- Read-only metadata audit. No chat, birthday, photo or coordinate values.
-- Run as the project administrator in SQL Editor > Database (not Logs).
with required(name) as (
  values ('couples'),('couple_members'),('messages'),('agent_messages'),('media'),
    ('entry_media'),('location_shares'),('location_snaps'),('location_snap_views'),('location_story_groups'),
    ('personal_schedules'),('date_preferences'),('date_availability'),('date_proposals'),('date_proposal_confirmations'),
    ('cat_court_cases'),('cat_court_invitations'),('cat_court_statements'),('cat_court_verdicts'),('cat_court_tasks'),('cat_court_temperature')
)
select r.name as table_name,c.oid is not null as present,
  coalesce(c.relrowsecurity,false) as rls_enabled,
  (select count(*) from pg_policies p where p.schemaname='public' and p.tablename=r.name) as policy_count
from required r left join pg_class c on c.oid=to_regclass('public.'||r.name)
order by r.name;

-- Verify columns introduced by later migrations without failing when a table is absent.
with required(table_name,column_name) as (
  values ('personal_schedules','all_day'),('location_snaps','story_group_id'),
    ('location_snaps','group_position'),('cat_court_cases','invitation_sent_at'),
    ('cat_court_cases','accepted_at'),('cat_court_invitations','accepted_at'),
    ('cat_court_cases','plaintiff_ready_at'),('cat_court_cases','defendant_ready_at')
)
select r.table_name,r.column_name,
  exists(select 1 from pg_attribute a where a.attrelid=to_regclass('public.'||r.table_name)
    and a.attname=r.column_name and not a.attisdropped) as present
from required r order by r.table_name,r.column_name;

select id,public as is_public,file_size_limit,allowed_mime_types
from storage.buckets where id='duet-private';

select schemaname,tablename from pg_publication_tables
where pubname='supabase_realtime' and schemaname='public' order by tablename;

select coalesce(has_table_privilege('authenticated',to_regclass('public.profiles'),'SELECT'),false) as profiles_readable,
  coalesce(has_column_privilege('authenticated',to_regclass('public.profiles'),'birthday','SELECT'),false) as birthday_readable,
  coalesce(has_table_privilege('authenticated',to_regclass('public.personal_schedules'),'SELECT'),false) as personal_schedules_readable,
  coalesce(has_table_privilege('authenticated',to_regclass('public.location_story_groups'),'SELECT'),false) as story_group_table_readable;
-- Profiles and story groups must not be directly readable. Personal schedules use SELECT plus couple-scoped RLS.

select signature,to_regprocedure(signature) is not null as present from (values
  ('public.duet_get_my_profile()'),('public.duet_list_shared_calendar(date,date)'),
  ('public.duet_confirm_date_proposal(uuid,integer)'),('public.duet_claim_media_cleanup()'),
  ('public.duet_start_location_share_for_duration(double precision,double precision,double precision,integer)'),
  ('public.duet_create_location_story(uuid,text,double precision,double precision,double precision,integer)'),
  ('public.duet_list_couple_profiles()'),
  ('public.duet_create_location_story_group(uuid[],text,double precision,double precision,double precision,integer)'),
  ('public.duet_create_personal_schedule(text,timestamptz,timestamptz,text,text,boolean)'),
  ('public.duet_update_personal_schedule(uuid,text,timestamptz,timestamptz,text,text,boolean)'),
  ('public.duet_cancel_personal_schedule(uuid)'),
  ('public.duet_list_personal_schedules(timestamptz,timestamptz)'),
  ('public.duet_common_free_time(timestamptz,timestamptz)'),
  ('public.duet_cat_court_create_case()'),
  ('public.duet_cat_court_file_case(uuid)'),
  ('public.duet_list_cat_court_invitations()'),
  ('public.duet_cat_court_accept_invitation(uuid)'),
  ('public.duet_cat_court_ready(uuid)'),
  ('public.duet_edit_profile(text,text,date)'),
  ('public.duet_cat_court_submit_statement(uuid,smallint,text)'),
  ('public.duet_cat_court_list()'),
  ('public.duet_cat_court_store_ai_verdict(uuid,uuid,jsonb)')
) required(signature);

-- Verify the couple-only birthday RPC was replaced by the version that returns birthdays.
with rpc as (select to_regprocedure('public.duet_list_couple_profiles()')::oid as function_oid)
select coalesce(pg_get_functiondef(function_oid) ilike '%birthday%',false)
  as couple_profile_rpc_includes_birthday from rpc;

-- The single-photo publisher delegates to the group publisher after 202611020002.
-- Inspect the group implementation, not the compatibility wrapper, for location
-- validation and the agreed 24-hour lifetime. No function is executed here.
with publisher as (
  select to_regprocedure('public.duet_create_location_story_group(uuid[],text,double precision,double precision,double precision,integer)')::oid as function_oid,
    to_regprocedure('public.duet_create_location_story(uuid,text,double precision,double precision,double precision,integer)')::oid as legacy_function_oid
), body as (
  select function_oid,legacy_function_oid,
    case when function_oid is null then '' else lower(pg_get_functiondef(function_oid)) end as source,
    case when legacy_function_oid is null then '' else lower(pg_get_functiondef(legacy_function_oid)) end as legacy_source
  from publisher
)
select function_oid is not null as story_group_publisher_present,
  legacy_function_oid is not null as story_publisher_present,
  legacy_source like '%public.duet_create_location_story_group(array[p_media]%' as single_photo_delegates_to_group,
  source like '%p_duration_minutes in (30,60)%' as validates_location_duration,
  source like '%p_latitude is null and p_longitude is null and p_accuracy_m is null and p_duration_minutes is null%' as allows_story_without_location,
  source like '%if p_latitude is not null then%' and source like '%insert into public.location_shares%' as refreshes_location_only_with_fix,
  source like '%interval ''24 hours''%' as story_lifetime_is_24_hours
from body;

select
  coalesce(has_function_privilege('authenticated',to_regprocedure('public.duet_start_location_share_for_duration(double precision,double precision,double precision,integer)'),'EXECUTE'),false) as authenticated_can_start_location_share,
  coalesce(has_function_privilege('anon',to_regprocedure('public.duet_start_location_share_for_duration(double precision,double precision,double precision,integer)'),'EXECUTE'),false) as anonymous_can_start_location_share,
  coalesce(has_function_privilege('authenticated',to_regprocedure('public.duet_create_location_story(uuid,text,double precision,double precision,double precision,integer)'),'EXECUTE'),false) as authenticated_can_create_location_story,
  coalesce(has_function_privilege('anon',to_regprocedure('public.duet_create_location_story(uuid,text,double precision,double precision,double precision,integer)'),'EXECUTE'),false) as anonymous_can_create_location_story,
  coalesce(has_function_privilege('authenticated',to_regprocedure('public.duet_create_location_story_group(uuid[],text,double precision,double precision,double precision,integer)'),'EXECUTE'),false) as authenticated_can_create_story_group,
  coalesce(has_function_privilege('anon',to_regprocedure('public.duet_create_location_story_group(uuid[],text,double precision,double precision,double precision,integer)'),'EXECUTE'),false) as anonymous_can_create_story_group,
  coalesce(has_function_privilege('authenticated',to_regprocedure('public.duet_list_couple_profiles()'),'EXECUTE'),false) as authenticated_can_list_couple_profiles,
  coalesce(has_function_privilege('anon',to_regprocedure('public.duet_list_couple_profiles()'),'EXECUTE'),false) as anonymous_can_list_couple_profiles,
  coalesce(has_function_privilege('authenticated',to_regprocedure('public.duet_cat_court_store_ai_verdict(uuid,uuid,jsonb)'),'EXECUTE'),false) as authenticated_can_store_ai_verdict,
  coalesce(has_function_privilege('anon',to_regprocedure('public.duet_cat_court_store_ai_verdict(uuid,uuid,jsonb)'),'EXECUTE'),false) as anonymous_can_store_ai_verdict,
  coalesce(has_function_privilege('service_role',to_regprocedure('public.duet_cat_court_store_ai_verdict(uuid,uuid,jsonb)'),'EXECUTE'),false) as service_role_can_store_ai_verdict;
-- Authenticated can call couple, schedule, story and court user functions; only service_role can store server AI verdicts; anon cannot call them.

select
  coalesce(has_function_privilege('authenticated',to_regprocedure('public.duet_cat_court_file_case(uuid)'),'EXECUTE'),false) as authenticated_can_file_court_case,
  coalesce(has_function_privilege('anon',to_regprocedure('public.duet_cat_court_file_case(uuid)'),'EXECUTE'),false) as anonymous_can_file_court_case,
  coalesce(has_function_privilege('authenticated',to_regprocedure('public.duet_list_cat_court_invitations()'),'EXECUTE'),false) as authenticated_can_list_court_invites,
  coalesce(has_function_privilege('anon',to_regprocedure('public.duet_list_cat_court_invitations()'),'EXECUTE'),false) as anonymous_can_list_court_invites,
  coalesce(has_function_privilege('authenticated',to_regprocedure('public.duet_cat_court_accept_invitation(uuid)'),'EXECUTE'),false) as authenticated_can_accept_court_invite,
  coalesce(has_function_privilege('anon',to_regprocedure('public.duet_cat_court_accept_invitation(uuid)'),'EXECUTE'),false) as anonymous_can_accept_court_invite;

-- 202611020004 / 202611020005: metadata only, never execute the mutations.
-- Ready: authenticated/service_role allowed, anon denied.
-- Profile edit: authenticated allowed; anon and service_role denied by explicit grants.
select
  coalesce(has_function_privilege('authenticated',to_regprocedure('public.duet_cat_court_ready(uuid)'),'EXECUTE'),false) as authenticated_can_mark_court_ready,
  coalesce(has_function_privilege('anon',to_regprocedure('public.duet_cat_court_ready(uuid)'),'EXECUTE'),false) as anonymous_can_mark_court_ready,
  coalesce(has_function_privilege('service_role',to_regprocedure('public.duet_cat_court_ready(uuid)'),'EXECUTE'),false) as service_role_can_mark_court_ready,
  coalesce(has_function_privilege('authenticated',to_regprocedure('public.duet_edit_profile(text,text,date)'),'EXECUTE'),false) as authenticated_can_edit_own_profile,
  coalesce(has_function_privilege('anon',to_regprocedure('public.duet_edit_profile(text,text,date)'),'EXECUTE'),false) as anonymous_can_edit_profile,
  coalesce(has_function_privilege('service_role',to_regprocedure('public.duet_edit_profile(text,text,date)'),'EXECUTE'),false) as service_role_can_edit_profile;

with definitions as (
  select coalesce(lower(pg_get_functiondef(to_regprocedure('public.duet_cat_court_submit_statement(uuid,smallint,text)'))),'') as statement_source,
    coalesce(lower(pg_get_functiondef(to_regprocedure('public.duet_edit_profile(text,text,date)'))),'') as profile_source
)
select statement_source like '%plaintiff_ready_at is null%'
    and statement_source like '%defendant_ready_at is null%'
    and statement_source like '%court_not_ready%' as statements_require_both_ready,
  regexp_replace(profile_source,'\s+','','g') like '%whereid=auth.uid()%' as profile_edit_targets_current_user
from definitions;

-- 202611030001: metadata only. Songs remain hidden until the recipient unlocks
-- their persisted draw; only question mode creates an answer and sender Inbox item.
select table_name,column_name,data_type,is_nullable,column_default
from information_schema.columns
where table_schema='public' and table_name in ('blind_box_items','draws')
  and column_name in ('interaction_mode','message_text')
order by table_name,column_name;

select signature,
  coalesce(has_function_privilege('authenticated',to_regprocedure(signature),'EXECUTE'),false) as authenticated_can_execute,
  coalesce(has_function_privilege('anon',to_regprocedure(signature),'EXECUTE'),false) as anonymous_can_execute
from (values ('public.duet_send_blind_box(jsonb,text)'),('public.duet_prepare_draw(uuid)'),('public.duet_complete_draw(uuid,text)')) f(signature);

with definitions as (
  select coalesce(pg_get_functiondef(to_regprocedure('public.duet_prepare_draw(uuid)')),'') as prepare_source,
    coalesce(pg_get_functiondef(to_regprocedure('public.duet_complete_draw(uuid,text)')),'') as complete_source
)
select prepare_source like '%item.interaction_mode,item.message_text%' as draw_snapshots_mode,
  complete_source like '%if d.interaction_mode=''question'' then%' as answers_only_for_question,
  complete_source like '%if d.completed_at is null then%' as completion_is_idempotent,
  complete_source like '%for update%' as completion_locks_draw
from definitions;
