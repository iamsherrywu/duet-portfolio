import {requireUser,requireCouple} from '../../../../lib/supabase/server';
import {failure} from '../../../../lib/server/http';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{const ctx=await requireUser(request);await requireCouple(ctx);return Response.json({key:process.env.AMAP_JS_KEY&&process.env.AMAP_SECURITY_CODE?process.env.AMAP_JS_KEY:null},{headers:{'Cache-Control':'private, no-store'}});}catch(e){return failure(e);}}
