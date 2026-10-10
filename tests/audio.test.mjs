import test from 'node:test';
import assert from 'node:assert/strict';
import {PianoAudio,analyzeMicrophoneFrame,PianoOnsets} from '../dist/audio.js';
import {NoteGate,frequency} from '../dist/engine.js';

function pianoFrame(note,noise=0,volume=.12,sampleRate=48000){
  let seed=123;const f=frequency(note);
  return Float32Array.from({length:8192},(_,i)=>{seed=(1664525*seed+1013904223)>>>0;return volume*(Math.sin(2*Math.PI*f*i/sampleRate)+.5*Math.sin(4*Math.PI*f*i/sampleRate))+noise*(seed/2**31-1);});
}
async function capture(t,{samples=pianoFrame(60),suspendOnCapture=false,noise=.003,sampleRate=48000}={}){
  let tick;const frames=[];const track={stop(){},muted:false,readyState:'live'};
  const ctx={state:'suspended',sampleRate,currentTime:0,destination:{},resume:async()=>{ctx.state='running';},createMediaStreamSource:()=>({connect(){},disconnect(){}}),createAnalyser:()=>({connect(){},disconnect(){},getFloatTimeDomainData(out){out.set(samples);},getFloatFrequencyData(out){out.fill(-100);}}),createGain:()=>({gain:{value:0},connect(){},disconnect(){}})};
  t.mock.method(globalThis,'setInterval',fn=>{tick=fn;return 123;});
  t.mock.method(globalThis,'clearInterval',()=>{});
  const oldWindow=Object.getOwnPropertyDescriptor(globalThis,'window'),oldNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator');
  Object.defineProperty(globalThis,'window',{configurable:true,value:{isSecureContext:true,AudioContext:function(){return ctx;}}});
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{audioSession:{type:'auto'},mediaDevices:{getUserMedia:async()=>{if(suspendOnCapture)ctx.state='suspended';return {getTracks:()=>[track],getAudioTracks:()=>[track]};}}}});
  t.after(()=>{if(oldWindow)Object.defineProperty(globalThis,'window',oldWindow);else delete globalThis.window;if(oldNavigator)Object.defineProperty(globalThis,'navigator',oldNavigator);else delete globalThis.navigator;});
  const audio=new PianoAudio();audio.noise=noise;t.after(()=>audio.stopMic());
  await audio.listen(frame=>frames.push(frame));
  for(let i=0;i<8;i++){ctx.currentTime+=.06;tick();}
  return {frames,ctx};
}
test('capture resumes processing after Safari suspends context when opening microphone',async t=>{
  const {frames,ctx}=await capture(t,{suspendOnCapture:true});
  assert.equal(ctx.state,'running');assert.ok(frames.some(f=>f.notes.includes(60)));
});
test('real capture pipeline accepts a stable piano fundamental with room noise',async t=>{
  const {frames}=await capture(t,{samples:pianoFrame(60,.06)});
  assert.ok(frames.filter(f=>f.notes.includes(60)).length>=3);
});
test('old noisy calibration cannot make all normal piano input disappear',async t=>{
  const {frames}=await capture(t,{noise:.8});assert.ok(frames.some(f=>f.notes.includes(60)));
});
test('microphone silence never advances a note',async t=>{
  const {frames}=await capture(t,{samples:new Float32Array(8192)});assert.ok(frames.every(f=>f.notes.length===0));
});
test('a different stable next note is accepted without an artificial silent gap',()=>{
  const g=new NoteGate(100);g.check([60],[60],0);assert.equal(g.check([60],[60],120),true);
  assert.equal(g.check([62],[62],180),false);assert.equal(g.check([62],[62],300),true);
  assert.equal(g.check([62],[62],800),false,'a held note is not a repeated strike');
});
test('single-note capture recognizes quiet, normal and clipped notes across C2–C7',()=>{
  for(const sampleRate of [44100,48000])for(const note of [36,43,48,55,60,61,64,69,72,81,84,90,96])for(const volume of [.002,.12,1.3]){
    const samples=pianoFrame(note,0,volume,sampleRate).map(x=>Math.max(-1,Math.min(1,x)));
    const frame=analyzeMicrophoneFrame(samples,sampleRate);
    assert.deepEqual(frame.notes,[note],`${note}, volume ${volume}, ${sampleRate} Hz`);
    if(volume>1)assert.equal(frame.clipping,true);
  }
});
test('random room noise cannot produce accepted practice steps',()=>{
  let seed=841;const gate=new NoteGate();let accepts=0;
  for(let frame=0;frame<40;frame++){
    const samples=Float32Array.from({length:8192},()=>{seed=(1664525*seed+1013904223)>>>0;return .1*(seed/2**31-1);});
    const detected=analyzeMicrophoneFrame(samples,48000);if(gate.check(detected.notes,[60],frame*40))accepts++;
  }
  assert.equal(accepts,0);
});
test('captured right notes pass the real practice gate; a wrong note never does',()=>{
  const g=new NoteGate(80),wrong=analyzeMicrophoneFrame(pianoFrame(61,.03),48000),right=analyzeMicrophoneFrame(pianoFrame(60,.06),48000);
  for(let i=0;i<8;i++)assert.equal(g.check(wrong.notes,[60],i*40),false);
  assert.equal(g.check(right.notes,[60],400),false);assert.equal(g.check(right.notes,[60],440),false);assert.equal(g.check(right.notes,[60],480),true);
  assert.equal(g.check(right.notes,[60],1000),false);
});
test('two repeated strikes advance twice despite a ringing tail; a held note advances once',()=>{
  const onsets=new PianoOnsets(),gate=new NoteGate(80);let count=0;
  const levels=[.001,.1,.09,.08,.07,.06,.04,.03,.02,.012,.009,.15,.13,.11,.09,.07,.05,.04,.03,.025,.02,.019,.018];
  levels.forEach((level,i)=>{const now=i*40,onset=onsets.update(level,now);if(gate.check([64],[64],now,onset))count++;});
  assert.equal(count,2);
  for(let i=levels.length;i<80;i++)if(gate.check([64],[64],i*40,onsets.update(.018,i*40)))count++;
  assert.equal(count,2,'steady input does not invent further strikes');
});
