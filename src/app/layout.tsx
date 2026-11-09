import type { Metadata } from 'next';
import './globals.css';
import '../components/production-shell.css';
import '../components/production-chat.css';
import '../components/production-home-calendar.css';
import '../components/production-profile.css';
import '../components/production-approved-a.css';
import '../components/production-approved-b.css';
import '../components/production-approved-c.css';
import '../components/production-approved-d-pets.css';
import '../components/production-approved-d-account.css';
import '../components/production-approved-ef.css';
import '../components/production-final-parity.css';
export const metadata:Metadata={title:'Duet',description:'Our songs, conversations, and home'};
export default function Layout({children}:{children:React.ReactNode}) { return <html lang="en"><body data-design-revision="approved-20261103-current-browser">{children}</body></html>; }
