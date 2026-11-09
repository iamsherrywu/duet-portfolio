import {requestData} from './client-api';
import {prepareUploadFile} from './upload-draft';
import {createRecognitionCache} from './recognition-cache';
export type ImportedSong={title?:string;artist?:string;album?:string;version?:string;coverMediaId?:string|null;uncertainFields?:string[];needsManualEntry?:boolean};
export function createScreenshotRecognizer(send:(file:File)=>Promise<ImportedSong>=async file=>{
 const form=new FormData();form.append('file',file);
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),50000);
 try{return await requestData<ImportedSong>('/api/duet/media/recognize',{method:'POST',body:form,signal:controller.signal});}
 catch(error){if(controller.signal.aborted)throw new Error('Recognition timed out. Please try a clearer screenshot.');throw error;}
 finally{clearTimeout(timer);}
}){
 const cache=createRecognitionCache<ImportedSong>(5,600000,Date.now,result=>Boolean(result.title?.trim()&&result.artist?.trim()&&!result.needsManualEntry&&!result.uncertainFields?.length));
 return async(file:File,userId:string)=>{
  const ready=await prepareUploadFile(file);
  // Account-prefixed, in-memory cache only: no screenshots or results in browser storage.
  const digest=await crypto.subtle.digest('SHA-256',await ready.arrayBuffer());
  const key=userId+':'+Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');
  return cache(key,()=>send(ready));
 };
}
