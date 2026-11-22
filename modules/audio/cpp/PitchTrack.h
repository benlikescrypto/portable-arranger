#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace pa {

// On-device note finding with SwiftF0 (https://github.com/lars76/swift-f0, MIT).
//
// The neural network itself runs in ONNX Runtime on the platform side (Kotlin / Swift),
// because each platform ships its own runtime. Everything around it lives here, once:
// decoding a stem, resampling to the model's 16 kHz, cutting the song into the same
// overlapping windows SwiftF0's detect() uses, the silence gate and loudness, and the
// note segmentation (a port of swift_f0.segment_notes).
namespace f0 {

constexpr int kRate = 16000;
constexpr int kHop = 256;                       // one frame = 16 ms
constexpr double kFramePeriod = (double)kHop / kRate;
constexpr float kFmin = 46.875f;
constexpr float kFmax = 2093.75f;
constexpr int kWindowFrames = 1875;             // 30 s per model call
constexpr int kLeftFrames = 11;                 // context before a window
constexpr int kLookaheadFrames = 10;            // context after a window
constexpr float kSilencePeak = 1e-3f;           // frames quieter than this get confidence 0

struct Frames {
    std::vector<float> pitch;       // Hz, every frame
    std::vector<float> confidence;  // 0..1, voiced at >= 0.5
    std::vector<float> loudness;    // dB over the 32 ms centred on the frame
};

struct Note {
    double start, end;  // seconds
    double midi;        // fitted pitch in fractional MIDI (rounded to a cent)
};

// Mixes interleaved int16 audio to mono and resamples it to 16 kHz.
std::vector<float> toMono16k(const int16_t* pcm, int frames, int channels, int rate);

// Mono 16 kHz audio -> notes. `run` stands in for the ONNX model.
struct Window {
    int from;   // first sample of the model input
    int count;  // samples in the model input
    int skip;   // model frames to drop at the front (left context)
    int keep;   // model frames that belong to this window
};
std::vector<Window> plan(int samples);

// Silence gate and loudness for the whole song, in place on `f` (frame count = pitch.size()).
void finishFrames(const std::vector<float>& audio, Frames& f);

// Port of swift_f0.segment_notes (exact dynamic programme over notes and gaps).
std::vector<Note> segmentNotes(const Frames& f, double pitchHoldMs);

// The result the app reads: notes plus a pitch line for drawing.
std::string toJson(const Frames& f, const std::vector<Note>& notes, double seconds);

}  // namespace f0
}  // namespace pa
