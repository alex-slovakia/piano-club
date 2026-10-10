import test from 'node:test';
import assert from 'node:assert/strict';
import {DemoTimeline} from '../dist/playback.js';
const groups=[0,.1,4,9].map(time=>({time,notes:[{pitch:60,duration:.8}]}));
test('demo clock keeps fast passages and long rests at the score timing',()=>{const t=new DemoTimeline(groups);t.play(10,.5);assert.equal(t.position(12),0);assert.equal(t.due(12,0).length,1);assert.equal(t.due(12.2,0)[0].index,1);assert.equal(t.due(18,0).length,0);assert.equal(t.due(20,0)[0].index,2);assert.equal(t.index(20),2);});
test('speed changes preserve the current position and pause freezes the roll',()=>{const t=new DemoTimeline(groups);t.play(0,1);assert.equal(t.position(3),2);t.speed(.5,3);assert.equal(t.position(3),2);assert.equal(t.position(5),3);t.pause(5);assert.equal(t.position(500),3);t.play(10,.5);assert.equal(t.position(12),4);});
test('demo reaches the final note and honors a selected section',()=>{const t=new DemoTimeline(groups,1,2);t.play(0);assert.equal(t.due(1,0)[0].index,1);assert.equal(t.due(5,0)[0].index,2);assert.equal(t.due(20,0).length,0);assert.equal(t.finished(5),false);assert.equal(t.finished(5.71),true);});
