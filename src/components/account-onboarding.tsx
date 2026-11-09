'use client';
import {LoadingStatus,StatusText} from './loading-status';

import {useState,type ReactNode} from 'react';
import {MainNavigation} from './main-navigation';
import {inviteTokenFromInput} from '../lib/onboarding';
import {ClientApiError,requestData} from '../lib/client-api';

type ProfileInput={displayName:string;gender:''|'male'|'female'|'other'|'prefer_not_to_say';birthday:string;clownRole?:'clown_boy'|'clown_girl'};
const profilePayload=(profile:ProfileInput)=>({...profile,...(['other','prefer_not_to_say'].includes(profile.gender)?{clownRole:profile.clownRole||'clown_boy'}:{})});
const blankProfile=():ProfileInput=>({displayName:'',gender:'',birthday:''});
const json=(body:unknown)=>({method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});

export function OnboardingHeader({title,onBack,backHref}:{title:string;onBack?:()=>void;backHref?:string}){
  const icon=<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 5-7 7 7 7"/></svg>;
  return <header className="onboarding-header">{onBack?<button type="button" aria-label="Back" onClick={onBack}>{icon}</button>:backHref?<a href={backHref} aria-label="Back">{icon}</a>:<span aria-hidden="true"/>}<h1>{title}</h1><span aria-hidden="true"/></header>;
}
export function OnboardingState({title,heading,children,state='neutral'}:{title:string;heading?:string;children:ReactNode;state?:'neutral'|'loading'|'error'|'joined'}){
  const invitation=title==='Invitation status';
  if(state==='loading')return <main className="shell-loading"><LoadingStatus/></main>;
  return <main className={`onboarding-screen approved-ef onboarding-state is-${state}`} data-approved-screen={invitation?'E06':undefined}><OnboardingHeader title={title} backHref="/"/><div className="onboarding-body"><section className="onboarding-state-card"><span className="onboarding-state-symbol" aria-hidden="true">{state==='error'?'!':state==='joined'?'✓':'♡'}</span>{heading&&<h3>{heading}</h3>}{children}</section></div><MainNavigation onSelect={()=>window.location.assign('/')}/></main>;
}
function InvitationUnavailable({message,onRetry}:{message:string;onRetry?:()=>void}){
  return <OnboardingState title="Invitation status" heading="Invitation unavailable" state="error"><p role="alert">{<StatusText value={message}/>}</p><p>Ask for a new invitation link.</p>{onRetry?<button className="onboarding-primary" type="button" onClick={onRetry}>Use another invitation</button>:<a className="onboarding-primary" href="/">Back to sign in</a>}</OnboardingState>;
}
function Progress({step}:{step:number}){return <div className="onboarding-progress" aria-label={`Step ${step} of 3`}>{[1,2,3].map(value=><span key={value} className={value===step?'is-active':value<step?'is-done':undefined}/>)}</div>;}
function ProfileFields({value,onChange}:{value:ProfileInput;onChange:(value:ProfileInput)=>void}) {
  return <div className="onboarding-profile-fields">
    <label>Name<input required maxLength={40} autoComplete="nickname" placeholder="Your name" value={value.displayName} onChange={event=>onChange({...value,displayName:event.target.value})}/></label>
    <label>Gender<select required value={value.gender} onChange={event=>onChange({...value,gender:event.target.value as ProfileInput['gender'],clownRole:undefined})}><option value="">Choose</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option><option value="prefer_not_to_say">Prefer not to say</option></select></label>
    <label>Birthday<input required type="date" autoComplete="bday" value={value.birthday} onChange={event=>onChange({...value,birthday:event.target.value})}/><small>Visible only to you and your partner.</small></label>
  </div>;
}
function InvitationEntry(){
  const [invite,setInvite]=useState('');const [error,setError]=useState('');
  return <details className="onboarding-invite-entry"><summary>Create an account</summary><form onSubmit={event=>{event.preventDefault();const token=inviteTokenFromInput(invite);if(!token){setError('Paste the full invitation link.');return;}window.location.assign(`/invite/${token}`);}}><label>Invitation link<input required value={invite} onChange={event=>{setInvite(event.target.value);setError('');}} placeholder="Paste your invitation link" autoComplete="off"/></label><button type="submit" className="onboarding-secondary">Continue</button>{error&&<p className="onboarding-message" role="alert">{error}</p>}</form></details>;
}

export function AuthEntry({inviteToken}:{inviteToken?:string}) {
  const [register,setRegister]=useState(!!inviteToken);const [profileStep,setProfileStep]=useState(false);const [retryPassword,setRetryPassword]=useState(false);const [email,setEmail]=useState('');const [password,setPassword]=useState('');
  const [profile,setProfile]=useState<ProfileInput>(blankProfile);const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');const [invitationError,setInvitationError]=useState('');
  const submit=async()=>{
    if(register&&!profileStep){setProfileStep(true);setMessage('');return;}
    setBusy(true);setMessage('');
    try {
      if(register&&inviteToken)await requestData('/api/auth/register-invite',json({email,password,inviteToken,...profilePayload(profile)}));
      else await requestData('/api/auth/sign-in',json({email,password}));
      setPassword('');setProfile(blankProfile());
      window.location.assign(register?'/':inviteToken?`/invite/${inviteToken}`:'/');
    }catch(error){setPassword('');setRetryPassword(true);if(error instanceof ClientApiError&&error.code==='invalid_invitation')setInvitationError(error.message);else setMessage(error instanceof Error?error.message:'Could not sign in. Try again.');}finally{setBusy(false);}
  };
  if(invitationError)return <InvitationUnavailable message={invitationError}/>;
  if(register&&profileStep)return <main className="onboarding-screen approved-ef" data-approved-screen="E03"><OnboardingHeader title="Your profile" onBack={()=>setProfileStep(false)}/><div className="onboarding-body"><Progress step={2}/><p className="onboarding-eyebrow">STEP 2 OF 3</p><h2>Set up your profile</h2><p className="onboarding-muted">A few details help Duet feel like yours.</p><form className="onboarding-form" onSubmit={event=>{event.preventDefault();void submit();}}><ProfileFields value={profile} onChange={setProfile}/>{retryPassword&&<label>Password<input required type="password" minLength={8} maxLength={128} autoComplete="new-password" value={password} onChange={event=>setPassword(event.target.value)}/></label>}<p className="onboarding-message" role={message?'alert':'status'}>{<StatusText value={message}/>}</p><button className="onboarding-primary" disabled={busy}>{busy?'Processing…':'Save and continue'}</button></form></div><MainNavigation onSelect={()=>setProfileStep(false)}/></main>;
  return <main className={`onboarding-screen approved-ef auth-entry${register?' is-register':''}`} data-approved-screen={register?'E02':'E01'}><OnboardingHeader title={register?'Accept invitation':'Sign in'} onBack={()=>window.history.back()}/><div className="onboarding-body">
    <div className="onboarding-brand" aria-label="Duet">DUET</div>
    {register?<div className="onboarding-invite-banner"><span aria-hidden="true">♡</span><div><strong>You’re invited</strong><small>Join your private shared space.</small></div></div>:<><p className="onboarding-eyebrow is-centered">WELCOME TO YOUR SPACE</p></>}
    <form onSubmit={event=>{event.preventDefault();void submit();}} className="onboarding-form">
      <label>Email<input required type="email" autoComplete="email" placeholder="you@example.com" disabled={busy} value={email} onChange={event=>setEmail(event.target.value)}/></label>
      <label>Password<input required type="password" minLength={8} maxLength={128} placeholder={register?'At least 8 characters':'Enter your password'} disabled={busy} autoComplete={register?'new-password':'current-password'} value={password} onChange={event=>setPassword(event.target.value)}/></label>
      {register&&<label>Name<input required maxLength={40} autoComplete="nickname" placeholder="Your name" disabled={busy} value={profile.displayName} onChange={event=>setProfile({...profile,displayName:event.target.value})}/></label>}
      <p className="onboarding-message" role={message?'alert':'status'} aria-live="polite">{<StatusText value={message}/>}</p>
      <button className="onboarding-primary" type="submit" disabled={busy}>{busy?'Processing…':register?'Sign up and join':'Sign in'}</button>
    </form>
    {inviteToken?<p className="onboarding-foot">{register?'Already have an account?':'New here?'} <button type="button" disabled={busy} onClick={()=>{setRegister(value=>!value);setPassword('');setMessage('');}}>{register?'Sign in':'Sign up'}</button></p>:<div className="onboarding-foot"><p>Invited by your partner?</p><InvitationEntry/></div>}
  </div><MainNavigation onSelect={tab=>{setMessage(`Sign in to open ${tab==='home'?'Home':tab==='chat'?'Chat':tab==='calendar'?'Calendar':'Me'}.`);document.querySelector<HTMLInputElement>('input[type=email]')?.focus();}}/></main>;
}

export function ProfileSetup({onComplete}:{onComplete:()=>void}) {
  const [profile,setProfile]=useState<ProfileInput>(blankProfile);const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');
  const submit=async()=>{
    setBusy(true);setMessage('');try{await requestData('/api/duet/profile/initialize',json(profilePayload(profile)));setProfile(blankProfile());onComplete();}
    catch(error){setMessage(error instanceof Error?error.message:'Could not save profile.');}finally{setBusy(false);}
  };
  return <section className="onboarding-screen approved-ef" data-approved-screen="E03"><OnboardingHeader title="Your profile"/><div className="onboarding-body"><Progress step={2}/><p className="onboarding-eyebrow">STEP 2 OF 3</p><h2>Set up your profile</h2><p className="onboarding-muted">A few details help Duet feel like yours.</p><form onSubmit={event=>{event.preventDefault();void submit();}} className="onboarding-form"><ProfileFields value={profile} onChange={setProfile}/><p className="onboarding-message" role={message?'alert':'status'} aria-live="polite">{<StatusText value={message}/>}</p><button className="onboarding-primary" type="submit" disabled={busy}>{busy?'Saving…':'Save and continue'}</button></form></div><MainNavigation onSelect={()=>window.location.assign('/')}/></section>;
}

export function PairingSetup({onComplete,inviteToken}:{onComplete:()=>void;inviteToken?:string}) {
  const [invite,setInvite]=useState(inviteToken??'');const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');const [invitationError,setInvitationError]=useState('');
  const work=async()=>{
    setBusy(true);setMessage('');try{
      {const token=inviteTokenFromInput(invite);if(!token)throw new Error('Paste the full invitation link.');await requestData('/api/duet/invitations/accept',json({token}));}
      onComplete();
    }catch(error){if(error instanceof ClientApiError&&error.code==='invalid_invitation')setInvitationError(error.message);else setMessage(error instanceof Error?error.message:'Could not pair accounts.');}finally{setBusy(false);}
  };
  if(invitationError)return <InvitationUnavailable message={invitationError} onRetry={()=>{setInvitationError('');setInvite('');setMessage('');}}/>;
  return <section className="onboarding-screen approved-ef" data-approved-screen="E04"><OnboardingHeader title="Join your space"/><div className="onboarding-body"><Progress step={3}/><p className="onboarding-eyebrow">STEP 3 OF 3</p><h2>Make it a shared space</h2>
    <form className="onboarding-choice-card" onSubmit={event=>{event.preventDefault();void work();}}><div className="onboarding-choice-heading"><span aria-hidden="true">↗</span><div><strong>Join with an invitation</strong><small>Paste the link sent to you.</small></div></div><label>Invitation link<input value={invite} onChange={event=>setInvite(event.target.value)} autoComplete="off" placeholder="Paste your invitation link" disabled={busy}/></label><button className="onboarding-primary" type="submit" disabled={busy||!invite}>{busy?'Joining…':'Accept invitation'}</button></form>

    <p className="onboarding-message" role={message?'alert':'status'} aria-live="polite">{<StatusText value={message}/>}</p>
  </div><MainNavigation onSelect={()=>window.location.assign('/')}/></section>;
}


export function HostInvitationSetup({onComplete,existingCouple=false}:{onComplete:()=>void;existingCouple?:boolean}) {
 const [created,setCreated]=useState(existingCouple),[url,setUrl]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const create=async()=>{if(busy)return;setBusy(true);setMessage('');try{if(!created){await requestData('/api/duet/couple',{method:'POST'});setCreated(true);}const result=await requestData<{url:string}>('/api/duet/invitations',{method:'POST'});setUrl(result.url);}catch(error){setMessage(error instanceof Error?error.message:'Could not create an invitation. Try again.');}finally{setBusy(false);}};
 const copy=async()=>{try{await navigator.clipboard.writeText(url);setMessage('Link copied.');}catch{setMessage('Select the link and copy it.');}};
 const share=async()=>{try{if(navigator.share)await navigator.share({title:'DUET invitation',url});else await copy();}catch(error){if(!(error instanceof DOMException&&error.name==='AbortError'))setMessage('Copy the link to share it.');}};
 return <section className="onboarding-screen approved-ef" data-approved-screen="E04"><OnboardingHeader title="Invite"/><div className="onboarding-body"><Progress step={3}/><p className="onboarding-eyebrow">STEP 3 OF 3</p><h2>Invite your partner</h2><p className="onboarding-muted">Create a private link to share your space.</p><div className="onboarding-choice-card"><p className="onboarding-eyebrow">INVITATION LINK</p>{url&&<><input aria-label="Invitation link" readOnly value={url}/><div className="host-invite-actions"><button type="button" className="onboarding-secondary" onClick={()=>void copy()}>Copy</button><button type="button" className="onboarding-secondary" onClick={()=>void share()}>Share</button></div></>}<p className="onboarding-muted">Invitation links expire after 24 hours.</p><button type="button" className="onboarding-primary" disabled={busy} onClick={()=>void create()}>{busy?'Creating…':url?'Create new link':'Create'}</button></div><p className="onboarding-message" role="status">{<StatusText value={message}/>}</p>{created&&<button type="button" className="onboarding-primary host-invite-continue" disabled={busy} onClick={onComplete}>Continue</button>}</div><MainNavigation onSelect={()=>{if(created)onComplete();else setMessage('Create your space to continue.');}}/></section>;
}
