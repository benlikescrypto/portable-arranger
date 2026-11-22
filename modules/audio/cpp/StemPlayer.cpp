#include "StemPlayer.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <string>
#include <thread>

#define DR_MP3_IMPLEMENTATION
#define DR_MP3_NO_STDIO_WARNINGS
#include "third_party/dr_mp3.h"

#include "Engine.h"
#include "third_party/signalsmith/signalsmith-stretch.h"

namespace pa {

namespace {

// Stems are rendered in chunks of at most this many frames (the stretcher buffers' size).
constexpr int kChunk = 512;

bool decodeMp3(const std::string& path, std::vector<int16_t>& out, int& rate, int& frames, std::string& error) {
    drmp3_config cfg{};
    drmp3_uint64 n = 0;
    drmp3_int16* pcm = drmp3_open_file_and_read_pcm_frames_s16(path.c_str(), &cfg, &n, nullptr);
    if (!pcm || n == 0 || cfg.channels < 1) {
        if (pcm) drmp3_free(pcm, nullptr);
        error = "could not decode " + path.substr(path.find_last_of("/\\") + 1);
        return false;
    }
    rate = (int)cfg.sampleRate;
    frames = (int)n;
    out.resize((size_t)n * 2);
    if (cfg.channels == 1) {
        for (drmp3_uint64 i = 0; i < n; ++i) out[i * 2] = out[i * 2 + 1] = pcm[i];
    } else {
        const int ch = (int)cfg.channels;
        for (drmp3_uint64 i = 0; i < n; ++i) {
            out[i * 2] = pcm[i * ch];
            out[i * 2 + 1] = pcm[i * ch + 1];
        }
    }
    drmp3_free(pcm, nullptr);
    return true;
}

void writeReport(char* report, int len, const std::string& s) {
    if (!report || len <= 0) return;
    std::snprintf(report, (size_t)len, "%s", s.c_str());
}

}  // namespace

// The time-stretcher and its buffers, set up off the audio thread (prepare).
struct StemPlayer::Stretch {
    signalsmith::stretch::SignalsmithStretch<float> s;
    float rate = 0.0f;
    std::vector<float> inL, inR, outL, outR;
    float* in[2]{};
    float* outp[2]{};
    int inCap = 0;  // input frames per chunk never exceed the chunk (speed <= 1); priming needs inputLatency
};

StemPlayer::StemPlayer() : st(new Stretch()), out((size_t)16384 * 2, 0.0f) {}

StemPlayer::~StemPlayer() {
    delete live.exchange(nullptr);
}

void StemPlayer::prepare(float outRate) {
    if (outRate <= 1.0f || st->rate == outRate) return;
    // splitComputation spreads each spectral block over the next interval, so no single
    // audio callback does a whole block of FFT work.
    st->s.presetDefault(2, outRate, true);
    st->rate = outRate;
    st->inCap = std::max(kChunk, st->s.inputLatency()) + 8;
    st->inL.assign((size_t)st->inCap, 0.0f);
    st->inR.assign((size_t)st->inCap, 0.0f);
    st->outL.assign((size_t)kChunk, 0.0f);
    st->outR.assign((size_t)kChunk, 0.0f);
    st->in[0] = st->inL.data();
    st->in[1] = st->inR.data();
    st->outp[0] = st->outL.data();
    st->outp[1] = st->outR.data();
    needPrime = true;
}

void StemPlayer::swapIn(StemSet* next) {
    StemSet* old = live.exchange(next);
    // Wait until the audio thread is not reading the old set (at most one block).
    for (int i = 0; old && inUse.load() == old && i < 2000; ++i) std::this_thread::sleep_for(std::chrono::milliseconds(1));
    if (old && inUse.load() != old) delete old;
    // If the audio thread never let go (stream stuck), leaking is safer than freeing.
}

int StemPlayer::load(const char* paths, char* report, int reportLen) {
    auto* set = new StemSet();
    std::string list = paths ? paths : "";
    size_t start = 0;
    std::string error;
    while (start <= list.size() && set->count < kMaxStems) {
        size_t end = list.find('\n', start);
        if (end == std::string::npos) end = list.size();
        const std::string path = list.substr(start, end - start);
        start = end + 1;
        if (path.empty()) continue;
        int rate = 0, frames = 0;
        if (!decodeMp3(path, set->pcm[set->count], rate, frames, error)) break;
        if (set->count > 0 && rate != set->rate) {
            error = "stems have different sample rates";
            break;
        }
        set->rate = rate;
        set->frames = std::max(set->frames, frames);
        set->count++;
    }
    if (!error.empty() || set->count == 0) {
        delete set;
        writeReport(report, reportLen, "{\"ok\":0,\"reason\":\"" + (error.empty() ? std::string("no stems") : error) + "\"}");
        return -1;
    }
    size_t bytes = 0;
    for (int i = 0; i < set->count; ++i) bytes += set->pcm[i].size() * sizeof(int16_t);
    char buf[160];
    std::snprintf(buf, sizeof(buf), "{\"ok\":1,\"stems\":%d,\"seconds\":%.3f,\"rate\":%d,\"mb\":%.1f}", set->count,
                  (double)set->frames / set->rate, set->rate, bytes / 1048576.0);
    const int count = set->count;
    swapIn(set);
    writeReport(report, reportLen, buf);
    return count;
}

void StemPlayer::clear() { swapIn(nullptr); }

StemSet* StemPlayer::beginBlock() {
    StemSet* s = nullptr;
    for (;;) {
        s = live.load();
        inUse.store(s);
        if (live.load() == s) break;
    }
    if (s != seen) {
        // A new set (or none): start at the top, stopped. The speed stays as chosen.
        seen = s;
        pos = 0.0;
        playing = false;
        fade = 0.0f;
        pendingSeek = -1.0;
        if (pendingSpeed >= 0.0f) speed = pendingSpeed;
        pendingSpeed = -1.0f;
        needPrime = true;
        inAcc = 0.0;
        for (int i = 0; i < kMaxStems; ++i) peak[i] = 0.0f;
    }
    return s;
}

void StemPlayer::command(int cmd, int a, float v) {
    if (cmd == CmdStemPlay) {
        if (v > 0.5f && seen && pos >= seen->frames - 1) {  // play again from the start
            pos = 0.0;
            needPrime = true;
        }
        playing = v > 0.5f && seen != nullptr;
    } else if (cmd == CmdStemSeek) {
        pendingSeek = std::max(0.0, (double)v);
    } else if (cmd == CmdStemGain) {
        if (a >= 0 && a < kMaxStems) gain[a] = std::max(0.0f, std::min(2.0f, v));
    } else if (cmd == CmdStemSpeed) {
        const float sp = std::max(kMinStemSpeed, std::min(1.0f, v));
        const bool slowNow = speed < 0.999f, slowNext = sp < 0.999f;
        if (slowNow == slowNext) {
            speed = sp;  // the stretcher follows a new rate smoothly
            if (!slowNext) speed = 1.0f;
        } else if (fade > 0.0f) {
            pendingSpeed = slowNext ? sp : 1.0f;  // switch between direct and stretched after a fade-out
        } else {
            if (seen && st->rate > 0.0f) pos = heardPos(seen, st->rate);
            speed = slowNext ? sp : 1.0f;
            needPrime = true;
            inAcc = 0.0;
        }
    }
}

bool StemPlayer::nextFrame(StemSet* s, float outRate, float& l, float& r) {
    l = r = 0.0f;
    const int i0 = (int)pos;
    if (i0 >= s->frames - 1) return false;
    const float t = (float)(pos - i0);
    constexpr float k = 1.0f / 32768.0f;
    for (int n = 0; n < s->count; ++n) {
        gainNow[n] += (gain[n] - gainNow[n]) * 0.002f;
        const auto& p = s->pcm[n];
        if ((size_t)(i0 + 1) * 2 + 1 >= p.size()) continue;
        const float a = (p[(size_t)i0 * 2] + (p[(size_t)i0 * 2 + 2] - p[(size_t)i0 * 2]) * t) * k;
        const float b = (p[(size_t)i0 * 2 + 1] + (p[(size_t)i0 * 2 + 3] - p[(size_t)i0 * 2 + 1]) * t) * k;
        const float g = gainNow[n];
        l += a * g;
        r += b * g;
        peak[n] = std::max(peak[n], std::max(std::fabs(a), std::fabs(b)) * g);
    }
    pos += (double)s->rate / outRate;
    return true;
}

double StemPlayer::heardPos(StemSet* s, float outRate) const {
    if (!s || speed >= 0.999f || needPrime || st->rate != outRate) return pos;
    // Audio still inside the stretcher: its input half plus its output half (in input frames).
    const double lag = (st->s.inputLatency() + st->s.outputLatency() * (double)speed) * s->rate / outRate;
    return std::max(0.0, pos - lag);
}

void StemPlayer::primeStretch(StemSet* s, float outRate) {
    // Restart the stretcher with `pos` as its processing time (Signalsmith: seek with
    // inputLatency frames), so only outputLatency of pre-roll comes out before the song.
    st->s.reset();
    const int n = std::min(st->s.inputLatency(), st->inCap);
    for (int j = 0; j < n; ++j) nextFrame(s, outRate, st->inL[(size_t)j], st->inR[(size_t)j]);
    st->s.seek(st->in, n, (double)speed);
    needPrime = false;
    inAcc = 0.0;
}

// Fully faded out: apply a queued seek or speed switch. A paused stretched song resumes
// where it was heard, not where its input had got to.
static inline bool hasPending(double seek, float spd) { return seek >= 0.0 || spd >= 0.0f; }

void StemPlayer::renderChunk(StemSet* s, float* o, int n, float outRate) {
    const float step = 1.0f / (0.006f * outRate);  // ~6 ms fades: play, pause, seek never click
    const auto want = [&] { return playing && pendingSeek < 0.0 && pendingSpeed < 0.0f; };
    const auto settle = [&] {
        if (speed < 0.999f && !needPrime) {
            pos = heardPos(s, outRate);
            needPrime = true;
        }
        if (pendingSpeed >= 0.0f) {
            speed = pendingSpeed;
            pendingSpeed = -1.0f;
            needPrime = true;
        }
        if (pendingSeek >= 0.0) {
            pos = std::min((double)s->frames - 1, pendingSeek * s->rate);
            pendingSeek = -1.0;
            needPrime = true;
        }
    };
    const bool slow = speed < 0.999f && st->rate == outRate;

    if (!slow) {
        for (int i = 0; i < n; ++i) {
            fade = want() ? std::min(1.0f, fade + step) : std::max(0.0f, fade - step);
            if (fade <= 0.0f) {
                const bool switching = pendingSpeed >= 0.0f;
                settle();
                if (switching && speed < 0.999f) {
                    renderChunk(s, o + (size_t)i * 2, n - i, outRate);  // now stretched
                    return;
                }
                if (!want()) continue;
            }
            float l, r;
            if (!nextFrame(s, outRate, l, r)) {
                playing = false;
                continue;
            }
            const float g = fade * fade * (3.0f - 2.0f * fade);
            o[(size_t)i * 2] = l * g;
            o[(size_t)i * 2 + 1] = r * g;
        }
        return;
    }

    if (!want() && fade <= 0.0f) {
        const bool pending = hasPending(pendingSeek, pendingSpeed);
        settle();
        if (pending && speed >= 0.999f) renderChunk(s, o, n, outRate);  // back to direct
        return;
    }
    if (needPrime) primeStretch(s, outRate);
    inAcc += (double)n * speed;
    const int nIn = std::min((int)inAcc, st->inCap);
    inAcc -= nIn;
    bool ended = false;
    for (int j = 0; j < nIn; ++j) {
        if (!nextFrame(s, outRate, st->inL[(size_t)j], st->inR[(size_t)j])) ended = true;
    }
    if (ended) playing = false;  // fades out over the next few ms
    st->s.process(st->in, nIn, st->outp, n);
    for (int i = 0; i < n; ++i) {
        fade = want() ? std::min(1.0f, fade + step) : std::max(0.0f, fade - step);
        if (fade <= 0.0f && !want()) {
            const bool pending = hasPending(pendingSeek, pendingSpeed);
            settle();
            if (pending && speed >= 0.999f) renderChunk(s, o + (size_t)i * 2, n - i, outRate);
            return;  // the rest of the chunk stays silent
        }
        const float g = fade * fade * (3.0f - 2.0f * fade);
        o[(size_t)i * 2] = st->outL[(size_t)i] * g;
        o[(size_t)i * 2 + 1] = st->outR[(size_t)i] * g;
    }
}

void StemPlayer::render(StemSet* s, int frames, float outRate) {
    rendered = std::max(0, std::min(frames, (int)(out.size() / 2)));
    std::fill(out.begin(), out.begin() + (size_t)rendered * 2, 0.0f);
    if (!s) return;
    for (int off = 0; off < rendered; off += kChunk) renderChunk(s, out.data() + (size_t)off * 2, std::min(kChunk, rendered - off), outRate);
}

void StemPlayer::endBlock(StemSet* s, int frames, float outRate) {
    inUse.store(nullptr);
    playingShown.store(s && playing ? 1 : 0);
    posShown.store(s ? (float)(heardPos(s, outRate) / s->rate) : 0.0f);
    lenShown.store(s ? (float)s->frames / s->rate : 0.0f);
    speedShown.store(pendingSpeed >= 0.0f ? pendingSpeed : speed);
    const float decay = std::exp(-(float)frames / (0.25f * outRate));
    for (int i = 0; i < kMaxStems; ++i) {
        level[i].store(std::max(peak[i], level[i].load() * decay));
        peak[i] = 0.0f;
    }
}

}  // namespace pa
