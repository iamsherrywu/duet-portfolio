'use client';
import {LoadingStatus,StatusText} from './loading-status';
import {MainNavigation} from './main-navigation';
import {useCallback,useEffect,useId,useRef,useState} from 'react';
import {requestData,signedMediaUrl} from '../lib/client-api';
import {createScreenshotRecognizer} from '../lib/song-import';

export const jsonBody=(body:unknown)=>({method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
type Song={id:string;title:string;artist:string;album:string;media_id:string|null;created_by:string};
type Box={id:string;recipient_id:string;note:string;total_count:number;opened_count:number};
export type InboxItem={id:string;prompt:string;answer:string;read_at:string|null;created_at:string};
export type CourtInvitation={id:string;case_id:string;sender_id:string;sender_name:string;created_at:string;read_at:string|null;accepted_at:string|null};
export type InboxPage={items:InboxItem[];courtInvitations:CourtInvitation[];unreadCount:number;nextCursor:string|null};

type Reaction={song_id:string;emoji:string};
export function SongCover({song,reactions,onChanged}:{song:Song;reactions:Reaction[];onChanged:()=>Promise<void>}) {
  const [url,setUrl]=useState('');const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const stickers=reactions.filter(row=>row.song_id===song.id).map(row=>row.emoji);
  const load=useCallback(()=>{if(song.media_id)void signedMediaUrl(song.media_id).then(setUrl).catch(()=>setError('Cover unavailable'));},[song.media_id]);
  useEffect(load,[load]);
  return <article className="production-song-cover" style={{padding:12,border:'1px solid var(--duet-rule)',borderRadius:12}}>
    {url?<img src={url} alt={`${song.title} album cover`} onError={()=>{setUrl('');setError('Cover link expired');}} style={{width:120,height:120,objectFit:'cover',borderRadius:'50%',border:'16px solid #111'}}/>:<span aria-label="Record cover">◉</span>}
    {error&&<button type="button" onClick={()=>{setError('');load();}}>Reload cover</button>}
    <strong style={{display:'block'}}>{song.title}</strong><span>{song.artist}</span><span className="approved-song-album">{song.album}</span><p className="approved-song-saved">Saved in Collection</p>
    <p aria-label="Song stickers">{stickers.join(' ')}</p><p>Leave a little reaction</p><div className="approved-song-reactions">{['🔥','🎧','🥹','✨','😎','🌙'].map(emoji=><button type="button" key={emoji} disabled={busy} onClick={()=>{setBusy(true);void requestData(`/api/duet/songs/${song.id}/reaction`,jsonBody({emoji})).then(onChanged).catch(()=>setError('Could not save sticker. Try again.')).finally(()=>setBusy(false));}}>{emoji}</button>)}</div>
  </article>;
}

function QueueCover({mediaId,title}:{mediaId?:string|null;title:string}) {
 const [url,setUrl]=useState('');
 useEffect(()=>{let active=true;setUrl('');if(mediaId)void signedMediaUrl(mediaId).then(value=>{if(active)setUrl(value);}).catch(()=>undefined);return()=>{active=false;};},[mediaId]);
 return <span className="production-record-thumbnail">{url?<img src={url} alt={`${title} album cover`} style={{width:'100%',height:'100%',objectFit:'cover',borderRadius:'50%'}}/>:<span aria-hidden="true">◉</span>}</span>;
}

export function CollectionRecord({song,onHide}:{song:Song;onHide:()=>Promise<void>}) {
 const hold=useRef<ReturnType<typeof setTimeout>|null>(null),held=useRef(false);const [removing,setRemoving]=useState(false);const cancelHold=()=>{if(hold.current)clearTimeout(hold.current);};useEffect(()=>()=>cancelHold(),[]);
 const [selected,setSelected]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 return <article className="collection-vinyl"><div className="collection-disc"><button type="button" className="collection-disc-button" aria-label={`Select ${song.title}`} aria-expanded={selected} onPointerDown={()=>{held.current=false;cancelHold();hold.current=setTimeout(()=>{held.current=true;setSelected(true);setError('');setRemoving(true);},550);}} onPointerMove={cancelHold} onPointerUp={cancelHold} onPointerLeave={cancelHold} onPointerCancel={cancelHold} onContextMenu={e=>{e.preventDefault();cancelHold();setSelected(true);setError('');setRemoving(true);}} onClick={()=>{if(held.current){held.current=false;return;}setSelected(!selected);setRemoving(false);setError('');}}><QueueCover mediaId={song.media_id} title={song.title}/></button>{selected&&<button type="button" className="collection-remove" aria-label={`Remove ${song.title} from Collection`} aria-expanded={removing} disabled={busy} onClick={()=>{setRemoving(true);setError('');}}>×</button>}</div>{removing&&<div role="alertdialog" aria-label="Remove from Collection"><p>Remove from your Collection?</p><button type="button" disabled={busy} onClick={()=>{setBusy(true);setError('');void onHide().then(()=>setRemoving(false)).catch(()=>setError('Could not remove. Try again.')).finally(()=>setBusy(false));}}>Remove</button><button type="button" disabled={busy} onClick={()=>setRemoving(false)}>Keep</button></div>}<p title={`${song.title} · ${song.artist}`}><strong>{song.title}</strong><small>{song.artist}</small></p>{error&&<span role="status">{error}</span>}</article>;
}

function Turntable({spinning}:{spinning:boolean}) {
  const id=useId().replace(/:/g,'');
  const clip=(name:string)=>`url(#${id}-${name})`;
  return <svg className="production-turntable-art" viewBox="0 0 1536 1024" aria-hidden="true"><defs>
    <clipPath id={`${id}-deck`}><rect x="254" y="143" width="1028" height="742" rx="26"/></clipPath>
    <clipPath id={`${id}-vinyl`}><circle cx="655" cy="512" r="319"/></clipPath>
    <clipPath id={`${id}-spindle`}><ellipse cx="655" cy="502" rx="17" ry="23"/></clipPath>
    <clipPath id={`${id}-arm`}><path d="M1084 340 L1120 340 L1124 447 L1140 449 L1140 467 L1120 478 Q1105 518 1157 581 Q1198 641 1149 701 L1158 721 L1136 766 L1164 787 L1166 817 L1146 820 L1115 796 L1090 817 L1060 799 L1063 761 L1096 702 L1124 673 Q1164 635 1124 578 Q1080 525 1083 479 L1073 475 L1074 449 L1085 446 Z"/></clipPath>
  </defs><image href="/mobile/assets/turntable-black-base.png" width="1536" height="1024" clipPath={clip('deck')}/>
  <g className="production-vinyl" data-spinning={spinning}><image href="/mobile/assets/turntable-black-base.png" width="1536" height="1024" clipPath={clip('vinyl')}/></g>
  <image href="/mobile/assets/turntable-black-base.png" width="1536" height="1024" clipPath={clip('spindle')}/>
  <g className="production-tonearm"><image href="/mobile/assets/turntable.png" width="1536" height="1024" clipPath={clip('arm')}/></g></svg>;
}

type SurpriseMode='question'|'message'|'none';
type SurpriseNote={mode:SurpriseMode;question:string;message:string};
type QueueItem=SurpriseNote&{song_id:string};
type SongDraw={draw_id:string;mode?:SurpriseMode;question:string|null;message?:string|null};
const emptyNote=():SurpriseNote=>({mode:'question',question:'',message:''});
const boxItem=(item:QueueItem)=>item.mode==='question'?{song_id:item.song_id,mode:item.mode,question:item.question}:item.mode==='message'?{song_id:item.song_id,mode:item.mode,message:item.message}:{song_id:item.song_id,mode:item.mode};
function SurpriseNoteEditor({value,onChange,disabled,onSuggest}:{value:SurpriseNote;onChange:(note:SurpriseNote)=>void;disabled:boolean;onSuggest?:()=>void}) {
  const id=useId();
  return <div className="production-surprise-editor">
    <div className="production-note-heading"><span>Note</span><div><button type="button" disabled={disabled} onClick={()=>{onChange({...value,mode:'question'});onSuggest?.();}}>Next ↻</button><button type="button" disabled={disabled} aria-pressed={value.mode==='none'} onClick={()=>onChange({...value,mode:value.mode==='none'?'message':'none'})}>Skip</button></div></div>
    {value.mode!=='none'&&<label htmlFor={id}><span className="shell-sr-only">{value.mode==='question'?'Question':'Message'}</span><textarea id={id} disabled={disabled} required={value.mode==='message'} maxLength={value.mode==='question'?500:2000} value={value[value.mode]} placeholder={value.mode==='question'?'Ask something only you would ask…':'A little message for them…'} onChange={event=>onChange({...value,[value.mode]:event.target.value})}/></label>}
  </div>;
}

type MusicView='home'|'add'|'queue'|'draw'|'revealed'|'collection';
export function HomeSpace({userId,onInbox,onChanged,active=true}:{userId:string;onInbox:()=>void;onChanged:()=>void;active?:boolean}) {
  const [hiddenSongs,setHiddenSongs]=useState<string[]>([]);
  const [boxes,setBoxes]=useState<Box[]>([]),[songs,setSongs]=useState<Song[]>([]);
  const [unread,setUnread]=useState(0),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[view,setView]=useState<MusicView>('home');
  const [reactions,setReactions]=useState<Reaction[]>([]);
  const [songQuery,setSongQuery]=useState(''),[songFilter,setSongFilter]=useState<'all'|'self'|'other'>('all');
  const [note,setNote]=useState<SurpriseNote>(emptyNote),[title,setTitle]=useState(''),[artist,setArtist]=useState(''),[album,setAlbum]=useState(''),[cover,setCover]=useState<string|null>(null);
  const [queue,setQueue]=useState<QueueItem[]>([]),[editingNote,setEditingNote]=useState<string|null>(null),[recipientName,setRecipientName]=useState(''),[draw,setDraw]=useState<SongDraw|null>(null),[answer,setAnswer]=useState(''),[revealed,setRevealed]=useState<Song|null>(null);
  const [coverPreview,setCoverPreview]=useState(''),[visible,setVisible]=useState(true),[documentVisible,setDocumentVisible]=useState(true);
  const modal=useRef<HTMLDialogElement>(null),record=useRef<HTMLButtonElement>(null),busyRef=useRef(false),headingId=useId();
  const available=boxes.filter(box=>box.recipient_id===userId&&box.opened_count<box.total_count);
  const hasUnopened=boxes.some(box=>box.opened_count<box.total_count);
  const unopened=available.reduce((sum,box)=>sum+box.total_count-box.opened_count,0);
  useEffect(()=>{let disposed=false;setCoverPreview('');if(cover)void signedMediaUrl(cover).then(url=>{if(!disposed)setCoverPreview(url);}).catch(()=>undefined);return()=>{disposed=true;};},[cover]);
  const load=useCallback(async()=>{
    const [bs,ss,ins,rs,couple]=await Promise.all([requestData<Box[]>('/api/duet/boxes'),requestData<Song[]>('/api/duet/songs'),requestData<InboxPage>('/api/duet/inbox'),requestData<Reaction[]>('/api/duet/song-reactions'),requestData<{profiles:Array<{id:string;display_name:string}>}>('/api/duet/couple')]);
    const hidden=await requestData<Array<{song_id:string}>>('/api/duet/collection/hidden');setHiddenSongs(hidden.map(row=>row.song_id));
    setBoxes(bs);setSongs(ss);setUnread(ins.unreadCount);setReactions(rs);setRecipientName(couple.profiles.find(person=>person.id!==userId)?.display_name||'');
  },[userId]);
  useEffect(()=>{if(!active)return;void load().catch(error=>setMessage(error instanceof Error?error.message:'Could not load Home. Try again.'));const timer=window.setInterval(()=>void load().catch(()=>undefined),30000);return()=>window.clearInterval(timer);},[load,active]);
  useEffect(()=>{const node=record.current;if(!node||typeof IntersectionObserver==='undefined')return;const observer=new IntersectionObserver(([entry])=>setVisible(entry.isIntersecting),{threshold:.2});observer.observe(node);const onVisibility=()=>setDocumentVisible(!document.hidden);document.addEventListener('visibilitychange',onVisibility);onVisibility();return()=>{observer.disconnect();document.removeEventListener('visibilitychange',onVisibility);};},[]);
  const modalOpen=view!=='home';
  useEffect(()=>{if(!modalOpen)return;const node=modal.current;node?.showModal();const overflow=document.body.style.overflow;document.body.style.overflow='hidden';return()=>{node?.close();document.body.style.overflow=overflow;};},[modalOpen]);
  const action=async(work:()=>Promise<void>,success='')=>{if(busyRef.current)return;busyRef.current=true;setBusy(true);setMessage('');try{await work();await load();onChanged();setMessage(success);}catch(error){setMessage(error instanceof Error?error.message:'Something went wrong. Try again.');}finally{busyRef.current=false;setBusy(false);}};
  const completeDraw=async(pending:SongDraw)=>{const mode=pending.mode??'question';setRevealed(await requestData<Song>(`/api/duet/draws/${pending.draw_id}/answer`,jsonBody(mode==='question'?{answer}:{})));setDraw(null);setAnswer('');setView('revealed');};
  const openSong=()=>{if(draw){setView('draw');if(draw.mode==='none')void action(()=>completeDraw(draw));return;}const box=available[0];if(!box){setView('collection');return;}void action(async()=>{const pending=await requestData<SongDraw>(`/api/duet/boxes/${box.id}/draw`,jsonBody({}));setDraw(pending);setAnswer('');setRevealed(null);setView('draw');if(pending.mode==='none')await completeDraw(pending);});};
  const [recognizeImage]=useState(()=>createScreenshotRecognizer());
  const recognize=(file:File)=>action(async()=>{
    setTitle('');setArtist('');setAlbum('');setCover(null);
    const result=await recognizeImage(file,userId);
    const recognizedTitle=result.title?.trim()??'',version=result.version?.trim()??'';
    const completeTitle=recognizedTitle&&version&&!recognizedTitle.toLocaleLowerCase().includes(version.toLocaleLowerCase())?`${recognizedTitle} (${version})`:recognizedTitle;
    setTitle(completeTitle);setArtist(result.artist??'');setAlbum(result.album??'');setCover(result.coverMediaId??null);
    if(result.needsManualEntry) {
      const missing=[!result.title?.trim()&&'song title',!result.artist?.trim()&&'artist'].filter(Boolean);
      throw new Error(missing.length?`We recognized part of the screenshot. Please enter the ${missing.join(' and ')} to continue.`:'We could not read the screenshot. Enter the title and artist to continue.');
    }
  });
  const close=()=>{if(!busyRef.current){setView('home');setMessage('');}};
  const titles:Record<MusicView,string>={home:'DUET',add:'Repository',queue:'Repository',draw:'',revealed:'',collection:'Collection'};
  return <section aria-label="Home" className="pet-home production-home">
    <div className="production-music">
      <button ref={record} className="production-turntable" data-has-unopened={hasUnopened} disabled={busy} aria-label={unopened?`Open a song surprise, ${unopened} unopened`:'Open your songs'} onClick={openSong}><Turntable spinning={hasUnopened&&active&&visible&&documentVisible&&!modalOpen}/></button>
      <div className="production-music-actions"><button type="button" className="production-primary" onClick={()=>{setMessage('');setView('add');}}>＋ Track</button><button type="button" onClick={()=>setView('collection')} disabled={busy}>Collection</button></div>
    </div>
    {message&&!modalOpen&&<p role="status" className="production-feedback">{<StatusText value={message}/>}<button type="button" disabled={busy} onClick={()=>void action(load)}>Refresh</button></p>}
    {modalOpen&&<dialog ref={modal} className={`production-music-dialog music-view-${view}`} aria-labelledby={headingId} onCancel={event=>{event.preventDefault();close();}}>
      <header className="production-music-header"><button type="button" className="production-back" aria-label="Back" disabled={busy} onClick={close}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 5-7 7 7 7"/></svg></button><h2 id={headingId} className={!titles[view]?'shell-sr-only':undefined}>{titles[view]}</h2><span/></header>
      <div className="production-music-body">
      {view==='add'&&<><div className="production-import-row"><div className="production-record-thumbnail">{coverPreview?<img src={coverPreview} alt="Cover preview"/>:<span aria-hidden="true">◉</span>}</div><div><label className="production-upload">Import screenshot<input className="shell-sr-only" type="file" disabled={busy} accept="image/png,image/jpeg,image/webp" onChange={event=>{const file=event.target.files?.[0];if(file)void recognize(file);event.target.value='';}}/></label><p>Or enter the details below.</p></div></div>
        <form className="production-music-form" onSubmit={event=>{event.preventDefault();if(note.mode==='message'&&!note.message.trim())return;void action(async()=>{const song=await requestData<{id:string}>('/api/duet/songs',jsonBody({title,artist,album,mediaId:cover}));setQueue(rows=>[...rows,{song_id:song.id,...note}]);setTitle('');setArtist('');setAlbum('');setCover(null);setNote(emptyNote());setView('queue');});}}>
          <p className="approved-b-kicker">The song</p><div className="production-song-fields"><label>Song<input required disabled={busy} value={title} placeholder="Song title" maxLength={200} onChange={event=>setTitle(event.target.value)}/></label><label>Artist<input required disabled={busy} value={artist} placeholder="Artist" maxLength={200} onChange={event=>setArtist(event.target.value)}/></label><label>Album<input disabled={busy} value={album} placeholder="Optional" maxLength={300} onChange={event=>setAlbum(event.target.value)}/></label></div>

          <SurpriseNoteEditor value={note} onChange={setNote} disabled={busy} onSuggest={()=>void action(async()=>{const prompt=await requestData<{question:string}>('/api/duet/prompts');setNote(value=>({...value,question:prompt.question}));})}/>
          <button className="production-primary production-music-footer" disabled={busy||!title.trim()||!artist.trim()||queue.length>=50||(note.mode==='message'&&!note.message.trim())}>{busy?'Adding…':'Commit'}</button>
        </form></>}
      {view==='queue'&&<><div className="production-song-queue">{queue.map(item=>{const song=songs.find(row=>row.id===item.song_id);return <article key={item.song_id}><div className="production-queue-song"><QueueCover mediaId={song?.media_id} title={song?.title||'Song'}/><div><strong>{song?.title||'Added song'}</strong><small>{song?.artist}</small></div><button type="button" disabled={busy} aria-label={`Remove ${song?.title||'song'}`} onClick={()=>setQueue(rows=>rows.filter(row=>row.song_id!==item.song_id))}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7m4-7v7"/></svg></button></div><div className="production-queue-note"><span>{item.mode==='question'?(item.question||'Note'):item.mode==='message'?item.message:'Skip'}</span><button type="button" disabled={busy} aria-label={`Edit note for ${song?.title||'song'}`} aria-expanded={editingNote===item.song_id} onClick={()=>setEditingNote(editingNote===item.song_id?null:item.song_id)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5 4 4M4 20l5-1L20 8l-4-4L5 15Z"/></svg></button></div>{editingNote===item.song_id&&<SurpriseNoteEditor value={item} disabled={busy} onChange={value=>setQueue(rows=>rows.map(row=>row.song_id===item.song_id?{...row,...value}:row))}/>}</article>;})}</div><button className="production-add-another" type="button" disabled={busy} onClick={()=>setView('add')}>＋ Add another song</button><button type="button" className="production-primary production-music-footer" disabled={busy||!queue.length||queue.some(item=>item.mode==='message'&&!item.message.trim())} onClick={()=>void action(async()=>{await requestData('/api/duet/boxes',jsonBody({items:queue.map(boxItem)}));setQueue([]);setEditingNote(null);setView('home');},'Pushed.')}>{busy?'Pushing…':'Push'}</button></>}
      {view==='draw'&&draw&&<form className="production-pull-form" onSubmit={event=>{event.preventDefault();if((draw.mode??'question')==='question'&&!answer.trim())return;void action(()=>completeDraw(draw));}}>{draw.mode==='none'?<p><LoadingStatus/></p>:<p>{draw.mode==='message'?draw.message:draw.question}</p>}{(draw.mode??'question')==='question'&&<textarea aria-label="Your answer" placeholder="Your answer…" required maxLength={2000} value={answer} onChange={event=>setAnswer(event.target.value)}/>}<button className="production-primary" disabled={busy||((draw.mode??'question')==='question'&&!answer.trim())}>{busy?'Opening…':'Pull'}</button></form>}
      {view==='revealed'&&revealed&&<><SongCover song={revealed} reactions={reactions} onChanged={load}/><button type="button" className="production-primary" disabled={busy} onClick={openSong}>Next</button><button type="button" onClick={()=>setView('collection')}>View Collection</button></>}
      {view==='collection'&&<><div className="production-song-collection-tools"><input type="search" aria-label="Search songs" placeholder="Search songs" value={songQuery} onChange={event=>setSongQuery(event.target.value)}/><div className="production-song-collection-filters">{(['all','self','other'] as const).map(filter=><button type="button" key={filter} aria-pressed={songFilter===filter} onClick={()=>setSongFilter(filter)}>{filter==='all'?'All':filter==='self'?'From me':`From ${recipientName||'Partner'}`}</button>)}</div></div><div className="production-song-collection">{songs.length?songs.filter(song=>!hiddenSongs.includes(song.id)&&(songFilter==='all'||(songFilter==='self'?song.created_by===userId:song.created_by!==userId))&&`${song.title} ${song.artist}`.toLowerCase().includes(songQuery.trim().toLowerCase())).map(song=><CollectionRecord key={song.id} song={song} onHide={async()=>{await requestData(`/api/duet/songs/${song.id}/hide`,jsonBody({}));setHiddenSongs(rows=>[...rows,song.id]);}}/>):<p>No songs yet.</p>}</div></>}
      {message&&<p role="status" className="production-feedback">{<StatusText value={message}/>}</p>}
      </div><MainNavigation active="home" onSelect={tab=>{close();window.dispatchEvent(new CustomEvent('duet:navigate',{detail:tab}));}}/>
    </dialog>}
  </section>;
}

export function BlindBoxInbox({onChanged,onOpenCourt}:{onChanged:()=>void;onOpenCourt?:(caseId:string)=>void}) {
  const [items,setItems]=useState<InboxItem[]>([]);const [message,setMessage]=useState('');
  const [courtInvitations,setCourtInvitations]=useState<CourtInvitation[]>([]);
  const [cursor,setCursor]=useState<string|null>(null);const [busy,setBusy]=useState(false);const busyRef=useRef(false);
  const [loading,setLoading]=useState(true);const [filter,setFilter]=useState<'all'|'unread'>('all');const [selected,setSelected]=useState('');const [unread,setUnread]=useState(0);
  const load=useCallback(async()=>{const page=await requestData<InboxPage>('/api/duet/inbox');setItems(page.items);setCourtInvitations(page.courtInvitations??[]);setCursor(page.nextCursor);setUnread(page.unreadCount);},[]);
  useEffect(()=>{void load().catch(error=>setMessage(error.message)).finally(()=>setLoading(false));},[load]);
  const act=async(work:()=>Promise<void>)=>{if(busyRef.current)return;busyRef.current=true;setBusy(true);setMessage('');try{await work();}catch(error){setMessage(error instanceof Error?error.message:'Could not update Inbox. Try again.');}finally{busyRef.current=false;setBusy(false);}};
  const rows=[...items.map(item=>({key:`answer-${item.id}`,kind:'answer' as const,item,unread:!item.read_at})),...courtInvitations.map(item=>({key:`court-${item.id}`,kind:'court' as const,item,unread:!item.read_at&&!item.accepted_at}))].sort((a,b)=>b.item.created_at.localeCompare(a.item.created_at));
  const current=rows.find(row=>row.key===selected);const visible=rows.filter(row=>filter==='all'||row.unread);
  const select=(row:typeof rows[number])=>{setSelected(row.key);if(row.kind==='answer'&&row.unread)void act(async()=>{await requestData(`/api/duet/inbox/${row.item.id}/read`,jsonBody({}));setItems(values=>values.map(item=>item.id===row.item.id?{...item,read_at:new Date().toISOString()}:item));setUnread(count=>Math.max(0,count-1));onChanged();});};
  const date=(value:string)=>new Date(value).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
  return <section className="approved-d-inbox" aria-label="Inbox updates"><p className="approved-d-eyebrow">YOUR UPDATES</p><div className="approved-d-segmented" aria-label="Inbox filter"><button type="button" aria-pressed={filter==='all'} onClick={()=>setFilter('all')}>All</button><button type="button" aria-pressed={filter==='unread'} onClick={()=>setFilter('unread')}>Unread <i>{unread}</i></button></div>
    {loading&&<p role="status"><LoadingStatus/></p>}
    {!loading&&!visible.length&&<p className="approved-d-muted">{filter==='unread'?'No unread updates.':'No updates yet.'}</p>}
    <div className="approved-d-inbox-list">{visible.map(row=><button key={row.key} type="button" className="approved-d-inbox-item" disabled={busy} aria-pressed={selected===row.key} onClick={()=>select(row)}><span className="approved-d-inbox-icon" aria-hidden="true">{row.kind==='court'?'⚖':'♫'}</span><span><b>{row.kind==='court'?'Cat Court invitation':'A song reply'}</b><small>{row.kind==='court'?`${row.item.sender_name} invited you to join`:'A reply to your music surprise'} · {date(row.item.created_at)}</small></span>{row.unread&&<i className="approved-d-unread-dot" aria-label="Unread"/>}</button>)}</div>
    {current&&<div className="approved-d-inbox-detail"><p className="approved-d-eyebrow">MESSAGE</p><b>{current.kind==='court'?'Cat Court invitation':current.item.prompt}</b>{current.kind==='court'?<><p>{current.item.sender_name} invited you to join a Cat Court hearing.</p><button type="button" className="approved-d-text-button" disabled={busy} onClick={()=>{if(current.item.accepted_at){onOpenCourt?.(current.item.case_id);return;}void act(async()=>{const result=await requestData<{caseId:string}>(`/api/duet/cat-court/invitations/${current.item.id}/accept`,jsonBody({}));setCourtInvitations(values=>values.map(item=>item.id===current.item.id?{...item,accepted_at:new Date().toISOString(),read_at:new Date().toISOString()}:item));if(current.unread)setUnread(count=>Math.max(0,count-1));onChanged();onOpenCourt?.(result.caseId);});}}>{current.item.accepted_at?'Open hearing':'Join hearing'}</button></>:<p className="approved-d-user-text">{current.item.answer}</p>}</div>}
    {cursor&&<button type="button" className="approved-d-text-button" disabled={busy} onClick={()=>void act(async()=>{const page=await requestData<InboxPage>(`/api/duet/inbox?cursor=${encodeURIComponent(cursor)}`);setItems(values=>[...values,...page.items.filter(item=>!values.some(row=>row.id===item.id))]);setCursor(page.nextCursor);setUnread(page.unreadCount);})}>Load earlier updates</button>}
    <button type="button" className="approved-d-text-button approved-d-refresh" disabled={busy||loading} onClick={()=>void act(load)}>Refresh inbox</button>{message&&<p role="status" className="approved-d-message">{<StatusText value={message}/>}</p>}
  </section>;
}
