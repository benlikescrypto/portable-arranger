// Checks PitchTrack (the C++ half of on-device SwiftF0) against the swift-f0 Python package.
//
// Make the reference with tests/swiftf0_reference.py, then:
//   test_pitch <reference folder>
// The folder holds the model's frames for a test melody (pitch.f32, conf.f32), the audio
// (audio.f32, 16 kHz), Python's loudness (loud.f32) and notes (notes.txt), and a 44.1 kHz
// tone (tone44k.s16) for the resampler.

#define DR_MP3_IMPLEMENTATION
#define DR_MP3_NO_STDIO_WARNINGS
#include "../third_party/dr_mp3.h"

#include "../PitchTrack.h"

#include <cmath>
#include <cstring>
#include <cstdio>
#include <fstream>
#include <string>
#include <vector>

using namespace pa::f0;

namespace {

int failures = 0;

void check(bool ok, const char* what) {
    std::printf("%s %s\n", ok ? "ok  " : "FAIL", what);
    if (!ok) ++failures;
}

template <typename T>
std::vector<T> readRaw(const std::string& path) {
    std::ifstream f(path, std::ios::binary);
    std::vector<char> bytes((std::istreambuf_iterator<char>(f)), std::istreambuf_iterator<char>());
    std::vector<T> out(bytes.size() / sizeof(T));
    if (!out.empty()) std::memcpy(out.data(), bytes.data(), out.size() * sizeof(T));
    return out;
}

void testPlan() {
    // detect(): 1875-frame windows, 11 frames of left context, 10 of lookahead.
    const int samples = 4000 * kHop + 100;
    const auto w = plan(samples);
    check(w.size() == 3, "plan: 4000 frames make three windows");
    check(w[0].from == 0 && w[0].skip == 0 && w[0].keep == 1875 && w[0].count == (1875 + 10) * kHop, "plan: first window");
    check(w[1].from == (1875 - 11) * kHop && w[1].skip == 11 && w[1].keep == 1875 && w[1].count == (11 + 1875 + 10) * kHop, "plan: middle window");
    check(w[2].keep == 4000 - 3750 && w[2].from + w[2].count == samples, "plan: last window runs to the end");
    check(plan(100).size() == 1 && plan(100)[0].keep == 1, "plan: shorter than a hop still gives one frame");
}

void testResample(const std::string& dir) {
    const auto tone = readRaw<int16_t>(dir + "/tone44k.s16");
    if (tone.empty()) {
        check(false, "resample: tone44k.s16 missing");
        return;
    }
    const auto y = toMono16k(tone.data(), (int)tone.size() / 2, 2, 44100);
    check(std::abs((long)y.size() - 48000) <= 1, "resample: 3 s at 44.1 kHz -> 48000 samples");
    // Correlate the middle second against 440 Hz and its quadrature: amplitude and phase.
    double re = 0, im = 0, pow = 0;
    for (int i = 16000; i < 32000; ++i) {
        const double ph = 2 * 3.14159265358979323846 * 440.0 * i / kRate;
        re += y[(size_t)i] * std::cos(ph);
        im += y[(size_t)i] * std::sin(ph);
        pow += (double)y[(size_t)i] * y[(size_t)i];
    }
    const double amp = 2 * std::sqrt(re * re + im * im) / 16000;
    const double phase = std::atan2(re, im);  // a sine at 0 phase gives 0
    const double rmsResidual = std::sqrt(std::max(0.0, pow / 16000 - amp * amp / 2));
    std::printf("     amp %.5f phase %.5f rad residual %.6f\n", amp, phase, rmsResidual);
    check(std::fabs(amp - 0.5) < 0.002, "resample: 440 Hz keeps its level");
    check(std::fabs(phase) < 0.002, "resample: no time shift");
    check(rmsResidual < 1e-3, "resample: clean (residual under -60 dB)");
}

void testAgainstPython(const std::string& dir) {
    const auto audio = readRaw<float>(dir + "/audio.f32");
    Frames f;
    f.pitch = readRaw<float>(dir + "/pitch.f32");
    f.confidence = readRaw<float>(dir + "/conf.f32");
    const auto pyLoud = readRaw<float>(dir + "/loud.f32");
    if (audio.empty() || f.pitch.empty() || f.pitch.size() != pyLoud.size()) {
        check(false, "reference files missing");
        return;
    }
    check(f.pitch.size() == (size_t)std::max(1, (int)audio.size() / kHop), "frames: one per 256 samples");
    finishFrames(audio, f);
    double worst = 0;
    for (size_t i = 0; i < pyLoud.size(); ++i) worst = std::max(worst, (double)std::fabs(f.loudness[i] - pyLoud[i]));
    std::printf("     loudness worst difference %.4f dB\n", worst);
    check(worst < 0.01, "loudness matches swift-f0");

    std::vector<Note> py;
    std::ifstream nf(dir + "/notes.txt");
    double s, e, m;
    while (nf >> s >> e >> m) py.push_back({s, e, m});
    const auto notes = segmentNotes(f, 80.0);
    std::printf("     notes: C++ %zu, Python %zu\n", notes.size(), py.size());
    bool same = notes.size() == py.size();
    for (size_t i = 0; same && i < py.size(); ++i) {
        same = std::fabs(notes[i].start - py[i].start) < 1e-4 && std::fabs(notes[i].end - py[i].end) < 1e-4 &&
               std::fabs(notes[i].midi - py[i].midi) < 0.006;
        if (!same) std::printf("     first difference at note %zu: %.3f-%.3f %.2f vs %.3f-%.3f %.2f\n", i, notes[i].start, notes[i].end, notes[i].midi, py[i].start, py[i].end, py[i].midi);
    }
    check(same, "segment_notes matches swift-f0 note for note");
    const std::string json = toJson(f, notes, audio.size() / (double)kRate);
    check(json.rfind("{\"ok\":1", 0) == 0 && json.back() == '}', "json is well formed");
}

}  // namespace

int main(int argc, char** argv) {
    testPlan();
    if (argc > 1) {
        testResample(argv[1]);
        testAgainstPython(argv[1]);
    } else {
        std::printf("skip reference checks (no folder given)\n");
    }
    std::printf(failures ? "%d FAILED\n" : "all passed\n", failures);
    return failures ? 1 : 0;
}
