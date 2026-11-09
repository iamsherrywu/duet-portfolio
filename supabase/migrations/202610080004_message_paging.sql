create function public.duet_list_messages(p_before timestamptz default null,p_cursor uuid default null,p_limit integer default 50) returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at,m.id),'[]') from (
    select messages.* from public.messages where couple_id=private.current_couple()
      and not exists(select 1 from public.message_hides h where h.message_id=messages.id and h.user_id=auth.uid())
      and (p_before is null or created_at<p_before or (created_at=p_before and p_cursor is not null and id<p_cursor))
    order by created_at desc,id desc limit least(greatest(p_limit,1),100)
  ) m
$$;
revoke all on function public.duet_list_messages(timestamptz,uuid,integer) from public,anon,authenticated;
grant execute on function public.duet_list_messages(timestamptz,uuid,integer) to authenticated;
