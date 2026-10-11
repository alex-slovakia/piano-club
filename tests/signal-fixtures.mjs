// Independent audio fixtures and the Blackman-window FFT used by Web Audio.
// No score or detector code contributes to the measured spectrum.
export function chordSamples(notes,{sampleRate=48000,size=8192,volume=.07,noise=0,cents=0,partials=[1,.5,.26,.13,.07,.035],gains=[],offset=0,clip=false}={}){
  let seed=741;
  return Float32Array.from({length:size},(_,i)=>{
    let x=0;
    notes.forEach((note,j)=>{const hz=440*2**((note-69+cents/100)/12);partials.forEach((a,h)=>{const f=hz*(h+1);if(f<sampleRate/2)x+=volume*(gains[j]??1)*a*Math.sin(2*Math.PI*f*(i/sampleRate+offset)+j*.71+h*.31);});});
    seed=(1664525*seed+1013904223)>>>0;x+=noise*(seed/2**31-1);
    return clip?Math.max(-1,Math.min(1,x)):x;
  });
}
export function spectrumOf(samples){
  const n=samples.length,re=new Float64Array(n),im=new Float64Array(n);
  for(let i=0;i<n;i++)re[i]=samples[i]*(.42-.5*Math.cos(2*Math.PI*i/n)+.08*Math.cos(4*Math.PI*i/n));
  for(let i=1,j=0;i<n;i++){let bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;if(i<j)[re[i],re[j]]=[re[j],re[i]];}
  for(let len=2;len<=n;len*=2){const a=-2*Math.PI/len,wr=Math.cos(a),wi=Math.sin(a);for(let start=0;start<n;start+=len){let ur=1,ui=0;for(let j=0;j<len/2;j++){const p=start+j,q=p+len/2,vr=re[q]*ur-im[q]*ui,vi=re[q]*ui+im[q]*ur;re[q]=re[p]-vr;im[q]=im[p]-vi;re[p]+=vr;im[p]+=vi;[ur,ui]=[ur*wr-ui*wi,ur*wi+ui*wr];}}}
  return Float32Array.from({length:n/2},(_,i)=>20*Math.log10(Math.max(1e-10,Math.hypot(re[i],im[i])/n)));
}
