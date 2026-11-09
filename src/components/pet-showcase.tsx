'use client';
import {LoadingStatus,StatusText} from './loading-status';

import {useCallback,useEffect,useRef,useState} from 'react';
import {requestData} from '../lib/client-api';
import {fixedPetSlots} from '../lib/pet-behavior';
import {petArt,type Pet} from '../lib/pets';
import {HomeStatusEditor,activeMood} from './home-status';
import {AnimatedPet} from './animated-pet';

type Mood={user_id:string;mood:string;expires_at:string};
type Person={id:string;display_name:string;gender:string|null;clown_role:string|null};
const jsonBody=(body:unknown)=>({method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});

export function PetShowcase({userId,timezone,active,showStatus=false}:{userId:string;timezone:string;active:boolean;showStatus?:boolean}){
 const [people,setPeople]=useState<Person[]>([]),[moods,setMoods]=useState<Mood[]>([]),[pets,setPets]=useState<Pet[]>([]);
 const [message,setMessage]=useState(''),[editingStatus,setEditingStatus]=useState(false);
 const [selectedPet,setSelectedPet]=useState<string|null>(null);
 const hold=useRef<ReturnType<typeof setTimeout>|null>(null),held=useRef(false),pointer=useRef<{x:number;y:number}|null>(null);
 useEffect(()=>{setSelectedPet(null);setEditingStatus(false);},[active]);
 const cancelHold=()=>{if(hold.current)clearTimeout(hold.current);hold.current=null;};
 useEffect(()=>()=>{if(hold.current)clearTimeout(hold.current);},[]);
 const load=useCallback(async()=>{
  const [couple,nextMoods,nextPets]=await Promise.all([
   requestData<{profiles:Person[]}>('/api/duet/couple'),requestData<Mood[]>('/api/duet/moods'),requestData<Pet[]>('/api/duet/pets')
  ]);
  setPeople(couple.profiles);setMoods(nextMoods);setPets(nextPets);
 },[]);
 useEffect(()=>{if(!active)return;void load().catch(error=>setMessage(error instanceof Error?error.message:'Could not load pets. Try again.'));const timer=window.setInterval(()=>void load().catch(()=>undefined),30000);return()=>window.clearInterval(timer);},[active,load]);
 const petSlots=fixedPetSlots(people.length?people:[{id:userId,display_name:'Me',gender:null,clown_role:null}],pets);
 const ownPet=pets.find(pet=>pet.owner_id===userId);
 const selectedPerson=people.find(person=>person.id===selectedPet);
 const selectedAnimal=pets.find(pet=>pet.owner_id===selectedPet);

 return <section aria-label="Our pets" className="pet-home pet-showcase production-pets">
  <section className="home-pets"><div className="pet-pair has-sofa"><img className="pet-sofa" src="/duet/pet-sofa.png" alt="" aria-hidden="true" width={300} height={300}/>{petSlots.map(({kind,person},slot)=>{if(!person)return null;const pet=pets.find(row=>row.owner_id===person.id);return <article className="pet-column" data-kind={kind} style={{gridColumn:slot+1,gridRow:1}} data-theme={pet?.appearance?.theme||'classic'} key={person.id}
   onPointerDown={event=>{held.current=false;pointer.current={x:event.clientX,y:event.clientY};cancelHold();if(person.id===userId)hold.current=setTimeout(()=>{held.current=true;setSelectedPet(person.id);setEditingStatus(true);},500);}}
   onPointerMove={event=>{if(pointer.current&&Math.hypot(event.clientX-pointer.current.x,event.clientY-pointer.current.y)>10)cancelHold();}} onPointerUp={cancelHold} onPointerCancel={cancelHold}
   onClickCapture={event=>{if(held.current){event.preventDefault();event.stopPropagation();held.current=false;return;}setSelectedPet(current=>current===person.id?null:person.id);}}
   onContextMenu={event=>{event.preventDefault();cancelHold();if(person.id===userId){setSelectedPet(person.id);setEditingStatus(true);}}}>
   {pet?<AnimatedPet pet={pet} status={activeMood(moods,person.id)} active={active}/>:null}
  </article>;})}</div>
  {selectedPerson&&<div className="production-pet-inspector" data-kind={selectedAnimal?.kind} onClick={()=>setSelectedPet(null)}><strong>{selectedAnimal?.name||selectedPerson.display_name}</strong><span>{activeMood(moods,selectedPerson.id).split(' · ')[0]||'No mood'}</span></div>}
  </section>
  {showStatus&&<div className="production-pet-status-list approved-pet-status-cards">{petSlots.map(({person,kind})=>{if(!person)return null;const pet=pets.find(pet=>pet.owner_id===person.id),[mood,action]=activeMood(moods,person.id).split(' · ');const content=<>{pet&&<img src={petArt(pet).src} alt="" width={76} height={92}/>}<span className="approved-pet-fields"><strong>{pet?.name||person.display_name}</strong><span><small>Mood</small><b>{mood||'No status'}</b></span><span><small>Action</small><b>{action||'Idle'}</b></span></span></>;return person.id===userId?<button type="button" key={person.id} className="approved-pet-status-card" aria-label={`Edit ${pet?.name||'my pet'} mood and action`} onClick={()=>setEditingStatus(true)}>{content}</button>:<article key={person.id} className="approved-pet-status-card" aria-label={`${pet?.name||kind} mood and action, read only`}>{content}</article>;})}</div>}
  {editingStatus&&<HomeStatusEditor pets={pets} userId={userId} moods={moods} onRename={async name=>{if(ownPet)await requestData(`/api/duet/pets/${ownPet.id}`,{...jsonBody({name}),method:'PATCH'});}} value={activeMood(moods,userId)} onClose={()=>setEditingStatus(false)} onSave={async mood=>{await requestData('/api/duet/moods',jsonBody({mood}));await load();setMessage('Mood and activity shared for today.');}}/>}
  {message&&<p role="status">{<StatusText value={message}/>}</p>}
 </section>;
}
