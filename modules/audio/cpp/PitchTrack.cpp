#include "PitchTrack.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <limits>
#include <map>
#include <memory>
#include <mutex>

#include "third_party/dr_mp3.h"  // implementation compiled in StemPlayer.cpp

namespace pa {
namespace f0 {

namespace {

constexpr double kPi = 3.14159265358979323846;

// Windowed-sinc kernel, sampled finely and read with linear interpolation.
struct Kernel {
    double half = 0;  // half-width in input samples
    double cutoff = 0;  // cycles per input sample
    static constexpr int kRes = 512;
    std::vector<float> table;  // h(d) for d = i / kRes, i = 0 .. half*kRes

    Kernel(int inRate, int outRate) {
        // Pass band to 92% of the output Nyquist; SwiftF0 reads up to 2.1 kHz, so this only
        // has to keep the upper harmonics clean and stop aliasing.
        cutoff = 0.46 * outRate / inRate;
        const double zeros = 16.0;  // zero crossings each side
        half = zeros / (2.0 * cutoff);
        const int n = (int)std::ceil(half * kRes) + 2;
        table.resize((size_t)n);
        for (int i = 0; i < n; ++i) {
            const double d = (double)i / kRes;
            if (d >= half) {
                table[(size_t)i] = 0.0f;
                continue;
            }
            const double x = 2.0 * cutoff * d;
            const double sinc = x == 0.0 ? 1.0 : std::sin(kPi * x) / (kPi * x);
            // Blackman-Harris window over [-half, half].
            const double u = 0.5 + 0.5 * d / half;  // 0.5 .. 1
            const double w = 0.35875 - 0.48829 * std::cos(2 * kPi * u) + 0.14128 * std::cos(4 * kPi * u) - 0.01168 * std::cos(6 * kPi * u);
            table[(size_t)i] = (float)(2.0 * cutoff * sinc * w);
        }
    }

    float at(double d) const {
        d = std::fabs(d) * kRes;
        const size_t i = (size_t)d;
        if (i + 1 >= table.size()) return 0.0f;
        const float t = (float)(d - (double)i);
        return table[i] + (table[i + 1] - table[i]) * t;
    }
};

float lev(const std::vector<float>& level, long i) {
    // numpy.pad(mode="symmetric"): the edge sample is repeated in the mirror.
    const long n = (long)level.size();
    while (i < 0 || i >= n) {
        if (i < 0) i = -i - 1;
        if (i >= n) i = 2 * n - 1 - i;
    }
    return level[(size_t)i];
}

}  // namespace

std::vector<float> toMono16k(const int16_t* pcm, int frames, int channels, int rate) {
    std::vector<float> mono((size_t)std::max(0, frames));
    if (!pcm || frames <= 0 || channels < 1 || rate <= 0) return {};
    constexpr float k = 1.0f / 32768.0f;
    for (int i = 0; i < frames; ++i) {
        float s = 0.0f;
        for (int c = 0; c < channels; ++c) s += pcm[(size_t)i * channels + c];
        mono[(size_t)i] = s * k / (float)channels;
    }
    if (rate == kRate) return mono;
    const Kernel kern(rate, kRate);
    const double step = (double)rate / kRate;
    const long outN = (long)std::floor((double)frames / step);
    std::vector<float> out((size_t)std::max(0L, outN));
    const long W = (long)std::ceil(kern.half);
    for (long j = 0; j < outN; ++j) {
        const double x = j * step;
        const long c = (long)std::floor(x);
        const long a = std::max(0L, c - W + 1), b = std::min((long)frames - 1, c + W);
        double acc = 0.0;
        for (long i = a; i <= b; ++i) acc += (double)mono[(size_t)i] * kern.at(x - (double)i);
        out[(size_t)j] = (float)acc;
    }
    return out;
}

std::vector<Window> plan(int samples) {
    std::vector<Window> out;
    const int n = std::max(1, samples / kHop);
    for (int start = 0; start < n; start += kWindowFrames) {
        const int end = std::min(start + kWindowFrames, n);
        const int left = std::max(0, start - kLeftFrames);
        const int from = left * kHop;
        const int to = end < n ? std::min(samples, (end + kLookaheadFrames) * kHop) : samples;
        out.push_back({from, std::max(0, to - from), start - left, end - start});
    }
    return out;
}

void finishFrames(const std::vector<float>& audio, Frames& f) {
    const size_t n = f.pitch.size();
    f.confidence.resize(n, 0.0f);
    f.loudness.assign(n, -140.0f);
    double prev = 0.0;
    for (size_t t = 0; t < n; ++t) {
        double power = 0.0;
        float peak = 0.0f;
        const size_t a = t * kHop, b = std::min(audio.size(), a + kHop);
        for (size_t i = a; i < b; ++i) {
            power += (double)audio[i] * audio[i];
            peak = std::max(peak, std::fabs(audio[i]));
        }
        if (peak < kSilencePeak) f.confidence[t] = 0.0f;
        f.loudness[t] = (float)(20.0 * std::log10(std::max(std::sqrt((prev + power) / 512.0), 1e-7)));
        prev = power;
    }
}

std::vector<Note> segmentNotes(const Frames& f, double pitchHoldMs) {
    const size_t n = f.pitch.size();
    std::vector<Note> notes;
    if (n == 0 || f.confidence.size() != n || f.loudness.size() != n) return notes;
    std::vector<double> m(n, 0.0), w(n, 0.0), q(n, 0.0);
    std::vector<double> cents;
    cents.reserve(n);
    for (size_t t = 0; t < n; ++t) {
        const double p = f.pitch[t];
        const bool valid = std::isfinite(p) && p > 0.0;
        if (valid) {
            m[t] = 69.0 + 12.0 * std::log2(p / 440.0);
            w[t] = std::max(0.0, std::min(1.0, (double)f.confidence[t]));
            cents.push_back(std::floor(m[t] * 100.0 + 0.5) / 100.0);
        }
        const double cc = std::max(0.01, std::min(0.99, w[t]));
        float left = -1e30f, right = -1e30f;
        for (long j = 0; j < 5; ++j) {
            left = std::max(left, lev(f.loudness, (long)t - 4 + j));
            right = std::max(right, lev(f.loudness, (long)t + j));
        }
        q[t] = -std::log(cc / (1.0 - cc)) + std::max(0.0, (double)std::min(left, right) - f.loudness[t] - 10.0 * std::log10(2.0));
    }
    if (cents.empty()) return notes;
    std::sort(cents.begin(), cents.end());
    cents.erase(std::unique(cents.begin(), cents.end()), cents.end());
    const size_t K = cents.size();
    const double beta = std::max(0.0, pitchHoldMs) / 1000.0 / kFramePeriod;

    std::vector<double> vn(K, std::numeric_limits<double>::infinity());
    std::vector<int> noteStart(K, 0);
    std::vector<int> back(n + 1, 0), kind(n + 1, -1);
    double best = 0.0;
    for (size_t t = 0; t < n; ++t) {
        const double start = best + beta;
        const double mt = m[t], wt = w[t], qt = q[t];
        double low = std::numeric_limits<double>::infinity();
        size_t j = 0;
        for (size_t k = 0; k < K; ++k) {
            double v = vn[k];
            if (start < v) {
                noteStart[k] = (int)t;
                v = start;
            }
            v += std::min(std::fabs(cents[k] - mt), 2.0) * wt + qt;
            vn[k] = v;
            if (v < low) {
                low = v;
                j = k;
            }
        }
        if (low < best) {
            best = low;
            back[t + 1] = noteStart[j];
            kind[t + 1] = (int)j;
        } else {
            back[t + 1] = (int)t;
        }
    }
    for (long b = (long)n; b > 0;) {
        const long a = back[(size_t)b];
        if (kind[(size_t)b] >= 0) notes.push_back({a * kFramePeriod, (b - 1) * kFramePeriod + kFramePeriod, cents[(size_t)kind[(size_t)b]]});
        b = a;
    }
    std::reverse(notes.begin(), notes.end());
    return notes;
}

std::string toJson(const Frames& f, const std::vector<Note>& notes, double seconds) {
    std::string s;
    s.reserve(64 + notes.size() * 28 + f.pitch.size() * 5);
    char buf[96];
    std::snprintf(buf, sizeof(buf), "{\"ok\":1,\"model\":\"SwiftF0\",\"seconds\":%.3f,\"hop\":%.3f,\"notes\":[", seconds, kFramePeriod);
    s += buf;
    for (size_t i = 0; i < notes.size(); ++i) {
        std::snprintf(buf, sizeof(buf), "%s[%.3f,%.3f,%.2f]", i ? "," : "", notes[i].start, notes[i].end, notes[i].midi);
        s += buf;
    }
    // The pitch line, one value per 16 ms frame: MIDI cents when voiced, 0 when not.
    s += "],\"line\":[";
    for (size_t t = 0; t < f.pitch.size(); ++t) {
        const float p = f.pitch[t];
        int v = 0;
        if (f.confidence[t] >= 0.5f && std::isfinite(p) && p > 0.0f) v = (int)std::lround(100.0 * (69.0 + 12.0 * std::log2(p / 440.0)));
        if (t) s += ',';
        std::snprintf(buf, sizeof(buf), "%d", v);
        s += buf;
    }
    s += "]}";
    return s;
}

}  // namespace f0

namespace {

struct Job {
    std::vector<float> audio;
    std::vector<f0::Window> windows;
    f0::Frames frames;
    double seconds = 0;
};

std::mutex gJobsMu;
std::map<int, std::unique_ptr<Job>> gJobs;
int gNextJob = 1;

Job* job(int id) {
    std::lock_guard<std::mutex> lock(gJobsMu);
    auto it = gJobs.find(id);
    return it == gJobs.end() ? nullptr : it->second.get();
}

void report(char* out, int len, const std::string& s) {
    if (out && len > 0) std::snprintf(out, (size_t)len, "%s", s.c_str());
}

}  // namespace
}  // namespace pa

extern "C" {

int arrangerbox_f0_open(const char* path, char* rep, int repLen) {
    using namespace pa;
    if (!path || !*path) {
        report(rep, repLen, "{\"ok\":0,\"reason\":\"no file\"}");
        return 0;
    }
    drmp3_config cfg{};
    drmp3_uint64 n = 0;
    drmp3_int16* pcm = drmp3_open_file_and_read_pcm_frames_s16(path, &cfg, &n, nullptr);
    if (!pcm || n == 0 || cfg.channels < 1) {
        if (pcm) drmp3_free(pcm, nullptr);
        report(rep, repLen, "{\"ok\":0,\"reason\":\"could not decode the stem\"}");
        return 0;
    }
    auto j = std::make_unique<Job>();
    j->audio = f0::toMono16k(pcm, (int)n, (int)cfg.channels, (int)cfg.sampleRate);
    j->seconds = (double)n / cfg.sampleRate;
    drmp3_free(pcm, nullptr);
    if (j->audio.size() < (size_t)f0::kHop) {
        report(rep, repLen, "{\"ok\":0,\"reason\":\"the stem is too short\"}");
        return 0;
    }
    // SwiftF0: scale up very quiet input (peak under about -35 dBFS) before detection.
    float peak = 0.0f;
    for (float v : j->audio) peak = std::max(peak, std::fabs(v));
    if (peak > 0.0f && peak < 0.0178f) {
        const float g = 0.5f / peak;
        for (float& v : j->audio) v *= g;
    }
    j->windows = f0::plan((int)j->audio.size());
    const int frames = std::max(1, (int)j->audio.size() / f0::kHop);
    j->frames.pitch.assign((size_t)frames, 0.0f);
    j->frames.confidence.assign((size_t)frames, 0.0f);
    const int windows = (int)j->windows.size();
    std::lock_guard<std::mutex> lock(gJobsMu);
    const int id = gNextJob++;
    gJobs[id] = std::move(j);
    char buf[128];
    std::snprintf(buf, sizeof(buf), "{\"ok\":1,\"windows\":%d,\"frames\":%d}", windows, frames);
    report(rep, repLen, buf);
    return id;
}

int arrangerbox_f0_windows(int id) {
    auto* j = pa::job(id);
    return j ? (int)j->windows.size() : 0;
}

int arrangerbox_f0_window_size(int id, int w) {
    auto* j = pa::job(id);
    if (!j || w < 0 || w >= (int)j->windows.size()) return 0;
    return j->windows[(size_t)w].count;
}

int arrangerbox_f0_window(int id, int w, float* out, int cap) {
    auto* j = pa::job(id);
    if (!j || !out || w < 0 || w >= (int)j->windows.size()) return 0;
    const auto& win = j->windows[(size_t)w];
    const int n = std::min(cap, win.count);
    std::memcpy(out, j->audio.data() + win.from, sizeof(float) * (size_t)n);
    return n;
}

int arrangerbox_f0_put(int id, int w, const float* pitch, const float* conf, int frames) {
    auto* j = pa::job(id);
    if (!j || !pitch || !conf || w < 0 || w >= (int)j->windows.size()) return 0;
    const auto& win = j->windows[(size_t)w];
    const int first = win.from / pa::f0::kHop + win.skip;
    int put = 0;
    for (int i = 0; i < win.keep; ++i) {
        const int src = win.skip + i, dst = first + i;
        if (src >= frames || dst >= (int)j->frames.pitch.size()) break;
        j->frames.pitch[(size_t)dst] = pitch[src];
        j->frames.confidence[(size_t)dst] = conf[src];
        ++put;
    }
    return put;
}

char* arrangerbox_f0_finish(int id, float pitchHoldMs) {
    std::unique_ptr<pa::Job> j;
    {
        std::lock_guard<std::mutex> lock(pa::gJobsMu);
        auto it = pa::gJobs.find(id);
        if (it != pa::gJobs.end()) {
            j = std::move(it->second);
            pa::gJobs.erase(it);
        }
    }
    std::string s = "{\"ok\":0,\"reason\":\"no such job\"}";
    if (j) {
        pa::f0::finishFrames(j->audio, j->frames);
        const auto notes = pa::f0::segmentNotes(j->frames, pitchHoldMs);
        s = pa::f0::toJson(j->frames, notes, j->seconds);
    }
    char* out = (char*)std::malloc(s.size() + 1);
    if (out) std::memcpy(out, s.c_str(), s.size() + 1);
    return out;
}

void arrangerbox_f0_close(int id) {
    std::lock_guard<std::mutex> lock(pa::gJobsMu);
    pa::gJobs.erase(id);
}

void arrangerbox_f0_free(char* s) { std::free(s); }

}  // extern "C"
