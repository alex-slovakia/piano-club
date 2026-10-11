export const noteName=n=>['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'][n%12]+(Math.floor(n/12)-1);
export const frequency=n=>440*2**((n-69)/12);
export const isBlack=n=>[1,3,6,8,10].includes(n%12);

// A score gate never uses the expected score to guess what was played.
// A stable exact match is required, followed by release before the next step.
export class NoteGate {
  constructor(holdMs=100){this.holdMs=holdMs;this.reset();}
  reset(){this.since=null;this.release=[];this.quietSince=null;this.onsetUsed=0;}
  check(heard,expected,now,onsetId=0,allowedHeld=[]){
    const actual=[...new Set(heard)].filter(n=>expected.includes(n)||!allowedHeld.includes(n)).sort((a,b)=>a-b);
    if(actual.length&&onsetId>this.onsetUsed){this.onsetUsed=onsetId;this.release=[];this.quietSince=null;}
    if(this.release.length){
      // A new, disjoint pitch is itself evidence of release. Do not consume its
      // attack while waiting for silence; repeat strikes still require release.
      if(actual.length&&!actual.some(n=>this.release.includes(n))){this.release=[];this.quietSince=null;}
      else {
      if(actual.some(n=>this.release.includes(n)))this.quietSince=null;
      else if(this.quietSince===null)this.quietSince=now;
      else if(now-this.quietSince>=65){this.release=[];this.quietSince=null;}
      this.since=null;return false;
      }
    }
    const target=[...new Set(expected)].sort((a,b)=>a-b);
    if(!target.length||actual.length!==target.length||actual.some((n,i)=>n!==target[i])){this.since=null;return false;}
    if(this.since===null)this.since=now;
    if(now-this.since<this.holdMs)return false;
    this.release=target;this.since=null;return true;
  }
}

// YIN difference function. Useful for clean, isolated piano notes; score-independent.
export function detectPitch(samples,sampleRate,minHz=55,maxHz=2200){
  const maxLag=Math.min(Math.floor(sampleRate/minHz),samples.length>>1);
  const minLag=Math.max(2,Math.floor(sampleRate/maxHz));
  const size=Math.min(2048,samples.length-maxLag),diff=new Float32Array(maxLag+1);
  let energy=0;for(let i=0;i<size;i++)energy+=samples[i]*samples[i];
  if(Math.sqrt(energy/size)<0.0002)return null;
  for(let lag=1;lag<=maxLag;lag++){let sum=0;for(let i=0;i<size;i++){const d=samples[i]-samples[i+lag];sum+=d*d;}diff[lag]=sum;}
  let running=0;diff[0]=1;
  for(let lag=1;lag<=maxLag;lag++){running+=diff[lag];diff[lag]=running?diff[lag]*lag/running:1;}
  let tau=-1;
  for(let lag=minLag;lag<maxLag;lag++)if(diff[lag]<0.14){while(lag+1<maxLag&&diff[lag+1]<diff[lag])lag++;tau=lag;break;}
  if(tau<0)return null;
  const a=diff[tau-1],b=diff[tau],c=diff[tau+1]??b;
  const better=tau+(a-c)/(2*(a-2*b+c)||1),hz=sampleRate/better;
  const midi=69+12*Math.log2(hz/440),note=Math.round(midi);
  if(note<21||note>108||Math.abs(midi-note)>0.38)return null;
  return {note,hz,confidence:1-b,cents:(midi-note)*100};
}

// Conservative harmonic suppression for experimental chord listening.
// Fundamentals must be visible; isolated harmonics cannot become guessed notes.
export function detectChord(db,sampleRate,fftSize,thresholdDb=-65){
  const peaks=[];
  for(let i=2;i<Math.min(db.length-1,Math.ceil(4400*fftSize/sampleRate));i++){
    if(db[i]<thresholdDb||db[i]<=db[i-1]||db[i]<db[i+1])continue;
    const shift=0.5*(db[i-1]-db[i+1])/(db[i-1]-2*db[i]+db[i+1]||1);
    const hz=(i+Math.max(-0.5,Math.min(.5,shift)))*sampleRate/fftSize;
    if(hz<65)continue;
    const exact=69+12*Math.log2(hz/440),note=Math.round(exact);
    if(note<36||note>96||Math.abs(note-exact)>.32)continue;
    peaks.push({note,hz,db:db[i]});
  }
  const loudest=Math.max(-120,...peaks.map(p=>p.db));
  const candidates=peaks.filter(p=>p.db>loudest-23).sort((a,b)=>a.hz-b.hz);
  const accepted=[];
  for(const p of candidates){
    const harmonic=accepted.some(low=>{const r=p.hz/low.hz,h=Math.round(r);return h>=2&&h<=8&&Math.abs(1200*Math.log2(r/h))<35&&p.db<low.db+4;});
    if(!harmonic&&!accepted.some(a=>a.note===p.note))accepted.push(p);
  }
  return accepted.slice(0,6).map(p=>p.note);
}

// Standard MIDI files, formats 0 and 1, PPQ timing with tempo changes.
export function parseMidi(buffer,split=60){
  if(buffer.byteLength>2_000_000)throw Error('Choose a MIDI file smaller than 2 MB.');
  const b=new Uint8Array(buffer),v=new DataView(buffer);let p=0;
  const need=n=>{if(p+n>b.length)throw Error('This MIDI file is incomplete.');};
  const u8=()=>{need(1);return b[p++];};
  const u16=()=>{need(2);const n=v.getUint16(p);p+=2;return n;};
  const u32=()=>{need(4);const n=v.getUint32(p);p+=4;return n;};
  const str=n=>{need(n);const s=String.fromCharCode(...b.slice(p,p+n));p+=n;return s;};
  const vlq=()=>{let n=0;for(let i=0;i<4;i++){const x=u8();n=(n<<7)|(x&127);if(!(x&128))return n;}throw Error('Invalid MIDI timing.');};
  if(str(4)!=='MThd')throw Error('Choose a standard .mid or .midi file.');
  const len=u32(),format=u16(),tracks=u16(),ppq=u16();
  if(len<6||format>1||!tracks||!ppq||(ppq&0x8000))throw Error('Use a format 0 or 1 MIDI file with beat-based timing.');
  p=8+len;const events=[],tempos=[{tick:0,us:500000}],names=[];
  for(let t=0;t<tracks;t++){
    if(str(4)!=='MTrk')throw Error('Invalid MIDI track.');const length=u32(),end=p+length;need(length);
    let tick=0,running=0;const active=new Map();
    while(p<end){
      tick+=vlq();let status=u8();
      if(status<128){if(!running)throw Error('Invalid MIDI event.');p--;status=running;}else if(status<0xf0)running=status;
      if(status===0xff){const type=u8(),count=vlq();need(count);if(type===0x51&&count===3)tempos.push({tick,us:(b[p]<<16)|(b[p+1]<<8)|b[p+2]});if(type===3)names.push(new TextDecoder().decode(b.slice(p,p+count)));p+=count;running=0;continue;}
      if(status===0xf0||status===0xf7){const n=vlq();need(n);p+=n;running=0;continue;}
      const kind=status>>4,channel=status&15;if(kind<8||kind>14)throw Error('Unsupported MIDI event.');
      const a=u8(),velocity=(kind===12||kind===13)?0:u8();if(a>127||velocity>127)throw Error('Invalid MIDI data.');
      if(channel===9)continue;const key=channel+':'+a;
      if(kind===9&&velocity){
        if(!active.has(key))active.set(key,[]);active.get(key).push({pitch:a,tick,velocity,track:t});
      }else if(kind===8||(kind===9&&!velocity)){
        const note=active.get(key)?.shift();if(note)events.push({...note,end:Math.max(tick,note.tick+ppq/8)});
      }
      if(events.length>30000)throw Error('This file is too large for mobile practice (30,000 notes maximum).');
    }
    if(p!==end)throw Error('Invalid MIDI track length.');
    for(const notes of active.values())for(const note of notes)events.push({...note,end:Math.max(tick,note.tick+ppq)});
  }
  const tempoMap=tempos.sort((a,b)=>a.tick-b.tick);let seconds=0,prev=0,us=500000;
  for(const tempo of tempoMap){seconds+=(tempo.tick-prev)/ppq*us/1e6;tempo.seconds=seconds;prev=tempo.tick;us=tempo.us;}
  const toSeconds=tick=>{let l=0,r=tempoMap.length-1;while(l<r){const m=Math.ceil((l+r)/2);if(tempoMap[m].tick<=tick)l=m;else r=m-1;}const tempo=tempoMap[l];return tempo.seconds+(tick-tempo.tick)/ppq*tempo.us/1e6;};
  const notes=events.filter(n=>n.pitch>=21&&n.pitch<=108).map(n=>({pitch:n.pitch,time:toSeconds(n.tick),duration:toSeconds(n.end)-toSeconds(n.tick),hand:n.pitch<split?'left':'right',track:n.track})).sort((a,b)=>a.time-b.time);
  if(!notes.length)throw Error('No piano notes were found in this file.');
  const offset=notes[0].time;notes.forEach(n=>n.time-=offset);
  return {notes,title:names.find(n=>n.trim())||'Imported piece',bpm:Math.round(60e6/tempoMap.filter(t=>t.tick===0).at(-1).us)};
}
export function groupNotes(notes,hand='both'){
  const groups=[];
  // Only share genuinely simultaneous onsets. A 35 ms window swallowed fast
  // arpeggios; pitch deduplication also discarded voices after octave fitting.
  for(const note of notes){if(hand!=='both'&&note.hand!==hand)continue;const onset=note.onset??note.time;let group=groups.at(-1);if(!group||onset-group.time>.001){group={time:onset,notes:[]};groups.push(group);}group.notes.push(note);}
  return groups;
}

export class PracticeSession {
  constructor(total,start=0,end=Math.min(total-1,7)){this.total=total;this.setSection(start,end);}
  setSection(start,end){this.start=Math.max(0,Math.min(this.total-1,start));this.end=Math.max(this.start,Math.min(this.total-1,end));this.index=this.start;this.streak=0;this.mastered=false;this.mistakes=0;}
  mistake(){this.streak=0;this.index=this.start;this.mastered=false;this.mistakes++;}
  correct(mode='seven',loop=true){
    if(this.mastered&&mode==='seven')return 'mastered';
    if(this.index<this.end){this.index++;return 'step';}
    if(mode==='seven'){this.streak++;if(this.streak===7){this.mastered=true;return 'mastered';}this.index=this.start;return 'repeat';}
    if(loop){this.index=this.start;return 'repeat';}return 'finished';
  }
  next(){if(!this.mastered||this.end>=this.total-1)return false;const length=this.end-this.start+1;this.setSection(this.end+1,Math.min(this.total-1,this.end+length));return true;}
}

// Preserve pitch class while fitting the physical 61-key range. This is a visible adaptation.
export function fitKeyboard(notes,low=36,high=96){
  if(high-low<12)throw Error('Keyboard range must span at least one octave.');
  return notes.map((n,i)=>{let pitch=n.pitch;while(pitch<low)pitch+=12;while(pitch>high)pitch-=12;return {...n,pitch,sourcePitch:n.pitch,id:n.id??i};});
}

// A modest five-finger heuristic, explicitly displayed as suggested and editable.
// It respects hand direction and gives distinct fingers to notes in small chords.
export function suggestFingers(notes){
  const result=notes.map(n=>({...n}));
  for(const hand of ['left','right']){
    const groups=groupNotes(result,hand);let previous=null;
    for(const group of groups){
      const ns=group.notes.sort((a,b)=>a.pitch-b.pitch),count=ns.length;
      if(count>5){ns.forEach(n=>n.finger=null);continue;}
      ns.forEach((n,i)=>{
        let f;
        if(count>1)f=1+Math.round(i*4/(count-1));
        else if(previous&&Math.abs(n.pitch-previous.pitch)<=7){
          const delta=Math.sign(n.pitch-previous.pitch)*Math.max(1,Math.round(Math.abs(n.pitch-previous.pitch)/2));
          f=n.pitch===previous.pitch?previous.position:previous.position+delta;
          if(f<1||f>5)f=isBlack(n.pitch)?3:(f>5?1:5);
        }else f=isBlack(n.pitch)?3:1;
        n.finger=n.finger??(hand==='left'?6-f:f);previous={pitch:n.pitch,position:f};
      });
    }
  }
  return result;
}

// The score is independent of practice mode and microphone recognition.
// Practice, seven-repeat sections and demo all use this exact event sequence.
export function practiceGroups(notes,hand='both'){return groupNotes(notes,hand);}

// Scores transcribed from videos keep video timestamps. Starting inside a held
// chord includes the still-sounding notes and never slides the next attack early.
export function trimScore(notes,start=0){
  return notes.map((n,i)=>({...n,id:n.id??i})).filter(n=>n.time+n.duration>start+.001).map(n=>({...n,time:Math.max(0,n.time-start),...(n.onset===undefined?{}:{onset:Math.max(0,n.onset-start)}),duration:n.duration-Math.max(0,start-n.time),continuation:n.time<start-.001}));
}

const warmNotes=[];
const melody=[60,62,64,67,64,62,60,60,65,64,62,60,59,62,60,60];
melody.forEach((pitch,i)=>{warmNotes.push({pitch,time:i*.75,duration:.55,hand:'right'});});
[48,52,55,52,53,57,55,48].forEach((pitch,i)=>warmNotes.push({pitch,time:12+i*.75,duration:.55,hand:'left'}));
[[48,60],[52,64],[55,67],[48,60]].forEach((chord,i)=>chord.forEach(pitch=>warmNotes.push({pitch,time:18+i*1.5,duration:1,hand:pitch<60?'left':'right'})));
export const warmup={id:'first-light',title:'First light',artist:'An original Piano Club warm-up',style:'warmup',bpm:80,notes:warmNotes,description:'A gentle melody, a little left hand, then four two-hand chords.'};
export const songSlots=[
  {id:'rush-e',title:'Rush E',artist:'Your selected arrangement',style:'rush',url:'https://www.youtube.com/watch?v=mHEWSfudL_w',description:'Fast fingers. Big energy. Your Rush E reference is saved.'},
  {id:'river',title:'River Flows in You',artist:'Yiruma · arrangement to choose',style:'river',description:'A flowing melody, one beautiful phrase at a time.'},
  {id:'love-story',title:'Love Story',artist:'Artist & arrangement to choose',style:'love',description:'The version you love. Send the video to choose your arrangement.'},
  {id:'katyusha',title:'Katyusha',artist:'Your selected arrangement',style:'katyusha',url:'https://www.youtube.com/watch?v=tRT-9LcCA7U',description:'Your Katyusha reference is saved. Ready for its note file.'}
];
