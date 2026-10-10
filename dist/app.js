import {noteName,isBlack,NoteGate,PracticeSession,parseMidi,fitKeyboard,suggestFingers,practiceGroups,warmup} from './engine.js';
import {PianoAudio} from './audio.js';
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeUrl=s=>{try{const u=new URL(s);return u.protocol==='https:'?u.href:'#';}catch{return '#';}};
function readStore(key,fallback){try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}}
let settings={recognition:'single',sensitivity:5,labels:true,split:60,speed:60,noise:.003,...readStore('piano-settings',{})};
let progress=readStore('piano-progress',{}),imports=readStore('piano-imports',[]),fingerings=readStore('piano-fingers',{});
const audio=new PianoAudio();audio.noise=settings.noise;
let catalog=[{...warmup,difficulty:1,color:'#f2cd73',symbol:'hello.',label:'Original warm-up',notes:warmup.notes}],filter='all',current=null,groups=[],session=null,mode='wait',hand='both',input='off',running=false,loop=false;
let gate=new NoteGate(),wrongSince=null,lastWrong='',pressed=new Set(),touchTimer=null,watchTimer=null,wakeLock=null,requestSerial=0,importTarget=null,frameId=0,lastFrame=0,visualIndex=0,keyLayout=[],canvasWidth=0,canvasHeight=0,notesCache=new Map(),toastTimer,calibrating=false;
const colors=['#f89479','#a6dace','#c8b9e7','#eed48b','#a6c0e1','#b5cf93','#ecc7b1','#b2cac9'];
const symbols=['E!','≈','♡','♫','M.','⚑','rag.','❄','☀','III','▦','♪','1,000','fin.','S.','⅞'];
function save(key,value){try{localStorage.setItem(key,JSON.stringify(value));return true;}catch{toast('Storage is full or blocked. Export a backup to keep your progress.');return false;}}
function toast(text){clearTimeout(toastTimer);$('#toast').textContent=text;$('#toast').classList.add('visible');toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),4200);}
function status(text,active=false){if($('#status').textContent!==text)$('#status').textContent=text;$('#status-dot').classList.toggle('active',active);}
function saveSettings(){save('piano-settings',settings);}
function allSongs(){return [...catalog,...imports];}
function durationText(seconds){if(!Number.isFinite(seconds))return 'At your pace';return Math.floor(seconds/60)+':'+String(Math.round(seconds%60)).padStart(2,'0');}
function isReady(song){return Boolean(song.file||song.notes?.length);}
function songArt(song,i=0){return `<div class="card-art" style="--card-color:${song.color||colors[i%colors.length]}"><span class="card-badge">${esc(song.badge||'61-KEY FRIENDLY')}</span><span class="card-symbol" aria-hidden="true">${esc(song.symbol||symbols[i%symbols.length])}</span><span class="card-number">${String(i+1).padStart(2,'0')} / PIANO CLUB</span><span class="card-play"><svg><use href="#i-play"/></svg></span></div>`;}
function renderLibrary(){
  const query=$('#search').value.trim().toLowerCase();const songs=allSongs().filter(s=>(filter!=='ready'||isReady(s))&&(filter!=='saved'||s.imported)&&`${s.title} ${s.artist}`.toLowerCase().includes(query));
  $('#song-count').textContent=allSongs().length;$('#empty-search').hidden=songs.length>0;
  $('#song-grid').innerHTML=songs.map((s,i)=>{const difficulty=s.difficulty||3,p=progress[s.id];return `<button class="song-card" data-song="${esc(s.id)}" aria-label="Open ${esc(s.title)}"><div>${songArt(s,catalog.indexOf(s)>=0?catalog.indexOf(s):i)}</div><div class="card-body"><h3>${esc(s.title)}</h3><p>${esc(s.artist)}</p><div class="card-meta"><span class="difficulty">${[1,2,3,4,5].map(n=>`<i class="${n<=difficulty?'on':''}"></i>`).join('')}<span>${['','First steps','Easy','Intermediate','Advanced','Challenge'][difficulty]}</span></span><span class="${isReady(s)?'ready-dot':''}">${isReady(s)?'● Play':'Needs notes'}</span></div>${p?.steps?`<div class="song-progress" title="${p.steps} correct notes played"><i style="width:${Math.min(100,(p.bestIndex||0)/Math.max(1,p.total||1)*100)}%"></i></div>`:''}</div></button>`;}).join('');
  $$('#song-grid [data-song]').forEach(b=>b.onclick=()=>showDetails(allSongs().find(s=>s.id===b.dataset.song)));
  const total=Object.values(progress).reduce((n,p)=>n+(p.steps||0),0);$('#total-practice').textContent=total?`${total.toLocaleString()} good notes and counting.`:'Let’s make a little progress.';
}
async function loadNotes(song){
  if(song.notes)return song.notes;
  if(notesCache.has(song.id))return notesCache.get(song.id);
  if(!song.file)throw Error('This piece needs a MIDI note file.');
  const r=await fetch(song.file);if(!r.ok)throw Error('Could not load this piece. Connect to the internet and try again.');const value=await r.json();
  if(!Array.isArray(value.notes)||!value.notes.length)throw Error('No playable notes in this piece.');notesCache.set(song.id,value.notes);return value.notes;
}
function showDetails(song){
  const ready=isReady(song),i=Math.max(0,catalog.indexOf(song));
  $('#song-details').innerHTML=`<div class="details-art">${songArt(song,i)}</div><h2>${esc(song.title)}</h2><p class="muted">${esc(song.artist)}${song.arranger?' · '+esc(song.arranger):''}</p><span class="version-tag">${esc(song.label||'Your imported MIDI')} · ${durationText(song.duration)}</span><p>${esc(song.description||'Practice at your own pace, one section at a time.')}</p><p class="small-note">${esc(song.arrangementNote||'Notes fit your Yamaha’s 61-key range. Fingering suggestions can be edited.')}</p>${song.id==='sweden'?'<div class="callout">Your reference starts at 0:37. This alternate MIDI is trimmed to 0:37 by default; musical alignment may differ. Adjust the start below if needed.</div>':''}<div class="detail-actions">${ready?'<button class="button dark" id="detail-play">Start practicing <svg><use href="#i-play"/></svg></button>':''}<button class="button outline" id="detail-import">${ready?'Replace with MIDI':'Import MIDI notes'}</button></div>${ready?`<label class="detail-time">Start at MIDI time (seconds) <input id="trim-start" type="number" min="0" max="${Math.max(0,(song.duration||3600)-1)}" step=".5" value="${progress[song.id]?.trim??song.trim??0}"></label>`:''}<div class="detail-source">${song.url?`<a href="${safeUrl(song.url)}" target="_blank" rel="noopener noreferrer">Your video reference ↗</a>`:''}${song.source?`<a href="${safeUrl(song.source)}" target="_blank" rel="noopener noreferrer">Arrangement source ↗</a>`:''}</div><p class="small-note">Difficulty is an estimate for this arrangement. Single-note mode breaks chords into steps. Hand colors are ${song.handTracks?'based on the MIDI hand tracks':'suggested by register'}; use one hand at a time to start.</p>`;
  $('.details-art .card-art').style.height='120px';
  if(ready)$('#detail-play').onclick=()=>{const trim=Math.max(0,Number($('#trim-start').value)||0);progress[song.id]={...progress[song.id],trim};save('piano-progress',progress);$('#details-dialog').close();openPlayer(song);};
  $('#detail-import').onclick=()=>{importTarget=song;$('#midi-file').click();};$('#details-dialog').showModal();
}
function noteIds(){return groups[session?.index]?.notes||[];}
async function openPlayer(song,newMode='wait'){
  const serial=++requestSerial;stop();
  try{
    const raw=await loadNotes(song);if(serial!==requestSerial)return;
    const trim=progress[song.id]?.trim??song.trim??0;
    let selected=raw.filter(n=>n.time+0.035>=trim);if(!selected.length)throw Error('Start time is after the last note. Choose an earlier start.');
    const base=selected[0].time;selected=selected.map(n=>({...n,time:Math.max(0,n.time-base)}));
    const prepared=suggestFingers(fitKeyboard(selected));prepared.forEach(n=>{if(fingerings[song.id]?.[n.id])n.finger=fingerings[song.id][n.id];});
    current={...song,prepared};mode=newMode;hand='both';input='off';$('#library').hidden=true;$('#player').hidden=false;document.body.style.background='#152426';
    $('#player-name').textContent=song.title;$('#player-artist').textContent=`${song.artist} · 61 keys · ${settings.recognition==='single'?'single-note steps':'chord practice'}`;
    rebuildGroups();syncControls();window.scrollTo(0,0);requestAnimationFrame(()=>{layoutKeyboard();animate(performance.now());});
  }catch(e){toast(e.message);}
}
function rebuildGroups(){
  groups=practiceGroups(current.prepared,hand,settings.recognition==='single');
  if(!groups.length){toast('This arrangement has no notes for that hand.');hand='both';groups=practiceGroups(current.prepared,hand,settings.recognition==='single');}
  session=new PracticeSession(groups.length,0,mode==='seven'?Math.min(groups.length-1,7):groups.length-1);gate.reset();visualIndex=0;updatePlayer();
}
function syncControls(){
  $$('[data-mode]').forEach(b=>{const selected=b.dataset.mode===mode;b.classList.toggle('selected',selected);b.setAttribute('aria-pressed',selected);});
  $$('[data-hand]').forEach(b=>{const selected=b.dataset.hand===hand;b.classList.toggle('selected',selected);b.setAttribute('aria-pressed',selected);});
  $('#streak').hidden=mode!=='seven';$('#next-section').hidden=mode!=='seven'||!session.mastered||session.end===groups.length-1;
  $('#speed').value=settings.speed;$('#speed-value').textContent=settings.speed+'%';$('#bpm-value').textContent=Math.round((current?.bpm||80)*settings.speed/100)+' BPM';
  $('#start-listening span').textContent=running?'Pause':mode==='watch'?'Play demo':input==='touch'?'Resume touch piano':'Start microphone';
  $('#start-listening svg use').setAttribute('href',mode==='watch'?'#i-play':'#i-mic');
  $('#touch-mode').textContent=input==='touch'?'Use microphone':'Try on screen';$('#touch-mode').hidden=mode==='watch';
  $('#mode-description').textContent=mode==='seven'?'7 clean repeats. A wrong note resets the streak to zero. Pauses are okay.':mode==='watch'?'Demo playback. Listen and follow along; this does not count as practice.':'The notes wait for you. Play the highlighted keys, then release.';
}
function updatePlayer(){
  if(!session)return;$('#section-label').textContent=`SECTION ${Math.floor(session.start/Math.max(1,session.end-session.start+1))+1} · ${session.start+1}–${session.end+1}`;$('#step-label').textContent=`Step ${session.index+1} of ${groups.length}`;
  $$('#streak b').forEach((b,i)=>{b.classList.toggle('done',i<session.streak);b.textContent=i<session.streak?'✓':i+1;});
  $('#streak').setAttribute('aria-label',`${session.streak} of 7 consecutive clean repetitions`);
  $('#expected-notes').innerHTML=noteIds().map(n=>`<button class="note-pill ${n.hand}" data-note-id="${n.id}" aria-label="${n.hand} hand ${noteName(n.pitch)}, suggested finger ${n.finger||'unset'}. Edit fingering">${noteName(n.pitch)}${settings.labels?`<b>${n.finger||'?'}</b>`:''}</button>`).join('');
  $$('#expected-notes [data-note-id]').forEach(b=>b.onclick=()=>editFinger(b.dataset.noteId));
  $$('.piano-key').forEach(b=>{b.classList.remove('target-left','target-right');const n=noteIds().find(n=>n.pitch===Number(b.dataset.pitch));if(n)b.classList.add('target-'+n.hand);});
  const pitches=noteIds().map(n=>n.pitch);if(pitches.length&&pitches.some(p=>!keyLayout.some(k=>k.pitch===p)))layoutKeyboard();
  syncControls();
}
function editFinger(id){
  stop();const note=current.prepared.find(n=>String(n.id)===id);if(!note)return;
  $('#finger-title').textContent=`${note.hand==='left'?'Left':'Right'} hand · ${noteName(note.pitch)}`;
  $('#finger-options').innerHTML=[1,2,3,4,5].map(n=>`<button data-finger="${n}" aria-label="Finger ${n}">${n}</button>`).join('');
  $$('#finger-options button').forEach(b=>b.onclick=()=>{note.finger=Number(b.dataset.finger);fingerings[current.id]={...fingerings[current.id],[id]:note.finger};save('piano-fingers',fingerings);$('#finger-dialog').close();updatePlayer();});$('#finger-dialog').showModal();
}
function stop(){
  running=false;audio.stopMic();audio.stopVoices();clearInterval(touchTimer);clearTimeout(watchTimer);touchTimer=null;watchTimer=null;pressed.clear();wrongSince=null;lastWrong='';gate.reset();
  if(wakeLock){wakeLock.release().catch(()=>{});wakeLock=null;}
  $('#meter-fill').style.width='0';$('#heard').textContent='Microphone is off';status('Paused. Ready when you are.');if(current)syncControls();
}
async function keepAwake(){try{if('wakeLock' in navigator)wakeLock=await navigator.wakeLock.request('screen');}catch{}}
async function start(){
  if(running){stop();return;}if(!current||session.mastered&&mode==='seven'){toast('Section mastered. Choose Next section or restart.');return;}
  if(mode==='watch'){input='off';running=true;await audio.unlock();keepAwake();status('Watch & listen',true);syncControls();playWatch();return;}
  if(input==='touch'){running=true;await audio.unlock();keepAwake();gate.reset();gate.holdMs=0;touchTimer=setInterval(()=>processNotes([...pressed],.1),35);status('Tap the highlighted keys.',true);$('#heard').textContent='Touch piano · microphone off';syncControls();return;}
  input='mic';$('#start-listening').disabled=true;status('Waiting for microphone permission…');
  try{const started=await audio.listen(frame=>{
    if(frame.interrupted){if(running){stop();toast('Audio was interrupted. Tap Start microphone to resume.');}return;}
    $('#meter-fill').style.width=Math.min(100,frame.level*500)+'%';
    if(!calibrating&&running)processNotes(frame.notes,frame.level);
  },{mode:settings.recognition,sensitivity:settings.sensitivity,onEnded:()=>{stop();toast('Microphone disconnected. Tap Start microphone to reconnect.');}});
    if(started){running=true;gate.reset();gate.holdMs=100;keepAwake();status('Listening. Your turn.',true);syncControls();}
  }catch(e){input='off';status('Microphone unavailable');toast(e.message);}finally{$('#start-listening').disabled=false;}
}
function processNotes(notes,level){
  if(!running||session.mastered&&mode==='seven')return;const now=performance.now(),target=noteIds().map(n=>n.pitch);
  $('#heard').textContent=notes.length?'Heard '+notes.map(noteName).join(' + '):input==='touch'?'Touch piano · microphone off':level>audio.noise*2?'Listening for a clear pitch…':'Listening…';
  const wasReleasing=gate.release.length>0;
  if(gate.check(notes,target,now)){advance();return;}
  if(wasReleasing){status('Release the keys, then play again.',true);wrongSince=null;return;}
  const wrong=notes.filter(n=>!target.includes(n));
  if(wrong.length){
    const key=wrong.join(',');if(key!==lastWrong){wrongSince=now;lastWrong=key;}
    if(input==='touch'||now-wrongSince>140){
      if(mode==='seven'){
        session.mistake();gate.reset();gate.release=[...notes];visualIndex=session.start;updatePlayer();status('Wrong note. Streak reset — fresh start.');toast('Streak reset to 0 / 7. Begin this section again.');
      }else status('Not quite. Try '+target.map(noteName).join(' + ')+'.');
      wrongSince=null;lastWrong='';
    }
  }else{wrongSince=null;lastWrong='';status(notes.length?'Keep going — match the highlighted notes.':'Your turn. Play '+target.map(noteName).join(' + ')+'.',true);}
}
function advance(){
  const index=session.index;
  progress[current.id]={...progress[current.id],steps:(progress[current.id]?.steps||0)+1,bestIndex:Math.max(progress[current.id]?.bestIndex||0,index+1),total:groups.length};save('piano-progress',progress);
  const result=session.correct(mode,loop);updatePlayer();
  if(result==='mastered'){stop();status('7 out of 7. This section is yours!',true);toast('Seven clean repetitions! Next section unlocked.');updatePlayer();}
  else if(result==='finished'){stop();status('Section complete. Nice work!',true);}
  else if(result==='repeat'){visualIndex=session.start;status(mode==='seven'?`${session.streak} / 7 clean. Release, then go again.`:'Section complete. Let’s go again.',true);}
  else status('Good note. Release, then continue.',true);
}
function playWatch(){
  if(!running||mode!=='watch')return;const group=groups[session.index];for(const n of group.notes)audio.play(n.pitch,Math.min(2.5,n.duration/(settings.speed/100)),.14/Math.sqrt(group.notes.length));updatePlayer();
  const next=groups[session.index+1];const interval=Math.max(.16,Math.min(3,next?next.time-group.time:1))/(settings.speed/100);
  watchTimer=setTimeout(()=>{const result=session.correct('watch',loop);if(result==='finished'){stop();status('Demo finished. Try it yourself.');return;}if(result==='repeat')visualIndex=session.start;playWatch();},interval*1000);
}
function layoutKeyboard(){
  if(!current||!groups.length)return;const width=$('#roll-container').clientWidth;const target=noteIds().map(n=>n.pitch);const upcoming=groups.slice(session.index,session.index+8).flatMap(g=>g.notes.map(n=>n.pitch));
  const min=Math.min(...target,...upcoming),max=Math.max(...target,...upcoming);const span=width<600?24:36;let low=Math.max(36,Math.floor((min-2)/12)*12),high=Math.min(96,Math.max(low+span,max+2));if(high-low>48&&width<600){low=Math.max(36,Math.floor(min/12)*12);high=Math.min(96,max+1);}if(high-low<span)low=Math.max(36,high-span);
  const white=[];for(let p=low;p<=high;p++)if(!isBlack(p))white.push(p);const keyW=width/white.length;keyLayout=[];let whiteIndex=0;
  for(let pitch=low;pitch<=high;pitch++){const black=isBlack(pitch),x=black?(whiteIndex-.31)*keyW:whiteIndex*keyW,w=black?keyW*.62:keyW;if(!black)whiteIndex++;keyLayout.push({pitch,x,w,black});}
  $('#keyboard').innerHTML=keyLayout.map(k=>`<button class="piano-key ${k.black?'black':''}" data-pitch="${k.pitch}" aria-label="Play ${noteName(k.pitch)}" style="left:${k.x}px;width:${k.w}px">${!k.black&&settings.labels?noteName(k.pitch):''}</button>`).join('');
  $$('.piano-key').forEach(button=>{button.onpointerdown=e=>{e.preventDefault();if(input!=='touch'||!running){toast('Choose “Try on screen” to play these keys.');return;}const pitch=Number(button.dataset.pitch);button.setPointerCapture(e.pointerId);pressed.add(pitch);button.classList.add('pressed');audio.play(pitch,.7,.2);processNotes([...pressed],.1);};const release=()=>{pressed.delete(Number(button.dataset.pitch));button.classList.remove('pressed');};button.onpointerup=release;button.onpointercancel=release;button.onlostpointercapture=release;button.onkeydown=e=>{if((e.key==='Enter'||e.key===' ')&&!e.repeat&&input==='touch'&&running){e.preventDefault();pressed.add(Number(button.dataset.pitch));audio.play(Number(button.dataset.pitch));processNotes([...pressed],.1);}};button.onkeyup=release;});
  const canvas=$('#roll');canvasWidth=width;canvasHeight=canvas.clientHeight;const dpr=Math.min(window.devicePixelRatio||1,2);canvas.width=canvasWidth*dpr;canvas.height=canvasHeight*dpr;canvas.getContext('2d').setTransform(dpr,0,0,dpr,0,0);
  $$('.piano-key').forEach(b=>{const n=noteIds().find(n=>n.pitch===Number(b.dataset.pitch));if(n)b.classList.add('target-'+n.hand);});
}
function animate(now){
  cancelAnimationFrame(frameId);if($('#player').hidden)return;const ctx=$('#roll').getContext('2d'),h=canvasHeight,w=canvasWidth;
  const delta=Math.min(60,now-lastFrame||16);lastFrame=now;const desired=session.index;visualIndex+=Math.max(-1,Math.min(1,desired-visualIndex))*Math.min(1,delta/140*(settings.speed/60));if(Math.abs(desired-visualIndex)<.01)visualIndex=desired;
  ctx.clearRect(0,0,w,h);ctx.strokeStyle='#ffffff08';ctx.lineWidth=1;
  for(const k of keyLayout.filter(k=>!k.black)){ctx.beginPath();ctx.moveTo(k.x,0);ctx.lineTo(k.x,h);ctx.stroke();}
  const spacing=Math.max(44,h/5.8),end=Math.min(groups.length,session.index+9,session.end+1);
  for(let i=end-1;i>=session.index;i--){const y=h-5-(i-visualIndex)*spacing;if(y<-80)continue;
    for(const n of groups[i].notes){const k=keyLayout.find(k=>k.pitch===n.pitch);if(!k)continue;const barHeight=Math.min(78,Math.max(42,n.duration*55)),barWidth=Math.max(8,k.w-(k.black?2:5)),x=k.x+(k.w-barWidth)/2;
      ctx.fillStyle=n.hand==='left'?'#80d8c4':'#fc795e';ctx.globalAlpha=i===session.index?1:.8;ctx.beginPath();ctx.roundRect(x,y-barHeight,barWidth,barHeight,Math.min(5,barWidth/3));ctx.fill();ctx.globalAlpha=1;
      if(settings.labels&&barWidth>14){ctx.fillStyle='#17352f';ctx.font=`600 ${Math.min(12,barWidth*.4)}px 'DM Sans',sans-serif`;ctx.textAlign='center';ctx.fillText(noteName(n.pitch).replace(/\d/g,''),x+barWidth/2,y-barHeight+14);if(n.finger&&barHeight>34){ctx.font=`700 ${Math.min(11,barWidth*.45)}px 'DM Sans',sans-serif`;ctx.fillText(n.finger,x+barWidth/2,y-9);}}
    }
  }
  frameId=requestAnimationFrame(animate);
}

function openSettings(){if(current)stop();$('#recognition').value=settings.recognition;$('#sensitivity').value=settings.sensitivity;$('#show-labels').checked=settings.labels;$('#split-note').value=settings.split;$('#settings-dialog').showModal();}
$('#settings-button').onclick=openSettings;$('#player-settings').onclick=openSettings;
$('#recognition').onchange=e=>{settings.recognition=e.target.value;saveSettings();if(current){stop();rebuildGroups();layoutKeyboard();}toast(settings.recognition==='single'?'Chords will be broken into single-note steps.':'Chord listening is experimental. Start slowly.');};
$('#sensitivity').oninput=e=>{settings.sensitivity=Number(e.target.value);saveSettings();};
$('#show-labels').onchange=e=>{settings.labels=e.target.checked;saveSettings();if(current){updatePlayer();layoutKeyboard();}};
$('#split-note').onchange=e=>{settings.split=Number(e.target.value);saveSettings();toast('Hand split saved for your next MIDI import.');};
$('#calibrate').onclick=async()=>{
  if(calibrating)return;stop();calibrating=true;$('#calibrate').disabled=true;$('#calibration-status').textContent='Allow the microphone, then keep the room quiet for 2 seconds.';const levels=[];
  try{await audio.listen(f=>levels.push(f.level),{mode:'single',sensitivity:settings.sensitivity});await new Promise(resolve=>setTimeout(resolve,2200));if(levels.length<10)throw Error('Calibration was interrupted. Try again.');levels.sort((a,b)=>a-b);settings.noise=Math.max(.001,levels[Math.floor(levels.length*.8)]);audio.noise=settings.noise;saveSettings();$('#calibration-status').textContent='Room calibrated. Play at a comfortable volume near your phone. Start microphone when ready.';}catch(e){$('#calibration-status').textContent=e.message;}finally{audio.stopMic();calibrating=false;$('#calibrate').disabled=false;}
};
$('#guide-nav').onclick=()=>$('#guide-dialog').showModal();$('#library-nav').onclick=()=>window.scrollTo({top:0,behavior:'smooth'});
$$('.close-dialog').forEach(b=>b.onclick=()=>b.closest('dialog').close());
$$('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}}));
$('#start-warmup').onclick=()=>openPlayer(catalog[0]);$('#seven-start').onclick=()=>openPlayer(catalog[0],'seven');
$('#back-library').onclick=()=>{requestSerial++;stop();cancelAnimationFrame(frameId);current=null;$('#player').hidden=true;$('#library').hidden=false;document.body.style.background='';renderLibrary();};
$('#start-listening').onclick=()=>start().catch(e=>{stop();toast(e.message);});
$('#touch-mode').onclick=()=>{stop();input=input==='touch'?'mic':'touch';if(input==='touch')start().catch(e=>toast(e.message));else syncControls();};
$$('[data-mode]').forEach(b=>b.onclick=()=>{stop();mode=b.dataset.mode;session.setSection(0,mode==='seven'?Math.min(groups.length-1,7):groups.length-1);loop=false;visualIndex=session.index;updatePlayer();});
$$('[data-hand]').forEach(b=>b.onclick=()=>{stop();hand=b.dataset.hand;rebuildGroups();layoutKeyboard();});
$('#restart').onclick=()=>{stop();session.setSection(session.start,session.end);visualIndex=session.start;updatePlayer();status('Fresh start. Ready when you are.');};
$('#next-section').onclick=()=>{if(session.next()){stop();visualIndex=session.start;updatePlayer();layoutKeyboard();status('Next section unlocked. Ready when you are.');}};
$('#speed').oninput=e=>{settings.speed=Number(e.target.value);saveSettings();syncControls();};
$('#section-button').onclick=()=>{stop();$('#section-from').value=session.start+1;$('#section-to').value=session.end+1;$('#section-from').max=groups.length;$('#section-to').max=groups.length;$('#loop-section').checked=loop;$('#section-dialog').showModal();};
$('#apply-section').onclick=()=>{const from=Number($('#section-from').value),to=Number($('#section-to').value);if(!Number.isInteger(from)||!Number.isInteger(to)||from<1||to<from||to>groups.length){toast(`Choose a valid range from 1 to ${groups.length}.`);return;}loop=$('#loop-section').checked;session.setSection(from-1,to-1);visualIndex=session.start;updatePlayer();layoutKeyboard();$('#section-dialog').close();};
$('#search').oninput=renderLibrary;$$('[data-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;$$('[data-filter]').forEach(x=>x.classList.toggle('selected',x===b));renderLibrary();});
$('#import-button').onclick=()=>{importTarget=null;$('#midi-file').click();};
$('#midi-file').onchange=async e=>{
  const file=e.target.files[0];if(!file)return;
  try{const parsed=parseMidi(await file.arrayBuffer(),settings.split);const song={id:'import-'+crypto.randomUUID(),title:importTarget?.title||file.name.replace(/\.midi?$/i,''),artist:importTarget?.artist||'Your own arrangement',url:importTarget?.url,imported:true,notes:parsed.notes,bpm:parsed.bpm,color:importTarget?.color||'#b8d7be',difficulty:3,symbol:'♪',label:'Imported MIDI',duration:Math.max(...parsed.notes.map(n=>n.time+n.duration)),description:'Your MIDI arrangement, stored on this device.',arrangementNote:'Hand colors follow your chosen split point. Notes outside C2–C7 move by octaves.'};
    const next=[...imports,song];if(!save('piano-imports',next))return;imports=next;$('#details-dialog').close();renderLibrary();toast('Piece added. Ready to play.');showDetails(song);
  }catch(err){toast(err.message);}finally{e.target.value='';}
};
$('#export-progress').onclick=()=>{const data={version:1,settings,progress,imports,fingerings};const url=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='piano-club-backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);};
$('#restore-file').onchange=async e=>{try{const file=e.target.files[0];if(!file)return;if(file.size>8_000_000)throw Error('Backup is too large.');const data=JSON.parse(await file.text());if(data.version!==1||!Array.isArray(data.imports)||!data.progress)throw Error('Not a Piano Club backup.');for(const song of data.imports){if(typeof song.id!=='string'||typeof song.title!=='string'||!Array.isArray(song.notes)||song.notes.length>30000||song.notes.some(n=>!Number.isInteger(n.pitch)||n.pitch<21||n.pitch>108||!Number.isFinite(n.time)||n.time<0||!Number.isFinite(n.duration)||n.duration<=0||!['left','right'].includes(n.hand)))throw Error('Backup contains invalid song notes.');}const merged=[...imports];for(const song of data.imports)if(!merged.some(s=>s.id===song.id))merged.push(song);if(!save('piano-imports',merged))return;imports=merged;progress={...progress,...data.progress};fingerings={...fingerings,...data.fingerings};save('piano-progress',progress);save('piano-fingers',fingerings);renderLibrary();toast('Songs and progress restored.');}catch(err){toast(err.message);}finally{e.target.value='';}};
document.addEventListener('visibilitychange',()=>{if(document.hidden&&(running||audio.stream)){stop();status('Paused while the app was in the background.');}});
window.addEventListener('pagehide',()=>stop());window.addEventListener('resize',()=>{if(current)layoutKeyboard();});
try{const r=await fetch('./catalog.json');if(!r.ok)throw Error();const data=await r.json();catalog.push(...data.songs);}catch{toast('Song library could not load. The warm-up is still available.');}
renderLibrary();
if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
