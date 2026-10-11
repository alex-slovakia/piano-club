// One audio clock drives scheduling and the falling-note display.
export class DemoTimeline {
  constructor(groups,start=0,end=groups.length-1){this.groups=groups;this.start=start;this.end=end;this.anchor=0;this.offset=groups[start].time-1;this.rate=1;this.playing=false;this.cursor=start;this.endTime=Math.max(groups[end].time+.3,...groups.slice(start,end+1).flatMap(g=>g.notes.map(n=>(n.time??g.time)+n.duration)));}
  position(now){return this.offset+(this.playing?(now-this.anchor)*this.rate:0);}
  play(now,rate=1){this.anchor=now;this.rate=rate;this.playing=true;}
  pause(now){this.offset=this.position(now);this.anchor=now;this.playing=false;while(this.cursor>this.start&&this.groups[this.cursor-1].time>this.offset)this.cursor--;}
  speed(rate,now){this.offset=this.position(now);this.anchor=now;this.rate=rate;}
  due(now,lookAhead=.075){const events=[],position=this.position(now);while(this.cursor<=this.end&&this.groups[this.cursor].time<=position+lookAhead*this.rate+1e-8){const index=this.cursor++,group=this.groups[index];events.push({group,index,delay:Math.max(0,(group.time-position)/this.rate)});}return events;}
  index(now){const position=this.position(now);let low=this.start,high=this.end;while(low<high){const mid=Math.ceil((low+high)/2);if(this.groups[mid].time<=position)low=mid;else high=mid-1;}return low;}
  finished(now){return this.position(now)>=this.endTime;}
}

// Identical score seconds and speed to the demo, with a ceiling at the next
// unplayed event. A long pause never accumulates time or skips future notes.
export class WaitTimeline {
  constructor(groups,index=0){this.groups=groups;this.target=index;this.offset=groups[index].time;this.anchor=0;this.rate=1;this.playing=false;}
  position(now){return Math.min(this.groups[this.target].time,this.offset+(this.playing?(now-this.anchor)*this.rate:0));}
  play(now,rate=1){this.anchor=now;this.rate=rate;this.playing=true;}
  pause(now){this.offset=this.position(now);this.anchor=now;this.playing=false;}
  speed(rate,now){this.offset=this.position(now);this.anchor=now;this.rate=rate;}
  advance(index,now){this.offset=this.position(now);this.anchor=now;this.target=index;}
}
