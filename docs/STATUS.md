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

## Verified in this workspace

- NDK clang (`x86_64-linux-android26`) compiled Engine, Factory, FactoryStyles, Arranger, Sampler, Pa4xLoader, SfzParser, StyleFormat, PcgParser, engine_c_api, and `tests/test_parsers.cpp`. TinySoundFont (`TsfHost.cpp`) is included in the Android CMake and iOS podspec; this pass was not host-compiled on Windows.
- `npx tsc --noEmit` passed.

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
