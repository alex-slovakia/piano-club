import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeMicrophoneFrame} from '../dist/audio.js';
import {NoteGate} from '../dist/engine.js';
import {chordSamples,spectrumOf} from './signal-fixtures.mjs';
import {ChordStability,learnKeyProfile} from '../dist/chords.js';
import {KeyboardCalibration,validKeyProfiles} from '../dist/calibration.js';

const fixtures=[
  ['octave',[48,60]],['three octaves',[40,52,64]],['minor with octave',[50,53,57,62]],
  ['Rush E octave chord',[40,52,64,68,76]],['Winter repeated chord',[41,53,56,60,65]],
  ['Love Story wide voicing',[46,53,58,62,65,70]],['seven keys',[36,48,55,60,64,67,72]]
];
test('microphone chord analysis hears every key of octave and wide piano chords',()=>{
  for(const [name,notes] of fixtures){
    const data=chordSamples(notes),frame=analyzeMicrophoneFrame(data,48000,{mode:'chord',spectrum:spectrumOf(data)});
    assert.deepEqual([...frame.notes].sort((a,b)=>a-b),notes,name);
    const gate=new NoteGate(80);gate.check(frame.notes,notes,0);assert.equal(gate.check(frame.notes,notes,100),true,name+' advances');
  }
});

function detect(notes,options={}){const sampleRate=options.sampleRate??48000,data=chordSamples(notes,options);return analyzeMicrophoneFrame(data,sampleRate,{mode:'chord',spectrum:spectrumOf(data),noise:options.noiseFloor,keyProfiles:options.keyProfiles}).notes;}

test('chords remain audible at Safari sample rates, different volumes and modest room noise',()=>{
  for(const sampleRate of [44100,48000])for(const volume of [.003,.07,.2])for(const notes of [[48,60],[60,64,67],[41,53,56,60,65]])assert.deepEqual(detect(notes,{sampleRate,volume,noise:volume*.1,noiseFloor:.8}),notes);
});

test('a bass note alone, a missing chord tone, wrong semitone or extra key cannot pass the chord gate',()=>{
  const target=[48,60,64,67];
  for(const played of [[48],[48,60],[48,60,64],[48,60,65,67],[48,60,64,67,70]]){
    const heard=detect(played),gate=new NoteGate(80);
    for(let i=0;i<8;i++)assert.equal(gate.check(heard,target,i*40),false,`played ${played}, heard ${heard}`);
  }
});

test('chord detection rejects silence and broadband noise',()=>{
  for(const noise of [0,.002,.03,.2])assert.deepEqual(detect([],{noise}),[]);
});

test('three-frame stability bridges one missing pitch without collecting separate key presses',()=>{
  const stable=new ChordStability(),gate=new NoteGate(80),target=[48,60,64];let passed=false;
  [[48,60,64],[48,60,64],[48,64],[48,60,64],[48,60,64]].forEach((notes,i)=>{passed||=gate.check(stable.update(notes),target,i*40);});
  assert.equal(passed,true);
  const separate=new ChordStability(),g=new NoteGate(80);
  for(const [i,notes] of [[60],[60],[60],[64],[64],[64],[],[60],[60]].entries())assert.equal(g.check(separate.update(notes),[60,64],i*40),false);
  assert.deepEqual(stable.update([]),[],'silence clears any held estimate immediately');
});

test('keyboard calibration requires the correct stable isolated pitch and can resume',()=>{
  const c=new KeyboardCalibration(),profile=[1,.4,.2,.1,.05,.03,.02,.01,0,0];
  const frame={pitch:{note:36,confidence:.99},profile,clipping:false,level:.1};
  for(let i=0;i<15;i++)assert.equal(c.update({...frame,pitch:{note:48,confidence:.99}},i*40),null);
  assert.equal(c.count,0);
  for(let i=0;i<12;i++)assert.equal(c.update(frame,1000+i*40),null);
  assert.equal(c.update(frame,1480),36);assert.equal(c.count,1);assert.equal(c.note,37);
  const resumed=new KeyboardCalibration(c.profiles);assert.equal(resumed.note,37);
  assert.deepEqual(validKeyProfiles({36:profile,37:[NaN],99:profile}),{36:profile});
  for(let n=37;n<=96;n++)for(let i=0;i<=12;i++)resumed.update({...frame,pitch:{note:n,confidence:.99}},n*1000+i*40);
  assert.equal(resumed.count,61);assert.equal(resumed.note,null);
});

test('learned keyboard timbre recognizes a quieter chord tone under a strong second harmonic',()=>{
  const partials=[.5,1,.4,.15,.1],keyProfiles={};
  for(let n=36;n<=96;n++)keyProfiles[n]=learnKeyProfile(spectrumOf(chordSamples([n],{partials})),48000,8192,{hz:440*2**((n-69)/12)});
  assert.deepEqual(detect([60,64,67],{partials,keyProfiles,gains:[1,.25,1],noise:.003}),[60,64,67]);
  assert.deepEqual(detect([40,52,64,68,76],{partials,keyProfiles,gains:[1,.25,1,1,1],noise:.003}),[40,52,64,68,76]);
  const gate=new NoteGate(0);assert.equal(gate.check(detect([60],{partials,keyProfiles}),[60,72],0),false,'calibration never supplies an unplayed octave');
});
