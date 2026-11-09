'use client';
import {LoadingStatus,StatusText} from './loading-status';
import {useEffect,useRef,useState} from 'react';
import {audioMime,AUDIO_MAX_BYTES} from '../lib/audio';
import {requestData} from '../lib/client-api';
import {jsonBody} from './home-space';

export function VoiceMessage({onSent,compact=false}:{onSent:()=>Promise<void>;compact?:boolean}) {
 const [recording,setRecording]=useState(false);const [busy,setBusy]=useState(false);const [clip,setClip]=useState<File|null>(null);const [url,setUrl]=useState('');const [message,setMessage]=useState('');
 const recorder=useRef<MediaRecorder|null>(null);const stream=useRef<MediaStream|null>(null);const timer=useRef<ReturnType<typeof setTimeout>|null>(null);const mounted=useRef(true);const cancelled=useRef(false);
 const release=()=>{stream.current?.getTracks().forEach(track=>track.stop());stream.current=null;if(timer.current)clearTimeout(timer.current);timer.current=null;};
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;cancelled.current=true;if(recorder.current?.state==='recording')recorder.current.stop();release();};},[]);
 useEffect(()=>{if(!clip){setUrl('');return;}const value=URL.createObjectURL(clip);setUrl(value);return()=>URL.revokeObjectURL(value);},[clip]);
 const start=async()=>{
  if(busy||recording)return;setBusy(true);setMessage('');
  try {
   if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined')throw new Error('This browser cannot record audio. Choose an audio file instead.');
   const type=['audio/mp4','audio/webm;codecs=opus','audio/ogg;codecs=opus'].find(value=>MediaRecorder.isTypeSupported(value));
   if(!type)throw new Error('No supported recording format. Choose an audio file instead.');
   const media=await navigator.mediaDevices.getUserMedia({audio:true});
   if(!mounted.current){media.getTracks().forEach(track=>track.stop());return;}
   stream.current=media;cancelled.current=false;const chunks:BlobPart[]=[];let bytes=0;
   const rec=new MediaRecorder(media,{mimeType:type});recorder.current=rec;
   rec.ondataavailable=event=>{if(event.data.size){bytes+=event.data.size;chunks.push(event.data);if(bytes>AUDIO_MAX_BYTES&&rec.state==='recording')rec.stop();}};
   rec.onerror=()=>{cancelled.current=true;release();if(mounted.current){setRecording(false);setMessage('Recording interrupted. Try again.');}};
   rec.onstop=()=>{release();if(!mounted.current)return;setRecording(false);if(cancelled.current)return;const mime=audioMime(rec.mimeType);if(!mime||!bytes||bytes>AUDIO_MAX_BYTES){setMessage('Recording is empty or over 4 MB. Try a shorter recording.');return;}setClip(new File(chunks,'duet-voice',{type:mime}));};
   rec.start(1000);setClip(null);setRecording(true);timer.current=setTimeout(()=>{if(rec.state==='recording')rec.stop();},60000);
  }catch(error){release();if(mounted.current)setMessage(error instanceof Error?error.message:'Check your browser’s microphone permission.');}finally{if(mounted.current)setBusy(false);}
 };
 const stop=(cancel=false)=>{cancelled.current=cancel;if(recorder.current?.state==='recording')recorder.current.stop();release();setRecording(false);};
 return <details className={compact?"duet-voice-recorder":undefined} open={compact||undefined}><summary>Voice message</summary><p>Record up to 60 seconds.</p>
  {recording?<><button type="button" onClick={()=>stop()}>Stop and preview</button><button type="button" onClick={()=>stop(true)}>Cancel recording</button></>:<button type="button" disabled={busy} onClick={()=>void start()}>Start recording</button>}
  <label>Or choose an audio file<input type="file" disabled={busy||recording} accept="audio/mp4,audio/webm,audio/ogg,.m4a" onChange={event=>{const file=event.target.files?.[0];if(file){if(!audioMime(file.type)||file.size>AUDIO_MAX_BYTES)setMessage('Choose MP4/M4A, WebM, or Ogg audio up to 4 MB.');else{setClip(file);setMessage('');}}event.target.value='';}}/></label>
  {url&&<><audio controls src={url}/><button type="button" disabled={busy||recording} onClick={()=>{if(!clip)return;setBusy(true);setMessage('');const form=new FormData();form.append('file',clip);form.append('purpose','chat');void requestData<{id:string}>('/api/duet/media',{method:'POST',body:form}).then(media=>requestData('/api/duet/messages',jsonBody({kind:'audio',mediaId:media.id}))).then(()=>{setClip(null);setMessage('Voice message sent.');}).then(onSent).catch(error=>setMessage(error.message)).finally(()=>setBusy(false));}}>Send voice message</button><button type="button" disabled={busy} onClick={()=>setClip(null)}>Discard</button></>}
  <p role="status">{<StatusText value={message}/>}</p>
 </details>;
}
