import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createBrowserHarness} from './browser-harness.js';

let harness;
const turnRuntime=Object.fromEntries(['VITE_TURN_URL','VITE_TURN_USERNAME','VITE_TURN_CREDENTIAL'].map(key=>[key,process.env[key]||'']));
function managedMediaRestriction(){
  if(process.env.CHROMIUM_PATH&&process.env.CHROMIUM_PATH!=='/usr/bin/chromium')return false;
  const policyFile='/etc/chromium/policies/managed/misc.json';
  if(!fs.existsSync(policyFile))return false;
  const policy=JSON.parse(fs.readFileSync(policyFile,'utf8'));
  if(policy.WebRtcIPHandling==='disable_non_proxied_udp'&&!Object.values(turnRuntime).every(Boolean)){
    return 'Managed Chromium WebRtcIPHandling=disable_non_proxied_udp blocks host ICE; no TURN relay is configured. Run RTP acceptance in a permitted browser with two accounts.';
  }
  return false;
}
test.before(async()=>{harness=await createBrowserHarness();});
test.after(async()=>{await harness?.close();});

// This transports SDP/ICE in the test process. Media uses actual Chromium
// RTCPeerConnections in two isolated browser contexts; Supabase is not tested.
function signalBroker(){
  const calls=new Map();
  return (side,message)=>{
    let call=calls.get(message.callId);
    if(!call){call={status:'ringing',signals:[]};calls.set(message.callId,call);}
    if(message.action==='send'){
      call.signals.push({id:call.signals.length+1,sender_id:side,recipient_id:message.peerId,signal_type:message.type,payload:message.payload});
      return null;
    }
    if(message.action==='fetch')return call.signals.filter(signal=>signal.recipient_id===side&&signal.id>message.afterId);
    if(message.action==='getStatus')return {status:call.status};
    if(message.action==='setStatus'){call.status=message.status;return null;}
    throw new Error(`Unknown test signaling operation ${message.action}`);
  };
}

async function startPeer(page,{callId,side,mode,initiator}){
  await page.evaluate(async options=>{
    const {CallSession}=await import('/src/CallSession.js');
    const peerId=options.side==='a'?'b':'a';
    const send=message=>globalThis.__testCallTransport({callId:options.callId,peerId,...message});
    globalThis.__callStates=[];
    globalThis.__call=new CallSession({
      ...options,peerId,pollIntervalMs:30,connectTimeoutMs:10000,
      signaling:{send:(type,payload)=>send({action:'send',type,payload}),fetch:afterId=>send({action:'fetch',afterId}),getStatus:()=>send({action:'getStatus'}),setStatus:status=>send({action:'setStatus',status})},
      onState:(state,detail)=>globalThis.__callStates.push({state,...detail})
    });
    await globalThis.__call.start();
  },{callId,side,mode,initiator,runtime:turnRuntime});
}

async function requireIncomingMedia(page,mode){
  try{await page.waitForFunction(()=>globalThis.__call?.state==='connected',null,{timeout:15000});}
  catch(error){
    const detail=await page.evaluate(()=>({states:globalThis.__callStates,diagnostics:globalThis.__call?.diagnostics,pcState:globalThis.__call?.pc?.connectionState,iceState:globalThis.__call?.pc?.iceConnectionState}));
    assert.fail(`${error.message}: ${JSON.stringify(detail)}`);
  }
  await page.waitForFunction(async mode=>{
    const stats=await globalThis.__call.pc.getStats();
    const received=new Set();
    stats.forEach(report=>{if(report.type==='inbound-rtp'&&report.bytesReceived>0)received.add(report.kind||report.mediaType);});
    return received.has('audio')&&(mode==='audio'||received.has('video'));
  },mode,{timeout:15000});
  const result=await page.evaluate(async()=>{
    const call=globalThis.__call;
    return {state:call.state,diagnostics:await call.collectStats(),tracks:call.remoteStream.getTracks().map(track=>({kind:track.kind,readyState:track.readyState}))};
  });
  assert.equal(result.state,'connected');
  assert.ok(result.diagnostics.selectedCandidatePair.bytesSent>0);
  assert.ok(result.diagnostics.selectedCandidatePair.bytesReceived>0);
  assert.ok(result.tracks.some(track=>track.kind==='audio'&&track.readyState==='live'));
  if(mode==='video')assert.ok(result.tracks.some(track=>track.kind==='video'&&track.readyState==='live'));
}

test('actual audio/video RTP connects in both directions and repeated calls release tracks',{skip:managedMediaRestriction()},async t=>{
  const a=await harness.scenario(t,{authenticated:false});
  const b=await harness.scenario(t,{authenticated:false});
  const broker=signalBroker();
  for(const [side,scenario] of [['a',a],['b',b]]){
    await scenario.context.grantPermissions(['camera','microphone']);
    await scenario.page.exposeFunction('__testCallTransport',message=>broker(side,message));
  }
  for(const [index,{mode,initiator}] of [{mode:'audio',initiator:'a'},{mode:'audio',initiator:'b'},{mode:'video',initiator:'a'},{mode:'video',initiator:'b'}].entries()){
    const callId=`browser-rtp-${index}`;
    await Promise.all([startPeer(a.page,{callId,side:'a',mode,initiator:initiator==='a'}),startPeer(b.page,{callId,side:'b',mode,initiator:initiator==='b'})]);
    await Promise.all([requireIncomingMedia(a.page,mode),requireIncomingMedia(b.page,mode)]);
    for(const scenario of [a,b]){
      assert.equal(await scenario.page.evaluate(()=>{globalThis.__call.setMuted(true);return globalThis.__call.localStream.getAudioTracks().every(track=>!track.enabled);}),true);
      assert.equal(await scenario.page.evaluate(()=>{globalThis.__call.setMuted(false);return globalThis.__call.localStream.getAudioTracks().every(track=>track.enabled);}),true);
      if(mode==='video'){
        assert.equal(await scenario.page.evaluate(()=>{globalThis.__call.setCameraEnabled(false);return globalThis.__call.localStream.getVideoTracks().every(track=>!track.enabled);}),true);
        assert.equal(await scenario.page.evaluate(()=>{globalThis.__call.setCameraEnabled(true);return globalThis.__call.localStream.getVideoTracks().every(track=>track.enabled);}),true);
      }
    }
    const ending=initiator==='a'?a:b,other=initiator==='a'?b:a;
    await ending.page.evaluate(()=>globalThis.__call.end());
    await other.page.waitForFunction(()=>globalThis.__call.state==='ended',null,{timeout:5000});
    for(const scenario of [a,b]){
      const stopped=await scenario.page.evaluate(()=>({connection:globalThis.__call.pc.connectionState,tracks:globalThis.__call.localStream.getTracks().map(track=>track.readyState)}));
      assert.equal(stopped.connection,'closed');
      assert.ok(stopped.tracks.every(state=>state==='ended'));
    }
  }
  assert.deepEqual(a.errors,[]);
  assert.deepEqual(b.errors,[]);
  assert.deepEqual(a.fixture.failures,[]);
  assert.deepEqual(b.fixture.failures,[]);
});
