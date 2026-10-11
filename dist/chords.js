// Fit harmonic patterns jointly: a high key can share its fundamental with a
// lower key's overtone. Never use the expected score to invent missing pitches.
const hz=n=>440*2**((n-69)/12);
const profiles=[.22,.4,.6,.8].map(decay=>Array.from({length:10},(_,i)=>decay**i));
profiles.push(Array.from({length:10},(_,i)=>1/(i+1)**1.5));
profiles.push([1,1.8,.8,.35,.18,.08,.04,.02,.01,.005]);

export function learnKeyProfile(db,sampleRate,fftSize,pitch){
  const profile=[],base=pitch.hz,binHz=sampleRate/fftSize;
  for(let h=1;h<=10;h++){
    const center=base*h/binHz,radius=Math.max(1.5,center*.014);let value=-120;
    for(let i=Math.max(2,Math.floor(center-radius));i<=Math.min(db.length-2,Math.ceil(center+radius));i++){
      if(db[i]>value&&db[i]>db[i-1]&&db[i]>=db[i+1])value=db[i];
    }
    profile.push(10**(value/20));
  }
  const scale=Math.max(...profile);return profile.map(x=>x/scale);
}

export class ChordStability {
  constructor(){this.history=[];}
  update(notes){
    this.history.push(new Set(notes));if(this.history.length>3)this.history.shift();
    if(!notes.length){this.history=[];return [];}
    const candidates=new Set(this.history.flatMap(s=>[...s]));
    return [...candidates].filter(n=>this.history.filter(s=>s.has(n)).length>=2).sort((a,b)=>a-b);
  }
}

export function detectPianoChord(db,sampleRate,fftSize,thresholdDb=-72,keyProfiles={}){
  const peaks=[],binHz=sampleRate/fftSize;
  const floor=[];for(let i=Math.ceil(120/binHz);i<Math.min(db.length,Math.floor(10000/binHz));i+=3)if(Number.isFinite(db[i]))floor.push(db[i]);
  floor.sort((a,b)=>a-b);thresholdDb=Math.max(thresholdDb,(floor[Math.floor(floor.length/2)]??-120)+15);
  for(let i=2;i<Math.min(db.length-1,Math.ceil(12500/binHz));i++){
    if(!Number.isFinite(db[i])||db[i]<thresholdDb||db[i]<=db[i-1]||db[i]<db[i+1])continue;
    const shift=Math.max(-.5,Math.min(.5,.5*(db[i-1]-db[i+1])/(db[i-1]-2*db[i]+db[i+1]||1)));
    const frequency=(i+shift)*binHz,amplitude=10**((db[i]-.25*(db[i-1]-db[i+1])*shift)/20);
    if(frequency>=60)peaks.push({frequency,amplitude});
  }
  if(!peaks.length)return [];
  const loudest=Math.max(...peaks.map(p=>p.amplitude));
  const useful=peaks.filter(p=>p.amplitude>loudest*.012);
  // Missing partials get zero rows, penalizing phantom keys with incomplete
  // harmonic patterns. The fit must explain measured energy, not just peaks.
  const observed=useful.map(p=>p.amplitude/loudest),candidates=[];
  for(let note=36;note<=96;note++){
    const base=hz(note),matches=[];
    for(let h=1;h<=10&&base*h<12500;h++){
      let best=-1,distance=Infinity;
      useful.forEach((p,i)=>{const cents=Math.abs(1200*Math.log2(p.frequency/(base*h)));if(cents<38&&cents<distance){best=i;distance=cents;}});
      matches.push(best);
    }
    if(matches[0]<0&&!(keyProfiles[note]&&matches[1]>=0&&matches[2]>=0))continue;
    const peak=useful[matches[0]>=0?matches[0]:matches[1]],bin=Math.round(peak.frequency/binHz);
    if(db[bin]-Math.min(db[Math.max(0,bin-4)],db[Math.min(db.length-1,bin+4)])<8)continue;
    const rows=matches.map(i=>{if(i>=0)return i;observed.push(0);return observed.length-1;});
    candidates.push({note,rows,matches,columns:[]});
  }
  const residual=Float64Array.from(observed),columns=[];
  for(const candidate of candidates)for(const profile of keyProfiles[candidate.note]?[keyProfiles[candidate.note]]:profiles){
    const weights=profile.slice(0,candidate.rows.length),norm=weights.reduce((s,x)=>s+x*x,0);
    const column={rows:candidate.rows,weights,norm,gain:0,penalty:keyProfiles[candidate.note]?.length===10?.008:.02};columns.push(column);candidate.columns.push(column);
  }
  // Sparse nonnegative coordinate descent touches only a key's partials.
  for(let pass=0;pass<80;pass++)for(const c of columns){
    let dot=0;for(let h=0;h<c.rows.length;h++)dot+=c.weights[h]*residual[c.rows[h]];
    const gain=Math.max(0,c.gain+(dot-c.penalty)/c.norm),change=gain-c.gain;c.gain=gain;
    if(change)for(let h=0;h<c.rows.length;h++)residual[c.rows[h]]-=c.weights[h]*change;
  }
  return candidates.filter(c=>c.columns.reduce((sum,p)=>sum+p.gain,0)>(keyProfiles[c.note]?.length===10?.06:.115)).map(c=>c.note);
}
