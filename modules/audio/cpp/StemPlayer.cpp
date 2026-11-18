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

namespace pa {

namespace {

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

StemPlayer::~StemPlayer() {
    delete live.exchange(nullptr);
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
        // A new set (or none): start at the top, stopped.
        seen = s;
        pos = 0.0;
        playing = false;
        fade = 0.0f;
        pendingSeek = -1.0;
        for (int i = 0; i < kMaxStems; ++i) peak[i] = 0.0f;
    }
    return s;
}

void StemPlayer::command(int cmd, int a, float v) {
    if (cmd == CmdStemPlay) {
        if (v > 0.5f && seen && pos >= seen->frames - 1) pos = 0.0;  // play again from the start
        playing = v > 0.5f && seen != nullptr;
    } else if (cmd == CmdStemSeek) {
        pendingSeek = std::max(0.0, (double)v);
    } else if (cmd == CmdStemGain) {
        if (a >= 0 && a < kMaxStems) gain[a] = std::max(0.0f, std::min(2.0f, v));
    }
}

void StemPlayer::mix(StemSet* s, float& L, float& R, float outRate) {
    if (!s) return;
    // ~6 ms fades so play, pause and seek never click.
    const float step = 1.0f / (0.006f * outRate);
    const bool want = playing && pendingSeek < 0.0;
    if (want) fade = std::min(1.0f, fade + step);
    else fade = std::max(0.0f, fade - step);
    if (fade <= 0.0f) {
        if (pendingSeek >= 0.0) {
            pos = std::min((double)s->frames - 1, pendingSeek * s->rate);
            pendingSeek = -1.0;
        }
        if (!want) return;
    }
    const int i0 = (int)pos;
    if (i0 >= s->frames - 1) {
        playing = false;
        return;
    }
    const float t = (float)(pos - i0);
    constexpr float k = 1.0f / 32768.0f;
    const float g = fade * fade * (3.0f - 2.0f * fade);
    for (int n = 0; n < s->count; ++n) {
        gainNow[n] += (gain[n] - gainNow[n]) * 0.002f;
        const auto& p = s->pcm[n];
        if ((size_t)(i0 + 1) * 2 + 1 >= p.size()) continue;
        const float l = (p[(size_t)i0 * 2] + (p[(size_t)i0 * 2 + 2] - p[(size_t)i0 * 2]) * t) * k;
        const float r = (p[(size_t)i0 * 2 + 1] + (p[(size_t)i0 * 2 + 3] - p[(size_t)i0 * 2 + 1]) * t) * k;
        const float gl = gainNow[n] * g;
        L += l * gl;
        R += r * gl;
        peak[n] = std::max(peak[n], std::max(std::fabs(l), std::fabs(r)) * gl);
    }
    pos += (double)s->rate / outRate;
}

void StemPlayer::endBlock(StemSet* s, int frames, float outRate) {
    inUse.store(nullptr);
    playingShown.store(s && playing ? 1 : 0);
    posShown.store(s ? (float)(pos / s->rate) : 0.0f);
    lenShown.store(s ? (float)s->frames / s->rate : 0.0f);
    const float decay = std::exp(-(float)frames / (0.25f * outRate));
    for (int i = 0; i < kMaxStems; ++i) {
        level[i].store(std::max(peak[i], level[i].load() * decay));
        peak[i] = 0.0f;
    }
}

}  // namespace pa
