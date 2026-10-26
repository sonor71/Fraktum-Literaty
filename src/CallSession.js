import {buildRtcConfiguration, rtcDebugEnabled} from './webrtc-config.js';

const END_STATUSES = new Set(['ended', 'declined', 'missed']);
export const CALL_STATUS_LABELS = Object.freeze({calling:'Звоним', incoming:'Входящий звонок', connecting:'Соединение', connected:'Подключено', failed:'Нет соединения', ended:'Завершён', declined:'Звонок отклонён'});

// One instance owns one call, its media, polling, timers and signal cursor. The
// injected signaling transport is the same for production and browser tests.
export class CallSession {
  constructor({callId, conversationId, peerId, title, mode='audio', initiator=false, signaling,
    onState=()=>{}, onEnded=()=>{}, onLocalStream=()=>{}, onRemoteStream=()=>{}, onControlsChanged=()=>{},
    runtime=globalThis.__FRAKTUM_CONFIG__ || {}, mediaDevices=globalThis.navigator?.mediaDevices,
    pcFactory=configuration=>new globalThis.RTCPeerConnection(configuration),
    streamFactory=()=>new globalThis.MediaStream(), connectTimeoutMs=45000, disconnectTimeoutMs=10000, pollIntervalMs=450}) {
    Object.assign(this, {callId, conversationId, peerId, title, mode, initiator, signaling, onState, onEnded, onLocalStream, onRemoteStream, onControlsChanged, runtime, mediaDevices, pcFactory, streamFactory, connectTimeoutMs, disconnectTimeoutMs, pollIntervalMs});
    this.state='idle';this.ended=false;this.started=false;this.polling=false;this.lastSignalId=0;this.pendingIce=[];this.statusPollCounter=0;this.outgoing=Promise.resolve();
    this.cameraSwitchAvailable=false;
    this.debug=rtcDebugEnabled(runtime);
    this.diagnostics={connectionState:'new',iceConnectionState:'new',iceGatheringState:'new',signalingState:'stable',candidateTypes:[],selectedCandidatePair:null,lastError:null};
  }

  _state(state, detail={}) {
    this.state=state;
    this.onState(state, {label:CALL_STATUS_LABELS[state] || state, ...detail});
    if(this.debug)console.debug('[FRAKTUM RTC]',state, this.diagnostics);
  }

  async start() {
    if(this.started)throw new Error('Этот звонок уже запущен');
    this.started=true;
    this._state(this.initiator?'calling':'connecting');
    try {
      if(!this.mediaDevices?.getUserMedia)throw new Error('Браузер не поддерживает доступ к микрофону/камере. Используйте HTTPS.');
      this.pc=this.pcFactory(buildRtcConfiguration(this.runtime));
      this.remoteStream=this.streamFactory();
      this._bindPeer();
      this.connectTimer=setTimeout(()=>this._fail(new Error('Время ожидания соединения истекло. Проверьте доступ к микрофону и сеть, затем повторите звонок.')),this.connectTimeoutMs);
      const stream=await this.mediaDevices.getUserMedia({audio:true,video:this.mode==='video'});
      if(this.ended){stream.getTracks().forEach(track=>track.stop());return this;}
      this.localStream=stream;
      stream.getTracks().forEach(track=>this.pc.addTrack(track,stream));
      this.onLocalStream(stream);
      if(this.mode==='video'&&this.mediaDevices.enumerateDevices){
        try {this.cameraSwitchAvailable=(await this.mediaDevices.enumerateDevices()).filter(device=>device.kind==='videoinput').length>1;}
        catch(error){if(this.debug)console.debug('[FRAKTUM RTC] enumerateDevices',error.name);}
      }
      if(this.ended)return this;
      this.onControlsChanged(this.controls());
      if(this.initiator){
        const offer=await this.pc.createOffer();
        if(this.ended)return this;
        await this.pc.setLocalDescription(offer);
        await this._send('offer',{type:this.pc.localDescription.type,sdp:this.pc.localDescription.sdp});
      }else{
        await this.signaling.setStatus?.('active');
      }
      if(!this.ended){await this.poll();this._schedulePoll();}
      return this;
    } catch(error) {
      const message=error.name==='NotAllowedError'?'Разрешите доступ к микрофону и камере в настройках браузера.':error.name==='NotFoundError'?'Микрофон или камера не найдены. Подключите устройство и повторите звонок.':error.message;
      await this._fail(new Error(message));
      throw error;
    }
  }

  _bindPeer() {
    const pc=this.pc;
    pc.addEventListener('track',event=>{
      if(this.ended)return;
      const tracks=event.streams?.[0]?.getTracks() || (event.track?[event.track]:[]);
      tracks.forEach(track=>{if(!this.remoteStream.getTracks().some(existing=>existing.id===track.id))this.remoteStream.addTrack(track);});
      this.onRemoteStream(this.remoteStream);
    });
    pc.addEventListener('icecandidate',event=>{
      if(this.ended||!event.candidate)return;
      const type=event.candidate.type || event.candidate.candidate?.match(/ typ (\w+)/)?.[1] || 'unknown';
      if(!this.diagnostics.candidateTypes.includes(type))this.diagnostics.candidateTypes.push(type);
      this._send('ice',event.candidate.toJSON?.() || event.candidate).catch(error=>this._fail(error));
    });
    for(const event of ['iceconnectionstatechange','icegatheringstatechange','signalingstatechange','connectionstatechange']){
      pc.addEventListener(event,()=>{
        if(this.ended)return;
        for(const field of ['connectionState','iceConnectionState','iceGatheringState','signalingState'])this.diagnostics[field]=pc[field];
        if(this.debug)console.debug('[FRAKTUM RTC]',event,{...this.diagnostics});
        if(event==='connectionstatechange'||event==='iceconnectionstatechange')this._connectionChanged();
      });
    }
    pc.addEventListener('icecandidateerror',event=>{
      this.diagnostics.lastError={kind:'icecandidateerror',code:event.errorCode || null};
      if(this.debug)console.debug('[FRAKTUM RTC] ICE candidate error',this.diagnostics.lastError);
    });
  }

  _connectionChanged() {
    const pc=this.pc;
    if(pc.connectionState==='failed'||pc.iceConnectionState==='failed'){
      this._fail(new Error('Не удалось установить медиасоединение. Проверьте сеть и повторите звонок.'));return;
    }
    if(pc.connectionState==='connected'){
      clearTimeout(this.connectTimer);clearTimeout(this.disconnectTimer);this.disconnectTimer=null;
      if(this.state!=='connected')this._state('connected');
      if(this.debug&&!this.statsTimer){this.collectStats();this.statsTimer=setInterval(()=>this.collectStats(),3000);}
    }else if(pc.connectionState==='disconnected'||pc.iceConnectionState==='disconnected'){
      this._state('connecting');
      if(!this.disconnectTimer)this.disconnectTimer=setTimeout(()=>this._fail(new Error('Соединение потеряно. Проверьте сеть и повторите звонок.')),this.disconnectTimeoutMs);
    }else if(pc.connectionState==='connecting'&&this.state!=='connected')this._state('connecting');
  }

  async collectStats() {
    if(this.ended||!this.pc)return this.diagnostics;
    try {
      const stats=await this.pc.getStats();let pair;
      stats.forEach(report=>{if(report.type==='transport'&&report.selectedCandidatePairId)pair=stats.get(report.selectedCandidatePairId)||pair;});
      if(!pair)stats.forEach(report=>{if(report.type==='candidate-pair'&&report.state==='succeeded'&&report.nominated)pair=report;});
      if(pair){const local=stats.get(pair.localCandidateId),remote=stats.get(pair.remoteCandidateId);this.diagnostics.selectedCandidatePair={localType:local?.candidateType,remoteType:remote?.candidateType,protocol:local?.protocol,bytesSent:pair.bytesSent,bytesReceived:pair.bytesReceived,currentRoundTripTime:pair.currentRoundTripTime};}
      if(this.debug)console.debug('[FRAKTUM RTC] getStats',this.diagnostics.selectedCandidatePair);
    }catch(error){this.diagnostics.lastError={kind:'getStats',message:error.name};if(this.debug)console.debug('[FRAKTUM RTC] getStats failed',error.name);}
    return this.diagnostics;
  }

  _send(type,payload) {
    const operation=this.outgoing.then(()=>this.ended?undefined:this.signaling.send(type,payload));
    // Keep the queue usable so teardown can report a signaling failure once.
    this.outgoing=operation.catch(()=>{});
    return operation;
  }

  _schedulePoll() {
    if(this.ended)return;
    clearTimeout(this.pollTimer);
    this.pollTimer=setTimeout(async()=>{await this.poll();this._schedulePoll();},this.pollIntervalMs);
  }

  async poll() {
    if(this.ended||this.polling)return;
    this.polling=true;
    try {
      if(++this.statusPollCounter%5===0&&this.signaling.getStatus){
        const record=await this.signaling.getStatus();
        if(this.ended)return;
        if(END_STATUSES.has(record?.status)){await this.end({notifyPeer:false,state:record.status==='declined'?'declined':'ended'});return;}
        if(record?.status==='active'&&this.state==='calling')this._state('connecting');
      }
      const signals=await this.signaling.fetch(this.lastSignalId);
      for(const signal of [...(signals||[])].sort((a,b)=>Number(a.id)-Number(b.id))){
        if(this.ended)return;
        if(Number(signal.id)<=this.lastSignalId)continue;
        if(!signal.sender_id||signal.sender_id===this.peerId)await this._handleSignal(signal);
        if(this.ended)return;
        this.lastSignalId=Number(signal.id);
      }
    }catch(error){if(!this.ended)await this._fail(new Error(`Ошибка обмена сигналами звонка: ${error.message}`));}
    finally{this.polling=false;}
  }

  async _handleSignal(signal) {
    const pc=this.pc,type=signal.signal_type,payload=signal.payload;
    if(type==='hangup'){await this.end({notifyPeer:false});return;}
    if(type==='ice'){
      if(pc.remoteDescription)await pc.addIceCandidate(payload);else this.pendingIce.push(payload);
    }else if(type==='offer'&&!this.initiator){
      if(pc.remoteDescription?.sdp===payload.sdp)return;
      await pc.setRemoteDescription(payload);
      await this._flushIce();
      const answer=await pc.createAnswer();await pc.setLocalDescription(answer);
      await this._send('answer',{type:pc.localDescription.type,sdp:pc.localDescription.sdp});
      if(!this.ended&&this.state!=='connected')this._state('connecting');
    }else if(type==='answer'&&this.initiator){
      if(pc.remoteDescription?.sdp===payload.sdp)return;
      await pc.setRemoteDescription(payload);await this._flushIce();if(!this.ended&&this.state!=='connected')this._state('connecting');
    }
  }

  async _flushIce() {
    while(this.pendingIce.length&&!this.ended){await this.pc.addIceCandidate(this.pendingIce[0]);this.pendingIce.shift();}
  }

  controls() {
    return {muted:!!this.localStream?.getAudioTracks().every(track=>!track.enabled),cameraEnabled:!!this.localStream?.getVideoTracks().some(track=>track.enabled),canSwitchCamera:this.cameraSwitchAvailable};
  }
  setMuted(muted) {this.localStream?.getAudioTracks().forEach(track=>track.enabled=!muted);this.onControlsChanged(this.controls());}
  setCameraEnabled(enabled) {this.localStream?.getVideoTracks().forEach(track=>track.enabled=enabled);this.onControlsChanged(this.controls());}

  async switchCamera() {
    const oldTrack=this.localStream?.getVideoTracks()[0];
    if(this.ended||!oldTrack||!this.cameraSwitchAvailable)throw new Error('Вторая камера недоступна в этом браузере');
    const devices=(await this.mediaDevices.enumerateDevices()).filter(device=>device.kind==='videoinput');
    const index=devices.findIndex(device=>device.deviceId===oldTrack.getSettings?.().deviceId);
    const device=devices[(index+1)%devices.length];
    const stream=await this.mediaDevices.getUserMedia({audio:false,video:{deviceId:{exact:device.deviceId}}});
    const newTrack=stream.getVideoTracks()[0];
    if(this.ended){stream.getTracks().forEach(track=>track.stop());return;}
    try{
      newTrack.enabled=oldTrack.enabled;
      await this.pc.getSenders().find(sender=>sender.track===oldTrack).replaceTrack(newTrack);
      if(this.ended){stream.getTracks().forEach(track=>track.stop());return;}
      this.localStream.removeTrack(oldTrack);this.localStream.addTrack(newTrack);oldTrack.stop();
      this.onLocalStream(this.localStream);this.onControlsChanged(this.controls());
    }catch(error){stream.getTracks().forEach(track=>track.stop());throw error;}
  }

  async _fail(error) {
    if(this.ended)return;
    this.diagnostics.lastError={kind:'call',message:error.message};
    await this.end({state:'failed',error});
  }

  async end({notifyPeer=true,state='ended',error=null}={}) {
    if(this.ended)return;
    this.ended=true;
    clearTimeout(this.pollTimer);clearTimeout(this.connectTimer);clearTimeout(this.disconnectTimer);clearInterval(this.statsTimer);
    this.localStream?.getTracks().forEach(track=>track.stop());
    this.remoteStream?.getTracks().forEach(track=>track.stop());
    this.pc?.close();this.pendingIce=[];
    this._state(state,{error:error?.message || null});
    this.onEnded({state,error:error?.message || null});
    if(notifyPeer){
      const results=await Promise.allSettled([this.signaling.send('hangup',{}),this.signaling.setStatus?.('ended')]);
      const failure=results.find(result=>result.status==='rejected');
      if(failure){this.diagnostics.lastError={kind:'teardown',message:failure.reason?.message || String(failure.reason)};this.onState(state,{label:CALL_STATUS_LABELS[state],error:'Медиа остановлено, но сервер не подтвердил завершение звонка. Обновите страницу.'});if(this.debug)console.debug('[FRAKTUM RTC] teardown failed',this.diagnostics.lastError);}
    }
  }
}
