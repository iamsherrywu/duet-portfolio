export type AccountSnapshot<T>={userId:string|null|undefined;data:T|null;error:string};
export function createAccountLifecycle<T>(load:(id:string)=>Promise<T>,publish:(value:AccountSnapshot<T>)=>void) {
  let current:string|null|undefined;let generation=0;let disposed=false;
  const identify=(id:string|null,force=false):Promise<void>=>{
    if(disposed||(!force&&current===id))return Promise.resolve();
    current=id;const version=++generation;publish({userId:id,data:null,error:''});
    if(!id)return Promise.resolve();
    // Defer work outside Supabase's auth-state callback/lock.
    return Promise.resolve().then(()=>load(id)).then(data=>{
      if(!disposed&&version===generation)publish({userId:id,data,error:''});
    }).catch(error=>{if(!disposed&&version===generation)publish({userId:id,data:null,error:error instanceof Error?error.message:'Unable to load your account.'});});
  };
  return {identify,refresh:()=>identify(current??null,true),dispose:()=>{disposed=true;generation++;}};
}
