import test from 'node:test';
import assert from 'node:assert/strict';
import {DemoTimeline,WaitTimeline} from '../dist/playback.js';
const groups=[0,.1,4,9].map(time=>({time,notes:[{pitch:60,duration:.8}]}));
test('demo clock keeps fast passages and long rests at the score timing',()=>{const t=new DemoTimeline(groups);t.play(10,.5);assert.equal(t.position(12),0);assert.equal(t.due(12,0).length,1);assert.equal(t.due(12.2,0)[0].index,1);assert.equal(t.due(18,0).length,0);assert.equal(t.due(20,0)[0].index,2);assert.equal(t.index(20),2);});
test('speed changes preserve the current position and pause freezes the roll',()=>{const t=new DemoTimeline(groups);t.play(0,1);assert.equal(t.position(3),2);t.speed(.5,3);assert.equal(t.position(3),2);assert.equal(t.position(5),3);t.pause(5);assert.equal(t.position(500),3);t.play(10,.5);assert.equal(t.position(12),4);});
test('demo reaches the final note and honors a selected section',()=>{const t=new DemoTimeline(groups,1,2);t.play(0);assert.equal(t.due(1,0)[0].index,1);assert.equal(t.due(5,0)[0].index,2);assert.equal(t.due(20,0).length,0);assert.equal(t.finished(5),false);assert.equal(t.finished(5.71),true);});
test('wait mode preserves score rhythm and stops at every unplayed event',()=>{
  const t=new WaitTimeline(groups,0);t.play(0,.5);
  assert.equal(t.position(100),0);
  t.advance(1,100);assert.ok(Math.abs(t.position(100.1)-.05)<1e-8);assert.equal(t.position(101),.1);
  t.advance(2,102);assert.equal(t.position(104),1.1);assert.equal(t.position(500),4);
  t.advance(3,500);t.pause(502);assert.equal(t.position(600),5);
  t.play(600,1);assert.equal(t.position(601),6);t.speed(.25,601);assert.equal(t.position(605),7);
});
test('demo lets a held bass finish after a shorter final melody note',()=>{
  const t=new DemoTimeline([{time:0,notes:[{pitch:48,duration:5}]},{time:1,notes:[{pitch:60,duration:.2}]}]);t.play(0);
  assert.equal(t.finished(3),false);assert.equal(t.finished(6),true);
});
