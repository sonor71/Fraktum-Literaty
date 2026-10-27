// Repository contract: fetchThreads -> {threads, people}, fetchMessages -> DTO[],
// sendMessage(threadId, {clientId,text}) -> DTO, createGroup -> thread DTO.
// No DOM, auth tokens or Supabase realtime APIs cross this boundary.
export class PollingChatTransport {
  constructor(repository,{interval=1800,schedule=(callback,delay)=>setInterval(callback,delay),cancel=timer=>clearInterval(timer)}={}){
    Object.assign(this,{repository,interval,schedule,cancel});this.generation=0;
  }
  fetchThreads(){return this.repository.fetchThreads();}
  fetchMessages(threadId){return this.repository.fetchMessages(threadId);}
  sendMessage(threadId,message){return this.repository.sendMessage(threadId,message);}
  createGroup(group){return this.repository.createGroup(group);}
  subscribe({getThreadId,onThreads,onMessages,onError}){
    this.unsubscribe();const generation=this.generation;let busy=false;
    const poll=async()=>{
      if(busy)return;busy=true;
      try{
        const data=await this.fetchThreads();if(generation!==this.generation)return;
        onThreads(data);
        const id=getThreadId();if(!id)return;
        const messages=await this.fetchMessages(id);if(generation===this.generation)onMessages(id,messages);
      }catch(error){if(generation===this.generation)onError(error);}finally{busy=false;}
    };
    this.timer=this.schedule(poll,this.interval);
    return ()=>{if(generation===this.generation)this.unsubscribe();};
  }
  unsubscribe(){this.generation++;if(this.timer!=null)this.cancel(this.timer);this.timer=null;}
}
