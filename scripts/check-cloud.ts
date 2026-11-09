import {AIProvider} from '../src/lib/ai/provider';
import sharp from 'sharp';

const env=process.env;
const required=['NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY','SUPABASE_SERVICE_ROLE_KEY','AI_BASE_URL','AI_API_KEY','AI_MODEL','AI_VISION_MODEL','CRON_SECRET'];
const missingKeys=required.filter(key=>!env[key]);
console.log(JSON.stringify({check:'configuration',ok:!missingKeys.length,missingKeys}));
let failed=!!missingKeys.length;
async function check(name:string,run:()=>Promise<Record<string,unknown>>) {
  try{const result=await run();const ok=result.ok!==false;if(!ok)failed=true;console.log(JSON.stringify({check:name,ok,result}));}
  catch(error){failed=true;console.log(JSON.stringify({check:name,ok:false,error:error instanceof Error?error.name:'Error'}));}
}
async function request(path:string,publicKey=false) {
  const key=(publicKey?env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:env.SUPABASE_SERVICE_ROLE_KEY)||'';
  const response=await fetch(new URL(path,env.NEXT_PUBLIC_SUPABASE_URL),{
    headers:{apikey:key,Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(30000),
  });
  if(!response.ok)throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function main() {
  if(!missingKeys.length) {
    // OpenAPI contains schema metadata, not chat, photos, account lists or coordinates.
    await check('database-schema',async()=>{
      const api=await request('/rest/v1/');const paths=api.paths??{};
      // Functions granted only to authenticated users may be absent from service-role
      // OpenAPI. Do not mistake that permission boundary for a missing migration.
      const expected=['/profiles','/messages','/entry_media','/rpc/duet_auth_rate','/rpc/duet_invite_registration_allowed','/location_shares','/location_snaps','/location_story_groups','/personal_schedules','/date_preferences','/date_availability','/date_proposals','/cat_court_cases','/cat_court_invitations','/cat_court_statements','/cat_court_verdicts','/cat_court_tasks','/cat_court_temperature','/rpc/duet_cat_court_store_ai_verdict','/rpc/duet_claim_media_cleanup','/rpc/duet_create_location_story','/rpc/duet_create_location_story_group','/rpc/duet_create_location_snap','/rpc/duet_start_location_share_for_duration','/rpc/duet_list_location_snaps','/rpc/duet_get_location_snap','/rpc/duet_create_personal_schedule','/rpc/duet_update_personal_schedule','/rpc/duet_cancel_personal_schedule','/rpc/duet_list_personal_schedules','/rpc/duet_common_free_time','/blind_box_inbox','/daily_moods','/song_reactions','/weekly_date_suggestions','/rpc/duet_finish_shared_ai'];
      const columns=api.definitions?.profiles?.properties??{};
      const scheduleColumns=api.definitions?.personal_schedules?.properties??{};
      const courtColumns=api.definitions?.cat_court_cases?.properties??{};
      const itemColumns=api.definitions?.blind_box_items?.properties??{};
      const drawColumns=api.definitions?.draws?.properties??{};
      // 202611020004 adds these durable columns. User-only RPC visibility varies
      // with grants, so inspect readiness columns here and verify the ready/profile
      // functions and EXECUTE grants through the read-only SQL audit instead.
      const requiredCourtColumns=['plaintiff_ready_at','defendant_ready_at'];
      const songModeColumns=['interaction_mode','message_text'];
      const absent=[...expected.filter(name=>!paths[name]),...['gender','birthday','clown_role','location_avatar_media_id'].filter(name=>!columns[name]).map(name=>`profiles.${name}`),...['all_day'].filter(name=>!scheduleColumns[name]).map(name=>`personal_schedules.${name}`),...requiredCourtColumns.filter(name=>!courtColumns[name]).map(name=>`cat_court_cases.${name}`),...songModeColumns.filter(name=>!itemColumns[name]).map(name=>`blind_box_items.${name}`),...songModeColumns.filter(name=>!drawColumns[name]).map(name=>`draws.${name}`)];
      if(absent.length)return {ok:false,missing:absent};
      return {requiredObjectsPresent:true,courtReadinessColumnsPresent:true,songSurpriseModeColumnsPresent:true,
        userRpcVisible:{courtReady:!!paths['/rpc/duet_cat_court_ready'],editProfile:!!paths['/rpc/duet_edit_profile']},
        functionPermissionsAudit:'supabase/checks/readiness.sql'};
    });
    await check('private-storage',async()=>{const bucket=await request('/storage/v1/bucket/duet-private');if(bucket.public!==false)throw new Error('Bucket must be private');return {private:true};});
    await check('auth-settings',async()=>{
      const settings=await request('/auth/v1/settings',true);
      const publicSignupEnabled=settings.disable_signup===false;
      const emailConfirmationRequired=settings.mailer_autoconfirm===false;
      return {ok:publicSignupEnabled&&emailConfirmationRequired,publicSignupEnabled,emailConfirmationRequired};
    });
    if(process.argv.includes('--ai')) {
      const model=new AIProvider({baseUrl:env.AI_BASE_URL!,key:env.AI_API_KEY!,model:env.AI_MODEL!,visionModel:env.AI_VISION_MODEL});
      await check('text-model',async()=>{await model.complete([{role:'user',content:'Reply with OK. Synthetic connection test; no user data.'}]);return {responded:true};});
      await check('vision-model',async()=>{
        // Synthetic non-private test image, not a user's screenshot or photograph.
        const png=await sharp({create:{width:32,height:32,channels:3,background:'#e90000'}}).png().toBuffer();
        await model.complete([{role:'user',content:[{type:'text',text:'Name the main color in one word.'},{type:'image_url',image_url:{url:`data:image/png;base64,${png.toString('base64')}`}}]}],true);
        return {responded:true,accuracyNotAssessed:true};
      });
    }
  }
  process.exitCode=failed?1:0;
}
void main();
