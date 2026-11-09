'use client';
import {useId} from 'react';
import type {CSSProperties} from 'react';
import type {Pet} from '../lib/pets';
import {usePetBehavior} from './use-pet-behavior';
import {petAction,petPose} from '../lib/pet-motion';
import {petExpression} from '../lib/pet-expression';
export function AnimatedPet({pet,status,active}:{pet:Pet;status:string;active:boolean}){
 const pose=petPose(pet),id=useId().replaceAll(':','');
 const expression=petExpression(pet,status),outline=`${id}-expression`;
 const image=expression?<svg x={50-expression.displayWidth/2} y={90-expression.displayHeight} width={expression.displayWidth} height={expression.displayHeight} viewBox={`${expression.x} ${expression.y} ${expression.width} ${expression.height}`} overflow="hidden"><image href={expression.src} width={expression.atlasWidth} height={expression.atlasHeight} clipPath={`url(#${outline})`}/></svg>:<image href={pose.src} x="0" y="0" width="100" height="100" preserveAspectRatio="none"/>;
 const {behavior,enabled,revision,greet}=usePetBehavior(pet.kind,status,active);
 return <button type="button" className="animated-pet home-pet-art" aria-label={`Greet ${pet.name}`} data-kind={pet.kind} data-expression={expression?.frame} data-active={active} data-motion-enabled={enabled} data-behavior={behavior} data-motion-revision={revision} data-action={petAction(status)} style={{'--pet-inward':pet.kind==='cat'?1:-1,'--pet-delay':pet.kind==='cat'?'-1.4s':'-3.7s'} as CSSProperties} onClick={greet}>
 <span key={`${behavior}-${revision}`} className="pet-motion-interaction"><svg viewBox="0 0 100 100" aria-hidden="true" focusable="false"><defs>{expression&&<clipPath id={outline} clipPathUnits="userSpaceOnUse"><polygon points={expression.outline}/></clipPath>}</defs>
 <g transform={pose.mirror?'translate(100 0) scale(-1 1)':undefined}>
 <g className="pet-motion-breathe">{image}</g>
 </g></svg></span></button>;
}
