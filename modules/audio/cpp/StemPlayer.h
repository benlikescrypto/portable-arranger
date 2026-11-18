#pragma once

#include <atomic>
#include <cstdint>
#include <vector>

namespace pa {

// Plays a song's separated stems (and the original mix) in lock-step, so each stem
// can be heard alone, muted or blended. Decoded to 16-bit stereo in RAM at load; the
// audio thread only reads memory.
constexpr int kMaxStems = 8;

struct StemSet {
    std::vector<int16_t> pcm[kMaxStems];  // stereo interleaved
    int count = 0;
    int frames = 0;
    int rate = 44100;
};

class StemPlayer {
public:
    ~StemPlayer();

    // Load thread. `paths`: newline-separated MP3 files, one per stem. Replaces the
    // current set (playback stops). Returns the stem count, or -1; writes a JSON report.
    int load(const char* paths, char* report, int reportLen);
    void clear();

    // Audio thread.
    void command(int cmd, int a, float v);  // EngineCmd CmdStemPlay / CmdStemSeek / CmdStemGain
    StemSet* beginBlock();
    void mix(StemSet* s, float& L, float& R, float outRate);
    void endBlock(StemSet* s, int frames, float outRate);

    // Display (any thread).
    std::atomic<float> posShown{0.0f}, lenShown{0.0f};
    std::atomic<int> playingShown{0};
    std::atomic<float> level[kMaxStems]{};

private:
    void swapIn(StemSet* next);

    std::atomic<StemSet*> live{nullptr};
    std::atomic<StemSet*> inUse{nullptr};
    // Audio-thread state.
    StemSet* seen = nullptr;
    double pos = 0.0;
    bool playing = false;
    float fade = 0.0f;
    double pendingSeek = -1.0;
    float gain[kMaxStems] = {1, 1, 1, 1, 1, 1, 1, 1};
    float gainNow[kMaxStems] = {1, 1, 1, 1, 1, 1, 1, 1};
    float peak[kMaxStems]{};
};

}  // namespace pa
