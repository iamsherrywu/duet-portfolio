// Process/component memory only. Values never persist to localStorage or a database.
export function createRecognitionCache<T>(limit=32,ttl=600000,now=Date.now,accept:(value:T)=>boolean=()=>true) {
 const entries=new Map<string,{expires:number;promise:Promise<T>}>();
 return (key:string,load:()=>Promise<T>):Promise<T>=>{
  const existing=entries.get(key);if(existing&&existing.expires>now())return existing.promise;
  entries.delete(key);
  while(entries.size>=limit)entries.delete(entries.keys().next().value!);
  const entry={expires:now()+ttl,promise:Promise.resolve().then(load)};
  entries.set(key,entry);
  entry.promise=entry.promise.then(value=>{if(!accept(value)&&entries.get(key)===entry)entries.delete(key);return value;},error=>{if(entries.get(key)===entry)entries.delete(key);throw error;});
  return entry.promise;
 };
}
