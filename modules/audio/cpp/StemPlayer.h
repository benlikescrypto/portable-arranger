#pragma once

#include <atomic>
#include <cstdint>
#include <memory>
#include <vector>

namespace pa {

// Plays a song's separated stems (and the original mix) in lock-step, so each stem
// can be heard alone, muted or blended. Decoded to 16-bit stereo in RAM at load; the
// audio thread only reads memory.
//
// Speed: below 1 the mix is slowed down without changing its pitch (Signalsmith Stretch),
// so notes sound, and are named, as in the song. At 1 the stems play directly.
constexpr int kMaxStems = 8;
constexpr float kMinStemSpeed = 0.5f;

struct StemSet {
    std::vector<int16_t> pcm[kMaxStems];  // stereo interleaved
    int count = 0;
    int frames = 0;
    int rate = 44100;
};

class StemPlayer {
public:
    StemPlayer();
    ~StemPlayer();

    // Not the audio thread (audio stopped): sets up the time-stretcher for the output rate.
    void prepare(float outRate);

    // Load thread. `paths`: newline-separated MP3 files, one per stem. Replaces the
    // current set (playback stops). Returns the stem count, or -1; writes a JSON report.
    int load(const char* paths, char* report, int reportLen);
    void clear();

    // Audio thread, per block: beginBlock, then commands, then render, then mixAt for each
    // frame, then endBlock.
    void command(int cmd, int a, float v);  // EngineCmd CmdStemPlay / Seek / Gain / Speed
    StemSet* beginBlock();
    void render(StemSet* s, int frames, float outRate);
    void mixAt(int i, float& L, float& R) const {
        if (i < rendered) {
            L += out[(size_t)i * 2];
            R += out[(size_t)i * 2 + 1];
        }
    }
    void endBlock(StemSet* s, int frames, float outRate);

    // Display (any thread). posShown is the song time being heard.
    std::atomic<float> posShown{0.0f}, lenShown{0.0f}, speedShown{1.0f};
    std::atomic<int> playingShown{0};
    std::atomic<float> level[kMaxStems]{};

private:
    struct Stretch;

    void swapIn(StemSet* next);
    void renderChunk(StemSet* s, float* o, int n, float outRate);
    bool nextFrame(StemSet* s, float outRate, float& l, float& r);
    double heardPos(StemSet* s, float outRate) const;
    void primeStretch(StemSet* s, float outRate);

    std::atomic<StemSet*> live{nullptr};
    std::atomic<StemSet*> inUse{nullptr};
    std::unique_ptr<Stretch> st;
    std::vector<float> out;  // this block's stem mix, stereo interleaved
    int rendered = 0;
    // Audio-thread state.
    StemSet* seen = nullptr;
    double pos = 0.0;  // next source frame to read
    bool playing = false;
    float fade = 0.0f;
    double pendingSeek = -1.0;
    float pendingSpeed = -1.0f;  // a switch to or from 1 waits for a fade-out
    float speed = 1.0f;
    double inAcc = 0.0;      // fractional input frames owed to the stretcher
    bool needPrime = true;   // the stretcher must restart at `pos`
    float gain[kMaxStems] = {1, 1, 1, 1, 1, 1, 1, 1};
    float gainNow[kMaxStems] = {1, 1, 1, 1, 1, 1, 1, 1};
    float peak[kMaxStems]{};
};

}  // namespace pa
