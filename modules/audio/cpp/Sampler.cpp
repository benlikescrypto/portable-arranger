#include "Engine.h"

#include <cmath>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <vector>
#include <zlib.h>

namespace pa {

static uint16_t ru16le(const uint8_t* p) { return (uint16_t)p[0] | ((uint16_t)p[1] << 8); }
static uint32_t ru32le(const uint8_t* p) {
    return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}
static uint32_t ru32be(const uint8_t* p) {
    return ((uint32_t)p[0] << 24) | ((uint32_t)p[1] << 16) | ((uint32_t)p[2] << 8) | (uint32_t)p[3];
}
static int16_t ri16be(const uint8_t* p) { return (int16_t)(((uint16_t)p[0] << 8) | p[1]); }

bool readFileBytes(const char* path, std::vector<uint8_t>& bytes) {
    std::ifstream in(path, std::ios::binary);
    if (!in) return false;
    in.seekg(0, std::ios::end);
    const auto n = (size_t)in.tellg();
    if (n == 0 || n > 400u * 1024u * 1024u) return false;
    in.seekg(0, std::ios::beg);
    bytes.resize(n);
    in.read((char*)bytes.data(), (std::streamsize)n);
    return (bool)in || in.eof();
}

static bool readAll(const char* path, std::vector<uint8_t>& bytes) { return readFileBytes(path, bytes); }

int loadWav(const char* path, Sample& out) {
    std::vector<uint8_t> b;
    if (!readAll(path, b) || b.size() < 44) return -1;
    if (std::memcmp(b.data(), "RIFF", 4) != 0 || std::memcmp(b.data() + 8, "WAVE", 4) != 0) return -1;
    size_t i = 12;
    int channels = 1, bits = 16, sr = 44100;
    const uint8_t* data = nullptr;
    size_t dataLen = 0;
    while (i + 8 <= b.size()) {
        const char* id = (const char*)b.data() + i;
        const uint32_t sz = ru32le(b.data() + i + 4);
        const uint8_t* payload = b.data() + i + 8;
        if (i + 8 + sz > b.size()) break;
        if (std::memcmp(id, "fmt ", 4) == 0 && sz >= 16) {
            channels = ru16le(payload + 2);
            sr = (int)ru32le(payload + 4);
            bits = ru16le(payload + 14);
        } else if (std::memcmp(id, "data", 4) == 0) {
            data = payload;
            dataLen = sz;
        }
        i += 8 + sz + (sz & 1);
    }
    if (!data || dataLen == 0) return -1;
    out.sampleRate = sr > 0 ? sr : 44100;
    out.loop = false;
    if (bits == 16) {
        const int frames = (int)(dataLen / (2 * std::max(1, channels)));
        out.data.resize(frames);
        for (int f = 0; f < frames; ++f) {
            float acc = 0;
            for (int c = 0; c < channels; ++c) {
                const int16_t s = (int16_t)ru16le(data + (size_t)(f * channels + c) * 2);
                acc += s / 32768.0f;
            }
            out.data[f] = acc / (float)std::max(1, channels);
        }
    } else if (bits == 8) {
        const int frames = (int)(dataLen / std::max(1, channels));
        out.data.resize(frames);
        for (int f = 0; f < frames; ++f) {
            float acc = 0;
            for (int c = 0; c < channels; ++c) acc += (data[f * channels + c] - 128) / 128.0f;
            out.data[f] = acc / (float)std::max(1, channels);
        }
    } else if (bits == 32) {
        const int frames = (int)(dataLen / (4 * std::max(1, channels)));
        out.data.resize(frames);
        for (int f = 0; f < frames; ++f) {
            float acc = 0;
            for (int c = 0; c < channels; ++c) {
                float v;
                std::memcpy(&v, data + (size_t)(f * channels + c) * 4, 4);
                acc += v;
            }
            out.data[f] = acc / (float)std::max(1, channels);
        }
    } else {
        return -1;
    }
    out.loopStart = 0;
    out.loopEnd = (int)out.data.size();
    return (int)out.data.size();
}

static float pcmScore(const std::vector<float>& x) {
    if (x.size() < 16) return 0;
    double energy = 0, dc = 0, clip = 0;
    for (float v : x) {
        dc += v;
        energy += (double)v * v;
        if (v > 0.99f || v < -0.99f) clip += 1;
    }
    dc /= (double)x.size();
    energy /= (double)x.size();
    if (energy < 1e-10) return 0;
    if (clip > (double)x.size() * 0.45) energy *= 0.05;
    if (std::fabs(dc) > 0.35) energy *= 0.15;
    return (float)energy;
}

static std::vector<float> decode16be(const uint8_t* p, size_t n, int frames) {
    const int count = std::min(frames > 0 ? frames : (int)(n / 2), (int)(n / 2));
    std::vector<float> o((size_t)std::max(0, count));
    for (int i = 0; i < count; ++i) o[(size_t)i] = ri16be(p + (size_t)i * 2) / 32768.0f;
    return o;
}

static std::vector<float> decode16le(const uint8_t* p, size_t n, int frames) {
    const int count = std::min(frames > 0 ? frames : (int)(n / 2), (int)(n / 2));
    std::vector<float> o((size_t)std::max(0, count));
    for (int i = 0; i < count; ++i) {
        const int16_t s = (int16_t)((uint16_t)p[(size_t)i * 2] | ((uint16_t)p[(size_t)i * 2 + 1] << 8));
        o[(size_t)i] = s / 32768.0f;
    }
    return o;
}

static std::vector<float> decode8u(const uint8_t* p, size_t n, int frames) {
    const int count = std::min(frames > 0 ? frames : (int)n, (int)n);
    std::vector<float> o((size_t)std::max(0, count));
    for (int i = 0; i < count; ++i) o[(size_t)i] = (p[i] - 128) / 128.0f;
    return o;
}

static std::vector<float> decode8s(const uint8_t* p, size_t n, int frames) {
    const int count = std::min(frames > 0 ? frames : (int)n, (int)n);
    std::vector<float> o((size_t)std::max(0, count));
    for (int i = 0; i < count; ++i) o[(size_t)i] = ((int8_t)p[i]) / 128.0f;
    return o;
}

static std::vector<float> decodeDpcm(const uint8_t* p, size_t n, int frames, int scale) {
    const int count = std::min(frames > 0 ? frames : (int)n, (int)n);
    std::vector<float> o((size_t)std::max(0, count));
    int acc = 0;
    for (int i = 0; i < count; ++i) {
        acc += (int)((int8_t)p[i]) * scale;
        if (acc > 32767) acc = 32767;
        if (acc < -32768) acc = -32768;
        o[(size_t)i] = acc / 32768.0f;
    }
    return o;
}

static std::vector<float> decodeDpcm4(const uint8_t* p, size_t n, int frames) {
    const int count = frames > 0 ? frames : (int)n * 2;
    std::vector<float> o;
    o.reserve((size_t)count);
    int acc = 0;
    for (size_t i = 0; i < n && (int)o.size() < count; ++i) {
        const int nib[2] = {(int)(int8_t)(p[i] & 0xF0) >> 4, (int)(int8_t)((p[i] & 0x0F) << 4) >> 4};
        for (int k = 0; k < 2 && (int)o.size() < count; ++k) {
            acc += nib[k] * 16;
            if (acc > 32767) acc = 32767;
            if (acc < -32768) acc = -32768;
            o.push_back(acc / 32768.0f);
        }
    }
    return o;
}

static bool inflateZlib(const uint8_t* p, size_t n, std::vector<uint8_t>& out) {
    if (n < 4) return false;
    auto run = [&](int window) -> bool {
        z_stream st{};
        if (inflateInit2(&st, window) != Z_OK) return false;
        out.assign(std::min<size_t>(n * 16, 32u * 1024u * 1024u), 0);
        st.next_in = const_cast<Bytef*>(p);
        st.avail_in = (uInt)n;
        st.next_out = out.data();
        st.avail_out = (uInt)out.size();
        const int err = inflate(&st, Z_FINISH);
        const size_t got = (size_t)st.total_out;
        inflateEnd(&st);
        if ((err == Z_STREAM_END || err == Z_OK) && got > 32) {
            out.resize(got);
            return true;
        }
        out.clear();
        return false;
    };
    return run(15 + 32) || run(15) || run(-15);
}

static std::vector<float> decodeBest(const uint8_t* pcm, size_t pcmLen, int bits, int frames, bool compressed) {
    std::vector<std::vector<float>> cands;
    cands.reserve(10);
    const bool looksUncompressed16 = pcmLen >= (size_t)std::max(1, frames) * 2;
    if (!compressed && bits == 16 && pcmLen >= 2) cands.push_back(decode16be(pcm, pcmLen, frames));
    if (!compressed && bits == 8 && pcmLen >= 1) cands.push_back(decode8u(pcm, pcmLen, frames));
    if (compressed || !looksUncompressed16) {
        cands.push_back(decodeDpcm(pcm, pcmLen, frames, 1));
        cands.push_back(decodeDpcm(pcm, pcmLen, frames, 16));
        cands.push_back(decodeDpcm(pcm, pcmLen, frames, 256));
        cands.push_back(decodeDpcm4(pcm, pcmLen, frames));
        cands.push_back(decode8s(pcm, pcmLen, frames));
        cands.push_back(decode8u(pcm, pcmLen, frames));
        std::vector<uint8_t> inflated;
        if (inflateZlib(pcm, pcmLen, inflated)) {
            cands.push_back(decode16be(inflated.data(), inflated.size(), frames));
            cands.push_back(decode16le(inflated.data(), inflated.size(), frames));
        }
    }
    if (!compressed && pcmLen >= 2) {
        cands.push_back(decode16be(pcm, pcmLen, frames));
        cands.push_back(decode16le(pcm, pcmLen, frames));
    }
    int best = -1;
    float bestScore = 0;
    for (int i = 0; i < (int)cands.size(); ++i) {
        const float s = pcmScore(cands[(size_t)i]);
        if (s > bestScore) {
            bestScore = s;
            best = i;
        }
    }
    if (best < 0) return {};
    return std::move(cands[(size_t)best]);
}

struct KsfResult {
    bool ok = false;
    bool compressed = false;
    size_t consumed = 0;
};

static KsfResult parseKorgSample(const uint8_t* b, size_t n, Sample& out) {
    KsfResult r;
    size_t i = 0;
    int sr = 44100, bits = 16, frames = 0, loopS = 0, loopE = 0, attr = 0;
    bool loop = true;
    const uint8_t* pcm = nullptr;
    size_t pcmLen = 0;
    char name[32]{};
    while (i + 8 <= n) {
        const char* id = (const char*)b + i;
        const uint32_t sz = ru32be(b + i + 4);
        if (sz < 1 || i + 8 + sz > n) break;
        const uint8_t* payload = b + i + 8;
        if (std::memcmp(id, "SMP1", 4) == 0 && sz >= 32) {
            std::memcpy(name, payload, 16);
            loopS = (int)ru32be(payload + 20);
            loopE = (int)ru32be(payload + 24);
            if (loopE > 0) loopE--;
        } else if (std::memcmp(id, "SMD1", 4) == 0 && sz >= 12) {
            sr = (int)ru32be(payload);
            attr = payload[4];
            bits = payload[7] ? payload[7] : 16;
            frames = (int)ru32be(payload + 8);
            pcm = payload + 12;
            pcmLen = sz - 12;
            if (attr & 0x80) loop = false;
            r.compressed = (attr & 0x10) != 0;
            r.consumed = i + 8 + sz;
            if (i + 8 + sz + 8 <= n && std::memcmp(b + i + 8 + sz, "NAME", 4) == 0) {
                const uint32_t nsz = ru32be(b + i + 8 + sz + 4);
                if (i + 8 + sz + 8 + nsz <= n) {
                    const int m = std::min(24, (int)nsz);
                    std::memcpy(name, b + i + 8 + sz + 8, (size_t)m);
                    r.consumed += 8 + nsz;
                }
            }
            i += 8 + sz;
            break;
        } else if (std::memcmp(id, "NAME", 4) == 0 && sz >= 1) {
            const int m = std::min(24, (int)sz);
            std::memcpy(name, payload, m);
        } else if (std::memcmp(id, "SMP1", 4) != 0 && std::memcmp(id, "SMD1", 4) != 0 &&
                   std::memcmp(id, "NAME", 4) != 0 && pcm) {
            break;
        }
        i += 8 + sz;
        r.consumed = i;
    }
    if (!pcm || pcmLen == 0) return r;
    auto decoded = decodeBest(pcm, pcmLen, bits, frames > 0 ? frames : (int)pcmLen, r.compressed);
    if (decoded.empty()) return r;
    out.sampleRate = sr > 0 ? sr : 44100;
    out.loop = loop && loopE > loopS;
    out.loopStart = std::max(0, loopS);
    out.loopEnd = loopE > 0 ? loopE : (int)decoded.size();
    if (out.loopEnd > (int)decoded.size()) out.loopEnd = (int)decoded.size();
    std::memset(out.name, 0, sizeof(out.name));
    std::strncpy(out.name, name, sizeof(out.name) - 1);
    out.data = std::move(decoded);
    r.ok = !out.data.empty();
    return r;
}

int loadKsfBytes(const uint8_t* bytes, size_t n, Sample& out, bool* compressed) {
    auto r = parseKorgSample(bytes, n, out);
    if (compressed) *compressed = r.compressed;
    return r.ok ? (int)out.data.size() : -1;
}

int loadKsf(const char* path, Sample& out) {
    std::vector<uint8_t> b;
    if (!readAll(path, b)) return -1;
    return loadKsfBytes(b.data(), b.size(), out, nullptr);
}

int scanPcmBank(const char* path, std::vector<Sample>& out) {
    std::vector<uint8_t> b;
    if (!readAll(path, b)) return 0;
    int found = 0;
    for (size_t i = 0; i + 8 < b.size();) {
        if (std::memcmp(b.data() + i, "SMP1", 4) == 0 || std::memcmp(b.data() + i, "SMD1", 4) == 0) {
            Sample s;
            auto r = parseKorgSample(b.data() + i, b.size() - i, s);
            if (r.ok) {
                if (!s.name[0]) {
                    std::snprintf(s.name, sizeof(s.name), "PCM %03d", found + 1);
                }
                out.push_back(std::move(s));
                found++;
                i += std::max((size_t)8, r.consumed);
                continue;
            }
        }
        ++i;
    }
    return found;
}

}  // namespace pa
