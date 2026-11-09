'use client';
import {OnlinePresence} from './online-presence';
import {LoadingStatus,StatusText} from './loading-status';

import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import {MainNavigation} from './main-navigation';
import { AbstractMap } from './abstract-map';
import { LocationShare } from './location-share';
import { LocationStories } from './location-stories';
import { ProfileSettings } from './profile-settings';
import { SharedCalendar } from './shared-calendar';
import { StoryViewer } from './story-viewer';
import { requestData } from '../lib/client-api';
import { DatePlanner } from './date-planner';
import { CatCourt } from './cat-court';
import { AuthEntry,PairingSetup,HostInvitationSetup,ProfileSetup } from './account-onboarding';
import { accountStep } from '../lib/onboarding';
import {useAccount,accountToolsLabel,type AccountState} from './use-account';
import {HomeHeroVideo} from './home-hero-video';
import {HomeSpace,BlindBoxInbox,type InboxPage} from './home-space';
import {PetSettings,PetSetup} from './pet-selection';
import {PersonalAgent} from './personal-agent';
import {WeeklyDate} from './weekly-date';
import {AccountDeletion} from './account-deletion';
import {SpaceSettings} from './space-settings';
import {PetShowcase} from './pet-showcase';

type Tab='home'|'chat'|'calendar'|'me';
type MePage='profile'|'inbox'|'pets'|'court-archive'|'account'|'account-options'|'feedback';
type Selection={authorId?:string;snapId?:string};
const meTitles:Record<MePage,string>={profile:'Profile',inbox:'Inbox',pets:'Pets','court-archive':'Court Archive',account:'Space','account-options':'Account options',feedback:'Feedback'};

export function PageHeader({title,onBack}:{title:string;onBack:()=>void}) {
  return <header className="shell-page-header"><button type="button" className="shell-back" aria-label="Back" onClick={onBack}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 5-7 7 7 7"/></svg></button><h1>{title}</h1><span aria-hidden="true"/></header>;
}
export function WorkspaceNavigation({active,unread=0,onSelect}:{active:Tab;unread?:number;onSelect:(tab:Tab)=>void}) {
  return <MainNavigation active={active} unread={unread} onSelect={onSelect}/>;
}
export function MeMenu({unread,onOpen}:{unread:number;onOpen:(page:MePage)=>void}) {
  return <div className="shell-me-menu">{(['inbox','pets','court-archive','account','feedback'] as MePage[]).map(page=><button type="button" key={page} onClick={()=>onOpen(page)}><span>{meTitles[page]}</span><span className="shell-menu-trailing">{page==='inbox'&&unread>0&&<span className="shell-unread">{unread}</span>}<span aria-hidden="true">›</span></span></button>)}</div>;
}
export function feedbackMailUrl(topic:string,body:string) {
  return `mailto:owner@example.com?subject=Duet%20feedback&body=${encodeURIComponent(`Topic: ${topic}\n\n${body.trim()}`)}`;
}
export function FeedbackForm() {
  const [topic,setTopic]=useState('Something else');const [body,setBody]=useState('');
  const [busy,setBusy]=useState(false),[result,setResult]=useState(''),[nonce,setNonce]=useState(()=>crypto.randomUUID());
  return <section className="approved-d-feedback"><p className="approved-d-eyebrow">HELP US MAKE DUET BETTER</p><form className="shell-feedback approved-d-panel" onSubmit={event=>{event.preventDefault();if(!body.trim()||busy)return;setBusy(true);setResult('');void requestData<{saved:boolean;emailed:boolean}>('/api/duet/feedback',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({topic,body,nonce})}).then(data=>{setResult(data.emailed?'Feedback sent. Thank you!':'Feedback saved. Email delivery is pending.');setBody('');setNonce(crypto.randomUUID());}).catch(()=>setResult('Could not submit. Please try again.')).finally(()=>setBusy(false));}}><label htmlFor="feedback-topic">Topic<select id="feedback-topic" value={topic} onChange={event=>setTopic(event.target.value)}>{['Something else','A screen or feature','A problem','An idea'].map(value=><option key={value}>{value}</option>)}</select></label><label htmlFor="feedback-body">Your message<textarea id="feedback-body" value={body} onChange={event=>setBody(event.target.value)} rows={6} maxLength={2000} required placeholder="What would you like us to know?"/></label><button type="submit" className="approved-d-primary" disabled={busy||!body.trim()}>{busy?'Submitting…':'Submit'}</button><small>{result}</small></form></section>;
}

export function DuetWorkspace() {
  const account=useAccount();return <><OnlinePresence key={account.userId??'anonymous'} enabled={!!account.userId&&!!account.data?.couple?.coupleId}/><WorkspaceSession key={account.userId??'anonymous'} account={account}/></>;
}
export function WorkspaceSession({account}:{account:AccountState}) {
  const {userId,data,error,refresh:refreshAccount}=account;const profile=data?.profile;const couple=data?.couple;
  const [inviteSetupDone,setInviteSetupDone]=useState(false);
  const [inviteUrl,setInviteUrl]=useState('');const [inviting,setInviting]=useState(false);
  const [tab,setTab]=useState<Tab>('home');
  const [chatView,setChatView]=useState<'chat'|'map'|'agent'>('chat');
  const [mePage,setMePage]=useState<MePage|null>(null);
  const [calendarView,setCalendarView]=useState<'month'|'assistant'>('month');
  const [calendarDetailsOpen,setCalendarDetailsOpen]=useState(false);
  const [dateSeed,setDateSeed]=useState('');
  const [unread,setUnread]=useState(0);
  const refreshInbox=useCallback(async()=>{if(!couple?.coupleId)return;try{const page=await requestData<InboxPage>('/api/duet/inbox');setUnread(page.unreadCount);}catch{/* The inbox itself exposes load failures and retry. */}},[couple?.coupleId]);
  useEffect(()=>{void refreshInbox();if(!couple?.coupleId)return;const timer=window.setInterval(()=>void refreshInbox(),30000);return()=>window.clearInterval(timer);},[refreshInbox,couple?.coupleId]);
  const [selection,setSelection]=useState<Selection|null>(null);
  const [storiesRevision,setStoriesRevision]=useState(0);
  const [calendarRevision,setCalendarRevision]=useState(0);
  const [showCatCourt,setShowCatCourt]=useState(false);const [courtCaseId,setCourtCaseId]=useState('');
  const [message,setMessage]=useState('');
  const signOut=async()=>{try{await account.signOut();}catch(error){setMessage(error instanceof Error?error.message:'Could not sign out. Try again.');}};
  const tools=<header className="shell-session-tools"><span>{accountToolsLabel(account)}</span><button type="button" onClick={()=>void signOut()}>Sign out</button>{message&&<p role="status">{<StatusText value={message}/>}</p>}</header>;
  useEffect(()=>{const navigate=(event:Event)=>{const next=(event as CustomEvent).detail;if(['home','chat','calendar','me'].includes(next)){setTab(next);setChatView('chat');setShowCatCourt(false);setCalendarView('month');setMePage(null);setMessage('');}};window.addEventListener('duet:navigate',navigate);return()=>window.removeEventListener('duet:navigate',navigate);});
  if(userId===undefined)return <main className="shell-loading"><p role="status">{error||<LoadingStatus/>}</p></main>;
  if(userId===null)return <AuthEntry/>;
  if(!profile||!couple)return <main className="shell-loading">{tools}<p role="status">{error||<LoadingStatus/>}</p>{error&&<button type="button" onClick={()=>void refreshAccount()}>Retry</button>}</main>;
  if(couple.status==='deletion_approved')return <main className="shell-loading">{tools}<SpaceSettings userId={userId} onDeleted={()=>void refreshAccount()}/></main>;
  const step=accountStep({userId,profile,coupleId:couple.coupleId});
  if(step==='profile')return <main>{tools}<ProfileSetup onComplete={()=>void refreshAccount()}/></main>;
  if(step==='pair')return <main>{tools}{couple.canCreateSpace?<HostInvitationSetup onComplete={()=>{setInviteSetupDone(true);void refreshAccount();}}/>:<PairingSetup onComplete={()=>void refreshAccount()}/>}<AccountDeletion/></main>;
  if(couple.isHost&&couple.members.length===1&&!data.pets.some(pet=>pet.owner_id===userId)&&!inviteSetupDone)return <main>{tools}<HostInvitationSetup existingCouple onComplete={()=>setInviteSetupDone(true)}/></main>;
  if(!data.pets.some(pet=>pet.owner_id===userId))return <main>{tools}<PetSetup userId={userId} pets={data.pets} onComplete={()=>refreshAccount()}/></main>;

  const invite=async()=>{setInviting(true);setMessage('');try{const result=await requestData<{url:string}>('/api/duet/invitations',{method:'POST'});setInviteUrl(result.url);setMessage('Invitation created. Valid for 24 hours.');}catch(error){setMessage(error instanceof Error?error.message:'Could not create invitation.');}finally{setInviting(false);}};
  const openCourt=(caseId?:string)=>{setTab('chat');setChatView('chat');setCourtCaseId(caseId??'');setShowCatCourt(true);setMePage(null);};
  const openPlanner=()=>{setCalendarView('assistant');setTab('calendar');};
  const selectTab=(next:Tab)=>{setTab(next);setChatView('chat');setShowCatCourt(false);setCalendarView('month');setMePage(null);setMessage('');void refreshInbox();};

  const subpage=tab==='me'?mePage!==null:tab==='chat'?chatView!=='chat'||showCatCourt:tab==='calendar'&&calendarView==='assistant';
  const copyInvite=async()=>{try{await navigator.clipboard.writeText(inviteUrl);setMessage('Link copied.');}catch{setMessage('Select the link and copy it.');}};
  const shareInvite=async()=>{try{if(navigator.share)await navigator.share({title:'DUET invitation',url:inviteUrl});else await copyInvite();}catch(error){if(!(error instanceof DOMException&&error.name==='AbortError'))setMessage('Could not share. Copy the link instead.');}};
  const invitation=<section className="approved-d-account"><p className="approved-d-eyebrow">YOUR ACCOUNT</p><div className="approved-d-panel"><p className="approved-d-eyebrow">INVITATION LINK</p><p>Create a private link for someone to join your shared space.</p><div className="approved-d-invite-link"><input aria-label="Invitation link" readOnly value={inviteUrl} placeholder="Create an invitation link"/><button type="button" disabled={!inviteUrl} onClick={()=>void copyInvite()}>Copy</button><button type="button" disabled={!inviteUrl} onClick={()=>void shareInvite()}>Share</button></div><small>Invitation links expire after 24 hours.</small></div><button type="button" className="approved-d-account-option" onClick={()=>{setMePage('account-options');setMessage('');}}>Account and shared space options <span aria-hidden="true">›</span></button><footer className="approved-d-account-footer"><button type="button" className="approved-d-primary" disabled={inviting||!couple.isHost||couple.members.length>=2} onClick={()=>void invite()}>{inviting?'Creating…':'Create'}</button>{couple.members.length>=2&&<p className="approved-d-muted">Your space already has two accounts.</p>}{!couple.isHost&&<p className="approved-d-muted">The host manages invitation links.</p>}</footer></section>;

  return <main className={`duet-production-shell view-${tab}${subpage?' is-subpage':''}`}>
    <div className="shell-home-view" hidden={tab!=='home'}>
      <header className="home-header shell-home-header"><span aria-hidden="true"/><div className="home-brand"><h1>DUET</h1></div><div className="home-header-actions"></div></header>
      <HomeHeroVideo active={tab==='home'}/>
      <HomeSpace active={tab==='home'} userId={userId} onInbox={()=>{setTab('me');setMePage('inbox');}} onChanged={()=>void refreshInbox()}/>
    </div>
    {message&&<p className="shell-status" role="status">{<StatusText value={message}/>}</p>}
    {tab==='chat'&&<div className="shell-chat-view">
      {chatView==='map'?<><PageHeader title="Location" onBack={()=>setChatView('chat')}/><div className="shell-page-body shell-map"><AbstractMap refreshKey={storiesRevision} onOpenStory={setSelection}/><LocationShare onChanged={()=>setStoriesRevision(v=>v+1)}/></div></>:chatView==='agent'?<PersonalAgent onBack={()=>setChatView('chat')}/>:showCatCourt?<><PageHeader title="Cat Court" onBack={()=>setShowCatCourt(false)}/><div className="shell-page-body shell-court"><CatCourt initialCaseId={courtCaseId} onClose={()=>setShowCatCourt(false)}/></div></>:<LocationStories refreshKey={storiesRevision} onOpenStory={setSelection} onOpenCourt={openCourt} onOpenMap={()=>setChatView('map')} onOpenAgent={()=>setChatView('agent')} onPlanDate={text=>{setDateSeed(text);openPlanner();}}/>}
    </div>}
    {tab==='calendar'&&(calendarView==='assistant'?<><PageHeader title="Date Proposal" onBack={()=>setCalendarView('month')}/><div className="shell-page-body shell-planner"><DatePlanner userId={userId} initialRequirements={dateSeed} onCalendarChanged={()=>setCalendarRevision(value=>value+1)}/></div></>:<div className="shell-calendar-view"><SharedCalendar key={calendarRevision} userId={userId} detailsOpen={calendarDetailsOpen} onToggleDetails={()=>setCalendarDetailsOpen(open=>!open)} onOpenAssistant={openPlanner} petContent={<PetShowcase userId={userId} timezone={profile.timezone||'Asia/Shanghai'} active={tab==='calendar'}/>} detailsContent={<div className="calendar-tools-content"><WeeklyDate onOpenAssistant={openPlanner}/></div>}/></div>)}
    {tab==='me'&&(mePage?<><PageHeader title={meTitles[mePage]} onBack={()=>{setMePage(mePage==='account-options'?'account':null);setMessage('');void refreshAccount();void refreshInbox();}}/><div className={`shell-page-body shell-me-${mePage}`}>
      {mePage==='profile'&&<ProfileSettings onSaved={()=>void refreshAccount()}/>}
      {mePage==='inbox'&&<BlindBoxInbox onChanged={()=>void refreshInbox()} onOpenCourt={openCourt}/>}
      {mePage==='pets'&&<PetSettings userId={userId} defaultOpen/>}
      {mePage==='court-archive'&&<CatCourt archiveOnly/>}
      {mePage==='account'&&invitation}
      {mePage==='account-options'&&<section className="approved-d-account-options"><p className="approved-d-muted">Shared-space changes require confirmation from both accounts.</p><SpaceSettings userId={userId} onDeleted={()=>void refreshAccount()} appearance="card"/><AccountDeletion appearance="card"/><button className="shell-sign-out approved-d-text-button" type="button" onClick={()=>void signOut()}>Sign out</button></section>}
      {mePage==='feedback'&&<FeedbackForm/>}
    </div></>:<section className="shell-me-view"><LocationStories mode="me" refreshKey={storiesRevision} onOpenStory={setSelection} onOpenProfile={()=>setMePage('profile')}/><MeMenu unread={unread} onOpen={setMePage}/></section>)}
    <WorkspaceNavigation active={tab} unread={unread} onSelect={selectTab}/>
    <StoryViewer key={selection?.snapId??selection?.authorId??'closed'} selection={selection} onClose={()=>{setSelection(null);setStoriesRevision(value=>value+1);}} onSaved={()=>setCalendarRevision(value=>value+1)}/>
  </main>;
}
