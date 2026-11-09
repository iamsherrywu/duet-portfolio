export function filterChatMessages<T extends {body:string}>(messages:T[],query:string):T[] {
  const needle=query.trim().toLocaleLowerCase();
  return needle?messages.filter(message=>message.body.toLocaleLowerCase().includes(needle)):messages;
}
export function partnerHasRead(senderId:string,createdAt:string,reads:Array<{user_id:string;last_read_at:string}>) {
  return reads.some(read=>read.user_id!==senderId&&Date.parse(read.last_read_at)>=Date.parse(createdAt));
}
export function mentionsDuet(text:string) {return /(^|\s)@duet(?=\s|$|[,:，：])/i.test(text);}
