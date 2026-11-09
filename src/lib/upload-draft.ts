type Purpose='story'|'location_avatar'|'chat';
export function createUploadDraft(upload:(file:File,purpose:Purpose)=>Promise<{id:string}>) {
  let previous:File|null=null;let previousPurpose:Purpose|null=null;let pending:Promise<{id:string}>|null=null;
  return {clear(){previous=null;pending=null;previousPurpose=null;},resolve(file:File,purpose:Purpose){
    if(file!==previous||purpose!==previousPurpose||!pending){previous=file;previousPurpose=purpose;pending=upload(file,purpose).catch(error=>{pending=null;throw error;});}
    return pending;
  }};
}
async function resize(file:File,edge:number,quality:number):Promise<Blob> {
  const url=URL.createObjectURL(file);
  try {
    const image=new Image();image.src=url;await image.decode();
    const scale=Math.min(1,edge/Math.max(image.naturalWidth,image.naturalHeight));
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
    const context=canvas.getContext('2d');if(!context)throw new Error('Unable to process this image.');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);
    return await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('Unable to process this image.')),'image/jpeg',quality));
  }finally{URL.revokeObjectURL(url);}
}
export async function prepareUploadFile(file:File,encode=resize):Promise<File> {
  const limit=3.5*1024*1024;
  if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw new Error('Choose a PNG, JPEG, or WebP image.');
  if(file.size<=limit)return file;
  for(const [edge,quality] of [[1600,.85],[1280,.7],[960,.55]]) {
    const result=await encode(file,edge,quality);
    if(result.size<=limit)return new File([result],'duet-photo.jpg',{type:'image/jpeg'});
  }
  throw new Error('This image is still too large. Resize it before uploading (3.5 MB limit).');
}
