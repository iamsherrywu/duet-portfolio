export type PublicProfile={display_name:string;gender:string|null;timezone?:string};
export function accountUser<T extends {id:string}>(result:{data:{user:T|null};error:Error|null}):T|null {
  if(result.error&&result.error.name!=='AuthSessionMissingError')throw result.error;
  return result.data.user;
}
export function accountStep(state:{userId:string|null;profile:PublicProfile|null;coupleId:string|null}):'sign-in'|'profile'|'pair'|'ready' {
  if(!state.userId)return 'sign-in';
  if(!state.profile?.gender||!state.profile.display_name.trim())return 'profile';
  return state.coupleId?'ready':'pair';
}
export function inviteTokenFromInput(value:string):string|null {
  const input=value.trim();if(/^[a-f0-9]{64}$/.test(input))return input;
  try{return new URL(input).pathname.match(/^\/invite\/([a-f0-9]{64})\/?$/)?.[1]??null;}catch{return null;}
}
