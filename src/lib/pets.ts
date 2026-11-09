export type PetKind='cat'|'dog';
export type Pet={id:string;kind:PetKind;owner_id:string;name:string;breed:string;appearance:{theme?:string}};
export const PET_ART=([
 {id:'cat-devon',kind:'cat',breed:'Devon Rex',label:'Devon Rex'},
 {id:'cat-ivory',kind:'cat',breed:'Ivory Shorthair',label:'Ivory'},
 {id:'cat-maine',kind:'cat',breed:'Maine Coon',label:'Maine Coon'},
 {id:'cat-black',kind:'cat',breed:'Black Shorthair',label:'Black'},
 {id:'cat-abyssinian',kind:'cat',breed:'Abyssinian',label:'Abyssinian'},
 {id:'cat-bengal',kind:'cat',breed:'Bengal',label:'Bengal'},
 {id:'cat-siamese',kind:'cat',breed:'Siamese',label:'Siamese'},
 {id:'dog-westie',kind:'dog',breed:'West Highland White Terrier',label:'Westie'},
 {id:'dog-pomeranian',kind:'dog',breed:'Pomeranian',label:'Pomeranian'},
 {id:'dog-golden',kind:'dog',breed:'Golden Retriever',label:'Golden Retriever'},
 {id:'dog-greyhound',kind:'dog',breed:'Greyhound',label:'Greyhound'},
 {id:'dog-collie',kind:'dog',breed:'Border Collie',label:'Border Collie'},
 ] as const).map(art=>({...art,src:`/duet/pets/${art.id}${art.id==='dog-collie'?'-20261103':''}.png`}));
const aliases:Record<string,string>={'Silver Shorthair':'Devon Rex','蓝猫':'Devon Rex','缅因':'Maine Coon','缅因猫':'Maine Coon','德文':'Devon Rex','德文卷毛猫':'Devon Rex','西高地':'West Highland White Terrier','Westie':'West Highland White Terrier'};
export function petArt(pet:Pick<Pet,'kind'|'breed'>){
 return PET_ART.find(art=>art.kind===pet.kind&&art.breed===(aliases[pet.breed]??pet.breed))??PET_ART.find(art=>art.kind===pet.kind)!;
}
export function availablePetKinds(pets:Array<Pick<Pet,'kind'|'owner_id'>>,userId:string):PetKind[]{
 const own=pets.find(p=>p.owner_id===userId);if(own)return [own.kind];
 return (['cat','dog'] as PetKind[]).filter(kind=>!pets.some(p=>p.kind===kind));
}
