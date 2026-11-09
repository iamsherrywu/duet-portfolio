import { createHash, timingSafeEqual } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError, databaseError, failure, ok } from '../../../../lib/server/http';
import { adminClient } from '../../../../lib/supabase/server';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;

export type ExpiredLocationSnap={id:string;mediaId:string;path:string};
export type LocationSnapCleanupRepository={
  listExpired():Promise<ExpiredLocationSnap[]>;
  removeObjects(paths:string[]):Promise<void>;
  deleteExpired(ids:string[]):Promise<number>;
};

function safeSecretMatch(provided:string,expected:string) {
  const providedDigest=createHash('sha256').update(provided).digest();
  const expectedDigest=createHash('sha256').update(expected).digest();
  const equal=timingSafeEqual(providedDigest,expectedDigest);
  return equal && Buffer.byteLength(provided)===Buffer.byteLength(expected);
}

export function supabaseRepository(createAdmin:()=>SupabaseClient=adminClient):LocationSnapCleanupRepository {
  return {
    async listExpired() {
      const db=createAdmin();
      const {error:moodError}=await db.rpc('duet_purge_expired_moods');
      databaseError(moodError);
      const {data,error}=await db.rpc('duet_claim_media_cleanup');
      databaseError(error);
      return (data??[]).map((row:{media_id:string;path:string})=>({id:row.media_id,mediaId:row.media_id,path:row.path}));
    },
    async removeObjects(paths) {
      if(!paths.length)return;
      const db=createAdmin();
      const {error}=await db.storage.from('duet-private').remove(paths);
      if(error)throw new AppError(503,'cleanup_pending','Snap files could not be cleaned up. We will retry later.');
    },
    async deleteExpired(ids) {
      if(!ids.length)return 0;
      const db=createAdmin();
      const {data,error}=await db.rpc('duet_finish_media_cleanup',{p_media_ids:ids});
      databaseError(error);
      return typeof data==='number'?data:0;
    },
  };
}

export function createLocationSnapCleanupPost(deps:{secret:string|undefined;repository:LocationSnapCleanupRepository;header?:'authorization'|'x-cron-secret'}) {
  return async function POST(request:Request) {
    if(!deps.secret)return failure(new AppError(503,'not_configured','Snap cleanup is not configured.'));
    const provided=request.headers.get(deps.header??'x-cron-secret')??'';
    if(!safeSecretMatch(provided,deps.secret))return failure(new AppError(401,'unauthorized','Cleanup authentication failed.'));
    try {
      const expired=await deps.repository.listExpired();
      if(!expired.length)return ok({deleted:0});
      await deps.repository.removeObjects(expired.map(snap=>snap.path));
      const deleted=await deps.repository.deleteExpired(expired.map(snap=>snap.id));
      return ok({deleted});
    } catch(error) {
      if(error instanceof AppError)return failure(error);
      return failure(new AppError(503,'cleanup_pending','Snaps could not be cleaned up. We will retry later.'));
    }
  };
}

export const POST=createLocationSnapCleanupPost({
  secret:process.env.CRON_SECRET,
  repository:supabaseRepository(),
});

// Vercel Cron sends GET with Authorization: Bearer CRON_SECRET.
export const GET=createLocationSnapCleanupPost({
  secret:process.env.CRON_SECRET?`Bearer ${process.env.CRON_SECRET}`:undefined,
  header:'authorization',
  repository:supabaseRepository(),
});
