# arrangerbox-audio

Platform-independent C++ arranger engine plus platform audio I/O.

## C API (`cpp/engine_c_api.h`)

TypeScript never talks to this API directly. Kotlin and Swift wrap it.

| Function | Thread | Notes |
| --- | --- | --- |
| `arrangerbox_engine_create/destroy` | UI | Owns the live engine singleton |
| `arrangerbox_audio_start/stop` | UI | Oboe (Android) or RemoteIO (iOS) |
| `arrangerbox_engine_render` | **audio** | Stereo interleaved float, no alloc |
| `arrangerbox_note_on/off`, `cc`, `pitch_bend`, `program_change` | MIDI or UI | Lock-free queue into the engine |
| `arrangerbox_midi_clock/start/stop/continue` | MIDI | Clock counter + arranger transport |
| catalog / mixer / style | UI | Not called from the audio thread |

Do not call filesystem, JNI, or network from `render`. Sample loading (`load_wav`, `load_ksf`, `scan_pcm_bank`) is UI/background only.
