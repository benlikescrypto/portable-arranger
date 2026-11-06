#include "Engine.h"

#include <cstdio>
#include <cstring>
#include <fstream>
#include <vector>

namespace pa {

static uint16_t ru16le(const uint8_t* p) { return (uint16_t)p[0] | ((uint16_t)p[1] << 8); }
static uint32_t ru32le(const uint8_t* p) {
    return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}
static uint32_t ru32be(const uint8_t* p) {
    return ((uint32_t)p[0] << 24) | ((uint32_t)p[1] << 16) | ((uint32_t)p[2] << 8) | (uint32_t)p[3];
}
static int16_t ri16be(const uint8_t* p) { return (int16_t)(((uint16_t)p[0] << 8) | p[1]); }

static bool readAll(const char* path, std::vector<uint8_t>& bytes) {
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

static bool parseKsfBytes(const uint8_t* b, size_t n, Sample& out) {
    size_t i = 0;
    int sr = 44100, bits = 16, frames = 0, loopS = 0, loopE = 0;
    bool loop = true;
    const uint8_t* pcm = nullptr;
    size_t pcmLen = 0;
    char name[32]{};
    while (i + 8 <= n) {
        const char* id = (const char*)b + i;
        const uint32_t sz = ru32be(b + i + 4);
        const uint8_t* payload = b + i + 8;
        if (i + 8 + sz > n) break;
        if (std::memcmp(id, "SMP1", 4) == 0 && sz >= 32) {
            std::memcpy(name, payload, 16);
            loopS = (int)ru32be(payload + 20);
            loopE = (int)ru32be(payload + 24);
            if (loopE > 0) loopE--;
        } else if (std::memcmp(id, "SMD1", 4) == 0 && sz >= 12) {
            sr = (int)ru32be(payload);
            const int attr = payload[4];
            bits = payload[7];
            frames = (int)ru32be(payload + 8);
            pcm = payload + 12;
            pcmLen = sz - 12;
            if (attr & 0x80) loop = false;
            if (attr & 0x10) return false;  // compressed
        } else if (std::memcmp(id, "NAME", 4) == 0 && sz >= 1) {
            const int m = std::min(24, (int)sz);
            std::memcpy(name, payload, m);
        }
        i += 8 + sz;
    }
    if (!pcm || pcmLen == 0) return false;
    out.sampleRate = sr > 0 ? sr : 44100;
    out.loop = loop && loopE > loopS;
    out.loopStart = loopS;
    out.loopEnd = loopE > 0 ? loopE : frames;
    std::memset(out.name, 0, sizeof(out.name));
    std::strncpy(out.name, name, sizeof(out.name) - 1);
    if (bits == 16) {
        const int count = (int)(pcmLen / 2);
        out.data.resize(count);
        for (int f = 0; f < count; ++f) out.data[f] = ri16be(pcm + f * 2) / 32768.0f;
    } else if (bits == 8) {
        out.data.resize(pcmLen);
        for (size_t f = 0; f < pcmLen; ++f) out.data[f] = (pcm[f] - 128) / 128.0f;
    } else {
        return false;
    }
    return !out.data.empty();
}

int loadKsf(const char* path, Sample& out) {
    std::vector<uint8_t> b;
    if (!readAll(path, b)) return -1;
    return parseKsfBytes(b.data(), b.size(), out) ? (int)out.data.size() : -1;
}

int scanPcmBank(const char* path, std::vector<Sample>& out) {
    std::vector<uint8_t> b;
    if (!readAll(path, b)) return 0;
    int found = 0;
    for (size_t i = 0; i + 8 < b.size(); ++i) {
        if (std::memcmp(b.data() + i, "SMP1", 4) == 0 || std::memcmp(b.data() + i, "SMD1", 4) == 0) {
            // Walk back to SMP1 if we hit SMD1 first.
            size_t start = i;
            if (std::memcmp(b.data() + i, "SMD1", 4) == 0) {
                bool ok = false;
                for (size_t k = i; k > 8; --k) {
                    if (std::memcmp(b.data() + k - 8, "SMP1", 4) == 0) {
                        start = k - 8;
                        ok = true;
                        break;
                    }
                    if (i - (k - 8) > 128) break;
                }
                if (!ok) continue;
            }
            Sample s;
            if (parseKsfBytes(b.data() + start, b.size() - start, s)) {
                out.push_back(std::move(s));
                found++;
                i += 64;
            }
        }
    }
    return found;
}

}  // namespace pa
