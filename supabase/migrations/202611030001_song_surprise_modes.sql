-- Keep every old item/draw as a question. New assigned draws snapshot their mode
-- and message so changing a queued item's configuration cannot change a draw.
alter table public.blind_box_items
  add column interaction_mode text not null default 'question',
  add column message_text text,
  add constraint blind_box_item_mode check (interaction_mode in ('question','message','none')),
  add constraint blind_box_item_interaction check (
    (interaction_mode='question' and message_text is null)
    or (interaction_mode='message' and custom_prompt is null and message_text is not null and length(message_text) between 1 and 2000)
    or (interaction_mode='none' and custom_prompt is null and message_text is null)
  );

alter table public.draws
  alter column question drop not null,
  add column interaction_mode text not null default 'question',
  add column message_text text,
  add constraint draw_mode check (interaction_mode in ('question','message','none')),
  add constraint draw_interaction check (
    (interaction_mode='question' and question is not null and message_text is null)
    or (interaction_mode='message' and question is null and message_text is not null and length(message_text) between 1 and 2000)
    or (interaction_mode='none' and question is null and message_text is null)
  );

create or replace function public.duet_send_blind_box(p_items jsonb,p_note text)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  c uuid:=private.current_couple(); b uuid; partner uuid; item jsonb;
  mode text; question text; message text;
  -- Match JavaScript String.trim, including non-breaking and ideographic spaces.
  trim_chars constant text:=U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
begin
  select user_id into partner from public.couple_members where couple_id=c and user_id<>auth.uid();
  if partner is null then raise exception 'partner_required'; end if;
  if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'invalid_items' using errcode='22023'; end if;
  if jsonb_array_length(p_items) not between 1 and 50 or p_note is null or length(p_note)>2000 then
    raise exception 'invalid_items' using errcode='22023';
  end if;
  insert into public.blind_boxes(couple_id,sender_id,recipient_id,note)
    values(c,auth.uid(),partner,p_note) returning id into b;
  for item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(item) is distinct from 'object' then raise exception 'invalid_items' using errcode='22023'; end if;
    if jsonb_typeof(item->'song_id') is distinct from 'string'
      or exists(select 1 from jsonb_object_keys(item) k where k not in ('song_id','mode','question','message'))
      or (item ? 'mode' and (jsonb_typeof(item->'mode') is distinct from 'string' or item->>'mode' not in ('question','message','none')))
    then raise exception 'invalid_items' using errcode='22023'; end if;
    mode:=coalesce(item->>'mode','question'); question:=null; message:=null;
    if mode='question' then
      if item ? 'message' or (item ? 'question' and jsonb_typeof(item->'question') is distinct from 'string') then
        raise exception 'invalid_items' using errcode='22023';
      end if;
      question:=nullif(btrim(item->>'question',trim_chars),'');
      if length(question)>500 then raise exception 'invalid_items' using errcode='22023'; end if;
    elsif mode='message' then
      if item ? 'question' or jsonb_typeof(item->'message') is distinct from 'string' then
        raise exception 'invalid_items' using errcode='22023';
      end if;
      message:=btrim(item->>'message',trim_chars);
      if length(message) not between 1 and 2000 then raise exception 'invalid_items' using errcode='22023'; end if;
    elsif item ? 'question' or item ? 'message' then
      raise exception 'invalid_items' using errcode='22023';
    end if;
    if not exists(select 1 from public.song_cards where id=(item->>'song_id')::uuid and created_by=auth.uid() and couple_id=c) then
      raise exception 'not_found';
    end if;
    insert into public.blind_box_items(couple_id,box_id,song_id,custom_prompt,interaction_mode,message_text)
      values(c,b,(item->>'song_id')::uuid,question,mode,message);
  end loop;
  insert into public.messages(couple_id,sender_id,kind,body,metadata)
    values(c,auth.uid(),'blind_box',p_note,jsonb_build_object('box_id',b,'count',jsonb_array_length(p_items)));
  return b;
end $$;

create or replace function public.duet_prepare_draw(p_box uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c uuid:=private.current_couple(); d public.draws; item public.blind_box_items; q text;
begin
  -- Serialize allocation within a box; retries return the same pending snapshot.
  perform 1 from public.blind_boxes where id=p_box and couple_id=c and recipient_id=auth.uid() for update;
  if not found then raise exception 'not_found'; end if;
  select * into d from public.draws where box_id=p_box and recipient_id=auth.uid() and completed_at is null;
  if d.id is null then
    select * into item from public.blind_box_items where box_id=p_box and opened_at is null order by random() limit 1;
    if item.id is null then raise exception 'box_empty'; end if;
    if item.interaction_mode='question' then
      q:=coalesce(item.custom_prompt,(array[
        'What little thing made you smile today?',
        'What would you most like to do after work today?',
        'Which color would you choose for today?',
        'What little thing would you most like to share today?'
      ])[1+floor(random()*4)::int]);
    end if;
    insert into public.draws(couple_id,box_id,item_id,recipient_id,question,interaction_mode,message_text)
      values(c,p_box,item.id,auth.uid(),q,item.interaction_mode,item.message_text) returning * into d;
  end if;
  -- Do not expose song IDs, titles, artwork or other song metadata before unlock.
  return jsonb_build_object('draw_id',d.id,'mode',d.interaction_mode,'question',d.question,'message',d.message_text);
end $$;

create or replace function public.duet_complete_draw(p_draw uuid,p_answer text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  c uuid:=private.current_couple(); d public.draws; song public.song_cards; answer_id uuid; sender uuid; answer text;
  trim_chars constant text:=U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
begin
  select * into d from public.draws where id=p_draw and couple_id=c and recipient_id=auth.uid() for update;
  if d.id is null then raise exception 'not_found'; end if;
  -- Completed retries are reads, including legacy draws; never create a second answer.
  if d.completed_at is null then
    answer:=nullif(btrim(p_answer,trim_chars),'');
    if d.interaction_mode='question' then
      if answer is null or length(answer)>2000 then raise exception 'answer_required'; end if;
      select sender_id into sender from public.blind_boxes where id=d.box_id;
      insert into public.prompt_answers(couple_id,author_id,source_type,source_id,prompt,answer)
        values(c,auth.uid(),'draw',d.id,d.question,answer) returning id into answer_id;
      insert into public.blind_box_inbox(id,couple_id,recipient_id,author_id,prompt,answer)
        values(answer_id,c,sender,auth.uid(),d.question,answer);
    elsif answer is not null then
      raise exception 'answer_not_expected' using errcode='22023';
    end if;
    update public.blind_box_items set opened_at=now() where id=d.item_id;
    update public.draws set completed_at=now() where id=d.id;
  end if;
  select s.* into song from public.song_cards s join public.blind_box_items i on i.song_id=s.id where i.id=d.item_id;
  return to_jsonb(song);
end $$;

-- Preserve the existing private table/RLS protections; expose only authenticated RPCs.
revoke all on function public.duet_send_blind_box(jsonb,text),public.duet_prepare_draw(uuid),public.duet_complete_draw(uuid,text) from public,anon;
grant execute on function public.duet_send_blind_box(jsonb,text),public.duet_prepare_draw(uuid),public.duet_complete_draw(uuid,text) to authenticated;
