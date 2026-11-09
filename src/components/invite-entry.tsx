'use client';
import {LoadingStatus,StatusText} from './loading-status';

import {useState} from 'react';
import {accountStep,inviteTokenFromInput} from '../lib/onboarding';
import {AuthEntry,PairingSetup,ProfileSetup,OnboardingState} from './account-onboarding';
import {useAccount,accountToolsLabel,type AccountState} from './use-account';

export function InviteEntry({token}:{token:string}) {
  const account=useAccount();return <InviteSession key={account.userId??'anonymous'} token={token} account={account}/>;
}
export function InviteSession({token,account}:{token:string;account:AccountState}) {
  const [error,setError]=useState('');
  if(!inviteTokenFromInput(token))return <OnboardingState title="Invitation status" heading="Invalid invitation link" state="error"><p>Ask for a new invitation link, then try again.</p><a className="onboarding-primary" href="/">Back to sign in</a></OnboardingState>;
  if(account.userId===undefined)return <OnboardingState title="Invitation status" heading={account.error?'Could not check sign-in':undefined} state={account.error?'error':'loading'}><p role={account.error?'alert':'status'}>{account.error||<LoadingStatus/>}</p>{account.error&&<button className="onboarding-secondary" type="button" onClick={()=>window.location.reload()}>Try again</button>}</OnboardingState>;
  if(account.userId===null)return <AuthEntry inviteToken={token}/>;
  const tools=<header className="shell-session-tools"><span>{accountToolsLabel(account)}</span><button type="button" onClick={()=>void account.signOut().catch(error=>setError(error instanceof Error?error.message:'Could not sign out.'))}>Sign out</button>{error&&<p role="alert">{error}</p>}</header>;
  if(!account.data)return <div className="invite-session">{tools}<OnboardingState title="Invitation status" heading={account.error?'Could not load your space':undefined} state={account.error?'error':'loading'}><p role={account.error?'alert':'status'}>{account.error||<LoadingStatus/>}</p>{account.error&&<button className="onboarding-secondary" type="button" onClick={()=>void account.refresh()}>Try again</button>}</OnboardingState></div>;
  const step=accountStep({userId:account.userId,profile:account.data.profile,coupleId:account.data.couple.coupleId});
  return <div className="invite-session">{tools}{step==='profile'?<ProfileSetup onComplete={()=>void account.refresh()}/>:step==='pair'?<PairingSetup inviteToken={token} onComplete={()=>window.location.assign('/')}/>:<OnboardingState title="Invitation status" heading="Already in a space" state="joined"><p>Each account can join one space.</p><a className="onboarding-primary" href="/">Open my space</a></OnboardingState>}</div>;
}
