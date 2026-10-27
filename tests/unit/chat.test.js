import test from 'node:test';
import assert from 'node:assert/strict';
import {ChatStore} from '../../src/chat/ChatStore.js';
import {PollingChatTransport} from '../../src/chat/ChatTransport.js';

const user={id:'user',name:'Writer'};
const thread={id:'thread',title:'Peer',type:'dm',memberIds:['peer']};
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
function store(){const value=new ChatStore({uuid:()=> 'uuid',now:()=>new Date('2026-10-27T10:00:00Z')});value.mergeThreads({threads:[thread],people:[]});return value;}

test('optimistic messages survive polls, reconcile before acknowledgement, and never duplicate',()=>{
  const state=store(),message=state.enqueue('thread','Hello',user);
  assert.equal(message.id,'client:uuid');assert.equal(message.status,'sending');
  state.mergeThreads({threads:[thread],people:[]});state.mergeMessages('thread',[]);
  assert.equal(state.thread('thread').messages.length,1);
  const confirmed={...message,id:'uuid',status:'sent'};
  state.mergeMessages('thread',[confirmed]);state.confirm('thread','uuid',confirmed);
  state.mergeMessages('thread',[confirmed]);
  assert.equal(state.thread('thread').messages.length,1);assert.equal(state.message('thread','uuid').status,'sent');
  state.fail('thread','uuid',new Error('late timeout'));
  assert.equal(state.message('thread','uuid').status,'sent');
});
test('failed delivery keeps text and retries the same id exactly once while in flight',()=>{
  const state=store();state.enqueue('thread','Never lose this',user);state.fail('thread','uuid',new Error('403'));
  assert.equal(state.message('thread','uuid').text,'Never lose this');assert.equal(state.message('thread','uuid').error,'403');
  assert.equal(state.sending('thread','uuid').clientId,'uuid');assert.equal(state.sending('thread','uuid'),null);
});
test('a stale thread poll cannot erase a newly acknowledged group or cached conversation',()=>{
  const state=store();state.mergeMessages('thread',[{id:'old',text:'Cached',createdAt:'2026-01-01'}]);
  state.addThread({id:'group',title:'New',type:'group',memberIds:[]});
  state.mergeThreads({threads:[thread],people:[]});
  assert.ok(state.thread('group'));assert.equal(state.thread('thread').messages[0].text,'Cached');
  state.clear();assert.deepEqual(state.threads,[]);
});
test('polling is serial, cancels stale account responses, and delegates the repository contract',async()=>{
  let poll,release,fetches=0,errors=0,deliveries=0,cancelled=false;
  const repository={fetchThreads:()=>{fetches++;return new Promise(resolve=>release=resolve);},fetchMessages:async id=>[id],sendMessage:async(id,message)=>({id,message}),createGroup:async group=>group};
  const transport=new PollingChatTransport(repository,{schedule:callback=>{poll=callback;return 1;},cancel:()=>cancelled=true});
  transport.subscribe({getThreadId:()=> 'thread',onThreads:()=>deliveries++,onMessages:()=>deliveries++,onError:()=>errors++});
  const pending=poll();await poll();assert.equal(fetches,1);transport.unsubscribe();release({threads:[],people:[]});await pending;
  assert.equal(deliveries,0);assert.equal(errors,0);assert.equal(cancelled,true);
  assert.deepEqual(await transport.sendMessage('t',{text:'a'}),{id:'t',message:{text:'a'}});
  assert.deepEqual(await transport.createGroup({title:'g'}),{title:'g'});
  transport.subscribe({getThreadId:()=> 'thread',onThreads:()=>deliveries++,onMessages:()=>deliveries++,onError:()=>errors++});
  const next=poll();release({threads:[],people:[]});await next;await tick();assert.equal(deliveries,2);
});
