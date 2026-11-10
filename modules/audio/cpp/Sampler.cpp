#include "Engine.h"

#include <cmath>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <map>
#include <string>
#include <vector>
#ifdef ARRANGERBOX_NO_ZLIB
struct z_stream {
    unsigned char* next_in = nullptr;
    unsigned avail_in = 0;
    unsigned char* next_out = nullptr;
    unsigned avail_out = 0;
    unsigned long total_out = 0;
};
using Bytef = unsigned char;
using uInt = unsigned;
constexpr int Z_OK = 0;
constexpr int Z_STREAM_END = 1;
constexpr int Z_FINISH = 4;
inline int inflateInit2(z_stream*, int) { return -1; }
inline int inflate(z_stream*, int) { return -1; }
inline int inflateEnd(z_stream*) { return 0; }
#else
#include <zlib.h>
#endif

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
    if (n == 0 || n > 800u * 1024u * 1024u) return false;
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
    int srcCh = 1, bits = 16, sr = 44100, formatTag = 1, unity = 60;
    const uint8_t* data = nullptr;
    size_t dataLen = 0;
    int loopS = 0, loopE = 0;
    bool hasLoop = false;
    while (i + 8 <= b.size()) {
        const char* id = (const char*)b.data() + i;
        const uint32_t sz = ru32le(b.data() + i + 4);
        const uint8_t* payload = b.data() + i + 8;
        if (i + 8 + sz > b.size()) break;
        if (std::memcmp(id, "fmt ", 4) == 0 && sz >= 16) {
            formatTag = ru16le(payload);
            srcCh = ru16le(payload + 2);
            sr = (int)ru32le(payload + 4);
            bits = ru16le(payload + 14);
        } else if (std::memcmp(id, "data", 4) == 0) {
            data = payload;
            dataLen = sz;
        } else if (std::memcmp(id, "smpl", 4) == 0 && sz >= 60) {
            unity = (int)ru32le(payload + 12);
            const uint32_t nloops = ru32le(payload + 28);
            if (nloops > 0) {
                loopS = (int)ru32le(payload + 44);
                loopE = (int)ru32le(payload + 48);
                hasLoop = loopE > loopS;
            }
        }
        i += 8 + sz + (sz & 1);
    }
    if (!data || dataLen == 0) return -1;
    const int inCh = std::max(1, srcCh);
    const int outCh = inCh >= 2 ? 2 : 1;
    const int bytesPerSample = std::max(1, bits / 8);
    const int frames = (int)(dataLen / (size_t)(bytesPerSample * inCh));
    if (frames <= 0) return -1;
    out.sampleRate = sr > 0 ? sr : 44100;
    out.channels = outCh;
    out.rootNote = (unity > 0 && unity < 128) ? unity : 60;
    out.data.assign((size_t)frames * (size_t)outCh, 0.0f);
    auto writeFrame = [&](int f, float l, float r) {
        out.data[(size_t)f * (size_t)outCh] = l;
        if (outCh == 2) out.data[(size_t)f * 2 + 1] = r;
    };
    auto sampleAt = [&](int f, int c) -> float {
        const size_t idx = (size_t)(f * inCh + std::min(c, inCh - 1));
        if (bits == 8) return (data[idx] - 128) / 128.0f;
        if (bits == 16) {
            const int16_t s = (int16_t)ru16le(data + idx * 2);
            return s / 32768.0f;
        }
        if (bits == 24) {
            const size_t o = idx * 3;
            int32_t v = (int32_t)data[o] | ((int32_t)data[o + 1] << 8) | ((int32_t)data[o + 2] << 16);
            if (v & 0x800000) v |= ~0xFFFFFF;
            return v / 8388608.0f;
        }
        if (bits == 32 && formatTag == 3) {
            float v;
            std::memcpy(&v, data + idx * 4, 4);
            return v;
        }
        if (bits == 32) {
            const int32_t s = (int32_t)ru32le(data + idx * 4);
            return s / 2147483648.0f;
        }
        return 0.0f;
    };
    if (bits != 8 && bits != 16 && bits != 24 && bits != 32) return -1;
    for (int f = 0; f < frames; ++f) {
        if (outCh == 1) {
            float acc = 0;
            for (int c = 0; c < inCh; ++c) acc += sampleAt(f, c);
            writeFrame(f, acc / (float)inCh, 0);
        } else {
            writeFrame(f, sampleAt(f, 0), sampleAt(f, 1));
        }
    }
    out.loop = hasLoop;
    out.loopStart = hasLoop ? std::max(0, std::min(frames - 1, loopS)) : 0;
    out.loopEnd = hasLoop ? std::max(out.loopStart + 1, std::min(frames, loopE)) : frames;
    return frames;
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

static std::vector<float> decode24(const uint8_t* p, size_t n, int frames, bool big) {
    const int count = std::min(frames > 0 ? frames : (int)(n / 3), (int)(n / 3));
    std::vector<float> o((size_t)std::max(0, count));
    for (int i = 0; i < count; ++i) {
        const uint8_t* q = p + (size_t)i * 3;
        int32_t v = big ? ((int32_t)q[0] << 16) | ((int32_t)q[1] << 8) | (int32_t)q[2]
                        : (int32_t)q[0] | ((int32_t)q[1] << 8) | ((int32_t)q[2] << 16);
        if (v & 0x800000) v |= ~0xFFFFFF;
        o[(size_t)i] = v / 8388608.0f;
    }
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
        out.assign(std::min<size_t>(n * 16, 96u * 1024u * 1024u), 0);
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

static std::vector<float> firstAudible(std::vector<std::vector<float>>&& cands) {
    for (auto& c : cands) {
        if (pcmScore(c) > 1e-8f) return std::move(c);
    }
    return {};
}

static uint32_t korgChunkSize(const uint8_t* b, size_t i, size_t n) {
    if (i + 8 > n) return 0;
    const uint32_t be = ru32be(b + i + 4);
    const uint32_t le = ru32le(b + i + 4);
    auto ok = [&](uint32_t sz) { return sz >= 1 && sz <= 512u * 1024u * 1024u && i + 8 + (size_t)sz <= n; };
    if (ok(be)) return be;
    if (ok(le)) return le;
    return 0;
}

static std::vector<float> decodeUncompressed(const uint8_t* pcm, size_t pcmLen, int bits, int frames) {
    if (bits == 16 && pcmLen >= 2) {
        auto be = decode16be(pcm, pcmLen, frames);
        if (pcmScore(be) > 1e-8f || be.size() >= 64) return be;
        auto le = decode16le(pcm, pcmLen, frames);
        if (!le.empty()) return le;
        return be;
    }
    if (bits == 24 && pcmLen >= 3) {
        auto be = decode24(pcm, pcmLen, frames, true);
        if (pcmScore(be) > 1e-8f || be.size() >= 64) return be;
        return decode24(pcm, pcmLen, frames, false);
    }
    if (bits == 8 && pcmLen >= 1) return decode8u(pcm, pcmLen, frames);
    if (pcmLen >= 2) return decode16be(pcm, pcmLen, frames);
    if (pcmLen >= 1) return decode8u(pcm, pcmLen, frames);
    return {};
}

static std::vector<float> decodeBest(const uint8_t* pcm, size_t pcmLen, int bits, int frames, bool compressed) {
    const size_t expect = (size_t)std::max(1, frames) * (size_t)std::max(1, bits / 8);
    const bool sizeLooksRaw = frames <= 0 || pcmLen >= expect * 9 / 10;
    if (!compressed || sizeLooksRaw) return decodeUncompressed(pcm, pcmLen, bits, frames);
    std::vector<std::vector<float>> cands;
    cands.push_back(decodeDpcm(pcm, pcmLen, frames, 1));
    cands.push_back(decodeDpcm(pcm, pcmLen, frames, 16));
    cands.push_back(decodeDpcm(pcm, pcmLen, frames, 256));
    cands.push_back(decodeDpcm4(pcm, pcmLen, frames));
    std::vector<uint8_t> inflated;
    if (inflateZlib(pcm, pcmLen, inflated)) {
        cands.push_back(decode16be(inflated.data(), inflated.size(), frames));
        cands.push_back(decode16le(inflated.data(), inflated.size(), frames));
    }
    auto got = firstAudible(std::move(cands));
    if (!got.empty()) return got;
    return decodeUncompressed(pcm, pcmLen, bits, frames);
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
        const uint32_t sz = korgChunkSize(b, i, n);
        if (sz < 1) break;
        const uint8_t* payload = b + i + 8;
        if ((std::memcmp(id, "SMP1", 4) == 0 || std::memcmp(id, "SMP2", 4) == 0) && sz >= 32) {
            std::memcpy(name, payload, 16);
            loopS = (int)ru32be(payload + 20);
            loopE = (int)ru32be(payload + 24);
            if (loopS < 0 || loopS > 200000000) loopS = (int)ru32le(payload + 20);
            if (loopE < 0 || loopE > 200000000) loopE = (int)ru32le(payload + 24);
            if (loopE > 0) loopE--;
        } else if ((std::memcmp(id, "SMD1", 4) == 0 || std::memcmp(id, "SDD1", 4) == 0) && sz >= 12) {
            sr = (int)ru32be(payload);
            if (sr < 4000 || sr > 192000) sr = (int)ru32le(payload);
            attr = payload[4];
            bits = payload[7] ? payload[7] : 16;
            if (bits != 8 && bits != 16 && bits != 24) bits = 16;
            frames = (int)ru32be(payload + 8);
            if (frames <= 0) frames = (int)ru32le(payload + 8);
            pcm = payload + 12;
            pcmLen = sz - 12;
            if (attr & 0x80) loop = false;
            r.compressed = (attr & 0x10) != 0;
            r.consumed = i + 8 + sz;
            if (i + 8 + sz + 8 <= n && std::memcmp(b + i + 8 + sz, "NAME", 4) == 0) {
                const uint32_t nsz = korgChunkSize(b, i + 8 + sz, n);
                if (nsz >= 1) {
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
        }
        i += 8 + sz;
        r.consumed = i;
    }
    if (!pcm || pcmLen == 0) return r;
    auto decoded = decodeBest(pcm, pcmLen, bits, frames > 0 ? frames : (int)pcmLen, r.compressed);
    if (decoded.empty()) return r;
    out.channels = 1;
    out.sampleRate = sr > 0 && sr < 192000 ? sr : 44100;
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

static std::string hex8(const uint8_t* p) {
    static const char* kHex = "0123456789abcdef";
    std::string s(16, '0');
    for (int i = 0; i < 8; ++i) {
        s[(size_t)i * 2] = kHex[p[i] >> 4];
        s[(size_t)i * 2 + 1] = kHex[p[i] & 0x0f];
    }
    return s;
}

static std::string readName24(const uint8_t* p, int n) {
    std::string s;
    for (int i = 0; i < n; ++i) {
        const unsigned char c = p[i];
        if (c == 0) break;
        if (c >= 32 && c < 127) s.push_back((char)c);
    }
    while (!s.empty() && s.back() == ' ') s.pop_back();
    return s;
}

static bool looksLikePaKorf(const uint8_t* b, size_t n) {
    if (n < 24) return false;
    if (!(b[0] == 0x01 && b[1] == 0x00 && b[2] == 0x01 && b[3] == 0x14)) return false;
    const size_t lim = std::min<size_t>(n, 48);
    for (size_t i = 0; i + 4 <= lim; ++i) {
        if (std::memcmp(b + i, "KORF", 4) == 0) return true;
    }
    return false;
}

static int scanPaKorfPcmBytes(const uint8_t* b, size_t n, std::vector<Sample>& out) {
    if (!looksLikePaKorf(b, n)) return 0;
    std::map<std::string, std::string> names;
    const size_t dirEnd = std::min<size_t>(n, 32u * 1024u);
    for (size_t i = 0; i + 96 <= dirEnd; ++i) {
        if (!(b[i] == 0x00 && b[i + 2] == 0x00 && b[i + 3] == 0x06 && b[i + 1] >= 0x50 && b[i + 1] <= 0x70))
            continue;
        const std::string name = readName24(b + i + 8, 24);
        if (name.size() < 3) continue;
        for (size_t k = i + 8; k + 11 < i + 94 && k + 11 < n; ++k) {
            if (b[k] == 0x04 && b[k + 1] == 0x00 && b[k + 2] == 0x08) {
                names[hex8(b + k + 3)] = name;
                break;
            }
        }
        i += 90;
    }
    int found = 0;
    size_t pos = 0;
    const uint8_t marker[4] = {0x12, 0x00, 0x00, 0x18};
    while (pos + 74 < n) {
        size_t hit = n;
        for (size_t i = pos; i + 8 <= n; ++i) {
            if (std::memcmp(b + i, marker, 4) == 0) {
                hit = i;
                break;
            }
        }
        if (hit == n) break;
        const uint32_t sz = ru32be(b + hit + 4);
        if (sz < 66 || hit + 8 + (size_t)sz > n) {
            pos = hit + 4;
            continue;
        }
        const uint8_t* payload = b + hit + 8;
        const std::string id = hex8(payload);
        const int sr = (int)((payload[12] << 8) | payload[13]);
        const uint32_t dataLen = ru32be(payload + 14);
        const uint32_t loopStart = ru32be(payload + 50);
        if (dataLen < 32 || 66 + (size_t)dataLen > (size_t)sz) {
            pos = hit + 8 + (size_t)sz;
            continue;
        }
        const uint8_t* audio = payload + 66;
        Sample s;
        auto decoded = decodeBest(audio, (size_t)dataLen, 16, (int)dataLen, true);
        if (decoded.empty()) {
            pos = hit + 8 + (size_t)sz;
            continue;
        }
        s.channels = 1;
        s.sampleRate = (sr >= 4000 && sr <= 192000) ? sr : 44100;
        s.data = std::move(decoded);
        s.sourceId = id;
        const auto it = names.find(id);
        const std::string nm = it != names.end() ? it->second : id;
        std::memset(s.name, 0, sizeof(s.name));
        std::strncpy(s.name, nm.c_str(), sizeof(s.name) - 1);
        const int frames = s.frames();
        if (loopStart > 0 && (int)loopStart < frames) {
            s.loop = true;
            s.loopStart = (int)loopStart;
            s.loopEnd = frames;
        }
        out.push_back(std::move(s));
        found++;
        pos = hit + 8 + (size_t)sz;
    }
    return found;
}

int scanPcmBank(const char* path, std::vector<Sample>& out) {
    FILE* f = std::fopen(path, "rb");
    if (!f) return 0;
    std::fseek(f, 0, SEEK_END);
    const long fileSize = std::ftell(f);
    if (fileSize < 16) {
        std::fclose(f);
        return 0;
    }
    uint8_t mag[48]{};
    std::fseek(f, 0, SEEK_SET);
    const size_t magN = std::fread(mag, 1, sizeof(mag), f);
    if (looksLikePaKorf(mag, magN)) {
        std::vector<uint8_t> bytes((size_t)fileSize);
        std::fseek(f, 0, SEEK_SET);
        if (std::fread(bytes.data(), 1, bytes.size(), f) != bytes.size()) {
            std::fclose(f);
            return 0;
        }
        std::fclose(f);
        return scanPaKorfPcmBytes(bytes.data(), bytes.size(), out);
    }
    auto readChunk = [&](long off, std::vector<uint8_t>& buf) -> bool {
        if (off < 0 || off + 8 > fileSize) return false;
        uint8_t hdr[8];
        std::fseek(f, off, SEEK_SET);
        if (std::fread(hdr, 1, 8, f) != 8) return false;
        const uint32_t be = ru32be(hdr + 4);
        const uint32_t le = ru32le(hdr + 4);
        auto ok = [&](uint32_t sz) {
            return sz >= 1 && sz <= 400u * 1024u * 1024u && off + 8 + (long)sz <= fileSize;
        };
        const uint32_t sz = ok(be) ? be : (ok(le) ? le : 0);
        if (!sz) return false;
        buf.resize(8 + sz);
        std::memcpy(buf.data(), hdr, 8);
        return std::fread(buf.data() + 8, 1, sz, f) == sz;
    };
    int found = 0;
    long pos = 0;
    std::vector<uint8_t> window(256u * 1024u);
    while (pos + 8 < fileSize) {
        std::fseek(f, pos, SEEK_SET);
        const size_t n = std::fread(window.data(), 1, window.size(), f);
        if (n < 8) break;
        size_t hit = (size_t)-1;
        for (size_t i = 0; i + 4 <= n; ++i) {
            if (std::memcmp(window.data() + i, "SMP1", 4) == 0 || std::memcmp(window.data() + i, "SMD1", 4) == 0 ||
                std::memcmp(window.data() + i, "SMP2", 4) == 0 || std::memcmp(window.data() + i, "SDD1", 4) == 0) {
                hit = i;
                break;
            }
        }
        if (hit == (size_t)-1) {
            pos += n > 4 ? (long)(n - 3) : (long)n;
            continue;
        }
        const long start = pos + (long)hit;
        std::vector<uint8_t> packed;
        long p = start;
        bool haveSmd = false;
        for (int chunks = 0; chunks < 8 && p + 8 <= fileSize; ++chunks) {
            std::vector<uint8_t> chunk;
            if (!readChunk(p, chunk)) break;
            packed.insert(packed.end(), chunk.begin(), chunk.end());
            p += (long)chunk.size();
            if (std::memcmp(chunk.data(), "SMD1", 4) == 0) {
                haveSmd = true;
                std::vector<uint8_t> nameChunk;
                if (readChunk(p, nameChunk) && std::memcmp(nameChunk.data(), "NAME", 4) == 0) {
                    packed.insert(packed.end(), nameChunk.begin(), nameChunk.end());
                    p += (long)nameChunk.size();
                }
                break;
            }
        }
        Sample s;
        auto r = parseKorgSample(packed.data(), packed.size(), s);
        if (r.ok) {
            if (!s.name[0]) std::snprintf(s.name, sizeof(s.name), "PCM %03d", found + 1);
            out.push_back(std::move(s));
            found++;
            pos = start + (long)std::max((size_t)8, r.consumed);
        } else if (haveSmd) {
            pos = p;
        } else {
            pos = start + 4;
        }
    }
    std::fclose(f);
    return found;
}

}  // namespace pa
