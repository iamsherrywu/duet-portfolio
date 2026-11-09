import type {PetKind} from './pets';
// Independently implemented finite-state behavior inspired by VS Code Pets.
// Source references and MIT license details: docs/pet-behavior-sources.md.
export type PetBehavior='idle'|'swipe'|'wag'|'stretch'|'doze'|'look'|'hug'|'lean'|'play'|'eat';
export function nextPetBehavior(kind:PetKind,current:PetBehavior,random=Math.random()):PetBehavior{
 if(current!=='idle')return 'idle';
 const choices:PetBehavior[]=kind==='cat'?['swipe','look','stretch','doze']:['wag','look','stretch','doze'];
 return choices[Math.min(choices.length-1,Math.max(0,Math.floor(random*choices.length)))];
}
export function behaviorDuration(behavior:PetBehavior){return {idle:5500,swipe:1800,wag:2400,stretch:3000,doze:5500,look:2200,hug:2400,lean:2200,play:3200,eat:3000}[behavior];}
export const ACTION_BEHAVIOR:Record<string,PetBehavior>={'Paw wave':'swipe','Tail wag':'wag',Play:'play',Wave:'swipe','Tail Wag':'wag',Stretch:'stretch',Hug:'hug','Lean In':'lean','Play Fight':'play',Sleep:'doze',Eat:'eat'};
export function behaviorForAction(action:string):PetBehavior{return ACTION_BEHAVIOR[action]??'idle';}
export function fixedPetSlots<T extends {id:string}>(people:T[],pets:Array<{kind:PetKind;owner_id:string}>){
 const unassigned=people.filter(person=>!pets.some(p=>p.owner_id===person.id));
 return (['cat','dog'] as PetKind[]).map(kind=>({kind,person:people.find(person=>pets.some(p=>p.kind===kind&&p.owner_id===person.id))??unassigned.shift()}));
}
