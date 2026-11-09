import { z } from 'zod';

const party=z.enum(['plaintiff','defendant']);
const task=z.object({assignee:z.enum(['plaintiff','defendant','both']),kind:z.enum(['reconcile','affection','agreement']),title:z.string().trim().min(1).max(240)}).strict();
const verdictSchema=z.object({
  rootCause:z.string().trim().min(1).max(2000),
  responsibility:z.object({plaintiff:z.number().int().min(0).max(100),defendant:z.number().int().min(0).max(100)}).strict(),
  judgment:z.string().trim().min(1).max(3000),
  articles:z.array(z.object({party,name:z.string().trim().min(1).max(120),reason:z.string().trim().min(1).max(1000)}).strict()).min(1).max(6),
  reconciliation:z.array(task).min(1).max(8),
}).strict().superRefine((value,ctx)=>{
  if(value.responsibility.plaintiff+value.responsibility.defendant!==100)ctx.addIssue({code:'custom',path:['responsibility'],message:'Responsibility percentages must total 100.'});
});
export type CatCourtVerdict=z.infer<typeof verdictSchema>;
export type CatCourtTask=z.infer<typeof task>;
export function parseCatCourtVerdict(text:string):CatCourtVerdict {
  try{return verdictSchema.parse(JSON.parse(text.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'')));}
  catch{throw new Error('invalid_cat_court_verdict');}
}
export function rewardForTask(kind:CatCourtTask['kind']) {return kind==='reconcile'?8:kind==='affection'?2:3;}
export function addTemperaturePoints(current:number,points:number) {return Math.min(100,Math.max(0,Math.trunc(current)+Math.max(0,Math.trunc(points))));}
