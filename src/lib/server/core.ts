import {isOnline} from '../online-presence';
import {findSongArtwork} from './song-artwork';
import {saveMedia} from './media';
import { z } from 'zod';
import { randomInt } from 'node:crypto';
import { ok, readJson, databaseError, AppError } from './http';
import { type Context, rpc, requireCouple, adminClient, siteUrl } from '../supabase/server';
import { id, shortText, textMessage, songInput, boxInput, drawAnswerInput, feedInput, entryInput, locationCoordinatesInput, locationStartInput, storyCreateInput, storySaveInput } from './schemas';
import { profileInitializationSchema, profileEditSchema } from './auth';

const questions=['What little thing would you most like to share today?','Which song would you send your partner this morning?','Describe today with a color.','What would you most like to do after work today?'];
const calendarRangeInput=z.object({from:z.iso.date(),to:z.iso.date()}).strict().superRefine((range,context)=>{
  const days=(Date.parse(`${range.to}T00:00:00Z`)-Date.parse(`${range.from}T00:00:00Z`))/86400000;
  if(days<0||days>366)context.addIssue({code:'custom',path:['to'],message:'Invalid date range.'});
});
const safeProfileFields=['id','display_name','gender','clown_role','timezone','afterwork_start','afterwork_end','location_avatar_media_id'] as const;
function safeProfile(profile:unknown,includeCoupleBirthday=false):Record<string,unknown>|null {
  if(!profile || typeof profile!=='object' || Array.isArray(profile))return null;
  const source=profile as Record<string,unknown>;
  const fields=includeCoupleBirthday?[...safeProfileFields,'birthday'] as const:safeProfileFields;
  return Object.fromEntries(fields.filter(key=>key in source).map(key=>[key,source[key]]));
}

async function includeEntryMedia(ctx:Context,entries:Array<{id:string;media_id:string|null;[key:string]:unknown}>) {
  if(!entries.length)return entries.map(entry=>({...entry,media_ids:[]}));
  const {data,error}=await ctx.db.from('entry_media').select('entry_id,media_id,position').in('entry_id',entries.map(entry=>entry.id)).order('position',{ascending:true});
  databaseError(error);
  const grouped=new Map<string,string[]>();
  for(const link of data??[])grouped.set(link.entry_id,[...(grouped.get(link.entry_id)??[]),link.media_id]);
  return entries.map(entry=>({...entry,media_ids:[...new Set([...(entry.media_id?[entry.media_id]:[]),...(grouped.get(entry.id)??[])])]}));
}

export async function core(request:Request,path:string[],ctx:Context,serviceDb=adminClient):Promise<Response|null> {
  const route=path.join('/'); const method=request.method;
  if(route==='presence'&&method==='POST'){
    await requireCouple(ctx);const body=await readJson(request,z.object({online:z.boolean()}).strict());
    const {error}=await serviceDb().from('user_presence').upsert({user_id:ctx.user.id,online:body.online,last_seen_at:new Date().toISOString()});databaseError(error);return ok({done:true});
  }
  if(route==='presence'&&method==='GET'){
    const coupleId=await requireCouple(ctx);const {data:partner,error}=await ctx.db.from('couple_members').select('user_id').eq('couple_id',coupleId).neq('user_id',ctx.user.id).maybeSingle();databaseError(error);if(!partner)return ok({online:false});
    const {data:presence,error:e}=await serviceDb().from('user_presence').select('online,last_seen_at').eq('user_id',partner.user_id).maybeSingle();databaseError(e);return ok({online:isOnline(presence)});
  }
  if(route==='couple' && method==='POST') return ok({id:await rpc(ctx,'duet_create_couple')},201);
  if(route==='couple' && method==='GET') {
    const {data:members,error}=await ctx.db.from('couple_members').select('*'); databaseError(error);
    const current=members?.find(m=>m.user_id===ctx.user.id);
    let listed:unknown=[];let status='active';
    if(current)try{listed=await rpc(ctx,'duet_list_couple_profiles');}catch(error){if(error instanceof AppError&&error.code==='space_inactive')status='deletion_approved';else throw error;}
    const profiles=Array.isArray(listed)?listed.map(profile=>safeProfile(profile,true)).filter((profile):profile is Record<string,unknown>=>profile!==null):[];
    let isHost=current?.slot===1;
    if(!current&&ctx.user.email){
      const {data:allowed,error:eligibilityError}=await adminClient().rpc('duet_login_allowed',{p_email:ctx.user.email.toLowerCase(),p_invite_hash:null});
      databaseError(eligibilityError);isHost=allowed===true;
    }
    return ok({coupleId:current?.couple_id??null,members,profiles,status,isHost,canCreateSpace:isHost&&!current});
  }
  if(route==='invitations' && method==='POST') {
    const token=await rpc(ctx,'duet_create_invitation');
    return ok({url:`${siteUrl()}/invite/${token}`,expiresIn:86400},201);
  }
  if(route==='invitations/accept' && method==='POST') {
    const body=await readJson(request,z.object({token:z.string().regex(/^[a-f0-9]{64}$/)}).strict());
    return ok({coupleId:await rpc(ctx,'duet_accept_invitation',{p_token:body.token})});
  }
  if(route==='prompts' && method==='GET') return ok({question:questions[randomInt(questions.length)]});
  if(route==='moods' && method==='GET') {
    await requireCouple(ctx);const {data,error}=await ctx.db.from('daily_moods').select('*');databaseError(error);return ok(data);
  }
  if(route==='moods' && method==='POST') {
    const b=await readJson(request,z.object({mood:z.string().trim().min(1).max(40)}).strict());
    await rpc(ctx,'duet_set_mood',{p_mood:b.mood});return ok({done:true});
  }
  if(route==='inbox' && method==='GET') {
    const cursor=new URL(request.url).searchParams.get('cursor');
    const [page,courtInbox]=await Promise.all([
      rpc(ctx,'duet_list_blind_box_inbox',{p_cursor:cursor?id.parse(cursor):null}),
      rpc(ctx,'duet_list_cat_court_invitations'),
    ]) as [{items:unknown[];unreadCount:number;nextCursor:string|null},{items:Array<{accepted_at:string|null;read_at:string|null}>}];
    const unreadCourtInvitations=courtInbox.items.filter(item=>!item.accepted_at&&!item.read_at).length;
    const coupleId=await requireCouple(ctx);
    const {data:notifications,error:notificationError}=await serviceDb().from('song_reaction_inbox').select('*').eq('couple_id',coupleId).eq('recipient_id',ctx.user.id).order('created_at',{ascending:false}).limit(100);databaseError(notificationError);
    return ok({...page,items:[...page.items,...(notifications??[]).map(n=>({...n,id:'reaction:'+n.id}))],courtInvitations:courtInbox.items,unreadCount:page.unreadCount+unreadCourtInvitations+(notifications??[]).filter(n=>!n.read_at).length});
  }
  if(path[0]==='inbox' && path.length===3 && path[2]==='read' && method==='POST') {
    if(path[1].startsWith('reaction:')){const coupleId=await requireCouple(ctx);const {error}=await serviceDb().from('song_reaction_inbox').update({read_at:new Date().toISOString()}).eq('id',id.parse(path[1].slice(9))).eq('recipient_id',ctx.user.id).eq('couple_id',coupleId);databaseError(error);return ok({done:true});}
    await rpc(ctx,'duet_read_blind_box_answer',{p_answer:id.parse(path[1])});return ok({done:true});
  }
  if(route==='location' && method==='GET') return ok(await rpc(ctx,'duet_list_location_shares'));
  if(route==='location/start' && method==='POST') {
    const b=await readJson(request,locationStartInput);
    if(b.durationMinutes===undefined) return ok(await rpc(ctx,'duet_start_location_share',{p_latitude:b.latitude,p_longitude:b.longitude,p_accuracy_m:b.accuracy}),201);
    return ok(await rpc(ctx,'duet_start_location_share_for_duration',{p_latitude:b.latitude,p_longitude:b.longitude,p_accuracy_m:b.accuracy,p_duration_minutes:b.durationMinutes}),201);
  }
  if(route==='location' && method==='PATCH') {
    const b=await readJson(request,locationCoordinatesInput);
    await rpc(ctx,'duet_update_location',{p_latitude:b.latitude,p_longitude:b.longitude,p_accuracy_m:b.accuracy});
    return ok({done:true});
  }
  if(route==='location' && method==='DELETE') {
    await rpc(ctx,'duet_stop_location_share');
    return ok({done:true});
  }
  if(route==='stories' && method==='POST') {
    const b=await readJson(request,storyCreateInput);
    if(b.mediaIds)return ok(await rpc(ctx,'duet_create_location_story_group',{
      p_media_ids:b.mediaIds,p_caption:b.caption,
      p_latitude:b.coordinates?.latitude??null,p_longitude:b.coordinates?.longitude??null,
      p_accuracy_m:b.coordinates?.accuracy??null,p_duration_minutes:b.coordinates?(b.durationMinutes??60):null,
    }),201);
    if(b.coordinates) return ok(await rpc(ctx,'duet_create_location_story',{
      p_media:b.mediaId!,p_caption:b.caption,
      p_latitude:b.coordinates.latitude,p_longitude:b.coordinates.longitude,p_accuracy_m:b.coordinates.accuracy,
      p_duration_minutes:b.durationMinutes??60,
    }),201);
    return ok(await rpc(ctx,'duet_create_location_snap',{p_media:b.mediaId!,p_caption:b.caption,p_with_location:b.withLocation??false}),201);
  }
  if(route==='stories' && method==='GET') {
    const scope=z.enum(['chat','map']).parse(new URL(request.url).searchParams.get('scope'));
    return ok(await rpc(ctx,'duet_list_location_snaps',{p_scope:scope}));
  }
  if(path[0]==='stories' && path.length===2 && method==='GET') {
    return ok(await rpc(ctx,'duet_get_location_snap',{p_snap:id.parse(path[1])}));
  }
  if(path[0]==='stories' && path.length===3 && path[2]==='view' && method==='POST') {
    await rpc(ctx,'duet_mark_location_snap_viewed',{p_snap:id.parse(path[1])});return ok({done:true});
  }
  if(path[0]==='stories' && path.length===3 && path[2]==='save' && method==='POST') {
    const b=await readJson(request,storySaveInput);
    return ok(await rpc(ctx,'duet_save_location_snap',{p_snap:id.parse(path[1]),p_linked_entry:b.linkedEntryId??null}));
  }
  if(route==='pets' && method==='GET') {
    await requireCouple(ctx); const {data,error}=await ctx.db.from('pets').select('*');databaseError(error);return ok(data);
  }
  if(route==='pets' && method==='POST') {
    const b=await readJson(request,z.object({kind:z.enum(['cat','dog']),breed:z.string().trim().min(1).max(80),name:z.string().trim().min(1).max(40)}).strict());
    try{return ok({id:await rpc(ctx,'duet_claim_pet',{p_kind:b.kind,p_breed:b.breed,p_name:b.name})},201);}
    catch(error){if(error instanceof AppError&&error.code==='conflict')throw new AppError(409,'pet_taken','Your partner chose this pet. Choose the other one.');throw error;}
  }
  if(path[0]==='pets' && path.length===2 && method==='PATCH') {
    const b=await readJson(request,z.object({breed:z.string().trim().min(1).max(80),name:z.string().trim().min(1).max(40),theme:z.enum(['classic','midnight','sunrise'])}).strict());
    await rpc(ctx,'duet_update_pet',{p_pet:id.parse(path[1]),p_breed:b.breed,p_name:b.name,p_theme:b.theme});return ok({done:true});
  }
  if(route==='feeds' && method==='POST') {
    const b=await readJson(request,feedInput);
    return ok({id:await rpc(ctx,'duet_feed_pet',{p_pet:b.petId,p_kind:b.kind,p_content:b.content,p_question:b.question,p_answer:b.answer})},201);
  }
  if(route==='feeds' && method==='GET') {
    await requireCouple(ctx);
    const {data,error}=await ctx.db.from('daily_feeds').select('*').order('feed_date',{ascending:false}).limit(60);databaseError(error);return ok(data);
  }
  if(route==='songs' && method==='POST') {
    const b=await readJson(request,songInput);
    await requireCouple(ctx);
    if(!b.mediaId)try{const artwork=await findSongArtwork(b.title,b.artist,b.album);if(artwork)b.mediaId=(await saveMedia(ctx,artwork,'song')).id;}catch{ /* Keep manual entry available if the catalog is unavailable. */ }
    return ok({id:await rpc(ctx,'duet_create_song',{p_title:b.title,p_artist:b.artist,p_album:b.album,p_version:b.version,p_media:b.mediaId})},201);
  }
  if(route==='songs' && method==='GET') {
    await requireCouple(ctx);const {data,error}=await ctx.db.from('song_cards').select('*').order('created_at',{ascending:false}).limit(100);databaseError(error);return ok(data);
  }
  if(route==='collection/hidden' && method==='GET') {
    await requireCouple(ctx);const {data,error}=await serviceDb().from('collection_hides').select('song_id').eq('user_id',ctx.user.id);databaseError(error);return ok(data??[]);
  }
  if(path[0]==='songs' && path.length===3 && path[2]==='hide' && method==='POST') {
    await requireCouple(ctx);const songId=id.parse(path[1]);const {data,error}=await ctx.db.from('song_cards').select('id').eq('id',songId).maybeSingle();databaseError(error);if(!data)throw new AppError(404,'not_found','Song not found.');
    const {error:saveError}=await serviceDb().from('collection_hides').upsert({user_id:ctx.user.id,song_id:songId});databaseError(saveError);return ok({done:true});
  }
  if(route==='song-reactions' && method==='GET') {
    await requireCouple(ctx);const {data,error}=await ctx.db.from('song_reactions').select('*');databaseError(error);return ok(data);
  }
  if(path[0]==='songs' && path.length===3 && path[2]==='reaction' && method==='POST') {
    const b=await readJson(request,z.object({emoji:z.enum(['🔥','🎧','🥹','✨','😎','🌙']),note:z.string().trim().max(2000).default('')}).strict());
    const coupleId=await requireCouple(ctx);
    const {data:song,error:songError}=await ctx.db.from('song_cards').select('title,artist').eq('id',id.parse(path[1])).single();databaseError(songError);
    const {data:partner,error:partnerError}=await ctx.db.from('couple_members').select('user_id').eq('couple_id',coupleId).neq('user_id',ctx.user.id).maybeSingle();databaseError(partnerError);if(!partner)throw new AppError(409,'partner_required','Invite someone before sending a reaction.');
    await rpc(ctx,'duet_react_to_song',{p_song:path[1],p_emoji:b.emoji});
    const {error}=await serviceDb().from('song_reaction_inbox').insert({couple_id:coupleId,recipient_id:partner.user_id,author_id:ctx.user.id,song_id:path[1],prompt:`${song!.title} · ${song!.artist}`,answer:b.emoji+(b.note?'\n'+b.note:'')});databaseError(error);return ok({done:true});
  }
  if(route==='boxes' && method==='GET') return ok(await rpc(ctx,'duet_list_boxes'));
  if(route==='boxes' && method==='POST') {
    const b=await readJson(request,boxInput,512*1024);return ok({id:await rpc(ctx,'duet_send_blind_box',{p_items:b.items,p_note:b.note})},201);
  }
  if(path[0]==='boxes' && path[2]==='draw' && path.length===3 && method==='POST') return ok(await rpc(ctx,'duet_prepare_draw',{p_box:id.parse(path[1])}));
  if(path[0]==='draws' && path[2]==='answer' && path.length===3 && method==='POST') {
    const b=await readJson(request,drawAnswerInput);return ok(await rpc(ctx,'duet_complete_draw',{p_draw:id.parse(path[1]),p_answer:b.answer??null}));
  }
  if(route==='messages' && method==='POST') {
    const b=await readJson(request,textMessage);const metadata=b.mediaId?{media_id:b.mediaId}:b.storyId?{story_id:b.storyId}:{};
    return ok({id:await rpc(ctx,'duet_send_message',{p_kind:b.kind,p_body:b.body,p_metadata:metadata})},201);
  }
  if(route==='messages' && method==='GET') {
    const params=new URL(request.url).searchParams;
    const before=params.get('before');const cursorId=params.get('cursorId');
    if(before) z.iso.datetime({offset:true}).parse(before);if(cursorId) id.parse(cursorId);
    return ok(await rpc(ctx,'duet_list_messages',{p_before:before,p_cursor:cursorId,p_limit:50}));
  }
  if(route==='messages/reads' && method==='GET') {
    await requireCouple(ctx);const {data,error}=await ctx.db.from('conversation_reads').select('*');databaseError(error);return ok(data);
  }
  if(route==='calendar/stories' && method==='GET') {
    const couple=await requireCouple(ctx);
    const offset=z.coerce.number().int().min(0).max(1000000).parse(new URL(request.url).searchParams.get('offset')??0);
    const {data,error}=await ctx.db.from('location_snaps').select('id,media_id,calendar_date,sent_at').eq('couple_id',couple).not('saved_to_calendar_at','is',null).order('calendar_date',{ascending:false}).order('sent_at').order('id').range(offset,offset+99);
    databaseError(error);return ok({stories:data??[]});
  }
  if(route==='calendar' && method==='GET') {
    const params=new URL(request.url).searchParams;
    const keys=[...params.keys()];
    if(keys.length!==2||keys.some(key=>!['from','to'].includes(key))||params.getAll('from').length!==1||params.getAll('to').length!==1) {
      throw new AppError(400,'invalid_input','Invalid date range.');
    }
    const range=calendarRangeInput.parse({from:params.get('from'),to:params.get('to')});
    return ok(await rpc(ctx,'duet_list_shared_calendar',{p_from:range.from,p_to:range.to}));
  }
  if(path[0]==='messages' && path.length===3 && method==='POST' && ['hide','read'].includes(path[2])) {
    await rpc(ctx,path[2]==='hide'?'duet_hide_message':'duet_mark_read',{p_message:id.parse(path[1])});return ok({done:true});
  }
  if(route==='entries' && method==='GET') {
    await requireCouple(ctx);let query=ctx.db.from('entries').select('*').order('created_at',{ascending:false}).limit(100);
    const kind=new URL(request.url).searchParams.get('kind');if(kind)query=query.eq('kind',entryInput.shape.kind.parse(kind));
    const {data,error}=await query;databaseError(error);return ok(await includeEntryMedia(ctx,data??[]));
  }
  if(route==='entries' && method==='POST') {
    const b=await readJson(request,entryInput); const couple=await requireCouple(ctx);
    if(b.media_ids) {
      const entryId=await rpc(ctx,'duet_create_memory',{p_title:b.title,p_body:b.body,p_visibility:b.visibility,p_event_date:b.event_date,p_media_ids:b.media_ids});
      const {data,error}=await ctx.db.from('entries').select('*').eq('id',entryId).single();databaseError(error);
      return ok((await includeEntryMedia(ctx,[data]))[0],201);
    }
    if(b.media_id) {
      const {data,error}=await ctx.db.from('media').select('id').eq('id',b.media_id).eq('owner_id',ctx.user.id).eq('purpose','memory').maybeSingle();databaseError(error);
      if(!data)throw new AppError(404,'not_found','Image not found or unavailable.');
    }
    const {data,error}=await ctx.db.from('entries').insert({...b,couple_id:couple,author_id:ctx.user.id}).select().single();databaseError(error);return ok((await includeEntryMedia(ctx,[data]))[0],201);
  }
  if(path[0]==='entries' && path.length===3 && path[2]==='status' && method==='POST') {
    const b=await readJson(request,z.object({status:z.enum(['open','done'])}).strict());
    await rpc(ctx,'duet_set_entry_status',{p_id:id.parse(path[1]),p_status:b.status});return ok({done:true});
  }
  if(path[0]==='entries' && path.length===2 && ['PATCH','DELETE'].includes(method)) {
    await requireCouple(ctx);const recordId=id.parse(path[1]);
    if(method==='DELETE') {
      const {data,error}=await ctx.db.from('entries').delete().eq('id',recordId).eq('author_id',ctx.user.id).select('id');databaseError(error);
      if(!data?.length)throw new AppError(404,'not_found','Content not found or unavailable.');return ok({done:true});
    }
    const b=await readJson(request,entryInput.omit({kind:true,media_id:true,media_ids:true}).partial().refine(v=>Object.keys(v).length>0));
    const {data,error}=await ctx.db.from('entries').update({...b,updated_at:new Date().toISOString()}).eq('id',recordId).eq('author_id',ctx.user.id).select().maybeSingle();databaseError(error);
    if(!data)throw new AppError(404,'not_found','Content not found or unavailable.');return ok((await includeEntryMedia(ctx,[data]))[0]);
  }
  if(route==='profile' && method==='GET') {
    return ok(safeProfile(await rpc(ctx,'duet_get_my_profile')));
  }
  if(route==='profile/initialize' && method==='POST') {
    const b=await readJson(request,profileInitializationSchema);
    await rpc(ctx,'duet_initialize_profile',{p_display_name:b.displayName,p_gender:b.gender,p_birthday:b.birthday,p_clown_role:b.clownRole??null});
    return ok({initialized:true},201);
  }
  if(route==='profile/edit' && method==='POST') {
    const b=await readJson(request,profileEditSchema);
    await rpc(ctx,'duet_edit_profile',{p_display_name:b.displayName,p_gender:b.gender,p_birthday:b.birthday});
    return ok({saved:true});
  }
  if(route==='profile' && method==='PATCH') {
    const clock=z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/);
    const b=await readJson(request,z.object({name:z.string().max(40),timezone:z.string().max(80).default('Asia/Shanghai'),start:clock.default('17:30'),end:clock.default('23:00'),avatarMediaId:id.nullable().optional()}).strict());
    await rpc(ctx,'duet_update_profile',{p_name:b.name,p_timezone:b.timezone,p_start:b.start,p_end:b.end});
    if(b.avatarMediaId!==undefined)await rpc(ctx,'duet_set_location_avatar',{p_media:b.avatarMediaId});
    return ok({done:true});
  }
  if(route==='deletions' && method==='GET') {
    // RLS still checks membership; approved spaces must remain readable for cleanup retry.
    const {data,error}=await ctx.db.from('deletion_requests').select('*').order('created_at',{ascending:false}).limit(30);databaseError(error);return ok(data);
  }
  if(route==='deletions' && method==='POST')return ok({id:await rpc(ctx,'duet_request_deletion')},201);
  if(path[0]==='deletions' && path.length===3 && path[2]==='respond' && method==='POST') {
    const b=await readJson(request,z.object({confirm:z.boolean()}).strict());const requestId=id.parse(path[1]);
    await rpc(ctx,'duet_respond_deletion',{p_request:requestId,p_confirm:b.confirm});
    if(!b.confirm)return ok({deleted:false,message:'Your partner declined. The space cannot be deleted.'});
    return finalizeDeletion(ctx,requestId);
  }
  if(path[0]==='deletions' && path.length===3 && path[2]==='finalize' && method==='POST')return finalizeDeletion(ctx,id.parse(path[1]));
  return null;
}

async function finalizeDeletion(ctx:Context,requestId:string) {
  const admin=adminClient();
  const {data:coupleId,error}=await admin.rpc('duet_prepare_cleanup',{p_request:requestId,p_actor:ctx.user.id});databaseError(error);
  // Retain metadata until every object is removed, allowing safe retry after a failure.
  let offset=0;
  while(true) {
    const {data:media,error:fileError}=await admin.from('media').select('path').eq('couple_id',coupleId).order('id').range(offset,offset+99);databaseError(fileError);
    if(!media?.length)break;
    const {error:removeError}=await admin.storage.from('duet-private').remove(media.map(m=>m.path));
    if(removeError)throw new AppError(503,'cleanup_pending','Both partners agreed to delete the space. File cleanup will be retried.');
    offset+=media.length;
  }
  const {error:deleteError}=await admin.rpc('duet_finish_cleanup',{p_request:requestId,p_actor:ctx.user.id});databaseError(deleteError);
  return ok({deleted:true});
}
