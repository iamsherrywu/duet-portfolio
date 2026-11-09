'use client';
import {PartnerOnlineDot} from './online-presence';
import {LoadingStatus,StatusText} from './loading-status';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {createUploadDraft} from '../lib/upload-draft';
import { ClientApiError,isRecord, requestData, signedMediaUrl, uploadImage } from '../lib/client-api';
import { groupStoriesByAuthor, type StoryRecord } from '../lib/story-view';
import { browserClient, subscribeToCouple } from '../lib/supabase/browser';
import {filterChatMessages,partnerHasRead,mentionsDuet} from '../lib/chat-display';
import {avatarInitial} from '../lib/avatar-initial';
import {isValidLocation,readLocationDurationPreference,type LocationCoordinates} from '../lib/location';
import {ChatIcon} from './chat-icons';

type Profile={id:string;display_name:string;gender:string|null;clown_role:string|null;location_avatar_media_id:string|null};
export type ChatMessage={id:string;sender_id:string;kind:string;body:string;metadata:Record<string,unknown>;created_at:string};
type OpenStory={authorId?:string;snapId?:string};
type StoriesMode='chat'|'me';
function isStory(item:unknown):item is StoryRecord {
  return isRecord(item)&&typeof item.id==='string'&&typeof item.author_id==='string'&&typeof item.media_id==='string'
    &&typeof item.sent_at==='string'&&typeof item.expires_at==='string'
    &&(item.latitude===null||typeof item.latitude==='number')&&(item.longitude===null||typeof item.longitude==='number');
}
function isChatMessage(item:unknown):item is ChatMessage {
  return isRecord(item)&&typeof item.id==='string'&&typeof item.sender_id==='string'&&typeof item.kind==='string'
    &&typeof item.body==='string'&&isRecord(item.metadata)&&typeof item.created_at==='string';
}

function readCurrentPosition():Promise<LocationCoordinates> {
  return new Promise((resolve,reject)=>{
    if(!navigator.geolocation){reject(new Error('Location is unavailable.'));return;}
    navigator.geolocation.getCurrentPosition(position=>resolve({
      latitude:position.coords.latitude,longitude:position.coords.longitude,accuracy:position.coords.accuracy,
    }),error=>reject(error),{enableHighAccuracy:true,maximumAge:0,timeout:15000});
  });
}

export function LocationStories({onOpenStory,onOpenCourt,onPlanDate,onOpenMap,onOpenAgent,onOpenProfile,refreshKey=0,mode='chat'}:{onOpenStory:(selection:OpenStory)=>void;onOpenCourt?:(caseId?:string)=>void;onPlanDate?:(text:string)=>void;onOpenMap?:()=>void;onOpenAgent?:()=>void;onOpenProfile?:()=>void;refreshKey?:number;mode?:StoriesMode}) {
  const [stories,setStories]=useState<StoryRecord[]>([]);
  const [chatMessages,setChatMessages]=useState<ChatMessage[]>([]);
  const [profiles,setProfiles]=useState<Profile[]>([]);
  const [userId,setUserId]=useState('');
  const [caption,setCaption]=useState('');
  const [textMessage,setTextMessage]=useState('');
  const [durationMinutes,setDurationMinutes]=useState<30|60>(60);
  const [files,setFiles]=useState<File[]>([]);
  const uploadDraft=useRef(createUploadDraft(uploadImage));
  const [busy,setBusy]=useState(false);
  const [showMore,setShowMore]=useState(false);
  const [showSearch,setShowSearch]=useState(false);
  const [showStoryAdd,setShowStoryAdd]=useState(false);
  const messagesEnd=useRef<HTMLDivElement>(null);
  const photoInput=useRef<HTMLInputElement>(null);
  const storyPhotoInput=useRef<HTMLInputElement>(null);
  const [previewUrls,setPreviewUrls]=useState<string[]>([]);
  const meMode=mode==='me';
  const [chatPhoto,setChatPhoto]=useState<File|null>(null);
  const [chatPhotoUrl,setChatPhotoUrl]=useState('');
  const chatUpload=useRef(createUploadDraft(uploadImage));
  useEffect(()=>{if(!chatPhoto){setChatPhotoUrl('');return;}const url=URL.createObjectURL(chatPhoto);setChatPhotoUrl(url);return()=>URL.revokeObjectURL(url);},[chatPhoto]);
  const [message,setMessage]=useState('Loading stories…');
  const [now,setNow]=useState(()=>Date.now());
  const [search,setSearch]=useState('');
  const [reads,setReads]=useState<Array<{user_id:string;last_read_at:string}>>([]);
  const [chatImages,setChatImages]=useState<Record<string,string>>({});
  const lastMarked=useRef('');

  useEffect(()=>{
    const urls=files.map(file=>URL.createObjectURL(file));
    setPreviewUrls(urls);
    return()=>urls.forEach(url=>URL.revokeObjectURL(url));
  },[files]);

  useEffect(()=>{setDurationMinutes(readLocationDurationPreference());},[]);

  const refresh=useCallback(async()=>{
    const rows=await requestData<unknown>('/api/duet/stories?scope=chat');
    setStories(Array.isArray(rows)?rows.filter(isStory):[]);
  },[]);
  const refreshMessages=useCallback(async()=>{
    const rows=await requestData<unknown>('/api/duet/messages');
    const messages=Array.isArray(rows)?rows.filter(isChatMessage):[];
    setChatMessages(messages);
    const latest=messages[messages.length-1]?.id;
    if(latest&&latest!==lastMarked.current&&document.visibilityState==='visible'){
      lastMarked.current=latest;
      try{await requestData(`/api/duet/messages/${latest}/read`,{method:'POST'});}catch(error){if(lastMarked.current===latest)lastMarked.current='';throw error;}
    }
    setReads(await requestData('/api/duet/messages/reads'));
    const images=await Promise.all(messages.filter(row=>(['image','audio'].includes(row.kind)&&typeof row.metadata.media_id==='string')||typeof row.metadata.feed_media_id==='string').map(async row=>[row.id,await signedMediaUrl((row.metadata.media_id??row.metadata.feed_media_id) as string).catch(()=> '')] as const));
    setChatImages(Object.fromEntries(images));
  },[]);

  useEffect(()=>{
    let disposed=false;let unsubscribe:(()=>void)|null=null;
    void (async()=>{
      try {
        const {data,error}=await browserClient().auth.getUser();
        if(error||!data.user){setMessage('Sign in to view shared stories.');return;}
        setUserId(data.user.id);
        const [couple]=await Promise.all([requestData<unknown>('/api/duet/couple'),refresh(),...(meMode?[]:[refreshMessages()])]);
        const coupleData=isRecord(couple)?couple:null;
        const profileRows=coupleData&&Array.isArray(coupleData.profiles)?coupleData.profiles.filter((row):row is Profile=>isRecord(row)&&typeof row.id==='string'):[];
        if(disposed)return;
        setProfiles(profileRows);setMessage('');
        if(typeof coupleData?.coupleId==='string')unsubscribe=subscribeToCouple(coupleData.coupleId,()=>{void Promise.all([refresh(),...(meMode?[]:[refreshMessages()])]).catch(()=>undefined);});
      } catch(error) {if(!disposed)setMessage(error instanceof Error?error.message:'Could not load stories.');}
    })();
    return()=>{disposed=true;unsubscribe?.();};
  },[refresh,refreshMessages,refreshKey,meMode]);

  useEffect(()=>{const timer=window.setInterval(()=>setNow(Date.now()),30000);return()=>window.clearInterval(timer);},[]);
  useEffect(()=>{if(meMode)return;const timer=window.setInterval(()=>void refreshMessages().catch(()=>undefined),30000);return()=>window.clearInterval(timer);},[meMode,refreshMessages]);
  const groups=useMemo(()=>groupStoriesByAuthor(stories,userId,now),[stories,userId,now]);
  const send=async()=>{
    if(!files.length||files.length>10)return;
    setBusy(true);setMessage('Uploading…');
    try {
      const mediaIds:string[]=[];
      for(const file of files)mediaIds.push((await uploadDraft.current.resolve(file,'story')).id);
      setMessage('Checking location…');
      let coordinates:LocationCoordinates|undefined;
      try {
        const current=await readCurrentPosition();
        if(isValidLocation(current.latitude,current.longitude,current.accuracy))coordinates=current;
      } catch { /* A story can still be sent to Chat when location is unavailable. */ }
      await requestData('/api/duet/stories',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
        mediaIds,caption,
        ...(coordinates?{coordinates,durationMinutes}:{ }),
      })});
      uploadDraft.current.clear();setCaption('');setFiles([]);
      setMessage(coordinates?`Story sent · ${mediaIds.length} photo${mediaIds.length===1?'':'s'} share one map pin.`:`Story sent · ${mediaIds.length} photo${mediaIds.length===1?'':'s'} without a map pin.`);
      await refresh();
    } catch(error) {if(error instanceof ClientApiError&&error.code==='media_cleanup')uploadDraft.current.clear();setMessage(error instanceof Error?error.message:'Could not send. Try again.');}
    finally {setBusy(false);}
  };
  const sendText=async()=>{
    const body=textMessage.trim();if(!body||busy)return;
    setBusy(true);setMessage('');
    try {
      const sent=await requestData<{id:string}>('/api/duet/messages',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({kind:'text',body})});
      setTextMessage('');await refreshMessages();
      if(mentionsDuet(body)){setMessage('Duet is replying…');await requestData(`/api/duet/messages/${sent.id}/duet`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});await refreshMessages();setMessage('');}
    } catch(error) {setMessage(error instanceof Error?error.message:'Could not send message.');}
    finally {setBusy(false);}
  };
  const sendImage=async(file:File)=>{
    if(busy)return;setBusy(true);setMessage('Sending photo…');
    try {
      const media=await chatUpload.current.resolve(file,'chat');
      await requestData('/api/duet/messages',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({kind:'image',mediaId:media.id})});
      chatUpload.current.clear();setChatPhoto(null);setMessage('Photo sent.');await refreshMessages();
    }catch(error){if(error instanceof ClientApiError&&error.code==='media_cleanup')chatUpload.current.clear();setMessage(error instanceof Error?error.message:'Could not send photo. Try again.');}finally{setBusy(false);}
  };

  useEffect(()=>{if(!meMode)messagesEnd.current?.scrollIntoView({block:'end',behavior:'smooth'});},[chatMessages.length,meMode]);

  const ringFor=(authorId:string)=>groups.find(group=>group.authorId===authorId)?.ring;
  const nameFor=(profile:Profile)=>profile.display_name||'Partner';
  const characterFor=(profile:Profile)=>avatarInitial(nameFor(profile),'P');

  const ownProfile=profiles.find(profile=>profile.id===userId);
  const partnerProfile=profiles.find(profile=>profile.id!==userId);
  const avatar=(profile:Profile|undefined,size:'small'|'large'='small')=>{
    const ring=profile?ringFor(profile.id):undefined;
    return <span className={`duet-initial-avatar ${size==='large'?'is-large':''} ${ring?`story-ring is-${ring}`:''}`}><span>{profile?characterFor(profile):'P'}</span></span>;
  };
  const retryMessages=()=>void refreshMessages().catch(error=>setMessage(error.message));

  return <section className={meMode?'duet-me-stories':'duet-conversation duet-shared-chat'} aria-label={meMode?'My profile and stories':'Chat'}>
    {meMode?<header className="duet-me-profile">
      <div className="duet-me-avatar-wrap">
        <button type="button" className="duet-avatar-button" aria-label="My stories" onClick={()=>{setShowStoryAdd(value=>!value);if(ownProfile&&ringFor(ownProfile.id))onOpenStory({authorId:ownProfile.id});}}>{avatar(ownProfile,'large')}</button>
        {showStoryAdd&&<button type="button" className="duet-story-add" aria-label="Add a story" onClick={()=>storyPhotoInput.current?.click()}><ChatIcon name="plus"/></button>}
      </div>
      <div><strong>{ownProfile?nameFor(ownProfile):'Me'}</strong><button type="button" className="duet-profile-link" onClick={onOpenProfile}>Profile →</button></div>
    </header>:<header className="duet-chat-header">
      <button type="button" className="duet-avatar-button" aria-label={`${partnerProfile?nameFor(partnerProfile):'Partner'}’s stories`} disabled={!partnerProfile||!ringFor(partnerProfile.id)} onClick={()=>partnerProfile&&onOpenStory({authorId:partnerProfile.id})}>{avatar(partnerProfile)}<PartnerOnlineDot/></button>
      <div className="duet-chat-heading"><h2>{partnerProfile?nameFor(partnerProfile):'Partner'}</h2></div>
      <div className="duet-chat-header-tools">
        <button type="button" className="duet-icon-button" aria-label="Search messages" aria-expanded={showSearch} onClick={()=>{setShowSearch(value=>!value);setSearch('');}}><ChatIcon name="search"/></button>
        <button type="button" className="duet-icon-button" aria-label="Location map" onClick={onOpenMap}><ChatIcon name="globe"/></button>
        <button type="button" className="duet-icon-button" aria-label="Ask Duet" onClick={onOpenAgent}><ChatIcon name="robot"/></button>
      </div>
    </header>}
    {meMode&&<>
      <input ref={storyPhotoInput} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={event=>{
        const selected=[...files,...Array.from(event.target.files??[])];event.target.value='';
        if(selected.length>10){setFiles(selected.slice(0,10));setMessage('Choose up to 10 photos per story.');}
        else{setFiles(selected);setMessage('');}
      }}/>
      {!!files.length&&<section className="approved-c02-story" role="dialog" aria-modal="true" aria-label="Story">
        <header className="approved-c-subheader"><button type="button" className="duet-icon-button" aria-label="Back" disabled={busy} onClick={()=>{setFiles([]);setCaption('');uploadDraft.current.clear();}}><ChatIcon name="back"/></button><h2>Post Story</h2><span/></header>
        <div className="approved-story-content">
          <p className="approved-story-count">{files.length} PHOTO{files.length===1?'':'S'} SELECTED</p>
          <div className="approved-story-photo-grid">{previewUrls.map((url,index)=><div key={`${url}-${index}`}><img src={url} alt={`Selected photo ${index+1}`}/><button type="button" aria-label={`Remove photo ${index+1}`} disabled={busy} onClick={()=>setFiles(current=>current.filter((_,i)=>i!==index))}><ChatIcon name="close"/></button></div>)}</div>
          <button className="approved-story-add-photos" type="button" disabled={busy||files.length>=10} onClick={()=>storyPhotoInput.current?.click()}>＋ Add photos</button>
          <p className="approved-story-summary">Post as a story<small>Choose what you want to share.</small></p><label className="approved-story-caption"><span className="shell-sr-only">Caption</span><input value={caption} maxLength={500} onChange={event=>setCaption(event.target.value)} placeholder="Optional"/></label>
          {message&&<p className="duet-chat-status" role="status">{<StatusText value={message}/>}</p>}
        </div>
        <footer className="approved-story-footer"><button type="button" disabled={!files.length||files.length>10||busy} onClick={()=>void send()}>{busy?'Posting…':'Post'}</button></footer>
      </section>}
    </>}
    {!meMode&&<>
      {showSearch&&<section className="approved-c01-search" role="dialog" aria-modal="true" aria-label="Search messages">
        <header className="approved-c-subheader"><button type="button" className="duet-icon-button" aria-label="Back" onClick={()=>{setShowSearch(false);setSearch('');}}><ChatIcon name="back"/></button><h2>Search</h2><span/></header>
        <div className="approved-search-content"><label>Search messages<input aria-label="Search the latest 50 messages" type="search" placeholder="Search messages" autoFocus value={search} onChange={event=>setSearch(event.target.value)}/></label>
          <div className="approved-search-results">{filterChatMessages(chatMessages,search).map(chat=><button key={chat.id} type="button" onClick={()=>{setShowSearch(false);setSearch('');window.requestAnimationFrame(()=>document.getElementById(`chat-${chat.id}`)?.scrollIntoView({block:'center'}));}}><time>{new Date(chat.created_at).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</time><span>{chat.body||({image:'Photo',audio:'Voice message'}[chat.kind]??'Message')}</span><small>{chat.metadata.agent==='duet'?'Duet':chat.sender_id===userId?'You':profiles.find(profile=>profile.id===chat.sender_id)?.display_name||'Partner'}</small></button>)}</div>
          {!filterChatMessages(chatMessages,search).length&&<p className="duet-chat-empty">No matching messages.</p>}
        </div>
      </section>}
      <div className="duet-chat-messages" aria-live="polite">
        {!chatMessages.length&&<p className="duet-chat-empty">{message?'':'Say hello.'}</p>}
        {!!chatMessages.length&&<p className="duet-chat-date">{new Date(chatMessages[chatMessages.length-1].created_at).toLocaleDateString(undefined,{month:'short',day:'numeric'})}</p>}
        {chatMessages.map(chat=>{
          const sender=profiles.find(profile=>profile.id===chat.sender_id);
          const quoted=typeof chat.metadata.story_id==='string';
          const own=chat.sender_id===userId&&chat.metadata.agent!=='duet';
          const isRead=own&&partnerHasRead(userId,chat.created_at,reads);
          return <article id={`chat-${chat.id}`} key={chat.id} className={`duet-message-row ${own?'is-own':'is-received'}`} aria-label={chat.metadata.agent==='duet'?'Duet':sender?.display_name??'Partner'}>
            {own&&<span className={`duet-message-check ${isRead?'is-read':''}`} aria-label={isRead?'Read':'Sent'}><ChatIcon name="check"/></span>}
            <div className="duet-message-bubble">
              {quoted&&<button type="button" className="duet-story-quote" onClick={()=>onOpenStory({snapId:chat.metadata.story_id as string})}>{stories.find(story=>story.id===chat.metadata.story_id)?.caption?`${stories.find(story=>story.id===chat.metadata.story_id)?.caption} · Story`:'↳ Story'}</button>}
              {chat.metadata.agent==='duet'&&<small className="duet-bubble-author">Duet</small>}
              {chat.body&&<p>{quoted&&chat.kind==='emoji'&&chat.body==='♥'?<><span className="approved-story-reaction">♥</span>{!own&&stories.find(story=>story.id===chat.metadata.story_id)?.author_id===userId?'Liked your story':'Liked a story'}</>:chat.body}</p>}
              {typeof chat.metadata.cat_court_case_id==='string'&&<button type="button" className="duet-bubble-link" onClick={()=>onOpenCourt?.(chat.metadata.cat_court_case_id as string)}>Open Cat Judge →</button>}
              {(chat.kind==='image'||chat.metadata.feed_kind==='image')&&(chatImages[chat.id]?<img className="duet-chat-photo" src={chatImages[chat.id]} alt="Shared photo" onError={()=>setChatImages(previous=>({...previous,[chat.id]:''}))}/>:<button type="button" onClick={retryMessages}>Reload photo</button>)}
              {chat.metadata.feed_kind==='song'&&<p>♫ {String(chat.metadata.feed_song_title??'Morning song')} — {String(chat.metadata.feed_song_artist??'')}</p>}
              {chat.kind==='audio'&&(chatImages[chat.id]?<audio controls preload="metadata" src={chatImages[chat.id]} onError={()=>setChatImages(previous=>({...previous,[chat.id]:''}))}/>:<button type="button" onClick={retryMessages}>Reload audio</button>)}
              <details className="duet-message-actions"><summary aria-label="Message actions"><ChatIcon name="more"/></summary><div>
                {chat.kind==='text'&&chat.metadata.agent!=='duet'&&own&&mentionsDuet(chat.body)&&<button type="button" disabled={busy} onClick={()=>{setBusy(true);void requestData(`/api/duet/messages/${chat.id}/duet`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'}).then(refreshMessages).catch(error=>setMessage(error.message)).finally(()=>setBusy(false));}}>Retry Duet</button>}
                {chat.kind==='text'&&onPlanDate&&<button type="button" onClick={()=>onPlanDate(chat.body.slice(0,2000))}>Plan in Calendar</button>}
                <button type="button" onClick={()=>void requestData(`/api/duet/messages/${chat.id}/hide`,{method:'POST'}).then(refreshMessages).catch(error=>setMessage(error.message))}>Hide for me</button>
              </div></details>
            </div>
            {own&&<button type="button" className="duet-avatar-button duet-message-avatar" aria-label="My stories" disabled={!ownProfile||!ringFor(ownProfile.id)} onClick={()=>onOpenStory({authorId:userId})}>{avatar(ownProfile)}</button>}
          </article>;
        })}
                <div ref={messagesEnd}/>
      </div>
      <div className="duet-chat-compose-area">
        {showMore&&<div className="duet-chat-attachment-menu" role="menu"><button type="button" role="menuitem" disabled={busy} onClick={()=>photoInput.current?.click()}><ChatIcon name="photo"/>Photo</button><button type="button" role="menuitem" onClick={()=>{setShowMore(false);onOpenCourt?.();}}><ChatIcon name="cat"/>Cat Judge</button></div>}
        {chatPhoto&&<section className="duet-chat-photo-preview" aria-label="Photo preview"><img src={chatPhotoUrl} alt="Selected photo"/><div className="duet-inline-actions"><button type="button" disabled={busy} onClick={()=>{setChatPhoto(null);chatUpload.current.clear();}}>Cancel</button><button type="button" className="duet-primary-button" disabled={busy} onClick={()=>void sendImage(chatPhoto)}>{busy?'Sending…':'Send photo'}</button></div></section>}

        <form className="duet-chat-composer" onSubmit={event=>{event.preventDefault();void sendText();}}>
          <input ref={photoInput} type="file" hidden disabled={busy} accept="image/png,image/jpeg,image/webp" onChange={event=>{setChatPhoto(event.target.files?.[0]??null);setShowMore(false);event.target.value='';}}/>
          <button type="button" className="duet-icon-button" aria-label="More chat tools" aria-expanded={showMore} onClick={()=>{setShowMore(value=>!value);}}><ChatIcon name="plus"/></button>
          <input aria-label="Message" value={textMessage} maxLength={8000} onChange={event=>setTextMessage(event.target.value)} placeholder="Message / @Duet" onKeyDown={event=>{if(event.key==='Enter'&&event.nativeEvent.isComposing)event.preventDefault();}}/>
          <button className="duet-send-button" type="submit" aria-label="Send message" disabled={busy||!textMessage.trim()}><ChatIcon name="send"/></button>
        </form>
      </div>
    </>}
    {message&&<p className="duet-chat-status" role="status">{<StatusText value={message}/>}</p>}
  </section>;
}
