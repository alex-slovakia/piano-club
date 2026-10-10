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

- Turquoise left hand, coral right hand; suggested finger numbers (1 thumb through 5 little finger), editable per note.
- Wait mode requires a matching pitch and key release. A wrong pitch never intentionally advances the score.
- 7× mode requires seven clean repetitions of the selected section. An extra wrong pitch resets the entire streak and restarts the section. Pauses and slow playing do not count as mistakes. Seven clean repetitions unlock the next section.
- Speed 20–120%, hand isolation, editable section boundaries, section looping, touch piano and demo playback.
- Single-note microphone mode is the default. It arpeggiates score chords into individual steps. Experimental chord listening uses conservative spectral peak detection, not a trained polyphonic piano model.
- The playable range is MIDI 36–96 (C2–C7). Out-of-range notes are moved by octaves, preserving pitch class. This changes voicing. Complex arrangements remain difficult at full speed.
- MIDI imports support SMF formats 0/1, PPQ tempo changes, and files up to 2 MB. Percussion is omitted; sustain pedal is ignored. Imported hand assignments use the selected pitch split. Curated hand tracks are used where available.
- Progress and imported files are stored locally in the browser. Export/restore a JSON backup in Settings. Microphone samples are neither saved nor uploaded.

## Recognition limits

Pitch recognition is tested against synthesized harmonic notes at 44.1 and 48 kHz, plus gate/state tests. It has **not been physically verified on this user's iPhone 17 Pro and Yamaha**. Reverb, accompaniment, octave doubling, background noise and sustained chords can cause missed or incorrect pitch estimates. Use a clean piano voice, disable keyboard auto accompaniment, keep the room quiet, calibrate noise and start one hand at a time. Calibrate again after moving the phone. WebAudio/device interruptions pause practice.

The note gate is deterministic; microphone estimates are not guaranteed perfect. The 7× score evaluates pitches/onsets rather than rhythm, note duration or technique. Suggested fingerings and heuristic hand splitting are not teacher-verified. Source arrangements can differ from linked videos.

## Sources and content

The personal deployment has alternate MIDI arrangements with attribution and links in each song's details. Public GitHub source excludes third-party score data. Third-party composition/arrangement rights remain with their owners. The original “First light” warm-up is included with the code. The French melody is an unidentified user-supplied note sketch with assumed rhythm and octaves.

Sweden's selected video starts at 0:37. The alternative MIDI initially trims to 37 seconds; its musical timing is not confirmed to align exactly with that video. Change “Start at MIDI time” in its details if necessary.

## Verification

`npm test` covers pitch detection, wrong-note rejection, held-note release, simultaneous chord matching, six successes followed by failure, seven-success unlock, no demo progress, MIDI tempo/parsing and 61-key adaptation. Browser QA covers mobile layout, live touch advancement, streak reset and unlock. No hardware accuracy claim is made.

Personal app: https://piano.kozovy.com (owner access). This public code repository contains the original warm-up and MIDI import; third-party song note files are excluded.
