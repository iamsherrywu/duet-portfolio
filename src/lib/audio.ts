export const AUDIO_MAX_BYTES=4*1024*1024;
export function audioMime(value:string):'audio/mp4'|'audio/webm'|'audio/ogg'|null {
  const mime=value.split(';')[0].trim().toLowerCase();
  return mime==='audio/mp4'||mime==='audio/webm'||mime==='audio/ogg'?mime:null;
}
export function validateAudioHeader(bytes:Uint8Array,mime:string) {
  if(bytes.length<8||bytes.length>AUDIO_MAX_BYTES)return false;
  if(mime==='audio/mp4')return bytes[4]===102&&bytes[5]===116&&bytes[6]===121&&bytes[7]===112;
  if(mime==='audio/webm')return bytes[0]===26&&bytes[1]===69&&bytes[2]===223&&bytes[3]===163;
  if(mime==='audio/ogg')return bytes[0]===79&&bytes[1]===103&&bytes[2]===103&&bytes[3]===83;
  return false;
}
