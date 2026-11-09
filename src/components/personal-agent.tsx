'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {requestData} from '../lib/client-api';
import {jsonBody} from './home-space';
import {privacyInstruction} from '../lib/ai/provider';
import {ChatIcon} from './chat-icons';
import {avatarInitial} from '../lib/avatar-initial';

type AgentMessage={id:string;role:string;body:string};
type SpeechResult={results:ArrayLike<ArrayLike<{transcript:string}>>};
type BrowserRecognition={lang:string;interimResults:boolean;continuous:boolean;onresult:((event:SpeechResult)=>void)|null;onerror:((event:{error:string})=>void)|null;onend:(()=>void)|null;start:()=>void;stop:()=>void;abort:()=>void};
type SpeechWindow=Window&{SpeechRecognition?:new()=>BrowserRecognition;webkitSpeechRecognition?:new()=>BrowserRecognition};

export function PersonalAgent({onBack}:{onBack?:()=>void}) {
  const [displayName,setDisplayName]=useState('');
  const [messages,setMessages]=useState<AgentMessage[]>([]);
  const [text,setText]=useState('');
  const [privacy,setPrivacy]=useState(false);
  const [busy,setBusy]=useState(false);
  const [status,setStatus]=useState('');
  const [listening,setListening]=useState(false);
  const [showOptions,setShowOptions]=useState(false);
  const speech=useRef<BrowserRecognition|null>(null);
  const bottom=useRef<HTMLDivElement>(null);
  const load=useCallback(async()=>{
    const result=await requestData<{messages:AgentMessage[];confidential:boolean}>('/api/duet/agent');
    setMessages([...result.messages].reverse());setPrivacy(result.confidential);
  },[]);
  useEffect(()=>{void load().catch(error=>setStatus(error.message));void requestData<{display_name:string}>('/api/duet/profile').then(profile=>setDisplayName(profile.display_name)).catch(()=>undefined);return()=>speech.current?.abort();},[load]);
  useEffect(()=>{bottom.current?.scrollIntoView({block:'end',behavior:'smooth'});},[messages.length,busy]);

  const dictate=()=>{
    if(listening){speech.current?.stop();return;}
    const browser=window as SpeechWindow;
    const Recognition=browser.SpeechRecognition??browser.webkitSpeechRecognition;
    if(!Recognition){setStatus('Voice input is unavailable in this browser. Use your keyboard microphone or type a message.');return;}
    const recognition=new Recognition();
    recognition.lang=navigator.language;recognition.interimResults=false;recognition.continuous=false;
    recognition.onresult=event=>{
      const transcript=Array.from(event.results).map(result=>result[0]?.transcript??'').join(' ');
      setText(value=>`${value}${value?' ':''}${transcript}`.slice(0,8000));
    };
    recognition.onerror=event=>{setListening(false);setStatus(event.error==='not-allowed'?'Allow microphone access to use voice input.':'Voice input stopped. Please try again.');};
    recognition.onend=()=>{setListening(false);speech.current=null;setStatus(value=>value==='Listening…'?'':value);};
    speech.current=recognition;
    try {recognition.start();setListening(true);setStatus('Listening…');}
    catch {setStatus('Could not start voice input. Please try again.');speech.current=null;}
  };
  const submit=async()=>{
    if(busy||!text.trim())return;
    speech.current?.stop();setBusy(true);setStatus('');
    try {
      // Explicit false ends incognito for this turn; past confidential turns remain private.
      await requestData('/api/duet/agent',jsonBody({text,privacy:privacyInstruction(text)??privacy}));
      setText('');await load();
    } catch(error) {setStatus(error instanceof Error?error.message:'Could not send. Try again.');void load().catch(()=>undefined);}
    finally {setBusy(false);}
  };

  return <section className="duet-conversation duet-agent approved-c06" aria-label="Ask Duet">
    <header className="duet-chat-header duet-agent-header">
      {onBack&&<button className="duet-icon-button" type="button" onClick={onBack} aria-label="Back"><ChatIcon name="back"/></button>}
      <span className="duet-agent-emblem"><ChatIcon name="robot"/></span>
      <div className="duet-chat-heading"><h2>Ask Duet</h2><span>Here to help you think it through</span></div>
      <button className="duet-icon-button" type="button" onClick={()=>setShowOptions(value=>!value)} aria-label="More options" aria-expanded={showOptions}><span aria-hidden="true">•••</span></button>
      {showOptions&&<div className="approved-agent-options" role="menu"><button type="button" role="menuitem" disabled={busy} onClick={()=>{setShowOptions(false);void load().catch(error=>setStatus(error.message));}}>Refresh chat</button><button type="button" role="menuitem" disabled={busy} onClick={()=>{setPrivacy(value=>!value);setShowOptions(false);setStatus('');}}>{privacy?'Turn off incognito':'Turn on incognito'}</button></div>}
    </header>
    <div className="duet-chat-messages" aria-live="polite"><p className="duet-privacy-hint">{privacy?'Incognito · New messages stay private.':'Standard · Duet may use this chat to answer your partner honestly.'}</p>
      {!messages.length&&!status&&<p className="duet-chat-empty">What’s on your mind?</p>}
      {messages.map(message=><article key={message.id} className={`duet-message-row ${message.role==='user'?'is-own':'is-received'}`} aria-label={message.role==='user'?'You':'Duet'}>
        <div className="duet-message-bubble"><p>{message.body}</p></div>{message.role==='user'&&<span className="duet-initial-avatar approved-agent-avatar" aria-label="Your avatar"><span>{avatarInitial(displayName,'Y')}</span></span>}
      </article>)}
      {busy&&<p className="duet-chat-status">Duet is thinking…</p>}
      <div ref={bottom}/>
    </div>
    <form className="duet-agent-composer approved-agent-composer" onSubmit={event=>{event.preventDefault();void submit();}}>
      <textarea aria-label="Message to Duet" placeholder="Message Duet" maxLength={8000} value={text} rows={1} onChange={event=>setText(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();void submit();}}}/>
      <div className="duet-agent-tools">
        <button className={`duet-mode-switch ${privacy?'is-on':''}`} type="button" role="switch" aria-checked={privacy} aria-label="Incognito conversation" disabled={busy} onClick={()=>{setPrivacy(value=>!value);setStatus('');}} title={privacy?'Incognito: new messages stay private.':'Standard: Duet can share summaries when asked.'}>
          <ChatIcon name="shield"/><span>Incognito</span><span className="duet-switch-track"><span/></span>
        </button>
        <button className={`duet-icon-button ${listening?'is-listening':''}`} type="button" aria-label={listening?'Stop voice input':'Voice input'} aria-pressed={listening} onClick={dictate} disabled={busy}><ChatIcon name="mic"/></button>
        <button className="duet-send-button" type="submit" aria-label="Send to Duet" disabled={busy||!text.trim()}><ChatIcon name="send"/></button>
      </div>

    </form>
    {status&&<p className="duet-chat-status" role="status">{status}</p>}
  </section>;
}
