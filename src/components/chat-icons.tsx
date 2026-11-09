import type {ReactNode, SVGProps} from 'react';

export type ChatIconName='cat'|'search'|'globe'|'robot'|'mic'|'send'|'plus'|'back'|'more'|'check'|'close'|'heart'|'share'|'save'|'photo'|'refresh'|'shield';

export function ChatIcon({name,...props}:SVGProps<SVGSVGElement>&{name:ChatIconName}) {
  const paths:Record<ChatIconName,ReactNode>={
    search:<><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/></>,
    globe:<><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/></>,
    cat:<><path d="M4 10V3l5 4a10 10 0 0 1 6 0l5-4v7c3 10-19 10-16 0Z"/><path d="M8 11h.01M16 11h.01M10 15l2 1 2-1M2 12l5 1M17 13l5-1"/></>,
    robot:<><rect x="4" y="7" width="16" height="13" rx="3"/><path d="M12 3v4M8 12h.01M16 12h.01M9 16h6"/></>,
    mic:<><rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/></>,
    send:<path d="M12 20V4m-7 7 7-7 7 7"/>,
    plus:<path d="M12 4v16M4 12h16"/>,
    back:<path d="m15 4-8 8 8 8"/>,
    more:<><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></>,
    check:<path d="m5 12 4 4 10-10"/>,
    close:<path d="m6 6 12 12M6 18 18 6"/>,
    heart:<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>,
    share:<path d="M9 5H4v15h16v-5M10 14 21 3M14 3h7v7"/>,
    save:<path d="M6 3h12v18l-6-4-6 4Z"/>,
    photo:<><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 6-6 4 4 3-3 5 5"/></>,
    refresh:<path d="M20 7V2m0 5h-5M4 17v5m0-5h5M20 7a9 9 0 0 0-16 2m0 8a9 9 0 0 0 16-2"/>,
    shield:<path d="m12 2 8 3v6c0 5-4 9-8 11-4-2-8-6-8-11V5Z"/>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name]}</svg>;
}
