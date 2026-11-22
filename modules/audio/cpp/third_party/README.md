# TinySoundFont

Vendored from https://github.com/schellingb/TinySoundFont (`tsf.h`, MIT).

`TsfHost.cpp` compiles the implementation. Factory GM playback loads
`modules/audio/factory/GeneralUser-GS.sf2` at audio start. Imported Korg/SFZ
instruments stay on the sampler path in `Engine.cpp`.

# dr_mp3

Vendored from https://github.com/mackron/dr_libs (`dr_mp3.h` v0.7.3, commit
5690d4671d7ad07ae6021756d7222eb159745f06; public domain or MIT-0). `StemPlayer.cpp` compiles the implementation
to decode the AI stems (MP3) for playback.

# SwiftF0

`modules/audio/factory/swift_f0.onnx` is the SwiftF0 pitch model from
https://github.com/lars76/swift-f0 (v0.3.0, commit d1ba77fe5331310b778ebe126b6cb3656d41d24f, MIT,
`modules/audio/factory/SWIFT_F0.LICENSE.txt`). The weights are unchanged; `scripts/swiftf0_float_pitch.py`
adds one Cast so the `pitch` output is float32 instead of float64, which the ONNX Runtime mobile APIs
(Java and Objective-C) read directly. The model runs in ONNX Runtime on the device (Kotlin / Swift);
`cpp/PitchTrack.cpp` does the resampling, windowing and note segmentation (a port of
`swift_f0.segment_notes`, checked note for note by `tests/test_pitch.cpp`).
