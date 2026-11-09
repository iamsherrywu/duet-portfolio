'use client';
import {LoadingStatus,StatusText} from './loading-status';
import {MainNavigation} from './main-navigation';
import {useCallback,useEffect,useRef,useState} from 'react';
import Image from 'next/image';
import {requestData} from '../lib/client-api';
import {HomeStatusEditor,activeMood} from './home-status';
import {PET_ART,petArt,availablePetKinds,type Pet,type PetKind} from '../lib/pets';
const json=(body:unknown)=>({method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
export function PetPortrait({pet,className}:{pet:Pick<Pet,'kind'|'breed'>;className?:string}){
 const art=petArt(pet);return <Image className={className} src={art.src} alt={pet.kind==='cat'?'Cat':'Dog'} width={180} height={180} sizes="180px"/>;
}
export function PetChooser({kind,breed,availableKinds,locked=false,disabled=false,onKindChange,onBreedChange}:{kind:PetKind;breed:string;availableKinds:PetKind[];locked?:boolean;disabled?:boolean;onKindChange:(kind:PetKind)=>void;onBreedChange:(breed:string)=>void}){
 return <fieldset className="pet-chooser" disabled={disabled}><legend className={locked?'shell-sr-only':undefined}>{locked?'Pet looks':'Choose your pet'}</legend>
 {!locked&&<div className="pet-kind-options">{(['cat','dog'] as PetKind[]).map(value=><div key={value}><button type="button" aria-pressed={kind===value} disabled={!availableKinds.includes(value)} onClick={()=>onKindChange(value)}>{value==='cat'?'Cat':'Dog'}</button>{!availableKinds.includes(value)&&<small>Partner’s pet</small>}</div>)}</div>}
 <div className="pet-art-options" role="group" aria-label={kind==='cat'?'Cat looks':'Dog looks'}>{PET_ART.filter(art=>art.kind===kind).map(art=><button type="button" key={art.id} aria-pressed={petArt({kind,breed}).id===art.id} onClick={()=>onBreedChange(art.breed)}><Image src={art.src} alt="" width={112} height={112} sizes="112px"/><span>{art.label}</span></button>)}</div></fieldset>;
}
export function PetForm({userId,pets,onSaved,refreshPets,people=[]}:{userId:string;pets:Pet[];onSaved:()=>void|Promise<void>;refreshPets:()=>Promise<void>;people?:PetOwner[]}){
 const pet=pets.find(p=>p.owner_id===userId);const kinds=availablePetKinds(pets,userId);const partner=pets.find(p=>p.owner_id!==userId),partnerName=people.find(person=>person.id===partner?.owner_id)?.display_name||'Partner';
 const [kind,setKind]=useState<PetKind>(pet?.kind??kinds[0]??'cat');const [breed,setBreed]=useState<string>(pet?petArt(pet).breed:petArt({kind:kinds[0]??'cat',breed:''}).breed);
 const [name,setName]=useState(pet?.name??'');const [theme,setTheme]=useState(pet?.appearance?.theme??'classic');const [message,setMessage]=useState('');const [busy,setBusy]=useState(false);const pending=useRef(false);
 const changeKind=(next:PetKind)=>{setKind(next);setBreed(petArt({kind:next,breed:''}).breed);};
 const availableKey=kinds.join(',');
 useEffect(()=>{if(!pet&&!kinds.includes(kind)&&kinds[0])changeKind(kinds[0]);},[availableKey,kind,pet]);
 return <form className="pet-selection-form" onSubmit={event=>{event.preventDefault();if(pending.current||!name.trim()||!kinds.includes(kind))return;pending.current=true;setBusy(true);setMessage('');void (async()=>{
 try{await requestData(pet?`/api/duet/pets/${pet.id}`:'/api/duet/pets',pet?{...json({breed,name:name.trim(),theme}),method:'PATCH'}:json({kind,breed,name:name.trim()}));await onSaved();setMessage(pet?'Pet updated.':'Your pet is ready.');}
 catch(error){setMessage(error instanceof Error?error.message:'Could not save your pet. Try again.');try{await refreshPets();}catch{/* Keep the original save error and the selected inputs for retry. */}}
 finally{pending.current=false;setBusy(false);}
 })();}}>
 <div className="approved-e-pet-body">{!pet&&<><div className="approved-e-pet-progress" aria-label="Final setup step"><i/><i/><i/></div><p className="approved-d-eyebrow">ONE CAT · ONE DOG</p><p className="approved-e-pet-hint">{partner?`${partnerName}’s pet is already a ${partner.kind}. Choose a ${kinds[0]||'pet'} for your side.`:'One cat and one dog share your space. Choose yours.'}</p>{partner&&<div className="approved-e-pet-lock"><PetPortrait pet={partner}/><div><b>{partnerName} · {partner.kind==='cat'?'Cat':'Dog'}</b><small>{partner.kind==='cat'?'Cat':'Dog'} is already chosen for this space.</small></div><span aria-hidden="true">⌑</span></div>}</>}
 <PetChooser kind={kind} breed={breed} availableKinds={kinds} locked={!!pet||kinds.length===1} disabled={busy} onKindChange={changeKind} onBreedChange={setBreed}/>
 <label>Pet name<input required maxLength={40} value={name} disabled={busy} onChange={e=>setName(e.target.value)}/></label>
 {pet&&<label>Theme<select value={theme} disabled={busy} onChange={e=>setTheme(e.target.value)}><option value="classic">Classic</option><option value="midnight">Midnight</option><option value="sunrise">Sunrise</option></select></label>}
 {!kinds.length&&<p role="alert">No pet is available. Refresh and try again.</p>}{message&&<p role="status">{<StatusText value={message}/>}</p>}</div>
 <footer className="approved-e-pet-footer"><button type="submit" disabled={busy||!name.trim()||!kinds.includes(kind)}>{busy?'Saving…':pet?'Save':`Confirm ${kind}`}</button></footer>
 </form>;
}

export function PetSetup({userId,pets,onComplete}:{userId:string;pets:Pet[];onComplete:()=>void|Promise<void>}){
 const [rows,setRows]=useState(pets),[people,setPeople]=useState<PetOwner[]>([]);const refresh=async()=>{const next=await requestData<Pet[]>('/api/duet/pets');setRows(next);if(next.some(p=>p.owner_id===userId))await onComplete();};
 useEffect(()=>{let active=true;void requestData<{profiles:PetOwner[]}>('/api/duet/couple').then(couple=>{if(active)setPeople(couple.profiles)}).catch(()=>undefined);return()=>{active=false};},[]);
 return <section className="pet-setup approved-e-pet-setup"><h1>Choose your pet</h1><PetForm userId={userId} pets={rows} people={people} onSaved={onComplete} refreshPets={refresh}/><MainNavigation onSelect={()=>window.location.assign('/')}/></section>;
}

type PetMood={user_id:string;mood:string;expires_at:string};
type PetOwner={id:string;display_name:string};
function PetLooksSettings({userId,pets,moods,people,onSaved}:{userId:string;pets:Pet[];moods:PetMood[];people:PetOwner[];onSaved:()=>Promise<void>}){
 const own=pets.find(p=>p.owner_id===userId)!;
 const [name,setName]=useState(own.name),[breed,setBreed]=useState(petArt(own).breed);
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[editingStatus,setEditingStatus]=useState(false);const pending=useRef(false);
 const save=async()=>{if(pending.current||!name.trim())return;pending.current=true;setBusy(true);setMessage('');try{await requestData(`/api/duet/pets/${own.id}`,{...json({breed,name:name.trim(),theme:own.appearance?.theme||'classic'}),method:'PATCH'});await onSaved();setName(name.trim());setMessage('Saved');}catch(error){setMessage(error instanceof Error?error.message:'Could not save your pet. Try again.');}finally{pending.current=false;setBusy(false)}};
 return <><form className="approved-d-pet-form" onSubmit={event=>{event.preventDefault();void save()}}><div className="approved-d-pet-list">{[...pets].sort((a,b)=>a.kind===b.kind?0:a.kind==='cat'?-1:1).map(pet=>{
  const editable=pet.owner_id===userId,selected=editable?{...pet,breed}:pet,owner=people.find(p=>p.id===pet.owner_id),[mood,action]=activeMood(moods,pet.owner_id).split(' · ');
  const status=<><span>Mood <b>{mood||'No status'}</b></span><span>Action <b>{action||'—'}</b></span></>;
  return <section className="approved-d-pet-choice" key={pet.id} aria-label={editable?'Your pet':`${owner?.display_name||'Partner'}’s pet`}>
   <PetPortrait pet={selected} className="approved-d-pet-portrait"/>
   <div className="approved-d-pet-info"><small className="approved-d-pet-owner">{editable?'Your':`${owner?.display_name||'Partner'}’s`} {pet.kind}</small>
    {editable?<label className="approved-d-pet-name"><span className="shell-sr-only">Pet name</span><input aria-label="Pet name" required maxLength={40} value={name} disabled={busy} onChange={event=>setName(event.target.value)}/></label>:<b className="approved-d-pet-partner-name">{pet.name}</b>}
    {editable?<button type="button" className="approved-d-pet-status" aria-label="Edit my mood and action" disabled={busy} onClick={()=>setEditingStatus(true)}>{status}</button>:<div className="approved-d-pet-status" aria-label="Mood and action, read only">{status}</div>}
    <div className="approved-d-pet-looks" role="group" aria-label={editable?'Your pet looks':'Pet looks, read only'}>{PET_ART.filter(art=>art.kind===pet.kind).map(art=>editable?<button key={art.id} type="button" aria-pressed={petArt(selected).id===art.id} disabled={busy} onClick={()=>setBreed(art.breed)}>{art.label}</button>:<span key={art.id} className={petArt(pet).id===art.id?'is-selected':undefined}>{art.label}</span>)}</div>
   </div>
  </section>;
 })}</div><footer className="approved-d-footer">{message&&<p role="status">{<StatusText value={message}/>}</p>}<button type="submit" disabled={busy||!name.trim()}>{busy?'Saving…':'Save'}</button></footer></form>
 {editingStatus&&<HomeStatusEditor value={activeMood(moods,userId)} onClose={()=>setEditingStatus(false)} onSave={async mood=>{await requestData('/api/duet/moods',json({mood}));await onSaved();}}/>}</>;
}
export function PetSettings({userId,defaultOpen=false}:{userId:string;defaultOpen?:boolean}){
 const [pets,setPets]=useState<Pet[]|null>(null),[moods,setMoods]=useState<PetMood[]>([]),[people,setPeople]=useState<PetOwner[]>([]);const [error,setError]=useState('');
 const mounted=useRef(false);
 const refresh=useCallback(async()=>{const [next,status,couple]=await Promise.all([requestData<Pet[]>('/api/duet/pets'),requestData<PetMood[]>('/api/duet/moods'),requestData<{profiles:PetOwner[]}>('/api/duet/couple')]);if(!mounted.current)return;setPets(next);setMoods(status);setPeople(couple.profiles);setError('');},[]);
 useEffect(()=>{mounted.current=true;const load=()=>void refresh().catch(e=>{if(mounted.current)setError(e instanceof Error?e.message:'Could not load pets. Try again.');});load();const timer=window.setInterval(load,30000);return()=>{mounted.current=false;window.clearInterval(timer);};},[userId,refresh]);
 const own=pets?.find(p=>p.owner_id===userId);
 const content=<>{pets?(own?<PetLooksSettings key={own.id} userId={userId} pets={pets} moods={moods} people={people} onSaved={refresh}/>:<PetForm userId={userId} pets={pets} people={people} onSaved={refresh} refreshPets={refresh}/>):<p role="status">{error||<LoadingStatus/>}</p>}{error&&pets&&<p role="status">{error}</p>}{error&&<button type="button" onClick={()=>void refresh().catch(e=>setError(e instanceof Error?e.message:'Could not load pets. Try again.'))}>Retry</button>}</>;
 return defaultOpen?<section className="shell-pet-settings approved-d-pets" aria-label="Pets">{content}</section>:<details className="approved-d-pets"><summary>Pets</summary>{content}</details>;
}
