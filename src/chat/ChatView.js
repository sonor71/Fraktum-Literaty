import {esc} from '../ui.js';
import {animateLocal,fadePreviousMessages,fadePreviousContent} from '../motion/Motion.js';

const initials=name=>String(name||'?').split(/\s+/).map(word=>word[0]).join('').slice(0,2).toUpperCase();
export const callButtons=thread=>`<div class="call-actions">${[['audio','☎','Аудиозвонок'],['video','▣','Видеозвонок']].map(([mode,icon,label])=>`<button data-action="start-call" data-id="${esc(thread.id)}" data-mode="${mode}" ${thread.type!=='dm'?'disabled':''} title="${thread.type!=='dm'?'Групповые звонки — Скоро':label}" aria-label="${label}">${icon}${thread.type!=='dm'?' Скоро':''}</button>`).join('')}</div>`;
const composer=()=>'<form class="thread-message-form"><input name="message" aria-label="Сообщение" placeholder="Сообщение…" autocomplete="off" required><button class="primary" aria-label="Отправить сообщение" title="Отправить сообщение">→</button></form>';
const conversation=drawer=>`<section class="${drawer?'drawer-chat':'chat'}" data-chat-conversation><div class="${drawer?'drawer-chat-head':'chat-main-head'}" data-chat-header></div><div class="message-viewport"><div class="${drawer?'drawer-messages':'message-stream'}" data-chat-messages role="log" aria-label="Сообщения беседы" aria-relevant="additions" tabindex="0"></div><button class="new-messages" data-action="chat-latest" hidden>Новые сообщения ↓</button></div>${composer()}</section>`;
export function chatDrawer(state){
  return `<section id="chat-drawer" class="chat-drawer" aria-label="Сообщения" data-chat-view="drawer" ${state.ui.chatPanelOpen?'':'inert'}><header><div><b>Сообщения</b><small>Личные чаты, группы и звонки</small></div><button data-action="toggle-chat-panel" aria-label="Закрыть чаты" title="Закрыть чаты">×</button></header>
    <div class="drawer-tabs" role="tablist" aria-label="Разделы сообщений">${[['chats','Чаты'],['groups','Группы'],['calls','Звонки']].map(([tab,label])=>`<button id="chat-tab-${tab}" role="tab" aria-controls="chat-panel-${tab}" data-action="chat-tab" data-tab="${tab}">${label}</button>`).join('')}<span class="chat-tab-indicator" aria-hidden="true"></span></div>
    <div class="drawer-tab-panels">${['chats','groups'].map(tab=>`<section id="chat-panel-${tab}" role="tabpanel" aria-labelledby="chat-tab-${tab}" data-chat-tab-panel="${tab}" ${tab===(state.ui.chatTab||'chats')?'':'hidden'}>${tab==='chats'?'<div class="drawer-section add-friend"><h3>Добавить друга</h3><form id="friendForm"><input name="username" aria-label="Username друга" placeholder="@username" required><button class="primary">Добавить</button></form></div>':state.user?.role==='author'?'<div class="drawer-section"><button class="primary wide" data-action="new-collab-group">+ Группа для проекта</button></div>':''}<div class="drawer-thread-list" data-chat-threads="${tab==='groups'?'group':'dm'}"></div></section>`).join('')}<section id="chat-panel-calls" class="drawer-section" role="tabpanel" aria-labelledby="chat-tab-calls" data-chat-tab-panel="calls" data-chat-calls ${state.ui.chatTab==='calls'?'':'hidden'}></section></div>${conversation(true)}</section>`;
}
export function chatDock(state){
  return `<aside class="chat-dock"><div class="dock-title">Личные чаты</div><div class="dock-friends">${state.friends.map(id=>state.peopleDirectory.find(person=>person.id===id)).filter(Boolean).slice(0,5).map(person=>`<button class="dock-person" data-action="open-chat-person" data-id="${esc(person.id)}" title="${esc(person.name)} @${esc(person.username)}"><span class="dock-avatar">${esc(initials(person.name))}</span><small>${esc(person.name.split(' ')[0])}</small></button>`).join('')}</div>${state.activeCall?'<button class="dock-call-live" data-action="toggle-chat-panel" title="Активный звонок">●</button>':''}</aside>`;
}
export function messagesContent(state){
  return `<div class="page-head"><div><h1>Сообщения</h1><p>Личные чаты и рабочие группы вокруг произведений.</p></div><div class="actions"><button data-action="toggle-chat-panel">Открыть мини-панель</button>${state.user?.role==='author'?'<button class="primary" data-action="new-collab-group">+ Группа проекта</button>':''}</div></div><div class="messages-layout" data-chat-view="main"><aside class="chat-list" data-chat-threads="all"></aside>${conversation(false)}<aside class="card" data-chat-members></aside></div>`;
}
const setHTML=(node,html)=>{if(node&&node._chatHTML!==html){node.innerHTML=html;node._chatHTML=html;}};
const messageHTML=message=>`<b>${esc(message.from)}</b><small>${esc(message.time)}</small><p>${esc(message.text)}</p>${message.mine?`<span class="message-state" role="status">${message.status==='sending'?'Отправляется…':message.status==='failed'?'Не отправлено':'Отправлено'}</span>${message.status==='failed'?`<button class="message-retry" data-action="chat-retry" data-client-id="${esc(message.clientId)}" title="${esc(message.error||'Повторить отправку')}" aria-label="Повторить отправку сообщения">Повторить</button>`:''}`:''}`;
function updateMessage(bubble,message){
  if(!bubble.firstChild){setHTML(bubble,messageHTML(message));return;}
  const text=(selector,value)=>{const node=bubble.querySelector(selector);if(node&&node.textContent!==value)node.textContent=value;};
  text('b',message.from);text('small',message.time);text('p',message.text);
  text('.message-state',message.status==='sending'?'Отправляется…':message.status==='failed'?'Не отправлено':'Отправлено');
  let retry=bubble.querySelector('.message-retry');
  if(message.status!=='failed'){retry?.remove();return;}
  if(!retry){retry=document.createElement('button');retry.className='message-retry';retry.dataset.action='chat-retry';retry.dataset.clientId=message.clientId;retry.textContent='Повторить';retry.setAttribute('aria-label','Повторить отправку сообщения');bubble.append(retry);}
  retry.title=message.error||'Повторить отправку';
}

export class ChatView {
  constructor(root,{getState,onRetry,onLatest}={}){
    this.root=root;this.getState=getState;this.seen=new Set();this.threadId=null;this.drafts=new Map();
    this.stream=root.querySelector('[data-chat-messages]');this.form=root.querySelector('.thread-message-form');
    this.latest=root.querySelector('.new-messages');this.unread=0;
    this.stream.addEventListener('scroll',()=>{if(this.nearBottom()){this.unread=0;this.latest.hidden=true;}},{passive:true});
    this.form.elements.message.addEventListener('input',()=>{if(this.threadId)this.drafts.set(this.threadId,this.form.elements.message.value);});
    root.addEventListener('click',event=>{
      const button=event.target.closest('[data-action]');if(!button)return;
      if(button.dataset.action==='chat-latest'){this.scrollLatest();onLatest?.();}
      if(button.dataset.action==='chat-retry')onRetry(this.threadId,button.dataset.clientId);
    });
    root.querySelector('.drawer-tabs')?.addEventListener('keydown',event=>{
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
      const tabs=[...root.querySelectorAll('[role="tab"]')],index=tabs.indexOf(document.activeElement);if(index<0)return;
      event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?2:(index+(event.key==='ArrowRight'?1:2))%3;tabs[next].click();tabs[next].focus();
    });
  }
  nearBottom(){return this.stream.scrollHeight-this.stream.clientHeight-this.stream.scrollTop<72;}
  scrollLatest(){this.stream.scrollTop=this.stream.scrollHeight;this.unread=0;this.latest.hidden=true;}
  update(){
    const state=this.getState(),drawer=this.root.dataset.chatView==='drawer',tab=state.ui.chatTab||'chats';
    const firstOpen=drawer&&state.ui.chatPanelOpen&&!this.openedOnce;if(firstOpen)this.openedOnce=true;
    const signature=JSON.stringify([state.ui.selectedChatId,tab,state.chatThreads,state.peopleDirectory,state.activeCall,state.callHistory]);
    if(signature===this.signature){if(firstOpen)this.scrollLatest();return;}this.signature=signature;
    const selected=state.chatThreads.find(thread=>thread.id===state.ui.selectedChatId);
    const thread=drawer&&(tab==='calls'||(selected?.type==='group')!==(tab==='groups'))?null:selected;
    const switched=this.threadId!==(thread?.id||null),near=this.nearBottom(),scrollTop=this.stream.scrollTop;
    // Read geometry once, then batch DOM writes; polling never touches #app.
    for(const list of this.root.querySelectorAll('[data-chat-threads]')){
      const threads=state.chatThreads.filter(item=>list.dataset.chatThreads==='all'||list.dataset.chatThreads===item.type);
      const existing=new Map([...list.querySelectorAll('[data-thread-key]')].map(node=>[node.dataset.threadKey,node]));
      if(threads.length)list.querySelector('.chat-list-empty')?.remove();
      for(const item of threads){
        let row=existing.get(item.id);if(!row){row=document.createElement('button');row.className='thread-row';row.dataset.action=drawer?'open-thread':'select-thread';row.dataset.id=item.id;row.dataset.threadKey=item.id;list.append(row);}
        existing.delete(item.id);row.classList.toggle('active',item.id===selected?.id);row.setAttribute('aria-pressed',String(item.id===selected?.id));
        setHTML(row,`<span class="dock-avatar">${esc(initials(item.title))}</span><span><b>${esc(item.title)}</b><small>${item.type==='group'?`${item.memberIds.length+1} участников`:'Личный чат'}</small></span>`);
      }
      for(const row of existing.values())row.remove();
      if(!threads.length&&!list.firstChild)list.innerHTML='<p class="muted chat-list-empty">Пока нет бесед.</p>';
    }
    if(drawer){
      const index=['chats','groups','calls'].indexOf(tab);this.root.querySelector('.drawer-tabs').style.setProperty('--chat-tab-index',Math.max(0,index));
      for(const button of this.root.querySelectorAll('[role="tab"]')){const active=button.dataset.tab===tab;button.classList.toggle('active',active);button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;}
      for(const panel of this.root.querySelectorAll('[data-chat-tab-panel]')){const hidden=panel.dataset.chatTabPanel!==tab;if(panel.hidden!==hidden){if(hidden)fadePreviousContent(panel,'chat-tab-ghost');panel.hidden=hidden;if(!hidden)animateLocal(panel);}}
      const active=state.activeCall;
      setHTML(this.root.querySelector('[data-chat-calls]'),`<h3>${active?'Идёт звонок':'Звонки'}</h3>${active?`<div class="active-call"><b>${esc(active.title)}</b><span>${active.mode==='video'?'Видеозвонок':'Аудиозвонок'}</span><button class="danger" data-action="end-call">Завершить</button></div>`:''}${state.callHistory.length?state.callHistory.slice().reverse().map(call=>`<div class="call-log"><b>${esc(call.title)}</b><small>${esc(call.mode)} · ${esc(call.endedAt)}</small></div>`).join(''):'<p class="muted">История звонков появится здесь.</p>'}`);
    }
    this.root.querySelector('[data-chat-conversation]').hidden=drawer&&!thread;
    const header=this.root.querySelector('[data-chat-header]');
    setHTML(header,`<div><${drawer?'b':'h2'}>${esc(thread?.title||'Выберите чат')}</${drawer?'b':'h2'}><small>${thread?.type==='group'?'Рабочая группа':'Личный чат'}</small></div>${thread?callButtons(thread):''}`);
    if(switched){
      if(this.threadId)this.drafts.set(this.threadId,this.form.elements.message.value);
      if(this.threadId)fadePreviousMessages(this.stream);
      this.threadId=thread?.id||null;this.stream.replaceChildren();this.seen.clear();this.unread=0;this.latest.hidden=true;
      this.form.elements.message.value=this.drafts.get(this.threadId)||'';
      animateLocal(header);animateLocal(this.stream);
    }
    this.form.dataset.thread=thread?.id||'';this.form.hidden=!thread;
    const messages=thread?.messages||[];
    if(messages.length||!thread)this.stream.querySelector('.chat-load-status')?.remove();
    const existing=new Map([...this.stream.querySelectorAll('[data-message-key]')].map(node=>[node.dataset.messageKey,node]));
    let added=0,cursor=this.stream.firstElementChild;
    for(const message of messages){
      const key=message.clientId||message.id;let bubble=existing.get(key);
      if(!bubble){
        bubble=document.createElement('article');bubble.className=`message ${message.mine?'mine':''}`;bubble.dataset.messageKey=key;
        if(!switched&&!this.seen.has(key)){animateLocal(bubble);added++;}
      }
      if(bubble!==cursor)this.stream.insertBefore(bubble,cursor);else cursor=cursor.nextElementSibling;
      this.seen.add(key);existing.delete(key);if(bubble.dataset.messageId!==message.id)bubble.dataset.messageId=message.id;if(bubble.dataset.status!==(message.status||'sent'))bubble.dataset.status=message.status||'sent';
      updateMessage(bubble,message);
    }
    for(const bubble of existing.values())bubble.remove();
    if(thread&&!messages.length){
      let status=this.stream.querySelector('.chat-load-status');if(!status){status=document.createElement('p');status.className='muted chat-load-status';status.setAttribute('role','status');this.stream.append(status);}
      const text=thread.error?`Не удалось загрузить сообщения: ${thread.error}`:thread.loaded?'Начните беседу':'Загрузка сообщений…';if(status.textContent!==text)status.textContent=text;
    }
    if(switched||firstOpen||near)this.scrollLatest();else{this.stream.scrollTop=scrollTop;if(added){this.unread+=added;this.latest.hidden=false;this.latest.textContent=`Новые сообщения ↓ (${this.unread})`;}}
    const people=thread?.memberIds?.map(id=>state.peopleDirectory.find(person=>person.id===id)).filter(Boolean)||[];
    setHTML(this.root.querySelector('[data-chat-members]'),`<h3>${thread?.type==='group'?'Участники':'Друг'}</h3>${people.map(person=>`<div class="member-row"><span class="dock-avatar">${esc(initials(person.name))}</span><span><b>${esc(person.name)}</b><small>@${esc(person.username)}</small></span></div>`).join('')||'<p class="muted">Выберите беседу</p>'}`);
  }
}
