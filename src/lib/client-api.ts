import {prepareUploadFile} from './upload-draft';
export class ClientApiError extends Error {
  constructor(public code:string,message:string){super(message);}
}

export function isRecord(value:unknown):value is Record<string,unknown> {
  return typeof value==='object'&&value!==null&&!Array.isArray(value);
}

export async function requestData<T>(path:string,init?:RequestInit):Promise<T> {
  const response=await fetch(path,{...init,cache:'no-store'});
  const payload:unknown=await response.json().catch(()=>null);
  if(!response.ok) {
    const error=isRecord(payload)&&isRecord(payload.error)?payload.error:{};
    throw new ClientApiError(typeof error.code==='string'?error.code:'request_failed',typeof error.message==='string'?error.message:'Request failed. Please try again later.');
  }
  if(!isRecord(payload)||!('data' in payload))throw new ClientApiError('invalid_response','The server returned an invalid response.');
  return payload.data as T;
}

export async function uploadImage(file:File,purpose:'story'|'location_avatar'|'chat') {
  const ready=await prepareUploadFile(file);
  const form=new FormData();form.append('file',ready);form.append('purpose',purpose);
  return requestData<{id:string}>('/api/duet/media',{method:'POST',body:form});
}

export async function signedMediaUrl(mediaId:string) {
  const result=await requestData<{url:string}>(`/api/duet/media/${encodeURIComponent(mediaId)}`);
  return result.url;
}
