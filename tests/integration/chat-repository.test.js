import test from 'node:test';
import assert from 'node:assert/strict';

test('Supabase chat adapter uses stable primary IDs and recovers acknowledged writes without duplicates',async()=>{
  const me='11111111-1111-4111-8111-111111111111',clientId='22222222-2222-4222-8222-222222222222';
  const session={access_token:'fixture',user:{id:me},expires_at:Math.floor(Date.now()/1000)+3600};
  globalThis.localStorage={getItem:()=>JSON.stringify(session),setItem(){},removeItem(){}};
  globalThis.__FRAKTUM_CONFIG__={VITE_SUPABASE_URL:'https://example.supabase.co',VITE_SUPABASE_PUBLISHABLE_KEY:'fixture-public'};
  const requests=[];let mode='message';
  globalThis.fetch=async(url,options={})=>{
    const parsed=new URL(url),body=options.body?JSON.parse(options.body):null;requests.push({url:parsed,body,method:options.method||'GET',headers:options.headers});
    const reply=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
    if(options.method==='POST'&&parsed.pathname.endsWith('lit_messages'))return reply({message:'duplicate primary key'},409);
    if(parsed.pathname.endsWith('lit_messages'))return reply([{id:clientId,sender_id:me,body:'Original body',created_at:'2026-10-27T10:00:00Z'}]);
    if(options.method==='POST'&&parsed.pathname.endsWith('lit_conversations'))return reply({message:'duplicate primary key'},409);
    if(parsed.pathname.endsWith('lit_conversations'))return reply([{id:clientId}]);
    if(parsed.pathname.endsWith('lit_conversation_members')){
      if(mode==='membership-failure')return reply({message:'membership denied'},403);return reply(null);
    }
    return reply([]);
  };
  const {sendCloudMessage,createCloudGroupConversation,fetchConversationMessages}=await import(`../../src/cloud.js?chat-contract=${Date.now()}`);
  const rows=await sendCloudMessage('thread','Original body',clientId);
  assert.equal(rows[0].id,clientId);assert.equal(requests[0].body.id,clientId);
  assert.equal(requests[1].url.searchParams.get('sender_id'),`eq.${me}`);assert.equal(requests[1].url.searchParams.get('conversation_id'),'eq.thread');
  assert.equal(await createCloudGroupConversation('Team',[me,'peer','peer'],null,clientId),clientId);
  const members=requests.find(request=>request.url.pathname.endsWith('lit_conversation_members'));
  assert.equal(members.body.length,2);assert.equal(members.body[0].role,'owner');assert.equal(members.headers.Prefer,'resolution=ignore-duplicates');
  assert.equal(members.url.searchParams.get('on_conflict'),'conversation_id,user_id');
  mode='membership-failure';await assert.rejects(createCloudGroupConversation('Team',['peer'],null,clientId),/membership denied/);
  await fetchConversationMessages('thread');
  const get=requests.filter(request=>request.url.pathname.endsWith('lit_messages')).at(-1);
  assert.equal(get.url.searchParams.get('order'),'created_at.desc');assert.equal(get.url.searchParams.get('limit'),'250');
});
