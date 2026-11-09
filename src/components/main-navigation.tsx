'use client';
import type {CSSProperties} from 'react';
export type MainTab='home'|'chat'|'calendar'|'me';
export function MainNavigation({active,unread=0,onSelect}:{active?:MainTab;unread?:number;onSelect?:(tab:MainTab)=>void}){
 const select=(tab:MainTab)=>onSelect?onSelect(tab):window.dispatchEvent(new CustomEvent('duet:navigate',{detail:tab}));
 return <nav aria-label="Main navigation" className="shell-bottom-nav">{(['home','chat','calendar','me'] as const).map(tab=><button type="button" key={tab} aria-label={tab[0].toUpperCase()+tab.slice(1)} aria-current={active===tab?'page':undefined} onClick={()=>select(tab)}><span className="shell-nav-icon" style={{'--nav-icon':`url(/mobile/assets/${tab}.svg)`} as CSSProperties} aria-hidden="true"/>{tab==='me'&&unread>0&&<span className="shell-nav-dot" aria-label={`${unread} unread`}/>}</button>)}</nav>;
}
