# ArrangerBox sound engine

This document records architecture decisions for the unified C++ engine in `modules/audio/cpp`.

## Decision: one arranger, two sample sources

The arranger, MIDI queue, mixer, and FX stay in `Engine`. Factory GM notes render through **TinySoundFont** (MIT) and the bundled **GeneralUser GS** SoundFont. Imported Korg KMP/KSF/WAV and SFZ instruments stay on the existing sampler (`Patch` + `Zone` + `Sample`). There is no Korg/Yamaha/Roland ROM and no second arranger.

Modeled additive/FM voices remain only as a fallback if the SF2 file is missing at startup.

## Evaluated libraries

| Project | License | Role | Decision |
| --- | --- | --- | --- |
| TinySoundFont | MIT | SF2 player | **Vendored** (`modules/audio/cpp/third_party/tsf.h`). In-process, no GPL/LGPL, plays the bundled GM bank. |
| GeneralUser GS | See `modules/audio/factory/LICENSE.txt` | GM SoundFont (~30 MB) | **Bundled.** Real sampled GM/GS bank by S. Christian Collins. TinySoundFont does not implement SoundFont modulators, so some GS programming is approximate; the PCM is still sampled instruments, not a modeled synth. |
| JUCE | GPL-3 / commercial | Audio/MIDI host | **Not used.** GPLv3 is incompatible with a closed commercial app without a paid license. |
| sfizz | BSD-2-Clause | SFZ player | **Not vendored.** SFZ import maps into our sampler IR so Korg SET and SFZ share one voice path. |
| FluidSynth | LGPL-2.1 | SF2 synth | **Not linked.** Better spec completeness (modulators), but LGPL dynamic linking is awkward on iOS. |
| ConvertWithMoss | GPL-3.0 | Format conversion | **Reference only.** Confirms KMP/KSF/KSC are documented and PCG program data is unpublished. We did not copy GPL code. |
| Meta Open Sound | Custom | Sample library | **Not bundled.** Redistribution terms need a separate legal pass. |
| VCSL / VSCO 2 CE | CC0 | Sample library | **Allowed to redistribute.** Not bundled (multi-gigabyte). The SFZ loader is the ingest path. |

## Factory library

ArrangerBox ships **GeneralUser GS** as the factory GM bank, mapped from the existing 111 patch names onto GM programs / drum kits. Styles are original ArrangerBox MIDI arrangements that now trigger those GM programs.

This is **not** a dump of Korg, Yamaha, or Roland PCM.

Acoustic realism of a recorded Steinway or a PA4X EDS-X program is **not** claimed. Users who want those libraries should import:

1. Their own PA4X SET (KMP + PCM/KSF).
2. CC0 SFZ packs such as VCSL.

## SFZ subset

Supported: `<control>` `default_path`, `<global>`, `<group>`, `<region>`, `sample`, `lokey`, `hikey`, `key`, `lovel`, `hivel`, `pitch_keycenter`, `tune`, `transpose`, `volume`, `pan`, `offset`, `end`, `loop_mode`, `loop_start`, `loop_end`, `seq_length`, `seq_position`, `ampeg_*`, `cutoff`, `resonance`.

Not supported: opcodes beyond that list, SFZ 2.0 curves, MIDI CC mapping, round-robin `lorand`/`hirand`, release-trigger `trigger=release` (documented gap).

## Korg PA4X SET

Implemented:

- Folder walk of `.SET` trees
- WAV with `smpl` loops
- KSF `SMP1`/`SMD1` (uncompressed and best-effort compressed)
- PCM banks containing SMP1/SMD1
- KMP `MSP1`/`RLP1` key maps (root, top key, tune, level, pan)
- STY/STG/MID/SMF, including SMF inside zlib and best-effort OC31/LZSS
- Chord-variation CV1 markers (`v1cv1` …)
- PCG **name extraction** and missing-file reporting

Not implemented (unpublished / not reverse-engineered):

- EDS-X oscillator, filter, and effects program parameters inside PCG
- Full OC31 when SMF cannot be recovered
- PAD performance objects as playable pads
- Factory PCM that is not in the user’s SET

If a program references factory samples that are not in the SET, the import report lists the missing references. The engine does not invent those samples.

## Real-time rules

`Engine::render` does not allocate, parse files, or take the load mutex. MIDI and UI commands enter a lock-free queue. Sample/SFZ/SET loading happens on the UI/import thread.

## Platform I/O

- Android: Oboe
- iOS: RemoteIO
- MIDI: Kotlin `MidiManager` / Swift CoreMIDI, parsed natively and pushed into the C++ queue
- Channel aftertouch is mapped to modulation (CC 1). Poly aftertouch is ignored.

Hardware verification of USB-MIDI latency and long-session stability is still required on physical devices. See `docs/STATUS.md`.
