import {InviteEntry} from '../../../components/invite-entry';
export default async function InvitePage({params}:{params:Promise<{token:string}>}) {
  const {token}=await params;return <InviteEntry token={token}/>;
}
