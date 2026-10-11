import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {trimScore,practiceGroups} from '../dist/engine.js';

const {songs}=JSON.parse(await readFile(new URL('../dist/catalog.json',import.meta.url)));
const references={
  'rush-e':'mHEWSfudL_w','river-flows-in-you':'NPBCbTZWnq0','love-story':'b2-qQwgs14o','la-maritza':'ctCa6JlA1R4',
  katyusha:'tRT-9LcCA7U',pirates:'vPmFZRcXOQk',entertainer:'wBbW17x5vZQ','vivaldi-winter':'onJ-ffw9SH8',
  'vivaldi-summer':'l2rSjLGndbQ','rondo-alla-turca':'6_qH4iI2Ado',sweden:'7jFJbp8rYDA',mario:'QFGJQhPmcts',
  'thousand-miles':'wP_NihUIBi0',frolic:'GneMwBNNCM4','golden-brown':'7hFnSebpL0c',succession:'OCfIT4wofMY'
};
async function score(id){const song=songs.find(s=>s.id===id);assert.ok(song,id);const data=JSON.parse(await readFile(new URL('../dist/'+song.file.replace('./',''),import.meta.url)));return {song,...data};}

test('all sixteen personal scores identify the actual requested video as their source',async t=>{
  if(!songs.length){t.skip('Personal score data is excluded from the public code repository.');return;}
  for(const [id,video] of Object.entries(references)){
    const {song,notes,provenance}=await score(id);
    assert.equal(song.sourceTiming,'video',id);assert.equal(new URL(song.url).searchParams.get('v'),video,id);
    assert.equal(provenance.videoId,video,id);assert.ok(notes.length>100,id);
    assert.ok(notes[0].time>=0&&notes.every((n,i)=>!i||n.time>=notes[i-1].time),id);
  }
});

test('verified opening pitches and video-37 Sweden cut cannot regress to the alternate MIDIs',async t=>{
  if(!songs.length){t.skip('Personal score data is excluded from the public code repository.');return;}
  const rush=await score('rush-e');assert.equal(rush.notes[0].pitch,64,'Rush E begins on E4, not E5');
  const river=await score('river-flows-in-you');
  const riverGroups=practiceGroups(trimScore(river.notes,river.song.trim));
  assert.deepEqual(riverGroups[2].notes.map(n=>n.pitch).sort((a,b)=>a-b),[54,81],'near-simultaneous bass and melody share one practice gate');
  assert.ok(riverGroups[2].notes[1].time>riverGroups[2].time,'demo keeps the measured within-frame offset');
  const kat=await score('katyusha');assert.deepEqual(practiceGroups(kat.notes)[0].notes.map(n=>n.pitch).sort((a,b)=>a-b),[50,53,57,62],'Katyusha starts in D minor');
  const succ=await score('succession');assert.equal(succ.notes[0].pitch,36);assert.ok(succ.notes.some(n=>n.pitch===96),'source has high C7');assert.ok(succ.song.duration>90,'full easy tutorial, not 14-second excerpt');
  const sweden=await score('sweden');assert.equal(sweden.song.trim,37);
  const selected=trimScore(sweden.notes,37),groups=practiceGroups(selected);
  assert.equal(groups[0].time,0);assert.deepEqual(groups[0].notes.map(n=>n.pitch),[38]);
  assert.ok(Math.abs(groups[1].time-1.25)<.02);
  assert.deepEqual(groups[1].notes.map(n=>n.pitch).sort((a,b)=>a-b),[40,52,55,59]);
});
