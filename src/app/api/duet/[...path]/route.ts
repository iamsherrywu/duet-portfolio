import {feedbackRoutes} from '../../../../lib/server/feedback';
import { type NextRequest } from 'next/server';
import { assertOrigin, failure, AppError } from '../../../../lib/server/http';
import { requireUser, rateLimit, siteUrl } from '../../../../lib/supabase/server';
import {accountRoutes} from '../../../../lib/server/account-deletion';
import { core } from '../../../../lib/server/core';
import { aiRoutes } from '../../../../lib/server/agent';
import { mediaRoutes } from '../../../../lib/server/media';
import { datePlanningRoutes } from '../../../../lib/server/date-planning';
import { catCourtRoutes } from '../../../../lib/server/cat-court';
import {sharedAgentRoutes} from '../../../../lib/server/shared-agent';
import {weeklyDateRoutes} from '../../../../lib/server/weekly-date';
import {personalScheduleRoutes} from '../../../../lib/server/personal-schedules';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
type Params={params:Promise<{path:string[]}>};
async function handle(request:NextRequest,{params}:Params) {
  try {
    assertOrigin(request,siteUrl());
    const ctx=await requireUser(request); const {path}=await params;
    if(request.method!=='GET')await rateLimit(ctx);
    for(const handler of [feedbackRoutes,accountRoutes,personalScheduleRoutes,core,aiRoutes,mediaRoutes,datePlanningRoutes,catCourtRoutes,sharedAgentRoutes,weeklyDateRoutes]) {
      const response=await handler(request,path,ctx);if(response)return response;
    }
    throw new AppError(404,'not_found','Endpoint not found.');
  } catch(error) {return failure(error);}
}
export const GET=handle;
export const POST=handle;
export const PATCH=handle;
export const DELETE=handle;
