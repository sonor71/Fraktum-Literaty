import test from 'node:test';
import assert from 'node:assert/strict';

const userId='00000000-0000-4000-8000-000000000001';
globalThis.__FRAKTUM_CONFIG__={VITE_SUPABASE_URL:'https://calls.example.supabase.co',VITE_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_call_test'};
globalThis.localStorage={getItem:()=>JSON.stringify({access_token:'test-session',user:{id:userId},expires_at:Math.floor(Date.now()/1000)+3600}),setItem(){},removeItem(){}};
const cloud=await import('../../src/cloud.js');

test('call creation and ICE signaling use the authenticated identity and preserve payload',async()=>{
  const requests=[];
  globalThis.fetch=async(url,options)=>{requests.push({url:String(url),options});return new Response(options.headers.Prefer==='return=minimal'?'':'[{"id":"call","mode":"video"}]',{status:200});};
  await cloud.createCloudCall('conversation','video');
  const creation=JSON.parse(requests[0].options.body);
  assert.deepEqual(creation,{conversation_id:'conversation',started_by:userId,mode:'video',status:'ringing'});
  assert.equal(requests[0].options.headers.Authorization,'Bearer test-session');
  const candidate={candidate:'candidate:example 1 udp 123 127.0.0.1 9000 typ host',sdpMid:'0',sdpMLineIndex:0};
  await cloud.sendCloudCallSignal('call','peer','ice',candidate);
  assert.deepEqual(JSON.parse(requests[1].options.body),{call_id:'call',sender_id:userId,recipient_id:'peer',signal_type:'ice',payload:candidate});
});

test('signal polling is recipient scoped and ordered after the last processed ID',async()=>{
  let requestUrl;
  globalThis.fetch=async url=>{requestUrl=new URL(url);return new Response('[]',{status:200});};
  await cloud.fetchCloudCallSignals('call',37);
  assert.equal(requestUrl.searchParams.get('recipient_id'),`eq.${userId}`);assert.equal(requestUrl.searchParams.get('call_id'),'eq.call');assert.equal(requestUrl.searchParams.get('id'),'gt.37');assert.equal(requestUrl.searchParams.get('order'),'id.asc');
});

test('accepted/ended timestamps and signaling permission errors remain observable',async()=>{
  const bodies=[];
  globalThis.fetch=async(_url,options)=>{bodies.push(JSON.parse(options.body));return new Response('[{"id":"call"}]',{status:200});};
  await cloud.setCloudCallStatus('call','active');await cloud.setCloudCallStatus('call','ended');
  assert.equal(bodies[0].status,'active');assert.ok(Number.isFinite(Date.parse(bodies[0].answered_at)));assert.ok(Number.isFinite(Date.parse(bodies[1].ended_at)));
  globalThis.fetch=async()=>new Response('{"message":"row-level security rejected call signal"}',{status:403});
  await assert.rejects(cloud.sendCloudCallSignal('call','peer','offer',{type:'offer',sdp:'test SDP'}),/403.*row-level security/);
});
