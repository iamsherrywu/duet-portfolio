type Media={currentTime:number;muted:boolean;defaultMuted:boolean;loop:boolean;play:()=>Promise<void>;pause:()=>void;load:()=>void};
export type HomeVideoSnapshot={ready:boolean;playing:boolean;completed:boolean;pending:boolean;failed:boolean};
export function createHomeVideoPlayback(media:Media,notify:(state:HomeVideoSnapshot)=>void){
 let active=false,inView=false,pageVisible=true,manualPaused=false,disposed=false,generation=0;
 let startupTimer:ReturnType<typeof setTimeout>|undefined,bufferingTimer:ReturnType<typeof setTimeout>|undefined;
 const state:HomeVideoSnapshot={ready:false,playing:false,completed:false,pending:false,failed:false};
 media.muted=true;media.defaultMuted=true;media.loop=false;
 const snapshot=()=>({...state});
 const publish=()=>{if(!disposed)notify(snapshot());};
 const clearTimers=()=>{if(startupTimer)clearTimeout(startupTimer);if(bufferingTimer)clearTimeout(bufferingTimer);startupTimer=undefined;bufferingTimer=undefined;};
 const fail=()=>{clearTimers();generation++;state.failed=true;state.ready=false;state.pending=false;state.playing=false;manualPaused=true;media.pause();publish();};
 const canPlay=()=>!disposed&&active&&inView&&pageVisible&&state.ready&&!state.completed&&!state.failed&&!manualPaused;
 const sync=()=>{
  if(!canPlay()){generation++;state.pending=false;clearTimers();media.pause();state.playing=false;publish();return;}
  if(state.playing||state.pending)return;
  const attempt=++generation;state.pending=true;publish();
  startupTimer=setTimeout(()=>{if(!disposed&&attempt===generation&&state.pending)fail();},10000);
  const rejected=()=>{if(disposed||attempt!==generation)return;clearTimers();state.pending=false;state.playing=false;state.failed=true;manualPaused=true;media.pause();publish();};
  try{void Promise.resolve(media.play()).then(()=>{
   if(disposed||attempt!==generation){if(!canPlay())media.pause();return;}
   clearTimers();state.pending=false;if(!canPlay()){sync();return;}state.playing=true;publish();
  },rejected);}catch{rejected();}
 };
 return {
  snapshot,
  setActive(value:boolean){active=value;sync();},
  setInView(value:boolean){inView=value;sync();},
  setPageVisible(value:boolean){pageVisible=value;sync();},
  ready(){state.ready=true;sync();},
  playing(){clearTimers();if(!canPlay()){media.pause();return;}state.pending=false;state.playing=true;publish();},
  waiting(){if(!state.playing)return;if(bufferingTimer)clearTimeout(bufferingTimer);const attempt=generation;bufferingTimer=setTimeout(()=>{if(!disposed&&attempt===generation&&state.playing)fail();},3000);},
  paused(){clearTimers();state.playing=false;publish();},
  ended(){clearTimers();generation++;state.pending=false;state.playing=false;state.completed=true;publish();},
  failed(){fail();},
  toggle(){
   if(disposed)return;
   if(state.failed){state.failed=false;manualPaused=false;if(state.ready)sync();else{media.load();publish();}return;}
   if(state.completed){state.completed=false;media.currentTime=0;manualPaused=false;}
   else if(state.playing||state.pending){manualPaused=true;}
   else manualPaused=false;
   sync();
  },
  dispose(){disposed=true;generation++;state.pending=false;clearTimers();media.pause();},
 };
}
