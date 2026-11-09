'use client';
import {LoadingStatus,StatusText} from './loading-status';

import { useEffect, useRef, useState } from 'react';
import { isRecord, requestData, signedMediaUrl } from '../lib/client-api';
import { selectStoryViewerItems,visibleStoryImage, type StoryRecord } from '../lib/story-view';
import { browserClient } from '../lib/supabase/browser';
import {ChatIcon} from './chat-icons';

type Selection={authorId?:string;snapId?:string};
type Story=StoryRecord&{saved_to_calendar_at?:string|null};
function validStory(item:unknown):item is Story {
  return isRecord(item)&&typeof item.id==='string'&&typeof item.author_id==='string'&&typeof item.media_id==='string'&&typeof item.sent_at==='string'&&typeof item.expires_at==='string'
    &&(item.latitude===null||typeof item.latitude==='number')&&(item.longitude===null||typeof item.longitude==='number');
}

export function StoryViewer({selection,onClose,onSaved}:{selection:Selection|null;onClose:()=>void;onSaved:()=>void}) {
  const [items,setItems]=useState<Story[]>([]);
  const [index,setIndex]=useState(0);
  const [userId,setUserId]=useState('');
  const [image,setImage]=useState<{snapId:string;url:string}|null>(null);
  const [reply,setReply]=useState('');
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);
  const [menuOpen,setMenuOpen]=useState(false);
  const [replyOpen,setReplyOpen]=useState(false);
  const [likedIds,setLikedIds]=useState<string[]>([]);
  const touchStart=useRef<{x:number;y:number}|null>(null);
  const current=items[index];
  const imageUrl=visibleStoryImage(image,current?.id);

  useEffect(()=>{
    setImage(null);setReply('');setMessage('');setMenuOpen(false);setReplyOpen(false);setItems([]);setIndex(0);
    if(!selection)return;
    let disposed=false;
    void (async()=>{
      const {data}=await browserClient().auth.getUser();
      if(!data.user)throw new Error('Sign in to view stories.');
      setUserId(data.user.id);
      const rows=await requestData<unknown>('/api/duet/stories?scope=chat');
      const stories=Array.isArray(rows)?rows.filter(validStory):rows&&validStory(rows)?[rows]:[];
      const next=selectStoryViewerItems(stories,{authorId:selection.authorId,snapId:selection.snapId}) as Story[];
      if(!disposed){setItems(next);setIndex(0);setMessage(next.length?'':'This story is unavailable or expired.');}
    })().catch(error=>{if(!disposed)setMessage(error instanceof Error?error.message:'Could not open story.');});
    return()=>{disposed=true;};
  },[selection]);

  useEffect(()=>{
    setImage(null);setReply('');setMessage('');setMenuOpen(false);setReplyOpen(false);
    if(!current)return;
    let disposed=false;
    void (async()=>{
      const url=await signedMediaUrl(current.media_id);
      if(disposed)return;setImage({snapId:current.id,url});
      void requestData(`/api/duet/stories/${current.id}/view`,{method:'POST'}).then(()=>{
        if(!disposed)setItems(rows=>rows.map(story=>story.id===current.id?{...story,is_viewed:true}:story));
      }).catch(()=>{if(!disposed)setMessage('Photo opened. Read status has not synced yet.');});
    })().catch(error=>{if(!disposed)setMessage(error instanceof Error?error.message:'Could not display this photo.');});
    return()=>{disposed=true;};
  },[current?.id,index]);

  if(!selection)return null;
  const close=()=>{setItems([]);setMessage('');onClose();};
  const save=async()=>{
    if(!current||!imageUrl)return;
    setBusy(true);setMessage('');
    try {
      await requestData(`/api/duet/stories/${current.id}/save`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({})});
      setItems(rows=>rows.map(story=>story.id===current.id?{...story,saved_to_calendar_at:new Date().toISOString()}:story));
      setMessage('Saved to Calendar.');setMenuOpen(false);onSaved();
    } catch(error) {setMessage(error instanceof Error?error.message:'Could not save. Try again.');}
    finally {setBusy(false);}
  };
  const sendReply=async()=>{
    if(!current||!imageUrl||!reply.trim())return;
    setBusy(true);setMessage('');
    try {
      await requestData('/api/duet/messages',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({kind:'text',body:reply.trim(),storyId:current.id})});
      setReply('');setReplyOpen(false);setMessage('Sent to Chat.');
    } catch(error) {setMessage(error instanceof Error?error.message:'Could not send reply.');}
    finally {setBusy(false);}
  };
  const sendInteraction=async(kind:'emoji'|'share')=>{
    if(!current||!imageUrl||busy)return;
    setBusy(true);setMessage('');
    try {
      await requestData('/api/duet/messages',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({kind,body:kind==='emoji'?'♥':current.caption||'Shared a story',storyId:current.id})});
      if(kind==='emoji')setLikedIds(ids=>[...ids,current.id]);
      setMenuOpen(false);setMessage(kind==='emoji'?'Liked · sent to Chat.':'Shared to Chat.');
    } catch(error){setMessage(error instanceof Error?error.message:'Could not send. Try again.');}
    finally{setBusy(false);}
  };
  const canSave=!!current&&!!imageUrl&&current.author_id===userId&&!current.saved_to_calendar_at&&Date.parse(current.expires_at)>Date.now();
  const move=(delta:number)=>setIndex(value=>Math.max(0,Math.min(items.length-1,value+delta)));

  return <div className="duet-story-viewer" role="dialog" aria-modal="true" aria-label="Story viewer" onClick={event=>{if(event.target===event.currentTarget)close();}} onKeyDown={event=>{if(event.key==='Escape')close();}}>
    <div className="duet-story-viewer-inner">
      <button className="duet-icon-button duet-story-close" type="button" onClick={close} aria-label="Close story"><ChatIcon name="close"/></button>
      <div className="duet-story-progress">{items.map((story,i)=><span key={story.id} className={i<=index?'is-active':undefined}/>)}</div>
      {current?<>
        <div className="duet-story-canvas"
          onTouchStart={event=>{const point=event.touches[0];if(point)touchStart.current={x:point.clientX,y:point.clientY};}}
          onTouchEnd={event=>{const point=event.changedTouches[0];const start=touchStart.current;if(!point||!start)return;const dx=point.clientX-start.x;const dy=point.clientY-start.y;touchStart.current=null;if(Math.abs(dx)>48&&Math.abs(dx)>Math.abs(dy)&&!busy)move(dx<0?1:-1);}}>
          {imageUrl?<img className="duet-story-image" src={imageUrl} alt={current.caption||'Shared story'} onError={()=>setMessage('Could not display this photo. Reopen the story to try again.')}/>:<span>{message||<LoadingStatus/>}</span>}
          <button className="duet-story-step is-prev" type="button" aria-label="Previous photo" onClick={()=>move(-1)} disabled={busy||index===0}><ChatIcon name="back"/></button>
          <button className="duet-story-step is-next" type="button" aria-label="Next photo" onClick={()=>move(1)} disabled={busy||index>=items.length-1}><ChatIcon name="back"/></button>
          {current.caption&&<p className="duet-story-caption">{current.caption}</p>}
          <button className="duet-icon-button duet-story-more" type="button" aria-label="Story actions" aria-expanded={menuOpen} disabled={!imageUrl} onClick={()=>setMenuOpen(value=>!value)}><ChatIcon name="more"/></button>
          {menuOpen&&<div className="duet-story-menu" role="menu">
            <button type="button" role="menuitem" onClick={()=>void sendInteraction('emoji')} disabled={busy||likedIds.includes(current.id)}><ChatIcon name="heart"/>{likedIds.includes(current.id)?'Liked':'Like'}</button>
            <button type="button" role="menuitem" onClick={()=>{setReplyOpen(true);setMenuOpen(false);}} disabled={busy}><ChatIcon name="send"/>Comment</button>
            <button type="button" role="menuitem" onClick={()=>void sendInteraction('share')} disabled={busy}><ChatIcon name="share"/>Share to Chat</button>
            {current.author_id===userId&&<button type="button" role="menuitem" onClick={()=>void save()} disabled={busy||!canSave}><ChatIcon name="save"/>{current.saved_to_calendar_at?'Saved':'Save to Calendar'}</button>}
          </div>}
        </div>
        {replyOpen&&<form className="duet-story-reply" onSubmit={event=>{event.preventDefault();void sendReply();}}>
          <input autoFocus aria-label="Reply to this story" value={reply} maxLength={2000} onChange={event=>setReply(event.target.value)} placeholder="Reply…"/>
          <button className="duet-send-button" type="submit" aria-label="Send reply to Chat" disabled={busy||!imageUrl||!reply.trim()}><ChatIcon name="send"/></button>
        </form>}
        {message&&<p className="duet-chat-status" role="status">{<StatusText value={message}/>}</p>}
      </>:<p role="status">{message||<LoadingStatus/>}</p>}
    </div>
  </div>;
}
