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

The **Learn piano** area teaches note names on a keyboard and treble staff with a working quiz, offers six short drills with deliberate fingering, explores six diatonic chords and three progressions, and provides an ungraded improvisation lab with live backing and note buttons. The C-major scale lesson includes the right-hand thumb crossing. Practice and demo share the same notes and chords.

- Turquoise left hand, coral right hand; suggested finger numbers (1 thumb through 5 little finger), editable per note.
- Wait mode requires a stable matching pitch. A fresh detected attack or release allows repeating the same key; changing to another pitch needs no artificial silent gap. A wrong pitch never intentionally advances the score.
- 7× mode requires seven clean repetitions of the selected section. An extra wrong pitch resets the entire streak and restarts the section. Pauses and slow playing do not count as mistakes. Seven clean repetitions unlock the next section.
- Speed 20–120%, hand isolation, editable section boundaries, section looping, touch piano and demo playback. One audio clock drives demo sound and the scrolling notes, preserving short notes and long rests. Watch & listen starts directly; pause and speed changes preserve position.
- All 61 keys stay visible from C2 to C7 in either orientation. C4 (middle C, third C from the left) has a small marker. Landscape uses the visible Safari viewport and safe-area insets without cropping the keyboard.
- Automatic listening chooses isolated-note or experimental chord detection as needed. Changing the detector never changes the score. Chord listening uses conservative spectral peak detection, not a trained polyphonic piano model. Still-sounding accompaniment is allowed while playing the next melody note.
- Practice scrolls at the selected speed, preserving the space between onsets, and stops at the next unplayed event. Switching to demo and back preserves the practice section and seven-repeat streak.
- The playable range is MIDI 36–96 (C2–C7). Out-of-range notes are moved by octaves, preserving pitch class. This changes voicing. Complex arrangements remain difficult at full speed.
- MIDI imports support SMF formats 0/1, PPQ tempo changes, and files up to 2 MB. Percussion is omitted; sustain pedal is ignored. Imported hand assignments use the selected pitch split. Curated hand tracks are used where available.
- Progress and imported files are stored locally in the browser. Export/restore a JSON backup in Settings. Microphone samples are neither saved nor uploaded.

## Recognition limits

Pitch recognition is tested against synthesized harmonic notes at 44.1 and 48 kHz, including quiet notes, clipped notes, room-noise fixtures and capture/gate integration tests. It has **not been physically verified on this user's iPhone 17 Pro and Yamaha**. Reverb, accompaniment, octave doubling, background noise and sustained chords can cause missed or incorrect pitch estimates. Use a clean piano voice, disable keyboard auto accompaniment and start one hand at a time. Settings → Test microphone shows the detected note, frequency and input level without requiring a song. The player also displays low-input, clipping and unclear-note feedback. Microphone samples remain on the device.

Version 4 resumes the audio context after capture changes the iOS audio route, feature-detects Audio Session support for capture/playback, filters high-frequency hiss, removes the redundant confidence rejection, bounds erroneous noise calibration and recognizes fresh attacks over a ringing tail. Safari interruptions pause the session. iPhone Control Center's Standard microphone mode is preferable to voice processing. These changes address reproducible software failure modes; a real-device listening check is still required.

The note gate is deterministic; microphone estimates are not guaranteed perfect. The 7× score evaluates pitches/onsets rather than rhythm, note duration or technique. Suggested fingerings and heuristic hand splitting are not teacher-verified.

## Sources and content

The personal deployment contains 16 transcriptions derived from the displayed keys in the selected videos, replacing unrelated MIDI arrangements and short excerpts. Opening, middle and late passages were visually spot-checked. These are visual reconstructions, not official MIDI files or manually verified editions. Frame resolution, visual animation and obscured or overlapping notes limit accuracy; dynamics and pedal are not reconstructed. Onsets within one video frame share a practice gate, while demo playback retains their individual measured times. River Flows in You and La Maritza use inferred hand assignments; the other scores use source colors.

Public GitHub source excludes third-party score data. Third-party composition/arrangement rights remain with their owners. The original “First light” warm-up is included with the code. The personal French melody is an unidentified user-supplied note sketch with assumed rhythm and octaves. Replacing a score resets its obsolete section, trim and suggested-fingering overrides, preserving cumulative practice totals.

Sweden starts at absolute video time 0:37, including the remaining held D2. Its next chord stays at video 0:38.25. Source details use video timestamps.

## Verification

`npm test` runs 33 tests covering pitch detection and live capture logic, Safari-style capture suspension, quiet/noisy/clipped input, stale noise calibration, repeated attacks, wrong-note rejection, held accompaniment, chord matching, six successes followed by failure, seven-success unlock, shared score groups, wait/demo timing and speed, MIDI parsing, drills, 61-key adaptation, and selected source pitch/timestamp regressions. The two personal-catalog checks skip in the public repository. Browser QA covers portrait/landscape layouts, the full 61-key count, running demo progression, touch advancement and streak reset. No hardware accuracy claim is made.
Personal app: https://piano.kozovy.com (owner access). This public repository contains the original warm-up, lessons and MIDI import; third-party song files are excluded.
