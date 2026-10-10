import {frequency,detectPitch,detectChord} from './engine.js';
export class PianoAudio {
  constructor(){this.context=null;this.stream=null;this.timer=null;this.serial=0;this.noise=.003;this.voices=new Set();}
  async unlock(){
    if(!this.context){const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)throw Error('Your browser cannot play audio. Open this page in Safari.');this.context=new Audio({latencyHint:'interactive'});}
    if(this.context.state!=='running')await this.context.resume();
    return this.context;
  }
  async listen(onFrame,{mode='single',sensitivity=5,onEnded=()=>{}}={}){
    this.stopMic();this.stopVoices();const serial=++this.serial;const ctx=await this.unlock();
    if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia)throw Error('Microphone access needs HTTPS. Open the secure app address in Safari.');
    let stream;
    try{stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false,channelCount:1},video:false});}
    catch(e){throw Error(e.name==='NotAllowedError'?'Microphone access was denied. Allow it in Safari’s website settings, then try again.':e.name==='NotFoundError'?'No microphone was found.':'The microphone is busy or unavailable. Close other audio apps and retry.');}
    if(serial!==this.serial){stream.getTracks().forEach(t=>t.stop());return false;}
    this.stream=stream;this.source=ctx.createMediaStreamSource(stream);this.analyser=ctx.createAnalyser();
    this.analyser.fftSize=8192;this.analyser.smoothingTimeConstant=0;this.source.connect(this.analyser);
    // Silent connection keeps analysis processing active without feeding the microphone back.
    this.silent=ctx.createGain();this.silent.gain.value=0;this.analyser.connect(this.silent);this.silent.connect(ctx.destination);
    const data=new Float32Array(8192),spectrum=new Float32Array(4096);
    stream.getAudioTracks()[0].onended=()=>{if(this.stream===stream){this.stopMic();onEnded();}};
    this.timer=setInterval(()=>{
      if(ctx.state!=='running'){onFrame({notes:[],level:0,interrupted:true});return;}
      this.analyser.getFloatTimeDomainData(data);let sum=0;for(let i=4096;i<data.length;i++)sum+=data[i]*data[i];const level=Math.sqrt(sum/4096);
      const threshold=Math.max(.0015,this.noise*(2.6-sensitivity*.15));
      let notes=[],pitch=null;
      if(level>threshold){
        this.analyser.getFloatFrequencyData(spectrum);
        if(mode==='single'){
          pitch=detectPitch(data.subarray(4096),ctx.sampleRate);
          if(pitch&&pitch.confidence>.9)notes=[pitch.note];
        }else notes=detectChord(spectrum,ctx.sampleRate,8192,-72+sensitivity);
      }
      onFrame({notes,level,pitch,interrupted:false});
    },60);
    return true;
  }
  stopMic(){this.serial++;clearInterval(this.timer);this.timer=null;if(this.stream){this.stream.getTracks().forEach(t=>{t.onended=null;t.stop();});this.stream=null;}this.source?.disconnect();this.analyser?.disconnect();this.silent?.disconnect();}
  play(note,duration=.7,volume=.18){
    const ctx=this.context;if(!ctx||ctx.state!=='running')return;
    const at=ctx.currentTime,base=frequency(note),g=ctx.createGain(),voices=[];
    g.gain.setValueAtTime(0,at);g.gain.linearRampToValueAtTime(volume,at+.006);g.gain.exponentialRampToValueAtTime(Math.max(.003,volume*.22),at+Math.max(.08,duration*.6));g.gain.exponentialRampToValueAtTime(.0001,at+duration+.22);g.connect(ctx.destination);
    [1,.36,.16,.075,.028].forEach((amplitude,i)=>{if(base*(i+1)>ctx.sampleRate/2)return;const osc=ctx.createOscillator(),partial=ctx.createGain();osc.type='sine';osc.frequency.value=base*(i+1)*Math.sqrt(1+.00012*i*i);partial.gain.value=amplitude;osc.connect(partial);partial.connect(g);osc.start(at);osc.stop(at+duration+.25);voices.push(osc);});
    const voice={g,voices};this.voices.add(voice);if(voices[0])voices[0].onended=()=>{g.disconnect();voices.forEach(o=>o.disconnect());this.voices.delete(voice);};
    if(this.voices.size>36){const old=this.voices.values().next().value;old.g.gain.setTargetAtTime(.0001,ctx.currentTime,.015);}
  }
  stopVoices(){for(const v of this.voices){try{v.voices.forEach(o=>o.stop());v.g.disconnect();}catch{}}this.voices.clear();}
}
