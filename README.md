# Piano Club

A phone-friendly piano practice room for a Yamaha 61-key keyboard. Vanilla JavaScript, Web Audio, and a static PWA; no build dependencies or audio uploads.

## Run

Use Node.js 20 or newer:

```sh
npm start
# http://127.0.0.1:4173
npm test
```

Host the contents of `dist` over HTTPS for microphone access on iPhone. Open in Safari and optionally use Share → Add to Home Screen. The interface supports portrait and landscape.

## Practice

The **Learn piano** area teaches note names on a keyboard and treble staff with a working quiz, offers six short drills with deliberate fingering, explores six diatonic chords and three progressions, and provides an ungraded improvisation lab with live backing and note buttons. The C-major scale lesson includes the right-hand thumb crossing. Chord examples include comfortable inversions, and demo playback preserves simultaneous chords even when microphone practice uses single-note steps.

- Turquoise left hand, coral right hand; suggested finger numbers (1 thumb through 5 little finger), editable per note.
- Wait mode requires a stable matching pitch. A fresh detected attack or release allows repeating the same key; changing to another pitch needs no artificial silent gap. A wrong pitch never intentionally advances the score.
- 7× mode requires seven clean repetitions of the selected section. An extra wrong pitch resets the entire streak and restarts the section. Pauses and slow playing do not count as mistakes. Seven clean repetitions unlock the next section.
- Speed 20–120%, hand isolation, editable section boundaries, section looping, touch piano and demo playback. One audio clock drives demo sound and the scrolling notes, preserving short notes and long rests. Watch & listen starts directly; pause and speed changes preserve position.
- All 61 keys stay visible from C2 to C7 in either orientation. C4 (middle C, third C from the left) has a small marker. Landscape uses the visible Safari viewport and safe-area insets without cropping the keyboard.
- Single-note microphone mode is the default. It arpeggiates score chords into individual steps. Experimental chord listening uses conservative spectral peak detection, not a trained polyphonic piano model.
- The playable range is MIDI 36–96 (C2–C7). Out-of-range notes are moved by octaves, preserving pitch class. This changes voicing. Complex arrangements remain difficult at full speed.
- MIDI imports support SMF formats 0/1, PPQ tempo changes, and files up to 2 MB. Percussion is omitted; sustain pedal is ignored. Imported hand assignments use the selected pitch split. Curated hand tracks are used where available.
- Progress and imported files are stored locally in the browser. Export/restore a JSON backup in Settings. Microphone samples are neither saved nor uploaded.

## Recognition limits

Pitch recognition is tested against synthesized harmonic notes at 44.1 and 48 kHz, including quiet notes, clipped notes, room-noise fixtures and capture/gate integration tests. It has **not been physically verified on this user's iPhone 17 Pro and Yamaha**. Reverb, accompaniment, octave doubling, background noise and sustained chords can cause missed or incorrect pitch estimates. Use a clean piano voice, disable keyboard auto accompaniment and start one hand at a time. Settings → Test microphone shows the detected note, frequency and input level without requiring a song. The player also displays low-input, clipping and unclear-note feedback. Microphone samples remain on the device.

Version 4 resumes the audio context after capture changes the iOS audio route, feature-detects Audio Session support for capture/playback, filters high-frequency hiss, removes the redundant confidence rejection, bounds erroneous noise calibration and recognizes fresh attacks over a ringing tail. Safari interruptions pause the session. iPhone Control Center's Standard microphone mode is preferable to voice processing. These changes address reproducible software failure modes; a real-device listening check is still required.

The note gate is deterministic; microphone estimates are not guaranteed perfect. The 7× score evaluates pitches/onsets rather than rhythm, note duration or technique. Suggested fingerings and heuristic hand splitting are not teacher-verified. Source arrangements can differ from linked videos.

## Sources and content

The personal deployment has alternate MIDI arrangements with attribution and links in each song's details. Public GitHub source excludes third-party score data. Third-party composition/arrangement rights remain with their owners. The original “First light” warm-up is included with the code. The French melody is an unidentified user-supplied note sketch with assumed rhythm and octaves.

Sweden's selected video starts at 0:37. The alternative MIDI initially trims to 37 seconds; its musical timing is not confirmed to align exactly with that video. Change “Start at MIDI time” in its details if necessary.

## Verification

`npm test` runs 25 tests covering pitch detection and live capture logic, Safari-style capture suspension, quiet/noisy/clipped input, stale noise calibration, random-noise rejection, repeated attacks, wrong-note rejection, held-note release, simultaneous chord matching, six successes followed by failure, seven-success unlock, demo clock timing/pause/speed, MIDI tempo/parsing, drills/chord notes and 61-key adaptation. Browser QA covers portrait/landscape layouts, the full 61-key count, running demo progression, touch advancement and streak reset. No hardware accuracy claim is made.

Personal app: https://piano.kozovy.com (owner access). This public code repository contains the original warm-up, learning lessons and MIDI import; third-party song note files are excluded.
