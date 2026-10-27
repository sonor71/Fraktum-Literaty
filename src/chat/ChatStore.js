// Transport-neutral state. A client UUID also becomes the server row ID, so a
// late acknowledgement, a poll and a retry all reconcile to the same message.
export class ChatStore {
  constructor({onChange=()=>{},uuid=()=>crypto.randomUUID(),now=()=>new Date()}={}) {
    Object.assign(this,{onChange,uuid,now});this.threads=[];this.people=[];
  }
  thread(id){return this.threads.find(thread=>thread.id===id);}
  emit(){this.onChange(this);}
  mergeThreads({threads,people}){
    const previous=new Map(this.threads.map(thread=>[thread.id,thread]));
    this.threads=threads.map(thread=>({...thread,messages:previous.get(thread.id)?.messages||[],loaded:previous.get(thread.id)?.loaded||false,error:previous.get(thread.id)?.error||''}));
    // An acknowledged group can precede a poll started before its creation.
    for(const thread of previous.values())if(thread.justCreated&&!this.thread(thread.id))this.threads.unshift(thread);
    this.people=people;this.emit();
  }
  addThread(thread){
    if(!this.thread(thread.id))this.threads.unshift({...thread,messages:[],loaded:true,justCreated:true});
    this.emit();
  }
  mergeMessages(id,messages){
    const thread=this.thread(id);if(!thread)return;
    const merged=new Map(thread.messages.map(message=>[message.clientId||message.id,message]));
    for(const message of messages){
      const key=message.clientId||message.id,old=merged.get(key);
      merged.set(key,{...old,...message,clientId:old?.clientId||message.id,status:'sent',error:''});
    }
    thread.messages=[...merged.values()].sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt)));
    thread.loaded=true;thread.error='';this.emit();
  }
  enqueue(id,text,user){
    const thread=this.thread(id);if(!thread)throw new Error('Беседа недоступна');
    const clientId=this.uuid(),date=this.now();
    const message={id:`client:${clientId}`,clientId,fromId:user.id,from:user.name||user.nickname||'Вы',text,mine:true,createdAt:date.toISOString(),time:date.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}),status:'sending'};
    thread.messages.push(message);this.emit();return message;
  }
  message(threadId,clientId){return this.thread(threadId)?.messages.find(message=>(message.clientId||message.id)===clientId);}
  sending(threadId,clientId){const message=this.message(threadId,clientId);if(!message||message.status!=='failed')return null;message.status='sending';message.error='';this.emit();return message;}
  confirm(threadId,clientId,message){this.mergeMessages(threadId,[{...message,clientId}]);}
  fail(threadId,clientId,error){const message=this.message(threadId,clientId);if(!message||message.status==='sent')return;message.status='failed';message.error=error.message||String(error);this.emit();}
  clear(){this.threads=[];this.people=[];this.emit();}
}
