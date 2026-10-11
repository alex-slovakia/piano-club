import {frequency,detectPitch} from './engine.js';
import {detectPianoChord,learnKeyProfile,ChordStability} from './chords.js';

// Repeated piano strikes can have ringing tails without digital silence.
// A sharp rise in level marks a new strike; steady or decaying notes do not.
export class PianoOnsets {
  constructor(){this.previous=0;this.previousAttack=0;this.history=[];this.last=-Infinity;this.id=0;}
  update(level,now,attackEnergy=0){
    this.history=this.history.filter(x=>now-x.time<240);
    const floor=Math.min(this.previous,...this.history.map(x=>x.level));
    const levelAttack=level>this.previous*1.55&&level>floor*2.4;
    const brightAttack=this.previousAttack>1e-9&&attackEnergy>this.previousAttack*1.7&&level>this.previous*1.15&&level>floor*1.2;
    if(level>.0008&&(levelAttack||brightAttack)&&level-floor>.0006&&now-this.last>170){this.id++;this.last=now;}
    this.previous=level;this.previousAttack=attackEnergy;this.history.push({time:now,level});return this.id;
  }
}

// Shared by live capture and the signal regression tests. Never uses score notes.
export function analyzeMicrophoneFrame(data,sampleRate,{noise=.0007,sensitivity=5,mode='single',spectrum=null,keyProfiles={}}={}){
  const samples=data.subarray(data.length-4096);let sum=0,mean=0,peak=0,clipped=0;
  for(const x of samples){sum+=x*x;mean+=x;peak=Math.max(peak,Math.abs(x));if(Math.abs(x)>.985)clipped++;}
  mean/=samples.length;
  const level=Math.sqrt(Math.max(0,sum/samples.length-mean*mean));
  const threshold=Math.max(.00045,Math.min(.006,Number(noise)||.0007)*(2.2-Math.max(1,Math.min(10,sensitivity))*.16));
  let notes=[],pitch=null;
  if(level>.00045){
    // A gentle low-pass removes high-frequency hiss before periodicity analysis.
    if(mode==='single'||mode==='calibrate'){
      const smooth=new Float32Array(samples.length),alpha=1-Math.exp(-2*Math.PI*4200/sampleRate);let previous=0;
      for(let i=0;i<samples.length;i++){previous+=alpha*(samples[i]-mean-previous);smooth[i]=previous;}
      pitch=detectPitch(smooth,sampleRate,60,2200);
      if(pitch&&pitch.note>=36&&pitch.note<=96&&pitch.confidence>=.86&&(level>threshold||pitch.confidence>.97))notes=[pitch.note];
    }else if(spectrum)notes=detectPianoChord(spectrum,sampleRate,data.length,-90-sensitivity,keyProfiles);
  }
  const profile=mode==='calibrate'&&spectrum&&pitch?.confidence>.96&&notes.length?learnKeyProfile(spectrum,sampleRate,data.length,pitch):null;
  let attackEnergy=0;if(spectrum&&mode!=='single')for(let i=Math.ceil(1000*data.length/sampleRate);i<Math.min(spectrum.length,Math.ceil(6000*data.length/sampleRate));i++)attackEnergy+=10**(spectrum[i]/10);
  return {notes,pitch,profile,attackEnergy,level,peak,clipping:clipped/samples.length>.004,db:Math.round(20*Math.log10(Math.max(level,1e-6))),threshold,sampleRate};
}
export class PianoAudio {
  constructor(){this.context=null;this.stream=null;this.timer=null;this.serial=0;this.noise=.0007;this.voices=new Set();this.keyProfiles={};}
  async unlock(type='playback'){
    // Safari can otherwise keep Web Audio in an ambient/silent playback route.
    try{if(navigator.audioSession)navigator.audioSession.type=type;}catch{}
    if(!this.context){const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)throw Error('Your browser cannot play audio. Open this page in Safari.');this.context=new Audio({latencyHint:'interactive'});}
    if(this.context.state!=='running')await this.context.resume();
    return this.context;
  }
  async listen(onFrame,{mode='single',sensitivity=5,onEnded=()=>{}}={}){
    this.stopMic();this.stopVoices();const serial=++this.serial;const ctx=await this.unlock('play-and-record');
    if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia)throw Error('Microphone access needs HTTPS. Open the secure app address in Safari.');
    let stream;
    try{stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false,channelCount:1},video:false});}
    catch(e){throw Error(e.name==='NotAllowedError'?'Microphone access was denied. Allow it in Safari’s website settings, then try again.':e.name==='NotFoundError'?'No microphone was found.':'The microphone is busy or unavailable. Close other audio apps and retry.');}
    if(serial!==this.serial){stream.getTracks().forEach(t=>t.stop());return false;}
    this.stream=stream;this.source=ctx.createMediaStreamSource(stream);this.analyser=ctx.createAnalyser();
    this.analyser.fftSize=8192;this.analyser.smoothingTimeConstant=0;this.source.connect(this.analyser);
    // Silent connection keeps analysis processing active without feeding the microphone back.
    this.silent=ctx.createGain();this.silent.gain.value=0;this.analyser.connect(this.silent);this.silent.connect(ctx.destination);
    // Opening capture changes the iOS audio route and can suspend the context
    // that was already resumed by the initial tap. Resume again after capture.
    try{if(ctx.state!=='running')await ctx.resume();}
    catch(e){if(serial===this.serial)this.stopMic();else stream.getTracks().forEach(t=>t.stop());throw Error('Safari could not start audio processing. Close other audio apps, then retry.');}
    if(serial!==this.serial){stream.getTracks().forEach(t=>t.stop());return false;}
    if(ctx.state!=='running'){this.stopMic();throw Error('Safari paused audio processing. Tap Start microphone again.');}
    const data=new Float32Array(8192),spectrum=new Float32Array(4096),onsets=new PianoOnsets();let stable=new ChordStability(),previousMode=null;
    stream.getAudioTracks()[0].onended=()=>{if(this.stream===stream){this.stopMic();onEnded();}};
    this.timer=setInterval(()=>{
      if(ctx.state!=='running'){onFrame({notes:[],level:0,interrupted:true});return;}
      this.analyser.getFloatTimeDomainData(data);
      const frameMode=typeof mode==='function'?mode():mode;
      if(frameMode!=='single')this.analyser.getFloatFrequencyData(spectrum);
      const frame=analyzeMicrophoneFrame(data,ctx.sampleRate,{noise:this.noise,sensitivity,mode:frameMode,spectrum,keyProfiles:this.keyProfiles});
      if(frameMode!==previousMode){stable=new ChordStability();previousMode=frameMode;}
      if(frameMode==='auto'||frameMode==='chord')frame.notes=stable.update(frame.notes);
      onFrame({...frame,onsetId:onsets.update(frame.level,ctx.currentTime*1000,frame.attackEnergy),interrupted:false,muted:stream.getAudioTracks()[0].muted});
    },40);
    return true;
  }
  stopMic(){this.serial++;clearInterval(this.timer);this.timer=null;if(this.stream){this.stream.getTracks().forEach(t=>{t.onended=null;t.stop();});this.stream=null;}this.source?.disconnect();this.analyser?.disconnect();this.silent?.disconnect();}
  play(note,duration=.7,volume=.18,delay=0){
    const ctx=this.context;if(!ctx||ctx.state!=='running')return;
    const at=ctx.currentTime+Math.max(0,delay),base=frequency(note),g=ctx.createGain(),voices=[];
    g.gain.setValueAtTime(0,at);g.gain.linearRampToValueAtTime(volume,at+.006);g.gain.exponentialRampToValueAtTime(Math.max(.003,volume*.22),at+Math.max(.08,duration*.6));g.gain.exponentialRampToValueAtTime(.0001,at+duration+.22);g.connect(ctx.destination);
    [1,.36,.16,.075,.028].forEach((amplitude,i)=>{if(base*(i+1)>ctx.sampleRate/2)return;const osc=ctx.createOscillator(),partial=ctx.createGain();osc.type='sine';osc.frequency.value=base*(i+1)*Math.sqrt(1+.00012*i*i);partial.gain.value=amplitude;osc.connect(partial);partial.connect(g);osc.start(at);osc.stop(at+duration+.25);voices.push(osc);});
    const voice={g,voices};this.voices.add(voice);if(voices[0])voices[0].onended=()=>{g.disconnect();voices.forEach(o=>o.disconnect());this.voices.delete(voice);};
    if(this.voices.size>36){const old=this.voices.values().next().value;old.g.gain.setTargetAtTime(.0001,ctx.currentTime,.015);}
  }
  stopVoices(){for(const v of this.voices){try{v.voices.forEach(o=>o.stop());v.g.disconnect();}catch{}}this.voices.clear();}
}
