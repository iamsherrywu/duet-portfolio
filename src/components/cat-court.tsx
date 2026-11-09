'use client';
import {LoadingStatus,StatusText} from './loading-status';

import {useCallback,useEffect,useRef,useState} from 'react';
import Image from 'next/image';
import {requestData} from '../lib/client-api';
import {avatarInitial} from '../lib/avatar-initial';

type Party='plaintiff'|'defendant';
type Statement={id:string;round:number;author_id:string;body:string;created_at:string};
type Task={id:string;assignee:string;kind:string;title:string;plaintiff_done:boolean;defendant_done:boolean;points:number};
export type CourtCase={id:string;plaintiff_id:string;defendant_id:string;status:'open'|'judged';created_at:string;invitation_sent_at:string|null;accepted_at:string|null;plaintiff_ready_at:string|null;defendant_ready_at:string|null;statements:Statement[];verdict:null|{rootCause:string;responsibility:{plaintiff:number;defendant:number};judgment:string;articles:Array<{party:string;name:string;reason:string}>;reconciliation:Array<{assignee:string;kind:string;title:string}>};tasks:Task[]};
type Bundle={temperature:number;cases:CourtCase[]};
const stages=['Opening','First argument','Second argument'];

export function courtCaseTitle(item:CourtCase):string {
  const opening=item.statements.find(statement=>statement.round===0&&statement.author_id===item.plaintiff_id);
  const lines=opening?.body.split(/\r?\n/).map(line=>line.trim()).filter(Boolean)??[];
  const title=lines.find(line=>!/^what happened\??$|^why are you upset\??$/i.test(line));
  if(!title)return `Case · ${new Date(item.created_at).toLocaleDateString('en-US',{month:'short',day:'numeric'})}`;
  const characters=Array.from(title);return characters.length>72?characters.slice(0,72).join('')+'…':title;
}
export function CourtHero({item}:{item:CourtCase}) {
  return <div className={`approved-court-hero ${item.verdict?'is-verdict':''}`}>
    <p className="production-court-meta">{item.status==='judged'?'CASE · CLOSED':'CASE · OPEN'}</p>
    <Image className={`production-court-judge${item.verdict?' is-verdict':''}`} src="/mobile/assets/cat-judge-badge.png" alt="Cat judge holding a gavel and law book" width={134} height={134}/>
    <h2>{courtCaseTitle(item)}</h2>

  </div>;
}

export function courtProgress(item:CourtCase,userId:string){
  const round=[0,1,2].find(n=>item.statements.filter(row=>row.round===n).length<2)??3;
  const ready=!!item.accepted_at&&!!item.plaintiff_ready_at&&!!item.defendant_ready_at;
  const submitted=item.statements.some(row=>row.round===round&&row.author_id===userId);
  return {round,ready,submitted,canSubmit:item.status==='open'&&ready&&round<3&&!submitted};
}
export function CourtReadiness({item,userId,names,busy,onReady}:{item:CourtCase;userId:string;names:Record<Party,string>;busy:boolean;onReady:()=>void}) {
  if(courtProgress(item,userId).ready||item.status==='judged')return null;
  return <section className="production-court-ready" aria-label="Hearing readiness">{(['plaintiff','defendant'] as const).map(party=>{
    const mine=item[`${party}_id`]===userId;const ready=!!item[`${party}_ready_at`];
    return <div key={party}><b>{mine?'You':names[party]} · {party==='plaintiff'?'Plaintiff':'Defendant'}</b><button type="button" disabled={!mine||busy||ready||!item.accepted_at} onClick={onReady}>{ready?'Ready ✓':'Ready'}</button></div>;
  })}</section>;
}
export function CourtStatementColumns({item,userId,names,round,happened,feeling,argument,onHappened,onFeeling,onArgument}:{item:CourtCase;userId:string;names:Record<Party,string>;round:number;happened:string;feeling:string;argument:string;onHappened:(value:string)=>void;onFeeling:(value:string)=>void;onArgument:(value:string)=>void}) {
  const progress=courtProgress(item,userId);
  return <div className="production-court-columns">{(['plaintiff','defendant'] as const).map(party=>{
    const mine=item[`${party}_id`]===userId;const statement=item.statements.find(row=>row.round===round&&row.author_id===item[`${party}_id`]);
    const editing=mine&&progress.canSubmit&&round===progress.round;
    return <section className={`production-court-side is-${party}`} key={party}><p className="production-court-party">{party==='plaintiff'?'PARTY A · PLAINTIFF':'PARTY B · DEFENDANT'}</p><h3>{mine?'You':names[party]}</h3><label>Who are you?<input value={names[party]} readOnly aria-label={`${party==='plaintiff'?'Plaintiff':'Defendant'} name`}/></label>
      {statement?<p className="production-court-statement">{statement.body}</p>:editing?round===0?<><label>What happened?<textarea value={happened} maxLength={2400} onChange={event=>onHappened(event.target.value)} placeholder="Tell the court what happened…"/></label><label>Why are you upset?<textarea value={feeling} maxLength={1500} onChange={event=>onFeeling(event.target.value)} placeholder="How did it make you feel?"/></label></>:<label>Your response<textarea value={argument} maxLength={4000} onChange={event=>onArgument(event.target.value)} placeholder="State your side honestly…"/></label>:<p className="production-court-awaiting">Waiting for {mine?'your statement':names[party]}</p>}
      <small>{statement?'Submitted':editing?'Draft · not yet sent':'Not submitted'}</small>
    </section>;
  })}</div>;
}
function CourtVerdict({item,userId,names,temperature,busy,onComplete}:{item:CourtCase;userId:string;names:Record<Party,string>;temperature:number;busy:boolean;onComplete:(id:string)=>void}){
  const verdict=item.verdict!;const currentParty=item.plaintiff_id===userId?'plaintiff':'defendant';
  return <div className="production-court-verdict" aria-label="Cat Court verdict">
    <section><h3>Root cause</h3><p>{verdict.rootCause}</p></section>
    <section><h3>Responsibility</h3><div className="production-court-responsibility"><span>{names.plaintiff}</span><b>{verdict.responsibility.plaintiff}%</b><span className="production-court-meter"><i style={{width:`${verdict.responsibility.plaintiff}%`}}/></span><b>{verdict.responsibility.defendant}%</b><span>{names.defendant}</span></div>
    </section>
    <section><h3>Ruling</h3><p>{verdict.judgment}</p>{verdict.articles.map((article,index)=><p key={index}><b>{article.name}</b><br/>{article.reason}</p>)}</section>
    <section><h3>Reconciliation tasks</h3>{item.tasks.map(task=>{const done=currentParty==='plaintiff'?task.plaintiff_done:task.defendant_done;return <article className="production-court-task" key={task.id}><b>{task.title}</b><p>{task.assignee==='both'?'Both of you':names[task.assignee as Party]} · +{task.points} connection</p><button type="button" disabled={busy||done} onClick={()=>onComplete(task.id)}>{done?'Confirmed':'Confirm your part'}</button><small>{task.plaintiff_done&&task.defendant_done?'Both confirmed':`Waiting for ${!task.plaintiff_done&&!task.defendant_done?'both confirmations':!task.plaintiff_done?names.plaintiff:names.defendant}`}</small></article>})}</section>
    <section className="production-court-temperature"><h3>Connection temperature</h3><strong>{temperature}°C</strong><progress value={temperature} max={100}/><small>Shared progress · capped at 100°C</small></section>
  </div>;
}

function responsibleParty(verdict:CourtCase['verdict']):Party|null {
  if(!verdict||verdict.responsibility.plaintiff===verdict.responsibility.defendant)return null;
  return verdict.responsibility.plaintiff>verdict.responsibility.defendant?'plaintiff':'defendant';
}
function guardRevealStorageKey(userId:string,caseId:string){return `duet:cat-court:guard-reveal:${userId}:${caseId}`;}
type GuardReveal={key:string;phase:'playing'|'dismissed';canClose:boolean};

function CourtJudging({item,busy,onRetry,canRetry}:{item:CourtCase;busy:boolean;onRetry:()=>void;canRetry:boolean}){
  return <div className="production-court-stage production-court-judging" role="region" aria-label="Cat Court judging">
    <h2>{courtCaseTitle(item)}</h2>
    <div className="production-court-judging-figure"><Image className="production-court-judging-judge" src="/mobile/assets/cat-judge-badge.png" alt="Cat judge striking the gavel" width={184} height={184}/></div>
    <p className="production-court-judging-status" role="status"><span className="duet-loading-spinner" aria-hidden="true"/><span>Judging…</span></p>
    {canRetry&&<button type="button" disabled={busy} onClick={onRetry}>{busy?'Reviewing…':'Retry ruling'}</button>}
  </div>;
}

function CourtWhipReveal({name,responsibility,target,canClose,onClose}:{name:string;responsibility:number;target:Party;canClose:boolean;onClose:()=>void}){
  const [videoFailed,setVideoFailed]=useState(false);const videoRef=useRef<HTMLVideoElement>(null);
  useEffect(()=>{
    if(window.matchMedia('(prefers-reduced-motion: reduce)').matches){setVideoFailed(true);return;}
    const video=videoRef.current;if(!video||videoFailed)return;
    void video.play().catch(()=>setVideoFailed(true));
  },[videoFailed]);
  return <div className="production-court-stage production-court-whip" role="region" aria-label={`Verdict reveal for ${name}`}>
    {canClose&&<button className="production-court-whip-close" type="button" aria-label="Close animation and view the full verdict" onClick={onClose}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>}
    <p className="production-court-meta">THE COURT HAS RULED</p>
    <div className={`production-court-whip-scene targets-${target}`}>
      <div className="production-court-whip-guard">
        <Image className="production-court-whip-poster" src="/mobile/assets/cat-guard-whip-poster.png" alt="" width={418} height={418}/>
        {!videoFailed&&<video ref={videoRef} className="production-court-whip-video" src="/mobile/assets/cat-guard-whip.mp4" poster="/mobile/assets/cat-guard-whip-poster.png" autoPlay muted playsInline preload="auto" aria-hidden="true" onError={()=>setVideoFailed(true)}/>}
      </div>
      <span className="production-court-whip-avatar" role="img" aria-label={`${name}'s avatar`}>{avatarInitial(name)}</span>
    </div>
    <div className="production-court-whip-subject"><h2>{name}</h2><p>{responsibility}% responsibility</p></div>
  </div>;
}

export function CatCourt({onClose,archiveOnly=false,initialCaseId=''}:{onClose?:()=>void;archiveOnly?:boolean;initialCaseId?:string}) {
  const [bundle,setBundle]=useState<Bundle>({temperature:80,cases:[]});const [selected,setSelected]=useState(initialCaseId);const [userId,setUserId]=useState('');
  const [needsPartner,setNeedsPartner]=useState(false),[inviteUrl,setInviteUrl]=useState('');
  const [archivePreviewId,setArchivePreviewId]=useState('');
  const [profiles,setProfiles]=useState<Array<{id:string;display_name:string}>>([]);const [loading,setLoading]=useState(true);
  const [happened,setHappened]=useState('');const [feeling,setFeeling]=useState('');const [argument,setArgument]=useState('');const [viewRound,setViewRound]=useState<number|null>(null);
  const [showVerdict,setShowVerdict]=useState(true);
  const [guardReveal,setGuardReveal]=useState<GuardReveal>({key:'',phase:'dismissed',canClose:true});
  const [judgeRetryAllowedCase,setJudgeRetryAllowedCase]=useState('');
  const [busy,setBusy]=useState(false);const busyRef=useRef(false);const [message,setMessage]=useState('');const requestedVerdict=useRef('');
  const refresh=useCallback(async()=>{const result=await requestData<Bundle>('/api/duet/cat-court/cases');setBundle(result);return result;},[]);
  const load=useCallback(async()=>{
    setLoading(true);setMessage('');
    try{
      const [{data},couple,current]=await Promise.all([import('../lib/supabase/browser').then(({browserClient})=>browserClient().auth.getUser()),requestData<{profiles:Array<{id:string;display_name:string}>;members:Array<{user_id:string}>}>('/api/duet/couple'),refresh()]);
      setUserId(data.user?.id??'');setProfiles(couple.profiles);
      const missingPartner=!couple.members.some(member=>member.user_id!==data.user?.id);setNeedsPartner(missingPartner);if(missingPartner&&!archiveOnly)return;
      if(initialCaseId)setSelected(initialCaseId);
      if(!archiveOnly&&!initialCaseId){
        const existingOpenCase=current.cases.find(item=>item.status==='open');
        if(existingOpenCase)setSelected(existingOpenCase.id);
        else{const opened=await requestData<{id:string}>('/api/duet/cat-court/cases',{method:'POST'});setSelected(opened.id);await refresh();}
      }
    }catch(error){setMessage(error instanceof Error?error.message:'Could not load Cat Court.');}finally{setLoading(false);}
  },[archiveOnly,initialCaseId,refresh]);
  useEffect(()=>{void load();},[load]);
  useEffect(()=>{const timer=window.setInterval(()=>void refresh().catch(()=>undefined),5000);return()=>window.clearInterval(timer);},[refresh]);
  const active=bundle.cases.find(item=>item.id===selected)??(!archiveOnly?bundle.cases.find(item=>item.status==='open'):undefined);
  const archivePreview=bundle.cases.find(item=>item.id===archivePreviewId)??bundle.cases[0];
  const progress=active?courtProgress(active,userId):null;
  const responsible=responsibleParty(active?.verdict??null);
  const revealKey=active&&userId?guardRevealStorageKey(userId,active.id):'';
  const revealPending=!!active?.verdict&&!!responsible&&(!userId||guardReveal.key!==revealKey);
  const checkingRevealIdentity=!!active?.verdict&&!!responsible&&!userId;
  const showWhipReveal=!!active?.verdict&&!!responsible&&!!userId&&(revealPending||(guardReveal.key===revealKey&&guardReveal.phase==='playing'));
  const isJudging=!!active&&active.status==='open'&&progress?.round===3&&!active.verdict;
  const nameFor=(id:string)=>profiles.find(profile=>profile.id===id)?.display_name||'…';
  const names:Record<Party,string>={plaintiff:active?nameFor(active.plaintiff_id):'…',defendant:active?nameFor(active.defendant_id):'…'};
  const otherName=active?nameFor(active.plaintiff_id===userId?active.defendant_id:active.plaintiff_id):'…';
  const submit=useCallback(async(path:string,data?:unknown)=>{
    if(busyRef.current)return false;busyRef.current=true;setBusy(true);setMessage('');
    try{await requestData(path,{method:'POST',headers:{'content-type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})});await refresh();return true;}
    catch(error){setMessage(error instanceof Error?error.message:'Something went wrong. Try again.');return false;}
    finally{busyRef.current=false;setBusy(false);}
  },[refresh]);
  useEffect(()=>{
    if(!active||active.status!=='open'||progress?.round!==3||requestedVerdict.current===active.id||busy)return;
    const finalSubmitter=active.statements.filter(row=>row.round===2).sort((a,b)=>a.created_at.localeCompare(b.created_at)).at(-1)?.author_id;
    if(finalSubmitter!==userId)return;
    requestedVerdict.current=active.id;void submit(`/api/duet/cat-court/cases/${active.id}/verdict`);
  },[active,progress?.round,busy,submit,userId]);
  useEffect(()=>{
    if(!active||!isJudging){setJudgeRetryAllowedCase('');return;}
    const caseId=active.id;const timer=window.setTimeout(()=>setJudgeRetryAllowedCase(caseId),30000);
    return()=>window.clearTimeout(timer);
  },[active?.id,isJudging]);
  useEffect(()=>{setViewRound(null);setShowVerdict(true);setHappened('');setFeeling('');setArgument('');},[active?.id]);
  useEffect(()=>{
    if(!revealKey||!active?.verdict||!responsible)return;
    let alreadyDismissed=false;
    try{alreadyDismissed=window.localStorage.getItem(revealKey)==='dismissed';}catch{}
    if(alreadyDismissed){setGuardReveal({key:revealKey,phase:'dismissed',canClose:true});setShowVerdict(true);return;}
    setGuardReveal({key:revealKey,phase:'playing',canClose:false});
    const timer=window.setTimeout(()=>setGuardReveal(current=>current.key===revealKey?{...current,canClose:true}:current),3000);
    return()=>window.clearTimeout(timer);
  },[revealKey,active?.verdict?.responsibility.plaintiff,active?.verdict?.responsibility.defendant,responsible]);
  const statementText=progress?.round===0?`What happened?\n${happened.trim()}\n\nWhy are you upset?\n${feeling.trim()}`:argument.trim();
  const canSend=progress?.canSubmit&&(progress.round===0?!!happened.trim()&&!!feeling.trim():!!argument.trim())&&statementText.length<=4000;
  const sendStatement=async()=>{if(!active||!progress||!canSend)return;if(await submit(`/api/duet/cat-court/cases/${active.id}/statements`,{round:progress.round,body:statementText})){setHappened('');setFeeling('');setArgument('');setViewRound(null);}};
  const round=Math.min(viewRound??progress?.round??0,2);
  return <section className="production-court approved-c07-c08" aria-label={archiveOnly?'Court Archive':'Cat Court'}>
    {archiveOnly&&active&&<button className="production-court-archive-back approved-d-text-button" type="button" onClick={()=>setSelected('')}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 5-7 7 7 7"/></svg><span>All cases</span></button>}
    {needsPartner&&!archiveOnly&&!loading&&<div className="approved-court-hero"><Image className="production-court-judge" src="/mobile/assets/cat-judge-badge.png" alt="Cat judge" width={134} height={134}/><h2>Waiting for someone to join</h2><p>Invite them to your space first. The hearing starts only when both of you are ready.</p><button type="button" disabled={busy} onClick={()=>{setBusy(true);setMessage('');void requestData<{url:string}>('/api/duet/invitations',{method:'POST'}).then(result=>setInviteUrl(result.url)).catch(error=>setMessage(error.message)).finally(()=>setBusy(false));}}>Invite</button>{inviteUrl&&<div><input aria-label="Invitation link" readOnly value={inviteUrl}/><button type="button" onClick={()=>void navigator.clipboard.writeText(inviteUrl).then(()=>setMessage('Copied.')).catch(()=>setMessage('Select and copy the link.'))}>Copy link</button></div>}<button type="button" disabled={busy} onClick={()=>void load()}>Check again</button></div>}
    {checkingRevealIdentity&&<p className="production-court-reveal-check" role="status"><LoadingStatus/></p>}
    {active&&!isJudging&&!showWhipReveal&&!checkingRevealIdentity&&<CourtHero item={active}/>}
    {loading&&!active&&<p role="status"><LoadingStatus/></p>}
    {isJudging&&active&&<CourtJudging item={active} busy={busy} canRetry={(!busy&&!!message)||(!busy&&judgeRetryAllowedCase===active.id)} onRetry={()=>void submit(`/api/duet/cat-court/cases/${active.id}/verdict`)}/>}
    {showWhipReveal&&active&&responsible&&<CourtWhipReveal key={active.id} name={names[responsible]} responsibility={active.verdict!.responsibility[responsible]} target={responsible} canClose={!!userId&&guardReveal.key===revealKey&&guardReveal.canClose} onClose={()=>{
      if(!revealKey||guardReveal.key!==revealKey||!guardReveal.canClose)return;
      try{window.localStorage.setItem(revealKey,'dismissed');}catch{}
      setGuardReveal({key:revealKey,phase:'dismissed',canClose:true});setShowVerdict(true);
    }}/>}
    {active&&progress&&!isJudging&&!showWhipReveal&&!checkingRevealIdentity&&<>
      {active.status==='open'&&!active.accepted_at&&<div className="production-court-invite">
        <p>{!active.invitation_sent_at?(active.plaintiff_id===userId?`You’re the plaintiff. File this case to invite ${otherName}.`:`Waiting for ${otherName} to file the case.`):active.plaintiff_id===userId?`Waiting for ${otherName} to join from Inbox.`:'Accept the Cat Judge invitation in Inbox to join.'}</p>
        {!active.invitation_sent_at&&active.plaintiff_id===userId&&<button type="button" disabled={busy} onClick={()=>void submit(`/api/duet/cat-court/cases/${active.id}/file`)}>File case &amp; invite {otherName}</button>}
      </div>}
      {active.status==='open'&&!!active.accepted_at&&!progress.ready&&<p className="production-court-intro">{active[`${active.plaintiff_id===userId?'plaintiff':'defendant'}_ready_at`]?`Waiting for ${otherName} to be ready.`:'Both of you must be ready before the hearing begins.'}</p>}
      {active.status==='open'&&<CourtReadiness item={active} userId={userId} names={names} busy={busy} onReady={()=>void submit(`/api/duet/cat-court/cases/${active.id}/ready`)}/>}
      {active.status==='open'&&progress.ready&&<>
        <div className="production-court-session"><h3>Court is in session!</h3><p>Please state your case honestly.</p></div>
        <div className="production-court-rounds" role="tablist" aria-label="Court rounds">{stages.map((stage,index)=><button type="button" role="tab" aria-selected={round===index} disabled={index>progress.round} key={stage} onClick={()=>setViewRound(index)}>{stage}</button>)}</div>
        <CourtStatementColumns item={active} userId={userId} names={names} round={round} happened={happened} feeling={feeling} argument={argument} onHappened={setHappened} onFeeling={setFeeling} onArgument={setArgument}/>
        <p className="production-court-note">Each person submits their own statement. Submitted messages are shared with both of you.</p>
        {progress.round<3&&round===progress.round&&<footer className="production-court-submit"><p role="status">{progress.submitted?`Waiting for ${otherName} to submit.`:''}</p><button type="button" disabled={busy||!canSend} onClick={()=>void sendStatement()}>{progress.submitted?`Waiting for ${otherName}…`:busy?'Submitting…':'Submit to Judge Cat 🐾'}</button></footer>}
      </>}
      {active.verdict&&!showVerdict&&<><div className="production-court-rounds" role="tablist" aria-label="Case statements">{stages.map((stage,index)=><button type="button" role="tab" aria-selected={round===index} key={stage} onClick={()=>setViewRound(index)}>{stage}</button>)}</div><CourtStatementColumns item={active} userId={userId} names={names} round={round} happened="" feeling="" argument="" onHappened={()=>{}} onFeeling={()=>{}} onArgument={()=>{}}/></>}
      {active.verdict&&showVerdict&&(!responsible||!!userId&&guardReveal.key===revealKey&&guardReveal.phase==='dismissed')&&<CourtVerdict item={active} userId={userId} names={names} temperature={bundle.temperature} busy={busy} onComplete={id=>void submit(`/api/duet/cat-court/tasks/${id}`)}/>}
      {active.verdict&&!showVerdict&&<footer className="approved-court-result-footer"><button type="button" onClick={()=>{setShowVerdict(value=>!value);if(showVerdict)setViewRound(0);}}>{showVerdict?'Back to case':'View ruling'}</button>{onClose&&!showVerdict&&<button type="button" onClick={onClose}>Back to Chat</button>}</footer>}
    </>}
    {archiveOnly&&!active&&<div className="approved-d-archive">{!bundle.cases.length&&!loading&&<p className="approved-d-muted">No cases yet.</p>}{bundle.cases.map(item=><button key={item.id} type="button" className="approved-d-archive-item" aria-pressed={archivePreview?.id===item.id} onClick={()=>setArchivePreviewId(item.id)}><span className="approved-d-archive-date">{new Date(item.created_at).toLocaleDateString('en-US',{month:'short',day:'2-digit'}).toUpperCase()}</span><span><b>{courtCaseTitle(item)}</b><small>{item.status==='judged'?'Ruled':item.invitation_sent_at?'In progress':'Draft'}</small></span><span aria-hidden="true">›</span></button>)}{archivePreview&&<section className="approved-d-panel approved-d-archive-result"><p className="approved-d-eyebrow">SELECTED CASE · {new Date(archivePreview.created_at).toLocaleDateString('en-US',{month:'short',day:'2-digit'}).toUpperCase()}</p><h3>{courtCaseTitle(archivePreview)}</h3>{archivePreview.verdict?<><p className="approved-d-archive-excerpt">Root cause: {archivePreview.verdict.rootCause}</p><p className="approved-d-archive-excerpt">Ruling: {archivePreview.verdict.judgment}</p></>:<p>No ruling yet.</p>}<button type="button" className="approved-d-text-button" onClick={()=>setSelected(archivePreview.id)}>{archivePreview.verdict?'View full ruling':'View case'}</button></section>}</div>}
    {message&&<p className="production-court-message" role="status">{<StatusText value={message}/>}{!active&&<button type="button" onClick={()=>void load()}>Retry</button>}</p>}
  </section>;
}
