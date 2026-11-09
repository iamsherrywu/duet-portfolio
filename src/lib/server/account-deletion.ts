import {z} from 'zod';
import {adminClient,type Context} from '../supabase/server';
import {AppError,databaseError,ok,readJson} from './http';

type Deps={hasSharedSpace:(userId:string)=>Promise<boolean>;deleteOwnAccount:(userId:string)=>Promise<void>};
const confirmation=z.object({confirmation:z.literal('DELETE ACCOUNT')}).strict();
function accountDeps():Deps {
 const admin=adminClient();
 return {
  async hasSharedSpace(userId){const {data,error}=await admin.from('couple_members').select('couple_id').eq('user_id',userId).maybeSingle();databaseError(error);return !!data;},
  async deleteOwnAccount(userId){const {error}=await admin.auth.admin.deleteUser(userId);if(error)throw new AppError(503,'account_deletion_pending','Could not delete your account. Try again.');},
 };
}
export async function deleteOwnAccount(request:Request,userId:string,deps:Deps) {
 await readJson(request,confirmation);
 // A shared space must first complete the existing two-person consent and file cleanup.
 // Foreign keys also prevent deletion if a concurrent request joins/creates a space.
 if(await deps.hasSharedSpace(userId))throw new AppError(409,'shared_space_exists','Dissolve your shared space first. Both accounts must confirm.');
 await deps.deleteOwnAccount(userId);
 return ok({deleted:true});
}
export async function accountRoutes(request:Request,path:string[],ctx:Context):Promise<Response|null> {
 if(path.join('/')!=='account/delete'||request.method!=='POST')return null;
 return deleteOwnAccount(request,ctx.user.id,accountDeps());
}
