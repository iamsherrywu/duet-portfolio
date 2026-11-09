export function isOnline(presence:{online:boolean;last_seen_at:string}|null,now=Date.now()):boolean {
 const seen=presence?Date.parse(presence.last_seen_at):NaN;
 return !!presence?.online&&Number.isFinite(seen)&&seen<=now+5000&&now-seen<45000;
}
