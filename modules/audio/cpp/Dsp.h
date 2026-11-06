#pragma once

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>

namespace pa {

constexpr float kPi = 3.14159265358979323846f;
constexpr float kTwoPi = 6.28318530717958647692f;
constexpr int kMaxVoices = 96;
constexpr int kMaxParts = 8;
constexpr int kBusCount = 6;
constexpr int kMaxSamples = 1024;
constexpr int kMaxInstruments = 2048;
constexpr int kPpq = 96;
constexpr int kKsLen = 1024;

enum Bus : int { BusKeyboard = 0, BusDrums = 1, BusBass = 2, BusAcc = 3, BusPad = 4, BusMaster = 5 };

inline float clampf(float x, float lo, float hi) { return std::max(lo, std::min(hi, x)); }
inline float midiToHz(float n) { return 440.0f * std::pow(2.0f, (n - 69.0f) / 12.0f); }
inline float dbToGain(float db) { return std::pow(10.0f, db / 20.0f); }
inline float fastTanh(float x) {
    const float x2 = x * x;
    return x * (27.0f + x2) / (27.0f + 9.0f * x2);
}
inline float velCurve(int vel) {
    const float v = clampf(vel / 127.0f, 0.0f, 1.0f);
    return v * v * (0.35f + 0.65f * v);
}
inline uint32_t nextUniq(uint32_t& s) {
    s ^= s << 13;
    s ^= s >> 17;
    s ^= s << 5;
    return s;
}
inline float white(uint32_t& s) {
    return (nextUniq(s) / 2147483648.0f) - 1.0f;
}

inline float polyblep(float t, float dt) {
    if (dt <= 0.0f) return 0.0f;
    if (t < dt) {
        const float x = t / dt;
        return x + x - x * x - 1.0f;
    }
    if (t > 1.0f - dt) {
        const float x = (t - 1.0f) / dt;
        return x * x + x + x + 1.0f;
    }
    return 0.0f;
}

inline float blepSaw(float t, float dt) { return (2.0f * t - 1.0f) - polyblep(t, dt); }

inline float blepPulse(float t, float dt, float pw) {
    float y = t < pw ? 1.0f : -1.0f;
    y += polyblep(t, dt);
    float t2 = t - pw;
    if (t2 < 0.0f) t2 += 1.0f;
    y -= polyblep(t2, dt);
    return y;
}

inline float hermite(const float* s, int n, double pos) {
    if (n <= 1) return 0.0f;
    const int i = (int)pos;
    const float x = (float)(pos - i);
    const float y0 = s[i < 1 ? 0 : i - 1];
    const float y1 = s[std::min(i, n - 1)];
    const float y2 = s[std::min(i + 1, n - 1)];
    const float y3 = s[std::min(i + 2, n - 1)];
    const float c0 = y1;
    const float c1 = 0.5f * (y2 - y0);
    const float c2 = y0 - 2.5f * y1 + 2.0f * y2 - 0.5f * y3;
    const float c3 = 0.5f * (y3 - y0) + 1.5f * (y1 - y2);
    return ((c3 * x + c2) * x + c1) * x + c0;
}

struct OnePole {
    float z = 0.0f;
    float processLp(float x, float a) {
        z += a * (x - z);
        return z;
    }
};

struct DcBlock {
    float x1 = 0.0f, y1 = 0.0f;
    float process(float x) {
        const float y = x - x1 + 0.995f * y1;
        x1 = x;
        y1 = y;
        return y;
    }
};

struct Adsr {
    enum Stage { Idle, Attack, Decay, Sustain, Release };
    Stage stage = Idle;
    float level = 0.0f;
    float aInc = 0.01f, dInc = 0.01f, sLev = 0.8f, rInc = 0.01f;

    void setTimes(float sr, float aMs, float dMs, float s, float rMs) {
        auto inc = [sr](float ms, float from, float to) {
            const float samples = std::max(1.0f, ms * 0.001f * sr);
            return (to - from) / samples;
        };
        aInc = inc(std::max(0.2f, aMs), 0.0f, 1.0f);
        dInc = inc(std::max(1.0f, dMs), 1.0f, s);
        sLev = clampf(s, 0.0f, 1.0f);
        rInc = inc(std::max(1.0f, rMs), 1.0f, 0.0f);
    }

    void noteOn() {
        stage = Attack;
        if (level < 0.001f) level = 0.0f;
    }
    void noteOff() {
        if (stage != Idle) stage = Release;
    }
    void steal() {
        stage = Release;
        rInc = std::min(rInc, -level / 24.0f);
    }

    float process() {
        switch (stage) {
            case Attack:
                level += aInc;
                if (level >= 1.0f) {
                    level = 1.0f;
                    stage = Decay;
                }
                break;
            case Decay:
                level += dInc;
                if ((dInc < 0.0f && level <= sLev) || (dInc >= 0.0f && level >= sLev)) {
                    level = sLev;
                    stage = Sustain;
                }
                break;
            case Sustain:
                level = sLev;
                break;
            case Release:
                level += (rInc < 0.0f ? rInc : -std::abs(rInc));
                if (level <= 0.0f) {
                    level = 0.0f;
                    stage = Idle;
                }
                break;
            default:
                break;
        }
        return level * level * (3.0f - 2.0f * level);
    }
    bool idle() const { return stage == Idle; }
};

struct Svf {
    float g = 0.0f, k = 0.0f, a1 = 0.0f, a2 = 0.0f, a3 = 0.0f;
    float ic1eq = 0.0f, ic2eq = 0.0f;
    float lp = 0.0f, bp = 0.0f, hp = 0.0f;

    void set(float cutoff, float res, float sr) {
        cutoff = clampf(cutoff, 20.0f, sr * 0.45f);
        res = clampf(res, 0.0f, 0.97f);
        g = std::tan(kPi * cutoff / sr);
        k = 2.0f - 2.0f * res;
        a1 = 1.0f / (1.0f + g * (g + k));
        a2 = g * a1;
        a3 = g * a2;
    }
    void tick(float v0) {
        const float v3 = v0 - ic2eq;
        const float v1 = a1 * ic1eq + a2 * v3;
        const float v2 = ic2eq + a2 * ic1eq + a3 * v3;
        ic1eq = 2.0f * v1 - ic1eq;
        ic2eq = 2.0f * v2 - ic2eq;
        lp = v2;
        bp = v1;
        hp = v0 - k * v1 - v2;
    }
    void reset() { ic1eq = ic2eq = lp = bp = hp = 0.0f; }
};

struct SoftClip {
    float process(float x) { return fastTanh(x * 0.85f) * 1.12f; }
};

struct PeakEq {
    float b0 = 1, b1 = 0, b2 = 0, a1 = 0, a2 = 0;
    float x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    void setPeaking(float sr, float freq, float q, float gainDb) {
        const float A = std::pow(10.0f, gainDb / 40.0f);
        const float w0 = kTwoPi * freq / sr;
        const float c = std::cos(w0);
        const float s = std::sin(w0);
        const float alpha = s / (2.0f * q);
        const float b0n = 1 + alpha * A;
        const float b1n = -2 * c;
        const float b2n = 1 - alpha * A;
        const float a0n = 1 + alpha / A;
        const float a1n = -2 * c;
        const float a2n = 1 - alpha / A;
        b0 = b0n / a0n;
        b1 = b1n / a0n;
        b2 = b2n / a0n;
        a1 = a1n / a0n;
        a2 = a2n / a0n;
    }
    void setLowShelf(float sr, float freq, float gainDb) {
        const float A = std::pow(10.0f, gainDb / 40.0f);
        const float w0 = kTwoPi * freq / sr;
        const float c = std::cos(w0);
        const float s = std::sin(w0);
        const float beta = std::sqrt(A);
        const float b0n = A * ((A + 1) - (A - 1) * c + beta * s);
        const float b1n = 2 * A * ((A - 1) - (A + 1) * c);
        const float b2n = A * ((A + 1) - (A - 1) * c - beta * s);
        const float a0n = (A + 1) + (A - 1) * c + beta * s;
        const float a1n = -2 * ((A - 1) + (A + 1) * c);
        const float a2n = (A + 1) + (A - 1) * c - beta * s;
        b0 = b0n / a0n;
        b1 = b1n / a0n;
        b2 = b2n / a0n;
        a1 = a1n / a0n;
        a2 = a2n / a0n;
    }
    float process(float x) {
        const float y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
        x2 = x1;
        x1 = x;
        y2 = y1;
        y1 = y;
        return y;
    }
};

struct Compressor {
    float env = 0.0f;
    float thresh = 0.5f;
    float ratio = 3.0f;
    float atk = 0.003f;
    float rel = 0.08f;
    float makeup = 1.0f;
    float process(float x, float sr) {
        const float aA = 1.0f - std::exp(-1.0f / (atk * sr));
        const float aR = 1.0f - std::exp(-1.0f / (rel * sr));
        const float absx = std::fabs(x);
        env += (absx > env ? aA : aR) * (absx - env);
        float g = 1.0f;
        if (env > thresh) {
            const float over = env / thresh;
            g = std::pow(over, 1.0f / ratio - 1.0f);
        }
        return x * g * makeup;
    }
};

struct Limiter {
    float env = 0.0f;
    float process(float x) {
        const float absx = std::fabs(x);
        env = absx > env ? absx : env * 0.9994f + absx * 0.0006f;
        const float g = env > 0.98f ? 0.98f / env : 1.0f;
        return fastTanh(x * g * 1.02f);
    }
};

struct DelayLine {
    static constexpr int kMax = 1 << 16;
    float buf[kMax]{};
    int mask = kMax - 1;
    int w = 0;
    void write(float x) {
        buf[w] = x;
        w = (w + 1) & mask;
    }
    float read(float samples) const {
        const float d = clampf(samples, 1.0f, (float)(kMax - 4));
        float rp = (float)w - d;
        while (rp < 0) rp += (float)kMax;
        const int i = (int)rp;
        const float f = rp - (float)i;
        const float a = buf[i & mask];
        const float b = buf[(i + 1) & mask];
        return a + (b - a) * f;
    }
};

struct Chorus {
    DelayLine dL, dR;
    float ph = 0.0f;
    float processL(float x, float sr) {
        ph += 0.8f / sr;
        if (ph > 1.0f) ph -= 1.0f;
        const float mod = 0.5f + 0.5f * std::sin(kTwoPi * ph);
        const float t = (7.5f + 5.5f * mod) * 0.001f * sr;
        dL.write(x);
        return x * 0.7f + dL.read(t) * 0.45f;
    }
    float processR(float x, float sr) {
        const float mod = 0.5f + 0.5f * std::sin(kTwoPi * ph + 1.7f);
        const float t = (8.2f + 6.0f * mod) * 0.001f * sr;
        dR.write(x);
        return x * 0.7f + dR.read(t) * 0.45f;
    }
};

struct Reverb {
    static constexpr int kCombs = 8;
    DelayLine comb[kCombs];
    OnePole damp[kCombs];
    DelayLine ap[4];
    float combZ[kCombs]{};
    float room = 0.78f;
    float dampAmt = 0.28f;
    float mix = 0.22f;
    const float combMs[kCombs] = {29.7f, 37.1f, 41.1f, 43.7f, 31.3f, 33.9f, 39.5f, 44.9f};
    const float apMs[4] = {5.0f, 1.7f, 6.3f, 12.6f};

    float tank(float x, float sr, int side) {
        float acc = 0.0f;
        for (int i = 0; i < kCombs; ++i) {
            const int idx = (i + side) & (kCombs - 1);
            const float d = combMs[idx] * 0.001f * sr;
            float y = comb[idx].read(d);
            y = damp[idx].processLp(y, 1.0f - dampAmt);
            combZ[idx] = y;
            comb[idx].write(x + y * room);
            acc += y;
        }
        acc *= 0.18f;
        for (int i = 0; i < 4; ++i) {
            const float d = apMs[i] * 0.001f * sr * (side ? 1.07f : 1.0f);
            const float buf = ap[i].read(d);
            const float y = -acc + buf;
            ap[i].write(acc + buf * 0.5f);
            acc = y;
        }
        return acc;
    }
    void process(float inL, float inR, float& outL, float& outR, float sr) {
        const float mono = (inL + inR) * 0.5f;
        const float wetL = tank(mono, sr, 0);
        const float wetR = tank(mono, sr, 1);
        outL = inL * (1.0f - mix) + wetL * mix;
        outR = inR * (1.0f - mix) + wetR * mix;
    }
};

enum class Model : int {
    Piano = 0,
    BrightPiano,
    SoftPiano,
    Rhodes,
    Wurly,
    Clav,
    Violin,
    OrientalStrings,
    ConcertStrings,
    WarmPad,
    Atmosphere,
    Oud,
    Ney,
    Kanun,
    Accordion,
    Sax,
    Trumpet,
    Brass,
    AcousticBass,
    FingerBass,
    SynthBass,
    JazzOrgan,
    RockOrgan,
    SquareLead,
    SawLead,
    NylonGuitar,
    Bouzouki,
    Duduk,
    KitStandard,
    KitArabic,
    KitDance,
    Count
};

inline bool isKit(Model m) {
    return m == Model::KitStandard || m == Model::KitArabic || m == Model::KitDance;
}

}  // namespace pa
