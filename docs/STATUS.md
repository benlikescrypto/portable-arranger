# ArrangerBox sound / arranger status

This is the honest record of what is implemented, what was tested, and what is still incomplete. It is not a claim of PA4X, Genos, or EDS-X equivalence.

## Architecture (done)

One C++ engine in `modules/audio/cpp` owns voices, samples, effects, chord detection, and accompaniment. Factory GM notes play through TinySoundFont + GeneralUser GS. SFZ instruments and imported Korg KMP/KSF/WAV instruments stay on the sampler IR. React Native never renders audio. Kotlin `MidiManager` and Swift CoreMIDI parse MIDI and push a lock-free queue.

See `docs/SOUND_ENGINE.md`, `docs/STYLE_FORMAT.md`, and `assets/factory/LICENSE_MANIFEST.md`.

## What ships

| Area | Status |
| --- | --- |
| Unified sampler + TinySoundFont factory GM, 96 sampler voices + 128 SF2 voices, hermite interpolation, loops, ADSR, SVF, reverb/chorus/delay | Implemented |
| Factory GM bank | **GeneralUser GS** (~30 MB SF2) mapped to **111** patch names (original IDs 0–33 kept stable) |
| Factory styles | **31** original `.abstyle` arrangements with intro/var/fill/break/ending, chord bass/comp |
| SFZ subset loader | Implemented (see opcode list in SOUND_ENGINE.md) |
| PA4X SET walk, WAV, KSF, PCM, KMP zones, STY/SMF, PCG names + missing refs | Implemented as a compatibility layer |
| UI: instrument/style browsers, favorites, recent, import progress, transport, transpose/octave, FX | Implemented |
| Android + iOS native audio/MIDI modules | Compiled architecture; **not hardware-verified** |

Factory sounds are **GeneralUser GS samples** played by TinySoundFont, not Korg/Yamaha/Roland ROM and not a modeled synth. TinySoundFont does not implement SoundFont modulators, so some presets are approximate. CC0 libraries (VCSL / VSCO 2 CE) may be ingested through the SFZ loader; they are not bundled.

## Arranger workstation (v0.3)

The app is a Pa-style workstation (`components/pro/ProScreen.tsx`) split into three horizontal slides, switched by swiping or the DISPLAY / CONTROLS / KEYS buttons: (1) the display — mode keys and the LCD pages with sounds, styles, mixer and so on; (2) the hardware control panel; (3) a full-size on-screen keyboard with octave shift (swiping is off on this slide so glissandos play keys). Layout adapts to tablet landscape, phone landscape and portrait.

| Area | What it does | Where |
| --- | --- | --- |
| Style elements | Intro 1/2/Count-in, Variation 1–4, Fill 1/2, Break, Ending 1–3, Start/Stop. LEDs show the playing element; a booked element blinks. Variations/endings change on the next bar line; fills/break start at once at the same beat position and end on the bar line. | `Arranger.cpp`, `ControlPanel.tsx` |
| Note transposition | Recorded style tracks (C major 7 source) follow the chord type: minor 3rd, flat 7th, dim/aug 5th, 6ths, sus. Previously they only moved by root. | `nttNote` in `Arranger.cpp` |
| Arranger switches | Synchro Start, Synchro Stop, Memory, Auto Fill, Bass Inversion, Manual Bass, Split on/off, Tempo Lock, Fade In/Out (time in Effects). | `Engine.cpp` `handleControl` |
| Chord recognition | Fingered or One Finger; scan Lower / Full keyboard (3+ keys) / Off; chord display shows inversions (C/E). | `Engine::detectChord` |
| Keyboard | 4 parts, per-part octave, split point, velocity curves (Soft/Normal/Hard/Fixed), Ensemble (Duet/Close/Block/Octave) on Upper 1. | `Engine.cpp`, Style Play tabs |
| Sub Scale | Equal, Pure Major/Minor, Pythagorean, Werckmeister, Kirnberger, Arabic Rast/Bayati, User quarter tones per key, scale Key, optional on style tracks. | `usePerformance.ts` |
| Keyboard Sets | STS 1–4 per style (tap = recall, long press / Library = write), Keyboard Set Library (save / recall / delete). | `usePerformance.ts`, `KbdLibraryPage.tsx` |
| Pads | 4 hit / chord / note pads with their own sound and channel, Pad Stop. Pads are sound triggers, not Pa pad patterns. | `CmdPadOn` |
| Mixer | 11 strips (UP1–3, LOW, Drum, Bass, Acc1–3, Pads, Click) with volume, pan, mute, solo, live activity meters; output peak meters and master. | `MixerPage.tsx` |
| Effects | Reverb, chorus, delay sends; 3-band master EQ; master / style / keyboard levels. | `EffectsPage.tsx` |
| SongBook | Entries recall style, tempo, transpose, variation and the keyboard set; search, genre filter, favourites, notes/lyrics, Set List with order and Prev/Next. | `SongBookPage.tsx` |
| Metronome | Click on its own channel, with the style or on its own; beat LEDs. | `Engine::metronomeClick` |
| Persistence | `performance.json`, `kbdsets.json`, `songbook.json` in the app document folder. | `lib/storage.ts` |

Engine controls go through one generic call, `control(cmd, a, b, v, c)` / `queryAll()` (see `EngineCmd` / `EngineQuery` in `Engine.h` and `modules/audio/src/index.ts`), so new controls do not need new JNI / Swift functions.

Not implemented (Pa features with no equivalent here yet): Player / MP3 and MIDI file playback, Sequencer and Style/Pad Record, Sound edit, voice processor / mic, lyrics display from files, Pa pad patterns, video out.

Factory styles are drum-only by an earlier decision (`drumsOnlyStyle` in `FactoryStyles.cpp`), so bass / accompaniment features (NTT, Memory, Bass Inversion, Manual Bass) are only audible on imported SET styles.

## AI (v0.5, rebuilt one step at a time)

One **AI** tab. Each step of the pipeline is brought back only after it has been checked on its own.

**Step 1: stems (live).**
- Upload a song (up to 10 min). The server runs Demucs `htdemucs_6s` and returns the original plus vocals, drums, bass, piano, guitar and other as 320 kbps MP3. Each stem's loudness and how well the stems add back up to the song come with them.
- The engine's `StemPlayer` (`modules/audio/cpp/StemPlayer.cpp`, MP3 via `dr_mp3`) decodes them to 16-bit RAM (about 70 MB per minute of song). It plays them sample-locked with per-stem gain, seek and declicked play/pause. The tab has mute/solo and Original/Stems A/B.
- Checked:
  - Host `test_engine` stem checks: sync, resampling 44.1 → 48 kHz, mute, seek, end of song, replace while playing.
  - The real server stems line up with the original at lag 0, correlation 0.9985.
  - `server/tests/e2e.mjs <url> stems` passes against the deployed API.
- Needs an app build that includes `StemPlayer`; older builds show a notice instead of playing.
- The stems job also keeps Demucs's own output for every stem on the server for 30 days, as 24-bit FLAC (`/data/stems/<job>`; the app's MP3s are only for playback). Step 2 finds notes in these and step 2b will cut its samples from them, sending 24-bit WAV with loop points (the sampler's `loadWav` reads 24-bit and `smpl` loops). `crop.mp3` in a notes job is only for auditioning, since the stem player decodes MP3 only.

**Step 2a: notes in a stretch of a stem (live, no new build needed).**
- In the AI tab, pick a stem and a stretch (0.5–120 s; "Here" marks the playhead), then Find notes. The server (CPU) runs Basic Pitch on the stretch, drops overtone ghosts, and moves every note's start to the exact sample (`server/abai/onsets.py`). It returns `crop.mp3` and `notes.json`.
- The app shows a piano roll (green = exact, amber = close estimate, blue = swell), a key map with each key's best take, and per note: start in ms, the cut point (on a zero crossing, before the start), Basic Pitch's error, attack type, how quiet it was before, and a zoomed 20 ms waveform with the start and cut marked. Tapping a note plays it from its cut. It also suggests Held or One-shot.
- How a start is found:
  - Sharp attacks: a linear predictor (order 160) learns what was already sounding and cancels it (about 40 dB); the onset is the first sample of energy it cannot explain.
  - Isolated notes are then checked on the plain level, which catches quiet lead-ins (finger noise) that prediction hides. The part of the attack still below the quiet is estimated from how fast the note grows, and the cut goes before it.
  - Swells: where the level climbs out of the quiet; cut early, never late.
- "Exact" means proven: sharp, isolated (30 dB quiet before), under 0.25 ms hidden, and no other note within 25 ms.
- Fast playing (notes 50–125 ms apart, the same key struck again):
  - Basic Pitch's own note builder dropped every note shorter than 60 ms, so a key struck again quickly vanished into the note before it. Notes are now rebuilt from its raw onset output (`notes.segment()`): 30 ms notes are allowed, and a held note is split where its own key's onset output peaks again.
  - A split or a short note must prove it was struck: an attack found by `onsets.attacks()` with no other key starting then (splits), or a sharp attack (short notes). Otherwise it goes back into the note before.
  - `onsets.attacks()` scans the whole stretch for strikes, independent of pitch. It never reported a false strike in testing (`server/tests/test_attacks.py`), but in dense playing it finds only some of the strikes. Its predictor cancels about 60 ringing frequencies, and a fast passage can have 150. So it only confirms, it does not decide.
  - A note with no sharp attack right after a struck note no longer falls back 80 ms (the swell rule), which used to pull in the previous key. It stays in the second half of the gap.
  - Every note now has `next`: when the next key is struck. Tapping a note stops there, so a fast passage is heard one key at a time.
  - Every note has a take score (`take`, 0–100): room before the next key (40), quiet before it (30), no other notes still ringing under it (20), exact start (10). The key map's best take for each key is the highest score, so a calm, isolated note beats a loud one in a fast run. Step 2b samples from these.
  - SwiftF0 was considered and not used: it reports one pitch every 16 ms with no note starts and no chords, so it cannot separate a repeated key.
- Measured:
  - Synthetic notes, 20 random sets (`server/tests/test_onsets.py`): no note marked exact is more than 1 ms off (median 0.02 ms); at least 90% of truly isolated notes are marked exact; swell cuts are never late.
  - Real instrument samples (GeneralUser GS, each note placed at a known sample; `modal run server/modal_app.py::notes_selftest`), separated notes, lossless:
    - piano 30/30 exact (worst 0.25 ms)
    - marimba 30/30 (0.16 ms)
    - e-piano 24/30 (0.27 ms)
    - strings 3/28 (the rest cut early)
    - nylon guitar 0/30: its finger-noise lead-in makes every start an estimate; found about 2 ms early.
  - No false "exact" in any test.
  - `server/tests/e2e.mjs <url> notes` passes against the deployed API, from the server's lossless stem and from the app's MP3.
- Limits:
  - MP3 erases the first milliseconds of an attack (pre-echo). From an MP3, starts land 6–12 ms early and nothing is marked exact. That applies to an MP3 song even with lossless stems, so the app asks for WAV, FLAC or AIFF songs when exact cuts matter.
  - Under other sound (notes ringing into each other) attacks are partly hidden. Those notes are never exact and can be cut a few ms late (worst: guitar and strings).
  - Basic Pitch still adds some ghost notes for marimba and strings, whose overtones are not simple octaves.

The drum-style and sound builders below (`hooks/useAiLab.ts`, `abai/drums.py`, `abai/sounds.py`) are not shown in the app until their step is retested.

### Earlier AI Lab (v0.4, parked)

The AI LAB page sends a song to the ArrangerBox AI server (`server/`, Modal GPU) and loads the results into the engine.

- **Song → Drum Style:** an `.abstyle` with Intro 1/2, Variation 1–4, Fill 1–4, Break and Ending 1–3, cut from the song's own drum stem as per-element slice kits. They follow any tempo. A GM-kit transcription of the same groove comes with it.
- **Song → Sounds:** SFZ multisamples of the instruments in the song (piano, strings, organ, …), tuned and looped, with a timeline of where each sound plays.

Results are stored in `Documents/ai/<job>/` and reloaded at start. See `server/README.md`.

Measured on rendered ground-truth songs (`modal run server/modal_app.py::tests`):

- **Drums (pop 4/4 at 112 BPM, waltz 3/4 at 96 BPM):**
  - tempo, meter, intro, ending and fill bars are found;
  - downbeats are within 50 ms (median 11 ms);
  - verse and chorus map to different variations;
  - slices land on 100% of played hits, within 2 ticks.
- **GM transcription:** kicks and snares 100%; hi-hats 67–86%. The waltz verse misses hats played under a snare: 1 open check.
- **Sounds:**
  - piano, strings and organ parts are sampled from their own notes;
  - all zones are in tune within 25 cents;
  - loop seams correlate above 0.99.
  - The instrument label comes from the PANNs tagger: the rendered strings were tagged "Brass" (1 open check).

## Verified in this workspace

- NDK clang (`x86_64-linux-android26`) compiled Engine, Factory, FactoryStyles, Arranger, Sampler, Pa4xLoader, SfzParser, StyleFormat, PcgParser, engine_c_api, and `tests/test_parsers.cpp`. TinySoundFont (`TsfHost.cpp`) is included in the Android CMake and iOS podspec; this pass was not host-compiled on Windows.
- `npx tsc --noEmit` passed.
- v0.3: host build of `test_engine` (w64devkit in `tmp/tools`) — 80 checks pass, including element timing (bar-line variation change, auto fill, ending, fade in/out), Synchro Start/Stop, One Finger chords, bass inversion, channel mute/gain on both the built-in synth and the GM SoundFont, per-part octave release, split off, Ensemble, metronome, pads and sub scale pitch. NDK clang compiled `Engine.cpp`, `Arranger.cpp`, `engine_c_api.cpp` and `jni_bridge.cpp` for arm64.
- v0.3 slides UI was driven on EAS Simulator (iOS dev-client simulator build `4eece99a`, iPad Pro 11-inch M5 and iPhone 17 Pro, portrait and landscape, via `eas simulator` + agent-device): slide buttons and swipes, swipe lock on KEYS, fader drag inside the pager, Start/Stop, Variation, tempo, live bar/beat display, Mixer, Effects, SongBook add/delete, Global, on-screen key press reaching the output meter. The simulator has no USB-MIDI and its audio was not listened to.
- v0.3 UI was rendered from a web export in headless Edge at 1280×800, 1024×768, 800×380, 768×1024 and 400×860 and every page / tab was opened. Web has no audio engine; it shows a preview catalog (`lib/webPreview.ts`).

- v0.4: host `test_engine` has 93 checks.
  - New: SFZ header-line opcodes, `ab_category`, `kit=` loaded once per file, 3/4 variation timing and beat display.
  - Real AI-server output: 12 slice kits load; Var 1–4 play at 70% and 125% tempo; the fill plays and the ending stops; every extracted sound plays from C2 to C6 and goes silent after release.
  - `server/tests/e2e.mjs` passed against the deployed API: auth, upload, polling, download, path-traversal refusal and delete.
  - EAS Simulator (build `3b0198f6`, iPad Pro 11-inch): AI LAB ran both demo songs through upload, GPU, download and load; the drum result played in the arranger. Audio was not listened to.

Host `test_engine` playback tests (polyphony, sustain, pitch bend, SFZ zones, arranger audio, KSF, PCG names) are in `modules/audio/cpp/tests`. They require a host C++ toolchain. They were **not executed on this Windows agent** when zlib/MSVC were unavailable.

## Not verified (do not claim)

1. USB-MIDI latency or stability on a physical Android tablet or iPhone/iPad.
2. Oboe / RemoteIO glitch-free long sessions or 96-voice CPU cost on device.
3. Import of a real user PA4X `.SET` compared against a PA4X.
4. Bluetooth MIDI (Android `MidiManager` and iOS CoreMIDI will see system Bluetooth MIDI endpoints if the OS exposes them; untested).
5. iOS build on this Windows machine (needs Xcode).

## Known gaps

- **PCG is names + missing-file reporting only.** EDS-X oscillator/filter/FX parameters are unpublished (ConvertWithMoss / PCG Tools agree). Playable Korg instruments come from KMP + PCM/KSF/WAV.
- **SET import UI** asks SET folder vs Style Record SMF / STY. iOS copies the picked folder natively (security-scoped) so `.SET` packages work.
- **PAD objects** are not playable pads.
- **PA4X styles** use Korg’s published Style Record SMF (`v1cv1`, channels 9–16, Program Change at tick 0) and SET folders. Host-tested: Korg EnCVn SMF loaded and rendered audio. Native `USER01.STY` is a KORF bank of unpublished OC31 MIDI; the loader still reads the name list and tells you to export SMF from the Pa (Style Record > Export SMF, Shift + Execute).
- **SFZ 2.0**, `trigger=release`, `lorand`/`hirand`, CC opcode maps: not supported.
- **Sample streaming**: samples load fully into RAM. No disk streamer yet.
- **No manufacturer ROM.** Do not expect Korg/Yamaha/Roland factory PCM or styles inside the app.
- Some factory style *titles* share a rhythmic template (tempo/category still differ). They are original MIDI arrangements, not audio loops, but they are not 31 fully unique scores.

## Next hardware pass

1. `npx expo run:android` on a tablet with a class-compliant USB-MIDI keyboard.
2. Play factory Concert Grand across the keyboard; check sustain, pitch bend, mod wheel.
3. Start a style, play left-hand chords, change variations and fills.
4. Import a real PA4X SET that contains KMP + PCM; confirm zones and missing-factory-PCM reporting.
5. Repeat on iPad with a USB-C / Camera Adapter host cable.
