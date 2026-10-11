// Learn only spectral ratios. Microphone samples are never retained.
export function validKeyProfiles(value){
  const result={};
  if(!value||typeof value!=='object')return result;
  for(const [key,profile] of Object.entries(value))if(+key>=36&&+key<=96&&Number.isInteger(+key)&&Array.isArray(profile)&&profile.length===10&&profile.every(x=>Number.isFinite(x)&&x>=0&&x<=1)&&Math.max(...profile)>.5)result[key]=profile;
  return result;
}
export class KeyboardCalibration {
  constructor(profiles={}){this.profiles=validKeyProfiles(profiles);this.frames=[];this.since=null;}
  get count(){return Object.keys(this.profiles).length;}
  get note(){for(let n=36;n<=96;n++)if(!this.profiles[n])return n;return null;}
  update(frame,now){
    const note=this.note;
    if(note===null)return null;
    if(frame.pitch?.note!==note||frame.pitch.confidence<.97||frame.clipping||frame.level<.001||!frame.profile){this.frames=[];this.since=null;return null;}
    if(this.since===null)this.since=now;
    this.frames.push(frame.profile);if(this.frames.length>12)this.frames.shift();
    if(now-this.since<480||this.frames.length<8)return null;
    const profile=Array.from({length:10},(_,i)=>{const values=this.frames.map(f=>f[i]).sort((a,b)=>a-b);return values[Math.floor(values.length/2)];});
    const max=Math.max(...profile);this.profiles[note]=profile.map(x=>x/max);this.frames=[];this.since=null;return note;
  }
}
