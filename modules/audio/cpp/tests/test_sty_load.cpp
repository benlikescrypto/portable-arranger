#include "../Engine.h"

#include <cmath>
#include <cstdio>
#include <cstring>
#include <memory>
#include <string>
#include <vector>

namespace {

int fails = 0;

void expect(bool ok, const char* name) {
    std::printf("%s %s\n", ok ? "PASS" : "FAIL", name);
    if (!ok) fails++;
}

float rms(const float* x, int n) {
    double a = 0;
    for (int i = 0; i < n; ++i) a += (double)x[i] * x[i];
    return (float)std::sqrt(a / std::max(1, n));
}

int loadAndPlay(pa::Engine& eng, const char* path, const char* label) {
    const int before = eng.styleCount();
    char report[1024];
    report[0] = 0;
    eng.loadPa4xSet(path, report, (int)sizeof(report));
    std::printf("LOAD %s report=%s\n", label, report);
    const int after = eng.styleCount();
    const int added = after - before;
    expect(added > 0, label);
    if (added <= 0) return -1;
    const int id = after - 1;
    std::printf("  style %d name=%s tempo=%.1f\n", id, eng.styleName(id), eng.styleTempo(id));
    eng.setStyle(id);
    eng.setTempo(eng.styleTempo(id) > 0 ? eng.styleTempo(id) : 120);
    eng.noteOn(1, 48, 100);
    eng.noteOn(1, 52, 100);
    eng.noteOn(1, 55, 100);
    eng.arrangerStart();
    std::vector<float> buf(48000 * 2, 0.0f);
    eng.render(buf.data(), 48000);
    const float level = rms(buf.data(), 96000);
    std::printf("  rms=%.6f playing=%d\n", level, eng.isPlaying() ? 1 : 0);
    expect(eng.isPlaying(), (std::string(label) + "_playing").c_str());
    if (eng.hasSoundfont()) expect(level > 0.00005f, (std::string(label) + "_audio").c_str());
    eng.arrangerStop();
    eng.noteOff(1, 48);
    eng.noteOff(1, 52);
    eng.noteOff(1, 55);
    return id;
}

}  // namespace

int main(int argc, char** argv) {
    auto engHeap = std::make_unique<pa::Engine>();
    pa::Engine& eng = *engHeap;
    eng.prepare(48000.0f);
    const char* sf2 = argc > 1 ? argv[1] : "modules/audio/factory/GeneralUser-GS.sf2";
    if (eng.loadSoundfont(sf2) > 0) std::printf("SF2 loaded %s\n", sf2);
    else std::printf("SF2 missing %s (load still tested)\n", sf2);

    const char* files[] = {
        "tmp/styles/yamaha-sff-overrun.sty",
        "tmp/styles/yamaha-sff-casm-low.sty",
        "tmp/styles/korg-encvn.mid",
        "tmp/styles/yamaha-demo.sty",
    };
    for (const char* f : files) loadAndPlay(eng, f, f);
    std::printf("%s\n", fails ? "FAILED" : "ALL PASSED");
    return fails ? 1 : 0;
}
