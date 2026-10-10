// One audio clock drives scheduling and the falling-note display.
export class DemoTimeline {
  constructor(groups,start=0,end=groups.length-1){this.groups=groups;this.start=start;this.end=end;this.anchor=0;this.offset=groups[start].time-1;this.rate=1;this.playing=false;this.cursor=start;}
  position(now){return this.offset+(this.playing?(now-this.anchor)*this.rate:0);}
  play(now,rate=1){this.anchor=now;this.rate=rate;this.playing=true;}
  pause(now){this.offset=this.position(now);this.anchor=now;this.playing=false;while(this.cursor>this.start&&this.groups[this.cursor-1].time>this.offset)this.cursor--;}
  speed(rate,now){this.offset=this.position(now);this.anchor=now;this.rate=rate;}
  due(now,lookAhead=.075){const events=[],position=this.position(now);while(this.cursor<=this.end&&this.groups[this.cursor].time<=position+lookAhead*this.rate+1e-8){const index=this.cursor++,group=this.groups[index];events.push({group,index,delay:Math.max(0,(group.time-position)/this.rate)});}return events;}
  index(now){const position=this.position(now);let low=this.start,high=this.end;while(low<high){const mid=Math.ceil((low+high)/2);if(this.groups[mid].time<=position)low=mid;else high=mid-1;}return low;}
  finished(now){const last=this.groups[this.end];return this.position(now)>=last.time+Math.max(.3,...last.notes.map(n=>n.duration));}
}
