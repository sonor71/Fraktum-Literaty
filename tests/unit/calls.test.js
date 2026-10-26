import test from 'node:test';
import assert from 'node:assert/strict';
import {CallSession} from '../../src/CallSession.js';
import {buildRtcConfiguration,rtcDebugEnabled} from '../../src/webrtc-config.js';
import {createRuntimeConfig} from '../../scripts/runtime-config.mjs';

function track(kind,id=kind){return {kind,id,enabled:true,stopped:false,stop(){this.stopped=true;},getSettings(){return {deviceId:id};}};}
function stream(tracks=[]){return {tracks:[...tracks],getTracks(){return [...this.tracks];},getAudioTracks(){return this.tracks.filter(item=>item.kind==='audio');},getVideoTracks(){return this.tracks.filter(item=>item.kind==='video');},addTrack(item){this.tracks.push(item);},removeTrack(item){this.tracks=this.tracks.filter(existing=>existing!==item);}};}
class Peer {
  constructor(){this.listeners={};this.order=[];this.senders=[];this.connectionState='new';this.iceConnectionState='new';this.iceGatheringState='new';this.signalingState='stable';this.localDescription=null;this.remoteDescription=null;}
  addEventListener(name,fn){(this.listeners[name]??=[]).push(fn);}
  fire(name,event={}){this.listeners[name]?.forEach(fn=>fn(event));}
  addTrack(item){const sender={track:item,replaceTrack:async next=>{sender.track=next;}};this.senders.push(sender);}
  getSenders(){return this.senders;}
  async createOffer(){return {type:'offer',sdp:'local offer'};}
  async createAnswer(){this.order.push('answer');return {type:'answer',sdp:'local answer'};}
  async setLocalDescription(value){this.localDescription=value;this.order.push('local');}
  async setRemoteDescription(value){this.remoteDescription=value;this.order.push('remote');}
  async addIceCandidate(value){assert.ok(this.remoteDescription,'ICE requires remote SDP');this.order.push(`ice:${value.candidate}`);if(value.candidate==='invalid')throw new Error('invalid ICE candidate');}
  async getStats(){return new Map([['transport',{type:'transport',selectedCandidatePairId:'pair'}],['pair',{type:'candidate-pair',localCandidateId:'local',remoteCandidateId:'remote',bytesSent:11,bytesReceived:22,currentRoundTripTime:0.1}],['local',{candidateType:'relay',protocol:'udp',address:'private IP'}],['remote',{candidateType:'srflx'}]]);}
  close(){this.closed=true;this.connectionState='closed';this.fire('connectionstatechange');}
}
function setup(overrides={}){
  const peer=new Peer(),local=stream([track('audio'),track('video','camera-a')]),sent=[],statuses=[],states=[],ended=[];
  const session=new CallSession({callId:'call',peerId:'peer',initiator:true,mode:'video',pollIntervalMs:100000,connectTimeoutMs:100000,runtime:{},pcFactory:()=>peer,streamFactory:()=>stream(),mediaDevices:{getUserMedia:async()=>local,enumerateDevices:async()=>[{kind:'videoinput',deviceId:'camera-a'},{kind:'videoinput',deviceId:'camera-b'}]},signaling:{send:async(type,payload)=>sent.push({type,payload}),fetch:async()=>[],getStatus:async()=>({status:'ringing'}),setStatus:async status=>statuses.push(status)},onState:(state,detail)=>states.push({state,...detail}),onEnded:detail=>ended.push(detail),...overrides});
  return {session,peer,local,sent,statuses,states,ended};
}
test('TURN configuration is optional, explicit and never installs hardcoded public relay credentials',()=>{
  const base=buildRtcConfiguration({});assert.equal(base.iceServers.length,2);assert.ok(base.iceServers.every(server=>server.urls.startsWith('stun:')));
  const config=buildRtcConfiguration({VITE_TURN_URL:'turn:relay.example:3478, turns:relay.example:443?transport=tcp',VITE_TURN_USERNAME:'temporary-user',VITE_TURN_CREDENTIAL:'temporary-credential'});
  assert.deepEqual(config.iceServers[2],{urls:['turn:relay.example:3478','turns:relay.example:443?transport=tcp'],username:'temporary-user',credential:'temporary-credential'});
  assert.throws(()=>buildRtcConfiguration({VITE_TURN_URL:'https://relay.example'}),/turn:/);
  assert.throws(()=>buildRtcConfiguration({VITE_TURN_URL:'turn:relay.example'}),/requires/);
  assert.equal(rtcDebugEnabled({VITE_RTC_DEBUG:'false'}),false);assert.equal(rtcDebugEnabled({VITE_RTC_DEBUG:'true'}),true);
});
test('runtime configuration carries TURN settings and rejects partial deployment configuration',()=>{
  const base={VITE_SUPABASE_URL:'https://example.supabase.co',VITE_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test'};
  assert.throws(()=>createRuntimeConfig({...base,VITE_TURN_URL:'turn:relay.example'}),/Missing required TURN/);
  const result=createRuntimeConfig({...base,VITE_TURN_URL:'turn:relay.example',VITE_TURN_USERNAME:'session',VITE_TURN_CREDENTIAL:'temporary',VITE_RTC_DEBUG:'TRUE'});
  assert.equal(result.VITE_TURN_CREDENTIAL,'temporary');assert.equal(result.VITE_RTC_DEBUG,'true');
});
test('caller publishes offer and media controls affect live tracks before complete cleanup',async()=>{
  const {session,peer,local,sent,statuses}=setup();await session.start();
  assert.equal(session.state,'calling');assert.equal(peer.senders.length,2);assert.equal(sent[0].type,'offer');
  session.setMuted(true);assert.equal(local.getAudioTracks()[0].enabled,false);session.setMuted(false);assert.equal(local.getAudioTracks()[0].enabled,true);
  session.setCameraEnabled(false);assert.equal(session.controls().cameraEnabled,false);session.setCameraEnabled(true);assert.equal(session.controls().cameraEnabled,true);
  await session.end();assert.ok(local.getTracks().every(item=>item.stopped));assert.equal(peer.closed,true);assert.deepEqual(statuses,['ended']);assert.equal(sent.at(-1).type,'hangup');
});
test('receiver buffers early ICE, applies SDP first, then sends one answer',async()=>{
  const {session,peer,sent,statuses}=setup({initiator:false});
  session.signaling.fetch=async()=>[{id:1,signal_type:'ice',payload:{candidate:'early'}},{id:2,signal_type:'offer',payload:{type:'offer',sdp:'remote offer'}}];
  await session.start();assert.deepEqual(peer.order,['remote','ice:early','answer','local']);assert.equal(sent.filter(item=>item.type==='answer').length,1);assert.equal(session.lastSignalId,2);assert.deepEqual(statuses,['active']);
  await session.poll();assert.equal(sent.filter(item=>item.type==='answer').length,1);await session.end({notifyPeer:false});
});
test('invalid ICE causes visible failure, retains failed cursor and stops media',async()=>{
  const {session,peer,local,states}=setup();await session.start();peer.remoteDescription={type:'answer',sdp:'remote answer'};
  session.signaling.fetch=async()=>[{id:1,signal_type:'ice',payload:{candidate:'invalid'}}];await session.poll();
  assert.equal(session.state,'failed');assert.equal(session.lastSignalId,0);assert.match(states.at(-1).error,/invalid ICE/);assert.ok(local.getTracks().every(item=>item.stopped));
});
test('permission denial releases peer and reports a useful error',async()=>{
  const error=Object.assign(new Error('Permission denied'),{name:'NotAllowedError'});
  const {session,peer,states,statuses}=setup({mediaDevices:{getUserMedia:async()=>{throw error;}}});
  await assert.rejects(session.start(),/Permission denied/);assert.equal(peer.closed,true);assert.equal(session.state,'failed');assert.match(states.at(-1).error,/Разрешите доступ/);assert.deepEqual(statuses,['ended']);
});
test('hangup while permission request is pending stops late-acquired tracks without offering',async()=>{
  let resolve;const pending=new Promise(done=>resolve=done);const {session,local,sent}=setup({mediaDevices:{getUserMedia:()=>pending}});
  const starting=session.start();await session.end({notifyPeer:false});resolve(local);await starting;
  assert.ok(local.getTracks().every(item=>item.stopped));assert.equal(sent.length,0);assert.equal(session.state,'ended');
});
test('polling is serialized even when a signaling request is slow',async()=>{
  const {session}=setup();await session.start();let resolve,requests=0;
  session.signaling.fetch=()=>{requests++;return new Promise(done=>resolve=done);};
  const first=session.poll();await session.poll();assert.equal(requests,1);resolve([]);await first;await session.end({notifyPeer:false});
});
test('connection timeout stops devices and reports failure instead of indefinite connecting',async()=>{
  let finish;const completed=new Promise(resolve=>finish=resolve);const {session,local,states}=setup({connectTimeoutMs:5,onEnded:finish});
  await session.start();await completed;assert.equal(session.state,'failed');assert.ok(local.getTracks().every(item=>item.stopped));assert.match(states.at(-1).error,/Время ожидания/);
});
test('a transient disconnection can recover before the disconnect deadline',async()=>{
  const {session,peer}=setup({disconnectTimeoutMs:10});await session.start();peer.connectionState='connected';peer.fire('connectionstatechange');
  peer.connectionState='disconnected';peer.fire('connectionstatechange');assert.equal(session.state,'connecting');peer.connectionState='connected';peer.fire('connectionstatechange');
  await new Promise(resolve=>setTimeout(resolve,20));assert.equal(session.state,'connected');await session.end({notifyPeer:false});
});
test('camera switch replaces sender track, retains video disabled state and stops the old camera',async()=>{
  const {session,peer,local}=setup();await session.start();const old=local.getVideoTracks()[0],next=track('video','camera-b');session.setCameraEnabled(false);
  session.mediaDevices.getUserMedia=async constraints=>{assert.deepEqual(constraints,{audio:false,video:{deviceId:{exact:'camera-b'}}});return stream([next]);};
  await session.switchCamera();assert.equal(old.stopped,true);assert.equal(local.getVideoTracks()[0],next);assert.equal(next.enabled,false);assert.ok(peer.senders.some(sender=>sender.track===next));await session.end({notifyPeer:false});
});
test('streamless remote track is retained and diagnostics omit addresses and credentials',async()=>{
  let received;const {session,peer}=setup({onRemoteStream:value=>received=value});await session.start();peer.fire('track',{track:track('audio','remote'),streams:[]});
  assert.equal(received.getTracks()[0].id,'remote');const diagnostics=await session.collectStats();assert.equal(diagnostics.selectedCandidatePair.bytesReceived,22);assert.doesNotMatch(JSON.stringify(diagnostics),/private IP|temporary-credential/);await session.end({notifyPeer:false});
});
test('an explicit peer failure closes resources and diagnostics retain the cause',async()=>{
  const {session,peer,local}=setup();await session.start();peer.connectionState='failed';peer.fire('connectionstatechange');
  assert.equal(session.state,'failed');assert.ok(local.getTracks().every(item=>item.stopped));assert.match(session.diagnostics.lastError.message,/медиасоединение/);
});
test('remote rejection stops the caller and is distinct from connection failure',async()=>{
  const {session,local,sent}=setup();await session.start();session.statusPollCounter=4;session.signaling.getStatus=async()=>({status:'declined'});await session.poll();
  assert.equal(session.state,'declined');assert.ok(local.getTracks().every(item=>item.stopped));assert.equal(sent.filter(item=>item.type==='hangup').length,0);
});
test('signaling failures are surfaced and teardown errors do not leave capture running',async()=>{
  const {session,local,states}=setup();await session.start();session.signaling.send=async()=>{throw new Error('signaling offline');};
  await session.end();assert.ok(local.getTracks().every(item=>item.stopped));assert.match(states.at(-1).error,/сервер не подтвердил/);assert.equal(session.diagnostics.lastError.kind,'teardown');
});
test('failed camera replacement closes the unused capture and preserves the previous camera',async()=>{
  const {session,peer,local}=setup();await session.start();const old=local.getVideoTracks()[0],next=track('video','camera-b');
  session.mediaDevices.getUserMedia=async()=>stream([next]);peer.getSenders().find(sender=>sender.track===old).replaceTrack=async()=>{throw new Error('replacement rejected');};
  await assert.rejects(session.switchCamera(),/replacement rejected/);assert.equal(next.stopped,true);assert.equal(old.stopped,false);assert.equal(local.getVideoTracks()[0],old);await session.end({notifyPeer:false});
});
