import {ChatStore} from './ChatStore.js';
import {ChatView,chatDock} from './ChatView.js';

export class ChatController {
  constructor({transport,getState,update,report}){
    Object.assign(this,{transport,getState,update,report});this.views=new WeakMap();this.revision=0;this.loading=new Map();
    this.store=new ChatStore({onChange:store=>{
      this.update(state=>{
        state.chatThreads=store.threads;state.peopleDirectory=store.people;
        state.friends=[...new Set(store.threads.filter(thread=>thread.type==='dm').flatMap(thread=>thread.memberIds))];
        if(!store.thread(state.ui.selectedChatId))state.ui.selectedChatId=store.threads[0]?.id||null;
      },{persist:false});this.schedule();
    }});
  }
  schedule(){if(this.framePending)return;this.framePending=true;requestAnimationFrame(()=>{this.framePending=false;this.mount();});}
  captureScroll(){return [...document.querySelectorAll('.chat-shell [data-chat-messages],.chat-shell .drawer-thread-list')].map(node=>({node,top:node.scrollTop,left:node.scrollLeft}));}
  restoreScroll(snapshot){for(const {node,top,left} of snapshot){node.scrollTop=top;node.scrollLeft=left;}}
  mount(){
    for(const root of document.querySelectorAll('[data-chat-view]')){
      let view=this.views.get(root);if(!view){view=new ChatView(root,{getState:this.getState,onRetry:(threadId,clientId)=>this.retry(threadId,clientId)});this.views.set(root,view);}view.update();
    }
    const dock=document.querySelector('.chat-dock');if(dock){const html=chatDock(this.getState());if(this.dockHTML!==html){const template=document.createElement('template');template.innerHTML=html;dock.replaceWith(template.content);this.dockHTML=html;}}
    this.syncOpen();
  }
  syncOpen(){
    const open=this.getState().ui.chatPanelOpen;
    document.querySelector('.chat-shell')?.classList.toggle('is-open',open);
    const drawer=document.querySelector('#chat-drawer');if(drawer)drawer.inert=!open;
    const toggle=document.querySelector('.chat-edge-toggle');if(toggle){toggle.textContent=open?'›':'‹';toggle.setAttribute('aria-expanded',String(open));toggle.setAttribute('aria-label',open?'Закрыть чаты':'Открыть чаты');}
  }
  setOpen(open){this.update(state=>state.ui.chatPanelOpen=open,{persist:false});this.syncOpen();if(open)this.mount();}
  async refresh(){
    const revision=this.revision;
    try{const data=await this.transport.fetchThreads();if(revision!==this.revision)return;this.store.mergeThreads(data);await this.load(this.getState().ui.selectedChatId);}
    catch(error){if(revision===this.revision)this.report(`Не удалось обновить чаты: ${error.message}`,{kind:'error'});}
  }
  load(id){
    if(!id)return Promise.resolve();if(this.loading.has(id))return this.loading.get(id);
    const revision=this.revision;
    const task=this.transport.fetchMessages(id).then(messages=>{if(revision===this.revision)this.store.mergeMessages(id,messages);}).catch(error=>{
      if(revision!==this.revision)return;const thread=this.store.thread(id);if(thread){thread.error=error.message;this.store.emit();}this.report(`Не удалось загрузить беседу: ${error.message}`,{kind:'error'});
    }).finally(()=>{if(this.loading.get(id)===task)this.loading.delete(id);});this.loading.set(id,task);return task;
  }
  subscribe(){
    this.transport.subscribe({getThreadId:()=>this.getState().ui.selectedChatId,onThreads:data=>this.store.mergeThreads(data),onMessages:(id,messages)=>this.store.mergeMessages(id,messages),onError:error=>this.report(`Не удалось обновить чаты: ${error.message}`,{kind:'error'})});
  }
  select(id,{open=true}={}){
    const thread=this.store.thread(id);if(!thread)return;
    this.update(state=>{state.ui.selectedChatId=id;state.ui.chatTab=thread.type==='group'?'groups':'chats';if(open)state.ui.chatPanelOpen=true;},{persist:false});
    this.mount();return this.load(id);
  }
  tab(tab){
    if(!['chats','groups','calls'].includes(tab))return;
    this.update(state=>{
      state.ui.chatTab=tab;state.ui.chatPanelOpen=true;
      if(tab!=='calls'){const pool=state.chatThreads.filter(thread=>thread.type===(tab==='groups'?'group':'dm'));if(!pool.some(thread=>thread.id===state.ui.selectedChatId))state.ui.selectedChatId=pool[0]?.id||null;}
    },{persist:false});this.mount();if(tab!=='calls')return this.load(this.getState().ui.selectedChatId);
  }
  send(form){
    const text=form.elements.message.value.trim(),id=form.dataset.thread;if(!text||!id)return;
    const message=this.store.enqueue(id,text,this.getState().user);
    form.elements.message.value='';form.elements.message.dispatchEvent(new window.Event('input',{bubbles:true}));
    this.mount();void this.deliver(id,message);
  }
  retry(id,clientId){const message=this.store.sending(id,clientId);if(message){this.mount();void this.deliver(id,message);}}
  async deliver(id,message){
    const revision=this.revision;
    try{const confirmed=await this.transport.sendMessage(id,{text:message.text,clientId:message.clientId});if(revision===this.revision)this.store.confirm(id,message.clientId,confirmed);}
    catch(error){if(revision!==this.revision)return;this.store.fail(id,message.clientId,error);this.report(`Сообщение не отправлено: ${error.message}`,{kind:'error'});}
  }
  clear(){++this.revision;this.transport.unsubscribe();this.loading.clear();this.store.clear();}
}
