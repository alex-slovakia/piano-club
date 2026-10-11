import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {NoteGate,PracticeSession,detectPitch,frequency,parseMidi,fitKeyboard,suggestFingers,practiceGroups,trimScore} from '../dist/engine.js';
import {basicDrills,chordExercise,CHORDS} from '../dist/learning.js';
test('gate requires stable exact notes, rejects silence, wrong notes and extra notes',()=>{const g=new NoteGate();assert.equal(g.check([],[60],0),false);assert.equal(g.check([61],[60],120),false);assert.equal(g.check([60,61],[60],200),false);assert.equal(g.check([60],[60],300),false);assert.equal(g.check([60],[60],410),true);});
test('held notes do not advance twice; a fresh note after release does',()=>{const g=new NoteGate();g.check([60],[60],0);assert.equal(g.check([60],[60],110),true);assert.equal(g.check([60],[60],500),false);assert.equal(g.check([],[60],600),false);assert.equal(g.check([],[60],700),false);assert.equal(g.check([60],[60],800),false);assert.equal(g.check([60],[60],920),true);});
test('chord must be heard simultaneously, not collected from separate wrong attempts',()=>{const g=new NoteGate(0);assert.equal(g.check([60],[60,64],0),false);assert.equal(g.check([64],[60,64],100),false);assert.equal(g.check([60,64,67],[60,64],200),false);assert.equal(g.check([64,60],[60,64],300),true);});
test('six clean repetitions then a wrong seventh resets the entire streak',()=>{const s=new PracticeSession(24,0,2);for(let i=0;i<18;i++)s.correct();assert.equal(s.streak,6);s.correct();s.mistake();assert.equal(s.streak,0);assert.equal(s.index,0);assert.equal(s.mastered,false);assert.equal(s.next(),false);for(let i=0;i<21;i++)s.correct();assert.equal(s.streak,7);assert.equal(s.mastered,true);assert.equal(s.next(),true);assert.equal(s.start,3);assert.equal(s.streak,0);});
test('watch mode never increases clean repetitions',()=>{const s=new PracticeSession(4,0,1);for(let i=0;i<30;i++)s.correct('watch',true);assert.equal(s.streak,0);assert.equal(s.mastered,false);});
test('pitch detection handles harmonic piano-like notes across 61-key useful range',()=>{for(const sampleRate of [44100,48000])for(const midi of [36,43,48,55,60,61,64,69,72,81,84,90,96]){const f=frequency(midi),samples=Float32Array.from({length:4096},(_,i)=>.15*Math.sin(2*Math.PI*f*i/sampleRate)+.055*Math.sin(4*Math.PI*f*i/sampleRate)+.022*Math.sin(6*Math.PI*f*i/sampleRate));const p=detectPitch(samples,sampleRate);assert.equal(p?.note,midi,`pitch ${midi} at ${sampleRate}`);assert.ok(p.confidence>.9);}});
test('pitch detector rejects silence',()=>assert.equal(detectPitch(new Float32Array(4096),48000),null));
test('MIDI parser honors initial tempo, retains hand-track provenance and validates bad files',()=>{const bytes=Uint8Array.from([77,84,104,100,0,0,0,6,0,0,0,1,1,224,77,84,114,107,0,0,0,20,0,255,81,3,15,66,64,0,144,60,100,131,96,128,60,0,0,255,47,0]);const parsed=parseMidi(bytes.buffer);assert.equal(parsed.bpm,60);assert.equal(parsed.notes.length,1);assert.equal(parsed.notes[0].duration,1);assert.equal(parsed.notes[0].track,0);assert.throws(()=>parseMidi(new ArrayBuffer(0)));assert.throws(()=>parseMidi(bytes.buffer.slice(0,-3)));});
test('fitting 61 keys preserves pitch classes and valid suggested finger numbers',()=>{const notes=[24,29,36,60,64,100,108].map((pitch,i)=>({pitch,time:i,duration:1,hand:pitch<60?'left':'right'}));const fit=fitKeyboard(notes);fit.forEach((n,i)=>{assert.ok(n.pitch>=36&&n.pitch<=96);assert.equal(n.pitch%12,notes[i].pitch%12);});suggestFingers(fit).forEach(n=>assert.ok(n.finger>=1&&n.finger<=5));});
test('practice and demo preserve the same chord pitches, onsets and durations regardless of mic setting',()=>{
  const notes=[{pitch:54,time:0,duration:1,hand:'left'},{pitch:81,time:0,duration:.4,hand:'right'},{pitch:83,time:.02,duration:.3,hand:'right'}];
  const practice=practiceGroups(notes,'both',true),demo=practiceGroups(notes,'both',false);
  assert.deepEqual(practice,demo);assert.equal(practice.length,2);
  assert.deepEqual(practice.flatMap(g=>g.notes),notes);assert.equal(practice[1].time,.02);
  assert.deepEqual(practiceGroups(notes,'right').flatMap(g=>g.notes),notes.filter(n=>n.hand==='right'));
});
test('keyboard folding never removes notes from the score',()=>{
  const notes=fitKeyboard([{pitch:24,time:0,duration:2,hand:'left'},{pitch:36,time:0,duration:1,hand:'right'}]);
  assert.equal(practiceGroups(notes).flatMap(g=>g.notes).length,2);
});
test('starting at video second 37 retains sounding notes and the original gap to the next attack',()=>{
  const notes=[{pitch:48,time:36,duration:2,hand:'left'},{pitch:60,time:36,duration:.5,hand:'right'},{pitch:62,time:37.5,duration:.5,hand:'right'}];
  const result=trimScore(notes,37);
  assert.deepEqual(result.map(n=>[n.pitch,n.time,n.duration,n.id]),[[48,0,1,0],[62,.5,.5,2]]);
  assert.equal(result[0].continuation,true);assert.equal(result[1].continuation,false);
});
test('a held accompaniment note does not block a new melody attack or count as a new attack',()=>{
  const gate=new NoteGate(0);
  assert.equal(gate.check([48,60],[48,60],0),true);
  assert.equal(gate.check([48],[62],100,0,[48]),false);
  assert.equal(gate.check([48,62],[62],200,0,[48]),true);
  assert.equal(gate.check([48,62],[62],300,0,[48]),false);
  assert.equal(gate.check([48,63],[64],400,0,[48]),false);
});
test('beginner drills have deliberate valid fingering and fit the keyboard',()=>{const drills=basicDrills();assert.equal(drills.length,6);for(const drill of drills){assert.ok(drill.notes.length>=9);assert.ok(drill.notes.every(n=>n.pitch>=36&&n.pitch<=96&&n.finger>=1&&n.finger<=5));}assert.deepEqual(drills[3].notes.slice(0,8).map(n=>n.finger),[1,2,3,1,2,3,4,5]);});
test('broken and block chord lessons contain exactly the chosen chord tones',()=>{for(const pattern of ['broken','rolling','together']){const exercise=chordExercise(['Am','F','C','G'],pattern);assert.ok(exercise.notes.every((n,i)=>i===0||n.time>=exercise.notes[i-1].time));for(let bar=0;bar<4;bar++){const name=['Am','F','C','G'][bar],ns=exercise.notes.filter(n=>n.time>=bar*3&&n.time<(bar+1)*3&&n.hand==='right');assert.ok(ns.every(n=>CHORDS[name].includes(n.pitch)));assert.deepEqual([...new Set(ns.map(n=>n.pitch))].sort(),[...CHORDS[name]].sort());}}});
test('every catalog piece preserves all notes in practice and demo on the Yamaha 61-key range',async()=>{const {songs}=JSON.parse(await readFile(new URL('../dist/catalog.json',import.meta.url)));assert.ok(Array.isArray(songs));for(const song of songs){const {notes}=JSON.parse(await readFile(new URL('../dist/'+song.file.replace('./',''),import.meta.url)));assert.ok(notes.length>10,song.title);assert.ok(notes.every(n=>Number.isFinite(n.time)&&n.duration>0),song.title);const fitted=fitKeyboard(notes);assert.ok(fitted.every(n=>n.pitch>=36&&n.pitch<=96),song.title);for(const hand of ['both','left','right']){const expected=fitted.filter(n=>hand==='both'||n.hand===hand);const practice=practiceGroups(fitted,hand,true),demo=practiceGroups(fitted,hand,false);assert.ok(JSON.stringify(practice)===JSON.stringify(demo),song.title+" differs between modes");assert.deepEqual(practice.flatMap(g=>g.notes),expected,song.title);}}});
