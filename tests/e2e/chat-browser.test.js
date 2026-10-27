import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createBrowserHarness,createBackendFixture,BACKEND_ORIGIN,USER_ID} from './browser-harness.js';

let harness;
test.before(async()=>{harness=await createBrowserHarness();});
test.after(async()=>{await harness?.close();});
const PEER='22222222-2222-4222-8222-222222222222',OTHER='33333333-3333-4333-8333-333333333333';
const DM='aaaaaaaa-1111-4111-8111-111111111111',DM2='aaaaaaaa-2222-4222-8222-222222222222',GROUP='aaaaaaaa-3333-4333-8333-333333333333';
const drawer='[data-chat-view="drawer"]',stream=`${drawer} [data-chat-messages]`;
function chatFixture(count=60){
  const fixture=createBackendFixture();
  fixture.tables.lit_profiles.push({id:PEER,nickname:'First Peer',username:'first',account_role:'reader'},{id:OTHER,nickname:'Second Peer',username:'second',account_role:'reader'});
  fixture.tables.lit_conversations=[{id:DM,conversation_type:'direct',created_by:USER_ID},{id:DM2,conversation_type:'direct',created_by:USER_ID},{id:GROUP,conversation_type:'project',title:'Existing group',created_by:USER_ID}];
  fixture.tables.lit_conversation_members=[{conversation_id:DM,user_id:USER_ID,role:'owner'},{conversation_id:DM,user_id:PEER,role:'member'},{conversation_id:DM2,user_id:USER_ID,role:'owner'},{conversation_id:DM2,user_id:OTHER,role:'member'},{conversation_id:GROUP,user_id:USER_ID,role:'owner'},{conversation_id:GROUP,user_id:PEER,role:'member'}];
  fixture.tables.lit_messages=Array.from({length:count},(_,index)=>({id:`message-${index}`,conversation_id:DM,sender_id:PEER,body:`История сообщения ${index}. `+'Текст для чтения. '.repeat(3),created_at:new Date(Date.UTC(2026,9,26,10,index)).toISOString()}));
  fixture.tables.lit_messages.push({id:'second-thread-message',conversation_id:DM2,sender_id:OTHER,body:'Another conversation',created_at:'2026-10-26T11:00:00Z'});
  return fixture;
}
async function scenario(t,options={}){
  const result=await harness.scenario(t,{fixture:chatFixture(),path:'/#/messages',...options});
  await result.page.locator(`${stream} .message`).first().waitFor({state:'attached'});
  await result.page.locator('.chat-edge-toggle').click();
  await result.page.waitForFunction(()=>document.querySelector('.chat-edge-toggle')?.getAttribute('aria-expanded')==='true');
  return result;
}
async function openGroupDialog(page){
  if(await page.locator('.chat-edge-toggle').getAttribute('aria-expanded')==='true')await page.locator('.chat-edge-toggle').click();
  await page.locator('.page [data-action="new-collab-group"]').click();
}
async function retainIdentity(page){await page.evaluate(()=>{window.__chatIdentity={page:document.querySelector('.page'),shell:document.querySelector('.chat-shell'),drawer:document.querySelector('#chat-drawer'),input:document.querySelector('#chat-drawer input[name="message"]'),first:document.querySelector('#chat-drawer .message')};});}
async function assertIdentity(page,{first=true}={}){
  const identity=await page.evaluate(()=>Object.fromEntries(Object.entries(window.__chatIdentity).map(([key,node])=>[key,node.isConnected])));
  assert.equal(identity.page,true,'chat event replaced page');assert.equal(identity.shell,true,'chat event replaced shell');assert.equal(identity.drawer,true,'chat event replaced drawer');assert.equal(identity.input,true,'chat event replaced composer');if(first)assert.equal(identity.first,true,'poll replaced an existing bubble');
}
function incoming(fixture,id='incoming',conversationId=DM){fixture.tables.lit_messages.push({id,conversation_id:conversationId,sender_id:PEER,body:`Новый ответ ${id}`,created_at:new Date().toISOString()});}
const waitPoll=async(page,id)=>page.locator(`${stream} [data-message-id="${id}"]`).waitFor({state:'attached',timeout:10000});

test('outgoing bubble and empty composer precede server acknowledgement; poll and acknowledgement reconcile without duplication',async t=>{
  const {page,context,fixture,errors}=await scenario(t);
  await retainIdentity(page);
  let release,posted;const pending=new Promise(resolve=>release=resolve),received=new Promise(resolve=>posted=resolve);
  await context.route(`${BACKEND_ORIGIN}/rest/v1/lit_messages**`,async route=>{
    if(route.request().method()==='POST'){posted(route.request().postDataJSON());await pending;}return route.fallback();
  });
  const input=page.locator(`${drawer} input[name="message"]`);
  await input.fill('Оптимистическое сообщение <b>без HTML</b>');await page.locator(`${drawer} .thread-message-form button`).click();
  const body=await received;
  assert.equal(await input.inputValue(),'');assert.equal(await page.locator(`${stream} [data-status="sending"]`).count(),1);
  assert.match(await page.locator(`${stream} [data-status="sending"] p`).innerText(),/<b>без HTML<\/b>/);
  assert.equal(await page.locator(`${stream} [data-status="sending"] p b`).count(),0);
  assert.equal(await page.locator(`${drawer} .thread-message-form button`).isDisabled(),false);
  await page.evaluate(()=>{window.__pendingText=document.querySelector('#chat-drawer [data-status="sending"] p');});
  await page.locator(stream).evaluate(element=>element.scrollTop=100);
  const readingTop=await page.locator(stream).evaluate(element=>element.scrollTop);
  // Server committed but the response is delayed; a poll arrives first.
  fixture.tables.lit_messages.push({...body,created_at:new Date().toISOString()});
  await page.locator(`${stream} [data-message-id="${body.id}"][data-status="sent"]`).waitFor();
  assert.equal(await page.locator(stream).evaluate(element=>element.scrollTop),readingTop,'status acknowledgement moved the history viewport');
  assert.equal(await page.evaluate(()=>window.__pendingText.isConnected),true,'status acknowledgement replaced message content');
  fixture.tables.lit_messages=fixture.tables.lit_messages.filter(row=>row.id!==body.id);
  const response=page.waitForResponse(response=>response.url().includes('/rest/v1/lit_messages')&&response.request().method()==='POST');
  release();await response;await page.waitForTimeout(60);
  assert.equal(await page.locator(`${stream} [data-message-id="${body.id}"]`).count(),1);
  assert.equal(fixture.tables.lit_messages.filter(row=>row.id===body.id).length,1);
  await assertIdentity(page);assert.deepEqual(errors,[]);
});

test('failed message retains text, exposes Retry, retries same UUID and confirms once',async t=>{
  const {page,context,fixture,errors}=await scenario(t);let deny=true;const ids=[];
  await context.route(`${BACKEND_ORIGIN}/rest/v1/lit_messages**`,async route=>{
    if(route.request().method()==='POST'){
      ids.push(route.request().postDataJSON().id);
      if(deny){deny=false;return route.fulfill({status:403,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({message:'chat write denied'})});}
    }return route.fallback();
  });
  await page.locator(`${drawer} input[name="message"]`).fill('Текст не должен потеряться');await page.locator(`${drawer} .thread-message-form button`).click();
  await page.locator(`${stream} [data-status="failed"]`).waitFor();
  assert.match(await page.locator(`${stream} [data-status="failed"]`).innerText(),/Текст не должен потеряться/);
  await page.locator(`${stream} [data-action="chat-retry"]`).click();
  await page.locator(`${stream} [data-message-id="${ids[0]}"][data-status="sent"]`).waitFor();
  assert.equal(ids.length,2);assert.equal(ids[0],ids[1]);assert.equal(fixture.tables.lit_messages.filter(row=>row.id===ids[0]).length,1);
  assert.equal(await page.locator(`${stream} [data-action="chat-retry"]`).count(),0);
  assert.ok(errors.every(error=>error.includes('403')));
});

test('incoming polling changes only the new bubble, preserves draft/focus and scroll while reading, and shows latest control',async t=>{
  const {page,fixture,errors}=await scenario(t);await retainIdentity(page);
  const input=page.locator(`${drawer} input[name="message"]`);await input.fill('Черновик ответа');
  await page.locator(stream).evaluate(element=>element.scrollTop=100);
  const oldTop=await page.locator(stream).evaluate(element=>element.scrollTop);
  await page.evaluate(()=>{window.__oldAnimations=[...document.querySelectorAll('#chat-drawer .message')].map(node=>[node,node.getAnimations().length]);window.__appChanges=0;window.__appObserver=new window.MutationObserver(records=>{window.__appChanges+=records.filter(record=>record.target.id==='app').length;});window.__appObserver.observe(document.querySelector('#app'),{childList:true});});
  incoming(fixture);await waitPoll(page,'incoming');
  assert.equal(await page.locator(stream).evaluate(element=>element.scrollTop),oldTop);
  assert.equal(await input.inputValue(),'Черновик ответа');assert.equal(await input.evaluate(element=>element===document.activeElement),true);
  assert.equal(await page.locator(`${drawer} .new-messages`).isVisible(),true);
  assert.equal(await page.evaluate(()=>window.__appChanges),0);await assertIdentity(page);
  assert.equal(await page.evaluate(()=>window.__oldAnimations.some(([node])=>node.getAnimations().length>0)),false);
  await page.locator(`${drawer} .new-messages`).click();
  assert.ok(await page.locator(stream).evaluate(element=>element.scrollHeight-element.clientHeight-element.scrollTop<3));
  assert.equal(await page.locator(`${drawer} .new-messages`).isVisible(),false);
  assert.deepEqual(errors,[]);
});

test('near-bottom incoming messages keep viewport at latest and status updates do not jump it',async t=>{
  const {page,fixture}=await scenario(t);
  assert.ok(await page.locator(stream).evaluate(element=>element.scrollHeight-element.clientHeight-element.scrollTop<3),'first opening must start at latest messages');
  incoming(fixture,'bottom');await waitPoll(page,'bottom');
  assert.ok(await page.locator(stream).evaluate(element=>element.scrollHeight-element.clientHeight-element.scrollTop<3));
  assert.equal(await page.locator(`${drawer} .new-messages`).isVisible(),false);
});

test('page navigation preserves the drawer history viewport and draft across the legacy page renderer',async t=>{
  const {page}=await scenario(t);await page.locator(`${drawer} input[name="message"]`).fill('Draft across pages');
  await page.locator(stream).evaluate(element=>element.scrollTop=150);
  await page.evaluate(()=>{window.__drawerBeforeNavigation=document.querySelector('#chat-drawer');});
  await page.locator('.chat-edge-toggle').click();await page.locator('.avatar-btn').click();await page.waitForURL('**/#/profile');
  await page.locator('.chat-edge-toggle').click();
  assert.equal(await page.locator(stream).evaluate(element=>element.scrollTop),150);
  assert.equal(await page.locator(`${drawer} input[name="message"]`).inputValue(),'Draft across pages');
  assert.equal(await page.evaluate(()=>window.__drawerBeforeNavigation===document.querySelector('#chat-drawer')),true);
});

for(const width of [390,1366])test(`thread/tab changes preserve drawer and composer identity at ${width}px`,async t=>{
  const {page,errors}=await scenario(t,{viewport:{width,height:844},reducedMotion:'no-preference'});await retainIdentity(page);
  const input=page.locator(`${drawer} input[name="message"]`);await input.fill('Draft first');
  await page.locator(`${drawer} [data-action="open-thread"][data-id="${DM2}"]`).click();
  await page.locator(`${stream} [data-message-id="second-thread-message"]`).waitFor();
  assert.match(await page.locator(`${drawer} [data-chat-header]`).innerText(),/Second Peer/);
  assert.equal(await input.inputValue(),'');await input.fill('Draft second');
  await page.locator(`${drawer} [data-action="open-thread"][data-id="${DM}"]`).click();
  assert.equal(await input.inputValue(),'Draft first');
  for(const tab of ['groups','calls','chats']){
    await page.locator(`${drawer} [data-action="chat-tab"][data-tab="${tab}"]`).click();
    assert.equal(await page.locator(`#chat-tab-${tab}`).getAttribute('aria-selected'),'true');
    assert.equal(await page.locator(`#chat-panel-${tab}`).isVisible(),true);
  }
  await assertIdentity(page,{first:false});
  const geometry=await page.evaluate(()=>({width:document.documentElement.scrollWidth,viewport:window.innerWidth}));assert.ok(geometry.width<=geometry.viewport+1);
  assert.deepEqual(errors,[]);
});

test('group creation loads in place, exits modal continuously, opens acknowledged group immediately and persists on reload',async t=>{
  const {page,context,fixture,errors}=await scenario(t,{reducedMotion:'no-preference'});await retainIdentity(page);
  await openGroupDialog(page);
  await page.locator('#collabGroupForm [name="name"]').fill('Новая команда');await page.locator(`#collabGroupForm label:has(input[value="${PEER}"])`).click();
  let release;const pending=new Promise(resolve=>release=resolve);
  await context.route(`${BACKEND_ORIGIN}/rest/v1/lit_conversations**`,async route=>{if(route.request().method()==='POST')await pending;return route.fallback();});
  const button=page.locator('#collabGroupForm button.primary');await button.click();
  assert.equal(await button.getAttribute('aria-busy'),'true');assert.equal(await button.isDisabled(),true);assert.match(await button.innerText(),/Создаём/);
  release();await page.waitForFunction(()=>document.querySelector('.modal-backdrop')?.dataset.phase==='closing');
  assert.equal(await page.locator('.modal-backdrop').count(),1);
  assert.match(await page.locator(`${drawer} [data-chat-header]`).innerText(),/Новая команда/);
  await page.locator('#collabGroupForm').waitFor({state:'detached'});
  const group=fixture.tables.lit_conversations.find(row=>row.title==='Новая команда');assert.ok(group);
  assert.equal(fixture.tables.lit_conversation_members.filter(row=>row.conversation_id===group.id).length,2);
  assert.equal(await page.locator(`${drawer} [data-thread-key="${group.id}"]`).count(),1);await assertIdentity(page,{first:false});
  await page.reload();await page.waitForSelector('.app-shell');
  await page.locator('.chat-edge-toggle').click();await page.locator('#chat-tab-groups').click();
  await page.locator(`${drawer} [data-thread-key="${group.id}"]`).waitFor();assert.deepEqual(errors,[]);
});

test('denied group creation preserves dialog, title and selected members and permits retry',async t=>{
  const {page,context,errors}=await scenario(t);await openGroupDialog(page);
  await page.locator('#collabGroupForm [name="name"]').fill('Сохранить форму');await page.locator(`#collabGroupForm label:has(input[value="${PEER}"])`).click();
  let deny=true;
  await context.route(`${BACKEND_ORIGIN}/rest/v1/lit_conversations**`,async route=>{
    if(route.request().method()==='POST'&&deny){deny=false;return route.fulfill({status:403,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({message:'group permission denied'})});}return route.fallback();
  });
  await page.locator('#collabGroupForm button.primary').click();await page.waitForFunction(()=>document.querySelector('#operationFeedback')?.textContent.includes('group permission denied'));
  assert.equal(await page.locator('#collabGroupForm [name="name"]').inputValue(),'Сохранить форму');assert.equal(await page.locator(`#collabGroupForm input[value="${PEER}"]`).isChecked(),true);
  assert.equal(await page.locator('.modal-backdrop').getAttribute('data-phase'),'open');
  await page.locator('#collabGroupForm button.primary').click();await page.locator('#collabGroupForm').waitFor({state:'detached'});
  assert.match(await page.locator(`${drawer} [data-chat-header]`).innerText(),/Сохранить форму/);assert.ok(errors.every(error=>error.includes('403')));
});

test('membership failure keeps group form and retries the same conversation without a second group',async t=>{
  const {page,context,fixture,errors}=await scenario(t);await openGroupDialog(page);
  await page.locator('#collabGroupForm [name="name"]').fill('Retry membership');
  await page.locator(`#collabGroupForm label:has(input[value="${PEER}"])`).click();
  const attempts=[];let denyMembership=true;
  const failure=(route,status,message)=>route.fulfill({status,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({message})});
  await context.route(`${BACKEND_ORIGIN}/rest/v1/lit_conversations**`,async route=>{
    if(route.request().method()==='POST'){
      const body=route.request().postDataJSON();attempts.push(body.id);
      if(fixture.tables.lit_conversations.some(row=>row.id===body.id))return failure(route,409,'duplicate conversation primary key');
    }return route.fallback();
  });
  await context.route(`${BACKEND_ORIGIN}/rest/v1/lit_conversation_members**`,async route=>{
    if(route.request().method()==='POST'&&denyMembership){denyMembership=false;return failure(route,403,'membership denied');}return route.fallback();
  });
  await page.locator('#collabGroupForm button.primary').click();await page.waitForFunction(()=>document.querySelector('#operationFeedback')?.textContent.includes('membership denied'));
  assert.equal(await page.locator('#collabGroupForm [name="name"]').inputValue(),'Retry membership');
  assert.equal(fixture.tables.lit_conversations.filter(row=>row.title==='Retry membership').length,1);
  assert.equal(await page.locator(`${drawer} [data-thread-key="${attempts[0]}"]`).count(),0);
  await page.locator('#collabGroupForm button.primary').click();await page.locator('#collabGroupForm').waitFor({state:'detached'});
  assert.equal(attempts.length,2);assert.equal(attempts[0],attempts[1]);
  assert.equal(fixture.tables.lit_conversations.filter(row=>row.title==='Retry membership').length,1);
  assert.equal(fixture.tables.lit_conversation_members.filter(row=>row.conversation_id===attempts[0]).length,2);
  assert.match(await page.locator(`${drawer} [data-chat-header]`).innerText(),/Retry membership/);
  assert.ok(errors.every(error=>error.includes('403')||error.includes('409')));
});

test('modal lifecycle keeps app identity, traps focus, plays exit before removal and respects reduced motion',async t=>{
  for(const reducedMotion of ['no-preference','reduce']){
    const {page}=await scenario(t,{reducedMotion});await retainIdentity(page);
    await openGroupDialog(page);
    await page.locator('.modal-backdrop[data-phase="open"]').waitFor();
    await assertIdentity(page);
    assert.equal(await page.locator('.modal').getAttribute('aria-modal'),'true');
    if(reducedMotion==='reduce')assert.equal(await page.locator('.chat-slide').evaluate(element=>getComputedStyle(element).transitionDuration),'0s');
    await page.keyboard.press('Escape');
    if(reducedMotion==='no-preference'){assert.equal(await page.locator('.modal-backdrop').getAttribute('data-phase'),'closing');assert.ok(await page.locator('.modal-backdrop').evaluate(element=>element.getAnimations({subtree:true}).length>0));}
    await page.locator('.modal-backdrop').waitFor({state:'detached'});await assertIdentity(page);
  }
});

test('drawer motion profiles stable DOM, attached toggle, long tasks and Chrome rendering counters',async t=>{
  const {page,context}=await harness.scenario(t,{fixture:chatFixture(100),reducedMotion:'no-preference'});
  // Warm the existing application's one-time audio unlock and initial layout;
  // profile routine drawer motion separately from application startup.
  await page.locator('.chat-edge-toggle').click();await page.waitForTimeout(300);
  await page.locator('.chat-edge-toggle').click();await page.waitForTimeout(300);
  await retainIdentity(page);const cdp=await context.newCDPSession(page);await cdp.send('Performance.enable');
  const before=await cdp.send('Performance.getMetrics');
  await cdp.send('Tracing.start',{categories:'devtools.timeline,blink,cc',transferMode:'ReturnAsStream'});
  await page.evaluate(()=>{
    window.__profile={longTasks:[],frames:[],rootReplacements:0};window.__profileObserver=new window.MutationObserver(records=>{window.__profile.rootReplacements+=records.length;});window.__profileObserver.observe(document.querySelector('#app'),{childList:true});
    window.__longTasks=new window.PerformanceObserver(list=>window.__profile.longTasks.push(...list.getEntries().map(entry=>entry.duration)));window.__longTasks.observe({type:'longtask'});
  });
  const motion=await page.evaluate(async()=>{
    const shell=document.querySelector('.chat-shell'),toggle=document.querySelector('.chat-edge-toggle'),drawer=document.querySelector('#chat-drawer');let previous=window.performance.now();const frames=[];let maxGap=0;
    toggle.click();const start=window.performance.now();
    await new Promise(resolve=>{function sample(time){frames.push(time-previous);previous=time;const a=toggle.getBoundingClientRect(),b=drawer.getBoundingClientRect();maxGap=Math.max(maxGap,Math.abs(a.right-b.left));if(time-start<330)requestAnimationFrame(sample);else resolve();}requestAnimationFrame(sample);});
    const openTransform=getComputedStyle(shell.querySelector('.chat-slide')).transform;toggle.click();await new Promise(resolve=>setTimeout(resolve,300));
    return {frames:frames.slice(1),maxGap,openTransform,shellConnected:shell.isConnected,closingTransform:getComputedStyle(shell.querySelector('.chat-slide')).transform};
  });
  const after=await cdp.send('Performance.getMetrics');const counters=Object.fromEntries(after.metrics.map(metric=>[metric.name,metric.value-(before.metrics.find(item=>item.name===metric.name)?.value||0)]));
  const tracingComplete=new Promise(resolve=>cdp.once('Tracing.tracingComplete',resolve));await cdp.send('Tracing.end');
  const {stream:traceStream}=await tracingComplete;let traceText='';
  for(;;){const chunk=await cdp.send('IO.read',{handle:traceStream});traceText+=chunk.data;if(chunk.eof)break;}await cdp.send('IO.close',{handle:traceStream});
  await fs.writeFile('/tmp/fraktum-chat-performance-trace.json',traceText);
  const trace=JSON.parse(traceText).traceEvents;
  const rendering=Object.fromEntries(['Layout','Paint','UpdateLayoutTree','DrawFrame'].map(name=>{const events=trace.filter(event=>event.name===name);return [name,{count:events.length,durationMs:events.reduce((total,event)=>total+(event.dur||0),0)/1000}];}));
  const findings={...motion,counters,rendering,observed:await page.evaluate(()=>window.__profile)};
  await fs.writeFile('/tmp/fraktum-chat-performance.json',JSON.stringify(findings,null,2));
  assert.equal(motion.shellConnected,true);assert.ok(motion.maxGap<1,'toggle separated from drawer edge');assert.equal(findings.observed.rootReplacements,0);
  assert.ok(motion.frames.length>=5,'animation was not sampled');assert.notEqual(motion.openTransform,motion.closingTransform);await assertIdentity(page);
  // Timing numbers are diagnostic, not machine-speed-dependent correctness gates.
  t.diagnostic(`Chrome drawer profile: ${JSON.stringify({frames:motion.frames.length,maxFrameMs:Math.max(...motion.frames),longTasks:findings.observed.longTasks,layoutCount:counters.LayoutCount,recalcStyleCount:counters.RecalcStyleCount,rootReplacements:findings.observed.rootReplacements})}`);
  await cdp.detach();
});
