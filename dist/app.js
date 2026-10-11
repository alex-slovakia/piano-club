import {noteName,isBlack,NoteGate,PracticeSession,parseMidi,fitKeyboard,suggestFingers,practiceGroups,trimScore,warmup} from './engine.js';
import {PianoAudio} from './audio.js';
import {DemoTimeline,WaitTimeline} from './playback.js';
import {initLearning} from './learning.js';
import {KeyboardCalibration,validKeyProfiles} from './calibration.js';
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeUrl=s=>{try{const u=new URL(s);return u.protocol==='https:'?u.href:'#';}catch{return '#';}};
function readStore(key,fallback){try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}}
let settings={recognition:'auto',sensitivity:5,labels:true,split:60,speed:60,noise:.003,...readStore('piano-settings',{})};
// Older single-note settings also changed the score. Migrate to score-preserving
// listening; selecting single-note listening now only changes the detector.
if(settings.scoreVersion!==5){settings.recognition='auto';settings.scoreVersion=5;}
if(settings.listenerVersion!==6){settings.recognition='auto';settings.listenerVersion=6;}
let progress=readStore('piano-progress',{}),imports=readStore('piano-imports',[]),fingerings=readStore('piano-fingers',{});
const audio=new PianoAudio();audio.noise=settings.noise;
audio.keyProfiles=validKeyProfiles(readStore('piano-key-profiles',{}));let keyboardCalibration=null;
let catalog=[{...warmup,difficulty:1,color:'#f2cd73',symbol:'hello.',label:'Original warm-up',notes:warmup.notes}],filter='all',current=null,groups=[],session=null,mode='wait',hand='both',input='off',running=false,loop=false;
let gate=new NoteGate(),wrongSince=null,lastWrong='',pressed=new Set(),touchTimer=null,watchTimer=null,wakeLock=null,requestSerial=0,importTarget=null,frameId=0,keyLayout=[],canvasWidth=0,canvasHeight=0,notesCache=new Map(),toastTimer,calibrating=false;
let demo=null,practiceClock=null,practiceSnapshot=null,micTesting=false,micStarted=0,lastClip=0,runSerial=0;
const colors=['#f89479','#a6dace','#c8b9e7','#eed48b','#a6c0e1','#b5cf93','#ecc7b1','#b2cac9'];
const symbols=['E!','≈','♡','♫','M.','⚑','rag.','❄','☀','III','▦','♪','1,000','fin.','S.','⅞'];
function save(key,value){try{localStorage.setItem(key,JSON.stringify(value));return true;}catch{toast('Storage is full or blocked. Export a backup to keep your progress.');return false;}}
function toast(text){clearTimeout(toastTimer);$('#toast').textContent=text;$('#toast').classList.add('visible');toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),4200);}
function status(text,active=false){if($('#status').textContent!==text)$('#status').textContent=text;$('#status-dot').classList.toggle('active',active);}
function saveSettings(){save('piano-settings',settings);}
function allSongs(){return [...catalog,...imports];}
function durationText(seconds){if(!Number.isFinite(seconds))return 'At your pace';const total=Math.round(seconds);return Math.floor(total/60)+':'+String(total%60).padStart(2,'0');}
function isReady(song){return Boolean(song.file||song.notes?.length);}
function migrateScore(song){
  if(!song.scoreRevision||progress[song.id]?.scoreRevision===song.scoreRevision)return;
  progress[song.id]={steps:progress[song.id]?.steps||0,trim:song.trim??0,scoreRevision:song.scoreRevision};
  delete fingerings[song.id];save('piano-progress',progress);save('piano-fingers',fingerings);
}
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
  migrateScore(song);
  const ready=isReady(song),i=Math.max(0,catalog.indexOf(song));
  $('#song-details').innerHTML=`<div class="details-art">${songArt(song,i)}</div><h2>${esc(song.title)}</h2><p class="muted">${esc(song.artist)}${song.arranger?' · '+esc(song.arranger):''}</p><span class="version-tag">${esc(song.label||'Your imported MIDI')} · ${durationText(song.duration)}</span><p>${esc(song.description||'Practice at your own pace, one section at a time.')}</p><p class="small-note">${esc(song.arrangementNote||'Notes fit your Yamaha’s 61-key range. Fingering suggestions can be edited.')}</p>${song.id==='sweden'&&song.sourceTiming==='video'?'<div class="callout">Starts at 0:37 of your video, including notes still sounding at that point.</div>':''}<div class="detail-actions">${ready?'<button class="button dark" id="detail-play">Start practicing <svg><use href="#i-play"/></svg></button>':''}<button class="button outline" id="detail-import">${ready?'Replace with MIDI':'Import MIDI notes'}</button></div>${ready?`<label class="detail-time">Start at ${song.sourceTiming==='video'?'video':'MIDI'} time (seconds) <input id="trim-start" type="number" min="0" max="${Math.max(0,(song.videoDuration||song.duration||3600)-1)}" step=".5" value="${progress[song.id]?.trim??song.trim??0}"></label>`:''}<div class="detail-source">${song.url?`<a href="${safeUrl(song.url)}" target="_blank" rel="noopener noreferrer">Your video reference ↗</a>`:''}${song.source?`<a href="${safeUrl(song.source)}" target="_blank" rel="noopener noreferrer">Arrangement source ↗</a>`:''}</div><p class="small-note">Difficulty is an estimate for this arrangement. Practice and demo keep the same chords and rhythm. Hand colors are ${song.handAssignment==='video-colors'?'taken from the video’s hand colors':song.handTracks?'based on the MIDI hand tracks':'suggested by register'}; use one hand at a time to start.</p>`;
  $('.details-art .card-art').style.height='120px';
  if(ready)$('#detail-play').onclick=()=>{const trim=Math.max(0,Number($('#trim-start').value)||0);progress[song.id]={...progress[song.id],trim};save('piano-progress',progress);$('#details-dialog').close();openPlayer(song);};
  $('#detail-import').onclick=()=>{importTarget=song;$('#midi-file').click();};$('#details-dialog').showModal();
}
function noteIds(){return groups[session?.index]?.notes||[];}
function heldPitches(time=groups[session.index].time){return groups.slice(session.start,session.index).flatMap(g=>g.notes.filter(n=>n.time+n.duration>time+.04).map(n=>n.pitch));}
async function openPlayer(song,newMode='wait'){
  const serial=++requestSerial;stop();
  try{
    migrateScore(song);
    const unlocked=newMode==='watch'?audio.unlock():null;
    const raw=await loadNotes(song);if(serial!==requestSerial)return;
    if(unlocked)await unlocked;if(serial!==requestSerial)return;
    const trim=progress[song.id]?.trim??song.trim??0;
    const selected=trimScore(raw,trim);if(!selected.length)throw Error('Start time is after the last note. Choose an earlier start.');
    const prepared=suggestFingers(fitKeyboard(selected));prepared.forEach(n=>{if(fingerings[song.id]?.[n.id])n.finger=fingerings[song.id][n.id];});
    current={...song,prepared};mode=newMode;hand='both';input='off';practiceSnapshot=null;$('#library').hidden=true;$('#player').hidden=false;document.body.style.background='#152426';
    $('#player-name').textContent=song.title;$('#player-artist').textContent=`${song.artist} · 61 keys · practice`;
    rebuildGroups();syncControls();window.scrollTo(0,0);requestAnimationFrame(()=>{layoutKeyboard();animate(performance.now());});
    if(newMode==='watch')await start();
  }catch(e){toast(e.message);}
}
function rebuildGroups(){
  groups=practiceGroups(current.prepared,hand);
  if(!groups.length){toast('This arrangement has no notes for that hand.');hand='both';groups=practiceGroups(current.prepared,hand);}
  session=new PracticeSession(groups.length,0,mode==='seven'?Math.min(groups.length-1,7):groups.length-1);demo=null;practiceClock=null;practiceSnapshot=null;gate.reset();updatePlayer();
}
function syncControls(){
  if(current)$('#player-artist').textContent=`${current.artist} · 61 keys · ${mode==='watch'?'demo':'practice'}`;
  $$('[data-mode]').forEach(b=>{const selected=b.dataset.mode===mode;b.classList.toggle('selected',selected);b.setAttribute('aria-pressed',selected);});
  $$('[data-hand]').forEach(b=>{const selected=b.dataset.hand===hand;b.classList.toggle('selected',selected);b.setAttribute('aria-pressed',selected);});
  $('#streak').hidden=mode!=='seven';$('#next-section').hidden=mode!=='seven'||!session.mastered||session.end===groups.length-1;
  $('#speed').value=settings.speed;$('#speed-value').textContent=settings.speed+'%';$('#bpm-value').textContent=current?.bpm?Math.round(current.bpm*settings.speed/100)+' BPM':'Video tempo';
  $('#start-listening span').textContent=running?'Pause':mode==='watch'?'Play demo':input==='touch'?'Resume touch piano':'Start microphone';
  $('#start-listening svg use').setAttribute('href',mode==='watch'?'#i-play':'#i-mic');
  $('#touch-mode').textContent=input==='touch'?'Use microphone':'Try on screen';$('#touch-mode').hidden=mode==='watch';
  $('#mode-description').textContent=mode==='seven'?'7 clean repeats. A wrong note resets the streak to zero. Pauses are okay.':mode==='watch'?'The same notes, chords and rhythm as practice. Your microphone stays off.':'Play the highlighted notes together. The music waits at each new note or chord. C4 is middle C.';
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
  runSerial++;
  if(keyboardCalibration){keyboardCalibration=null;calibrating=false;$('#keyboard-calibrate').textContent='Continue keyboard calibration';$('#calibration-help').textContent='Paused. Learned keys are saved on this device.';$('#calibrate').disabled=false;}
  document.dispatchEvent(new Event('piano:stop-extra-audio'));
  if(demo?.playing)demo.pause(audio.context?.currentTime||0);
  if(practiceClock?.playing)practiceClock.pause(performance.now()/1000);
  micTesting=false;if($('#mic-test'))$('#mic-test').textContent='Test microphone';
  running=false;audio.stopMic();audio.stopVoices();clearInterval(touchTimer);clearTimeout(watchTimer);touchTimer=null;watchTimer=null;pressed.clear();wrongSince=null;lastWrong='';gate.reset();
  if(wakeLock){wakeLock.release().catch(()=>{});wakeLock=null;}
  $('#meter-fill').style.width='0';$('#heard').textContent='Microphone is off';$('#mic-hint').textContent='';status('Paused. Ready when you are.');if(current)syncControls();
}
async function keepAwake(){try{if('wakeLock' in navigator)wakeLock=await navigator.wakeLock.request('screen');}catch{}}
async function start(){
  if(running){stop();return;}if(!current||session.mastered&&mode==='seven'){toast('Section mastered. Choose Next section or restart.');return;}
  const ticket=++runSerial;
  if(mode==='watch'){input='off';await audio.unlock();if(ticket!==runSerial)return;running=true;if(!demo||demo.finished(audio.context.currentTime))demo=new DemoTimeline(groups,session.start,session.end);demo.play(audio.context.currentTime,settings.speed/100);keepAwake();status('Demo playing · follow the colors',true);$('#heard').textContent='Demo audio · microphone off';syncControls();playWatch();return;}
  if(input==='touch'){await audio.unlock();if(ticket!==runSerial)return;running=true;practiceClock??=new WaitTimeline(groups,session.index);practiceClock.play(performance.now()/1000,settings.speed/100);keepAwake();gate.reset();gate.holdMs=0;touchTimer=setInterval(()=>processNotes([...pressed],.1),35);status('Tap the highlighted keys together.',true);$('#heard').textContent='Touch piano · microphone off';syncControls();return;}
  input='mic';$('#start-listening').disabled=true;status('Waiting for microphone permission…');
  try{const started=await audio.listen(frame=>{
    if(frame.interrupted){if(running){stop();toast('Audio was interrupted. Tap Start microphone to resume.');}return;}
    if(!calibrating&&running)processNotes(frame.notes,frame.level,frame.onsetId);
    showMicFrame(frame);
  },{mode:()=>settings.recognition==='single'&&new Set([...noteIds().map(n=>n.pitch),...heldPitches()]).size===1?'single':'chord',sensitivity:settings.sensitivity,onEnded:()=>{stop();toast('Microphone disconnected. Tap Start microphone to reconnect.');}});
    if(started&&ticket===runSerial){running=true;practiceClock??=new WaitTimeline(groups,session.index);practiceClock.play(performance.now()/1000,settings.speed/100);micStarted=performance.now();lastClip=0;gate.reset();gate.holdMs=80;keepAwake();status('Listening. Your turn.',true);syncControls();}
  }catch(e){input='off';status('Microphone unavailable');toast(e.message);}finally{$('#start-listening').disabled=false;}
}
function showMicFrame(frame){
  const now=performance.now();if(frame.clipping)lastClip=now;
  const meter=Math.max(0,Math.min(100,(frame.db+65)/55*100));
  $('#meter-fill').style.width=meter+'%';$('#meter-fill').classList.toggle('clipping',frame.clipping);
  const heard=frame.notes.length?'Heard '+frame.notes.map(noteName).join(' + ')+(frame.pitch?' · '+Math.round(frame.pitch.hz)+' Hz':''):frame.level>.00045?'Sound received · finding a clear note':'No note heard';
  $('#heard').textContent=heard+' · '+frame.db+' dB';
  let hint='';
  if(frame.muted)hint='Safari has muted the microphone. Check microphone access and tap Pause, then Start.';
  else if(lastClip>0&&now-lastClip<1200)hint='Sound is distorting. Lower the keyboard volume or move the phone farther away.';
  else if(now-micStarted>2500&&frame.level<.00045)hint='Very quiet input. Move closer to the speaker; use Standard mic mode in iPhone Control Center.';
  else if(frame.level>.004&&!frame.notes.length)hint='Hold the keys briefly. Use a plain piano sound; keyboard calibration in Settings can help.';
  else if(running&&current&&frame.notes.length){const missing=[...new Set(noteIds().map(n=>n.pitch))].filter(n=>!frame.notes.includes(n));if(missing.length)hint='Still listening for '+missing.map(noteName).join(' + ')+'. Hold the chord briefly.';}
  $('#mic-hint').textContent=hint;
  if(micTesting){$('#mic-test-note').textContent=frame.notes.length?frame.notes.map(noteName).join(' + '):'—';$('#mic-test-details').textContent=heard+' · '+frame.db+' dB · '+Math.round(frame.sampleRate/1000)+' kHz';$('#mic-test-hint').textContent=hint||'Play a note or chord. Every detected key appears above. If a key is missing, try keyboard calibration.';$('#mic-test-meter i').style.width=meter+'%';}
}
function processNotes(notes,level,onsetId=0){
  if(!running||session.mastered&&mode==='seven')return;const now=performance.now(),target=noteIds().map(n=>n.pitch);
  const scoreTime=practiceClock?.position(now/1000)??groups[session.index].time,ready=scoreTime+.001>=groups[session.index].time;
  const allowedHeld=heldPitches(scoreTime);
  $('#heard').textContent=notes.length?'Heard '+notes.map(noteName).join(' + '):input==='touch'?'Touch piano · microphone off':level>audio.noise*2?'Listening for a clear pitch…':'Listening…';
  const wasReleasing=gate.release.length>0;
  if(ready&&gate.check(notes,target,now,onsetId,allowedHeld)){advance();return;}
  const wrong=notes.filter(n=>!target.includes(n)&&!allowedHeld.includes(n));
  if(wasReleasing&&gate.release.length&&!wrong.length){status('Release the keys, then play again.',true);wrongSince=null;return;}
  if(wrong.length){
    const key=wrong.join(',');if(key!==lastWrong){wrongSince=now;lastWrong=key;}
    if(input==='touch'||now-wrongSince>140){
      if(mode==='seven'){
        session.mistake();practiceClock=new WaitTimeline(groups,session.start);practiceClock.play(now/1000,settings.speed/100);gate.reset();gate.release=[...notes];gate.onsetUsed=onsetId;updatePlayer();status('Wrong note. Streak reset — fresh start.');toast('Streak reset to 0 / 7. Begin this section again.');
      }else status('Not quite. Try '+target.map(noteName).join(' + ')+'.');
      wrongSince=null;lastWrong='';
    }
  }else{wrongSince=null;lastWrong='';status(!ready?'Follow the notes to the keys.':notes.length?'Keep going — match the highlighted notes.':'Your turn. Play '+target.map(noteName).join(' + ')+'.',true);}
}
function advance(){
  const index=session.index;
  progress[current.id]={...progress[current.id],steps:(progress[current.id]?.steps||0)+1,bestIndex:Math.max(progress[current.id]?.bestIndex||0,index+1),total:groups.length};save('piano-progress',progress);
  const result=session.correct(mode,loop);
  if(result==='step')practiceClock?.advance(session.index,performance.now()/1000);
  else if(result==='repeat'){practiceClock=new WaitTimeline(groups,session.start);practiceClock.play(performance.now()/1000,settings.speed/100);}
  updatePlayer();
  if(result==='mastered'){stop();status('7 out of 7. This section is yours!',true);toast('Seven clean repetitions! Next section unlocked.');updatePlayer();}
  else if(result==='finished'){stop();status('Section complete. Nice work!',true);}
  else if(result==='repeat'){status(mode==='seven'?`${session.streak} / 7 clean. Release, then go again.`:'Section complete. Let’s go again.',true);}
  else status('Good note. Release, then continue.',true);
}
function playWatch(){
  if(!running||mode!=='watch'||!demo)return;
  if(audio.context.state!=='running'){stop();status('Audio paused by Safari. Tap Play demo to resume.');return;}
  const now=audio.context.currentTime;
  for(const event of demo.due(now))for(const n of event.group.notes)audio.play(n.pitch,Math.max(.08,n.duration/demo.rate),.14/Math.sqrt(event.group.notes.length),event.delay+Math.max(0,n.time-event.group.time)/demo.rate);
  const index=demo.index(now);if(index!==session.index){session.index=index;updatePlayer();}
  if(demo.finished(now)){
    if(loop){demo=new DemoTimeline(groups,session.start,session.end);demo.play(now,settings.speed/100);session.index=session.start;updatePlayer();}
    else{stop();demo=null;status('Demo finished. Try it yourself.');return;}
  }
  watchTimer=setTimeout(playWatch,25);
}
function layoutKeyboard(){
  if(!current||!groups.length)return;const width=$('#roll-container').clientWidth;
  const low=36,high=96;
  const white=[];for(let p=low;p<=high;p++)if(!isBlack(p))white.push(p);const keyW=width/white.length;keyLayout=[];let whiteIndex=0;
  for(let pitch=low;pitch<=high;pitch++){const black=isBlack(pitch),x=black?(whiteIndex-.31)*keyW:whiteIndex*keyW,w=black?keyW*.62:keyW;if(!black)whiteIndex++;keyLayout.push({pitch,x,w,black});}
  $('#keyboard').innerHTML=keyLayout.map(k=>`<button class="piano-key ${k.black?'black':''} ${k.pitch===60?'middle-c':''}" data-pitch="${k.pitch}" aria-label="Play ${noteName(k.pitch)}" style="left:${k.x}px;width:${k.w}px">${!k.black&&settings.labels?`<span>${noteName(k.pitch).replace(/\d/g,'')}<small>${k.pitch%12===0?Math.floor(k.pitch/12)-1:''}</small></span>`:''}</button>`).join('');
  $$('.piano-key').forEach(button=>{button.onpointerdown=e=>{e.preventDefault();if(input!=='touch'||!running){toast('Choose “Try on screen” to play these keys.');return;}const pitch=Number(button.dataset.pitch);button.setPointerCapture(e.pointerId);pressed.add(pitch);button.classList.add('pressed');audio.play(pitch,.7,.2);processNotes([...pressed],.1);};const release=()=>{pressed.delete(Number(button.dataset.pitch));button.classList.remove('pressed');};button.onpointerup=release;button.onpointercancel=release;button.onlostpointercapture=release;button.onkeydown=e=>{if((e.key==='Enter'||e.key===' ')&&!e.repeat&&input==='touch'&&running){e.preventDefault();pressed.add(Number(button.dataset.pitch));audio.play(Number(button.dataset.pitch));processNotes([...pressed],.1);}};button.onkeyup=release;});
  const canvas=$('#roll');canvasWidth=width;canvasHeight=canvas.clientHeight;const dpr=Math.min(window.devicePixelRatio||1,2);canvas.width=canvasWidth*dpr;canvas.height=canvasHeight*dpr;canvas.getContext('2d').setTransform(dpr,0,0,dpr,0,0);
  $$('.piano-key').forEach(b=>{const n=noteIds().find(n=>n.pitch===Number(b.dataset.pitch));if(n)b.classList.add('target-'+n.hand);});
}
function animate(now){
  cancelAnimationFrame(frameId);if($('#player').hidden)return;const ctx=$('#roll').getContext('2d'),h=canvasHeight,w=canvasWidth;
  ctx.clearRect(0,0,w,h);ctx.strokeStyle='#ffffff08';ctx.lineWidth=1;
  for(const k of keyLayout.filter(k=>!k.black)){ctx.beginPath();ctx.moveTo(k.x,0);ctx.lineTo(k.x,h);ctx.stroke();}
  const watching=mode==='watch',scoreTime=watching?(demo?.position(audio.context?.currentTime||0)??groups[session.index].time):(practiceClock?.position(now/1000)??groups[session.index].time),pps=Math.max(25,h/4),active=new Map();
  const end=Math.min(groups.length,session.index+140,session.end+1),begin=Math.max(session.start,session.index-40);
  for(let i=end-1;i>=begin;i--){const y=h-(groups[i].time-scoreTime)*pps;if(y<-120)continue;
    for(const n of groups[i].notes){const k=keyLayout.find(k=>k.pitch===n.pitch);if(!k)continue;const barHeight=Math.max(10,n.duration*pps),barWidth=Math.max(4,k.w-(k.black?1:2)),x=k.x+(k.w-barWidth)/2;
      if(watching&&groups[i].time<=scoreTime&&groups[i].time+n.duration>scoreTime)active.set(n.pitch,n.hand);
      if(y-barHeight>h)continue;
      ctx.fillStyle=n.hand==='left'?'#80d8c4':'#fc795e';ctx.globalAlpha=i===session.index?1:.8;ctx.beginPath();ctx.roundRect(x,y-barHeight,barWidth,barHeight,Math.min(5,barWidth/3));ctx.fill();ctx.globalAlpha=1;
      if(settings.labels&&barWidth>7&&barHeight>20){ctx.fillStyle='#17352f';ctx.font=`600 ${Math.max(7,Math.min(12,barWidth*.55))}px 'DM Sans',sans-serif`;ctx.textAlign='center';ctx.fillText(noteName(n.pitch).replace(/\d/g,''),x+barWidth/2,y-barHeight+13);if(n.finger&&barHeight>34){ctx.font=`700 ${Math.max(7,Math.min(11,barWidth*.55))}px 'DM Sans',sans-serif`;ctx.fillText(n.finger,x+barWidth/2,Math.min(h-8,y-9));}}
    }
  }
  if(watching){$$('.piano-key').forEach(b=>{const hand=active.get(Number(b.dataset.pitch));b.classList.toggle('target-left',hand==='left');b.classList.toggle('target-right',hand==='right');});$('#heard').textContent=`Demo ${durationText(Math.max(0,scoreTime))} · microphone off`;}
  frameId=requestAnimationFrame(animate);
}

function openSettings(){if(current)stop();$('#recognition').value=settings.recognition;$('#sensitivity').value=settings.sensitivity;$('#show-labels').checked=settings.labels;$('#split-note').value=settings.split;const learned=Object.keys(audio.keyProfiles).length;$('#keyboard-profile-status').textContent=learned+' / 61 keys calibrated on this device';$('#keyboard-calibrate').textContent=learned===61?'Recalibrate keyboard':learned?'Continue keyboard calibration':'Calibrate my keyboard';$('#settings-dialog').showModal();}
$('#settings-button').onclick=openSettings;$('#player-settings').onclick=openSettings;
$('#recognition').onchange=e=>{settings.recognition=e.target.value;saveSettings();if(current){stop();syncControls();}toast('Listening updated. The score and selected section stay the same.');};
$('#sensitivity').oninput=e=>{settings.sensitivity=Number(e.target.value);saveSettings();};
$('#show-labels').onchange=e=>{settings.labels=e.target.checked;saveSettings();if(current){updatePlayer();layoutKeyboard();}};
$('#split-note').onchange=e=>{settings.split=Number(e.target.value);saveSettings();toast('Hand split saved for your next MIDI import.');};
$('#calibrate').onclick=async()=>{
  if(calibrating)return;stop();calibrating=true;$('#calibrate').disabled=true;$('#calibration-status').textContent='Allow the microphone, then keep the room quiet for 2 seconds.';const levels=[];
  try{await audio.listen(f=>levels.push(f.level),{mode:'single',sensitivity:settings.sensitivity});await new Promise(resolve=>setTimeout(resolve,2200));if(levels.length<10)throw Error('Calibration was interrupted. Try again.');levels.sort((a,b)=>a-b);settings.noise=Math.max(.001,levels[Math.floor(levels.length*.8)]);audio.noise=settings.noise;saveSettings();$('#calibration-status').textContent='Room calibrated. Play at a comfortable volume near your phone. Start microphone when ready.';}catch(e){$('#calibration-status').textContent=e.message;}finally{audio.stopMic();calibrating=false;$('#calibrate').disabled=false;}
};
$('#mic-test').onclick=async()=>{
  if(calibrating)return;
  if(micTesting){stop();return;}stop();micTesting=true;micStarted=performance.now();$('#mic-test-panel').hidden=false;$('#mic-test').textContent='Stop mic test';$('#mic-test-note').textContent='…';$('#mic-test-hint').textContent='Allow the microphone, then play a note or chord.';
  try{const started=await audio.listen(frame=>{if(frame.interrupted){$('#mic-test-hint').textContent='Safari interrupted audio. Stop this test and tap Test microphone again.';return;}showMicFrame(frame);},{mode:'chord',sensitivity:settings.sensitivity,onEnded:()=>{stop();$('#mic-test-hint').textContent='Microphone disconnected. Start the test again.';}});if(!started)stop();}
  catch(e){stop();$('#mic-test-hint').textContent=e.message;}
};
$('#settings-dialog').addEventListener('close',()=>{if(micTesting||calibrating)stop();});
function showKeyboardCalibration(){
  const calibration=keyboardCalibration;if(!calibration)return;
  const note=calibration.note;$('#calibration-progress').value=calibration.count;
  $('#keyboard-profile-status').textContent=calibration.count+' / 61 keys calibrated on this device';
  $('#calibration-note').textContent=note===null?'All keys learned!':noteName(note);
  $('#calibration-help').textContent=note===null?'Saved. Return to your piece and start the microphone. Recalibrate if you change the keyboard voice or phone position.':'Press only '+noteName(note)+' on your Yamaha and hold for about one second. Release when the highlighted key moves. Keep the same piano voice, volume and phone position you use for practice.';
  let white=0;$('#calibration-keyboard').innerHTML=Array.from({length:61},(_,i)=>{const p=i+36,black=isBlack(p),x=(black?white-.31:white)/36*100;if(!black)white++;return `<i class="calibration-key ${black?'black':''} ${p===note?'active':''}" style="left:${x}%;width:${(black?.62:1)/36*100}%">${!black&&p%12===0?noteName(p):''}</i>`;}).join('');
}
$('#keyboard-calibrate').onclick=async()=>{
  if(keyboardCalibration){stop();return;}if(calibrating)return;stop();
  if(Object.keys(audio.keyProfiles).length===61){audio.keyProfiles={};save('piano-key-profiles',audio.keyProfiles);}
  keyboardCalibration=new KeyboardCalibration(audio.keyProfiles);const calibration=keyboardCalibration;
  calibrating=true;$('#calibrate').disabled=true;$('#keyboard-calibrate').textContent='Pause keyboard calibration';$('#keyboard-calibration-panel').hidden=false;showKeyboardCalibration();
  try{
    await audio.listen(frame=>{
      if(keyboardCalibration!==calibration)return;
      if(frame.interrupted){stop();return;}
      const learned=calibration.update(frame,performance.now());
      if(learned!==null){audio.keyProfiles={...audio.keyProfiles,...calibration.profiles};save('piano-key-profiles',audio.keyProfiles);showKeyboardCalibration();if(calibration.note===null){keyboardCalibration=null;calibrating=false;audio.stopMic();$('#calibrate').disabled=false;$('#keyboard-calibrate').textContent='Recalibrate keyboard';}}
      else if(frame.clipping)$('#calibration-help').textContent='Input is distorting. Lower the keyboard volume slightly, then hold '+noteName(calibration.note)+'.';
      else if(frame.notes.length&&frame.notes[0]!==calibration.note)$('#calibration-help').textContent='Heard '+frame.notes.map(noteName).join(' + ')+'. Press only '+noteName(calibration.note)+', the highlighted key.';
    },{mode:'calibrate',sensitivity:settings.sensitivity,onEnded:()=>stop()});
  }catch(e){stop();$('#calibration-help').textContent=e.message;}
};
$('#guide-nav').onclick=()=>$('#guide-dialog').showModal();$('#library-nav').onclick=()=>window.scrollTo({top:0,behavior:'smooth'});
$$('.close-dialog').forEach(b=>b.onclick=()=>b.closest('dialog').close());
$$('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}}));
$('#start-warmup').onclick=()=>openPlayer(catalog[0]);$('#seven-start').onclick=()=>openPlayer(catalog[0],'seven');
$('#back-library').onclick=()=>{requestSerial++;stop();cancelAnimationFrame(frameId);current=null;$('#player').hidden=true;$('#library').hidden=false;document.body.style.background='';renderLibrary();};
$('#start-listening').onclick=()=>start().catch(e=>{stop();toast(e.message);});
$('#touch-mode').onclick=()=>{stop();input=input==='touch'?'mic':'touch';if(input==='touch')start().catch(e=>toast(e.message));else syncControls();};
$$('[data-mode]').forEach(b=>b.onclick=async()=>{
  const next=b.dataset.mode;if(next===mode)return;stop();
  if(next==='watch'){
    practiceSnapshot={session,mode,clock:practiceClock};
    session=new PracticeSession(groups.length,session.start,session.end);demo=null;
  }else{
    const previousMode=practiceSnapshot?.mode??mode;
    if(practiceSnapshot){session=practiceSnapshot.session;practiceClock=practiceSnapshot.clock;practiceSnapshot=null;}
    if(next!==previousMode){const end=next==='seven'&&session.start===0&&session.end===groups.length-1?Math.min(groups.length-1,session.index+7):session.end;session.setSection(next==='seven'?session.index:session.start,end);practiceClock=null;}
  }
  mode=next;updatePlayer();layoutKeyboard();if(mode==='watch')try{await start();}catch(e){stop();toast(e.message);}
});
$$('[data-hand]').forEach(b=>b.onclick=()=>{stop();hand=b.dataset.hand;rebuildGroups();layoutKeyboard();});
$('#restart').onclick=()=>{stop();demo=null;practiceClock=null;session.setSection(session.start,session.end);updatePlayer();status('Fresh start. Ready when you are.');};
$('#next-section').onclick=()=>{if(session.next()){stop();practiceClock=null;updatePlayer();layoutKeyboard();status('Next section unlocked. Ready when you are.');}};
$('#speed').oninput=e=>{settings.speed=Number(e.target.value);if(demo)demo.speed(settings.speed/100,audio.context?.currentTime||0);if(practiceClock)practiceClock.speed(settings.speed/100,performance.now()/1000);saveSettings();syncControls();};
$('#section-button').onclick=()=>{stop();$('#section-from').value=session.start+1;$('#section-to').value=session.end+1;$('#section-from').max=groups.length;$('#section-to').max=groups.length;$('#loop-section').checked=loop;$('#section-dialog').showModal();};
$('#apply-section').onclick=()=>{const from=Number($('#section-from').value),to=Number($('#section-to').value);if(!Number.isInteger(from)||!Number.isInteger(to)||from<1||to<from||to>groups.length){toast(`Choose a valid range from 1 to ${groups.length}.`);return;}loop=$('#loop-section').checked;demo=null;practiceClock=null;session.setSection(from-1,to-1);if(practiceSnapshot){practiceSnapshot.session.setSection(from-1,to-1);practiceSnapshot.clock=null;}updatePlayer();layoutKeyboard();$('#section-dialog').close();};
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
try{const r=await fetch('./catalog.json');if(!r.ok)throw Error();const data=await r.json();catalog.push(...data.songs);data.songs.forEach(migrateScore);}catch{toast('Song library could not load. The warm-up is still available.');}
renderLibrary();
initLearning({openPlayer,audio,stop,toast});
if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
