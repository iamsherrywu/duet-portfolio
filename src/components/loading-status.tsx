export function LoadingStatus(){return <span className="duet-loading-spinner" role="status" aria-busy="true" aria-label="Loading"/>;}
export function StatusText({value}:{value:string}){return /^(Loading|Checking|Opening|Uploading|Preparing)[^.!?]*…$/.test(value)?<LoadingStatus/>:<>{value}</>;}
