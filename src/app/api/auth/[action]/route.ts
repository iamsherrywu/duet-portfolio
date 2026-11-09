import { type NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ok, failure, readJson, assertOrigin, AppError } from '../../../../lib/server/http';
import { adminClient, cookieUserClient, siteUrl } from '../../../../lib/supabase/server';
import { createAuthDeps, registerInviteSchema, registerWithInvite, signInSchema, signInWithPassword } from '../../../../lib/server/auth';

export const runtime='nodejs';
export const dynamic='force-dynamic';
type AuthRouteDeps = {
  adminClient(): SupabaseClient;
  cookieUserClient(): Promise<SupabaseClient>;
  siteUrl(): string;
};
type AuthParams = { params: Promise<{ action: string }> };

export function createAuthPost(deps: AuthRouteDeps) {
  return async function authPost(request: NextRequest, {params}: AuthParams) {
    try {
      assertOrigin(request,deps.siteUrl());const {action}=await params;
      if(action==='sign-out') {
        const db=await deps.cookieUserClient();
        const {error}=await db.auth.signOut({scope:'local'});
        if(error)throw new AppError(503,'sign_out_unavailable','Unable to sign out. Please try again.');
        return ok({signedOut:true});
      }
      if(action==='sign-in') {
        const input=await readJson(request,signInSchema);
        const authDeps=createAuthDeps(deps.adminClient(),await deps.cookieUserClient());
        return ok({user:await signInWithPassword(authDeps,input)});
      }
      if(action==='register-invite') {
        const input=await readJson(request,registerInviteSchema);
        const authDeps=createAuthDeps(deps.adminClient(),await deps.cookieUserClient());
        const result=await registerWithInvite(authDeps,input);
        return ok({user:{id:result.id,email:result.email},coupleId:result.coupleId},201);
      }
      throw new AppError(404,'not_found','Endpoint not found.');
    } catch(error) {return failure(error);}
  };
}
export const POST=createAuthPost({adminClient,cookieUserClient,siteUrl});
