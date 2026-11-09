import { z } from 'zod';

export class AppError extends Error {
  constructor(public status:number,public code:string,public publicMessage:string) { super(code); }
}
export function ok(data:unknown,status=200) {
  return Response.json({data},{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}
export function failure(error:unknown) {
  if (error instanceof AppError) return Response.json({error:{code:error.code,message:error.publicMessage}},{status:error.status,headers:{'Cache-Control':'no-store'}});
  if (error instanceof z.ZodError) return failure(new AppError(400,'invalid_input','Invalid input format.'));
  return failure(new AppError(500,'internal_error','Unable to complete this action. Please try again later.'));
}
export function assertOrigin(request:Request,siteUrl:string) {
  if (['GET','HEAD','OPTIONS'].includes(request.method)) return;
  const origin=request.headers.get('origin');
  if ((origin && origin!==new URL(siteUrl).origin) || (!origin && request.headers.has('cookie') && !request.headers.has('authorization'))) {
    throw new AppError(403,'invalid_origin','Invalid request origin.');
  }
}
export async function readJson<T extends z.ZodType>(request:Request,schema:T,maxBytes=32768):Promise<z.infer<T>> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new AppError(415,'json_required','Send JSON data.');
  const reader=request.body?.getReader();
  if (!reader) throw new AppError(400,'empty_body','Enter some content.');
  let length=0; const chunks:Uint8Array[]=[];
  while (true) {
    const {done,value}=await reader.read(); if(done) break;
    length+=value.byteLength;
    if(length>maxBytes) { await reader.cancel(); throw new AppError(413,'too_large','Content is too long.'); }
    chunks.push(value);
  }
  const buffer=Buffer.concat(chunks);
  let raw:unknown;
  try { raw=JSON.parse(buffer.toString('utf8')); } catch { throw new AppError(400,'invalid_json','Invalid JSON format.'); }
  return schema.parse(raw);
}
export function databaseError(error:{code?:string;message?:string}|null) {
  if (!error) return;
  const codes:Record<string,[number,string]>={
    court_not_ready:[409,'Both people must click Ready first.'],invitation_not_accepted:[409,'Accept the court invitation in Inbox first.'],not_plaintiff:[403,'Only the plaintiff can file this case.'],
    unauthenticated:[401,'Sign in first.'],not_paired:[409,'Pair with your partner first.'],not_allowed:[403,'This account cannot create a couple space.'],
    already_paired:[409,'You already belong to a couple space.'],space_full:[409,'This couple space already has two people.'],
    invalid_invitation:[410,'This invitation has expired, has been used, or is unavailable.'],space_inactive:[409,'This couple space is being deleted.'],
    already_adopted:[409,'You have already adopted a pet.'],already_fed:[409,'Your pet has already been fed today.'],answer_required:[400,'Answer the question first.'],
    box_empty:[409,'All songs have been drawn.'],invalid_items:[400,'Check the songs and their question or message.'],answer_not_expected:[400,'This song does not need an answer.'],partner_required:[403,'This action requires your partner.'],not_found:[404,'Content not found or unavailable.'],
    turn_pending:[409,'The assistant is replying to the previous message.'],stale_turn:[409,'This conversation turn has expired.'],already_responded:[409,'This request has already been handled.'],
    already_sharing:[409,'You are already sharing your location.'],location_not_active:[409,'You are not sharing your location.'],
    location_expired:[410,'Location sharing has expired.'],location_rate_limited:[429,'Location updates are too frequent. Please try again later.'],
    invalid_location:[400,'Invalid location data. Refresh your location.'],
    location_not_fresh:[409,'Location sharing is off or expired. Refresh your location or send a chat-only snap.'],
    invalid_story:[400,'Invalid snap content.'],invalid_story_scope:[400,'Invalid snap scope.'],
    media_cleanup:[410,'This temporary photo has expired. Choose and upload it again.'],
    not_story_author:[403,'You can only save snaps you sent.'],already_saved:[409,'This snap is already linked to another calendar event.'],
    invalid_calendar_entry:[400,'Choose a dated shared event in your couple space.'],
    invalid_message_metadata:[400,'Invalid chat reference.'],profile_already_initialized:[409,'Your profile is already set up.'],
    invalid_date_source:[403,'You can only share your own non-private messages.'],invalid_date_input:[400,'Invalid date information format.'],
    invalid_date_wishes:[400,'Choose shared wishes from your current couple space.'],date_input_limit:[400,'Too much date information. Review your existing content first.'],
    no_common_availability:[409,'This time is busy or pairing is incomplete. Change the time or check both schedules.'],date_context_changed:[409,'Date information or schedules have changed. Generate a new proposal.'],
    invalid_schedule_input:[400,'Invalid event details. Check the title, start and end times, and timezone.'],invalid_calendar_range:[400,'Invalid date range. Choose 366 days or less.'],
    stale_proposal:[409,'The proposal has changed. Refresh and confirm the latest version.'],proposal_not_pending:[409,'This proposal has ended and can no longer be changed or confirmed.'],
    uploads_pending:[503,'Both partners agreed to delete the space. Wait for current image uploads to finish, then retry.'],
    invalid_cat_court_statement:[400,'Invalid statement. Review it and submit again.'],round_not_ready:[409,'Wait for both partners to finish the current court stage.'],
    case_closed:[409,'This case is closed.'],invalid_cat_court_verdict:[400,'Invalid verdict format. Generate a new verdict.'],
  };
  const rule=codes[error.message||''];
  if (rule) throw new AppError(rule[0],error.message!,rule[1]);
  if(error.code==='23505') throw new AppError(409,'conflict','This content already exists or is complete.');
  if(['23514','22P02','23502'].includes(error.code||'')) throw new AppError(400,'invalid_input','Invalid input format.');
  if(error.code==='42501') throw new AppError(403,'forbidden','You cannot perform this action.');
  throw new AppError(500,'database_error','Unable to complete this data operation.');
}
