import {petArt,type Pet} from './pets';

type PetArtId=typeof import('./pets').PET_ART[number]['id'];
type PetPoseConfig={source:'original'|'inward';mirror:boolean;neck:number;paw:[number,number,number,number];tail:[number,number,number,number];tailOrigin?:[number,number]};

/** One explicit art, orientation, and movement rig per selectable appearance. */
export const PET_POSES:Record<PetArtId,PetPoseConfig>={
 'cat-devon':{source:'inward',mirror:false,neck:40,paw:[38,69,10,24],tail:[72,57,21,34]},
 'cat-ivory':{source:'inward',mirror:false,neck:42,paw:[60,72,12,20],tail:[18,76,30,15]},
 'cat-maine':{source:'original',mirror:true,neck:40,paw:[30,73,18,20],tail:[54,76,39,20]},
 'cat-black':{source:'inward',mirror:false,neck:40,paw:[49,72,10,21],tail:[26,73,18,19]},
 'cat-abyssinian':{source:'original',mirror:false,neck:40,paw:[47,73,11,21],tail:[22,78,30,14]},
 'cat-bengal':{source:'original',mirror:false,neck:39,paw:[48,73,12,20],tail:[22,76,26,18]},
 'cat-siamese':{source:'original',mirror:false,neck:38,paw:[49,74,12,21],tail:[24,79,29,15]},
 'dog-westie':{source:'inward',mirror:false,neck:48,paw:[32,72,13,18],tail:[68,54,15,31]},
 'dog-pomeranian':{source:'inward',mirror:false,neck:43,paw:[31,74,12,17],tail:[68,55,24,29]},
 'dog-golden':{source:'inward',mirror:false,neck:43,paw:[29,74,13,17],tail:[64,77,31,16]},
 'dog-greyhound':{source:'inward',mirror:false,neck:32,paw:[37,74,10,20],tail:[20,79,23,14]},
 'dog-collie':{source:'inward',mirror:false,neck:43,paw:[35,73,12,19],tail:[66,77,24,16],tailOrigin:[67,79]},
};

export function petPose(pet:Pick<Pet,'kind'|'breed'>){
 const art=petArt(pet),pose=PET_POSES[art.id];
 const src=pose.source==='original'?art.src:art.src.replace('/duet/pets/','/duet/pets/inward/');
 return {src,facing:pet.kind==='cat'?'right':'left',...pose};
}
export function petAction(status:string){const action=status.split(' · ').at(-1);return ['Wave','Tail Wag','Stretch','Hug','Lean In','Play Fight','Sleep','Eat'].includes(action??'')?action!:'Idle';}
