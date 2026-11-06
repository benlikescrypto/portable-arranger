#include "Engine.h"

#include <cctype>
#include <cstdio>
#include <cstring>
#include <dirent.h>
#include <map>
#include <mutex>
#include <string>
#include <sys/stat.h>
#include <vector>
#include <zlib.h>

namespace pa {
namespace {

std::string upperExt(const std::string& path) {
    auto slash = path.find_last_of("/\\");
    std::string name = slash == std::string::npos ? path : path.substr(slash + 1);
    auto dot = name.find_last_of('.');
    if (dot == std::string::npos) return {};
    std::string ext = name.substr(dot);
    for (char& c : ext) c = (char)std::toupper((unsigned char)c);
    return ext;
}

std::string fileStem(const std::string& path) {
    auto slash = path.find_last_of("/\\");
    std::string name = slash == std::string::npos ? path : path.substr(slash + 1);
    auto dot = name.find_last_of('.');
    if (dot != std::string::npos) name = name.substr(0, dot);
    return name;
}

std::string baseName(const std::string& path) {
    auto slash = path.find_last_of("/\\");
    return slash == std::string::npos ? path : path.substr(slash + 1);
}

std::string parentDir(const std::string& path) {
    auto slash = path.find_last_of("/\\");
    return slash == std::string::npos ? std::string() : path.substr(0, slash);
}

void walkFiles(const std::string& dir, std::vector<std::string>& files) {
    DIR* d = opendir(dir.c_str());
    if (!d) return;
    while (dirent* e = readdir(d)) {
        if (e->d_name[0] == '.') continue;
        const std::string path = dir + "/" + e->d_name;
        struct stat st {};
        if (stat(path.c_str(), &st) != 0) continue;
        if (S_ISDIR(st.st_mode)) walkFiles(path, files);
        else files.push_back(path);
    }
    closedir(d);
}

std::string normName(const char* s) {
    std::string o;
    if (!s) return o;
    for (; *s; ++s) {
        if (std::isalnum((unsigned char)*s)) o += (char)std::tolower((unsigned char)*s);
    }
    return o;
}

const char* guessCat(const char* name, const char* fallback) {
    const std::string n = normName(name);
    if (n.find("piano") != std::string::npos || n.find("grand") != std::string::npos || n.find("rhodes") != std::string::npos)
        return "Piano";
    if (n.find("violin") != std::string::npos || n.find("string") != std::string::npos) return "Strings";
    if (n.find("bass") != std::string::npos) return "Bass";
    if (n.find("brass") != std::string::npos || n.find("trumpet") != std::string::npos) return "Brass";
    if (n.find("sax") != std::string::npos || n.find("flute") != std::string::npos) return "Woodwind";
    if (n.find("organ") != std::string::npos) return "Organ";
    if (n.find("guitar") != std::string::npos) return "Guitar";
    if (n.find("drum") != std::string::npos || n.find("kit") != std::string::npos || n.find("perc") != std::string::npos)
        return "Percussion";
    if (n.find("pad") != std::string::npos || n.find("lead") != std::string::npos || n.find("synth") != std::string::npos)
        return "Synth";
    if (n.find("oud") != std::string::npos || n.find("ney") != std::string::npos || n.find("kanun") != std::string::npos ||
        n.find("orient") != std::string::npos || n.find("arabic") != std::string::npos || n.find("mizrahi") != std::string::npos)
        return "Oriental";
    return fallback;
}

bool looksLikeName(const std::string& s) {
    if (s.size() < 3) return false;
    int letters = 0, weird = 0;
    for (char c : s) {
        if (std::isalpha((unsigned char)c)) letters++;
        if (std::strchr("@#$%^&*{}[]<>|\\~`", c)) weird++;
    }
    if (letters < 3 || weird > 1) return false;
    if (s.rfind("http", 0) == 0) return false;
    return true;
}

std::vector<std::string> extractNames(const uint8_t* b, size_t n) {
    std::vector<std::pair<size_t, std::string>> hits;
    size_t i = 0;
    while (i + 8 < n) {
        if (b[i] >= 32 && b[i] < 127) {
            size_t len = 0;
            while (i + len < n && len < 24 && b[i + len] >= 32 && b[i + len] < 127) len++;
            if (len >= 8 && len <= 24) {
                std::string raw((const char*)b + i, len);
                while (!raw.empty() && raw.back() == ' ') raw.pop_back();
                if (looksLikeName(raw)) hits.push_back({i, raw});
                i += len;
                continue;
            }
        }
        i++;
    }
    std::vector<std::string> names;
    if (hits.size() >= 8) {
        std::map<int, int> deltas;
        for (size_t h = 1; h < hits.size(); ++h) {
            const int d = (int)(hits[h].first - hits[h - 1].first);
            if (d >= 16 && d <= 1024) deltas[d]++;
        }
        int best = 0, bestc = 0;
        for (auto& kv : deltas)
            if (kv.second > bestc) {
                best = kv.first;
                bestc = kv.second;
            }
        if (bestc >= 6 && best > 0) {
            const size_t first = hits[0].first;
            for (auto& h : hits) {
                const int rem = (int)((h.first - first) % (size_t)best);
                if (rem == 0 || rem <= 2 || best - rem <= 2) names.push_back(h.second);
            }
        }
    }
    if (names.empty()) {
        for (auto& h : hits) names.push_back(h.second);
    }
    std::vector<std::string> unique;
    for (auto& s : names) {
        bool dup = false;
        for (auto& u : unique)
            if (u == s) {
                dup = true;
                break;
            }
        if (!dup && s.size() >= 3) unique.push_back(s);
    }
    return unique;
}

uint32_t ru32be(const uint8_t* p) {
    return ((uint32_t)p[0] << 24) | ((uint32_t)p[1] << 16) | ((uint32_t)p[2] << 8) | (uint32_t)p[3];
}
uint32_t ru32le(const uint8_t* p) {
    return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}
uint16_t ru16be(const uint8_t* p) { return (uint16_t)((p[0] << 8) | p[1]); }
uint16_t ru16le(const uint8_t* p) { return (uint16_t)(p[0] | (p[1] << 8)); }

uint32_t readVlq(const uint8_t*& p, const uint8_t* end) {
    uint32_t v = 0;
    for (int g = 0; g < 4 && p < end; ++g) {
        const uint8_t b = *p++;
        v = (v << 7) | (b & 0x7f);
        if (!(b & 0x80)) break;
    }
    return v;
}

struct MidiNote {
    int tick = 0, ch = 0, note = 0, vel = 0, dur = 0;
};

bool looksLikeMidi(const uint8_t* d, size_t n) {
    if (n < 8) return false;
    if (std::memcmp(d, "MThd", 4) == 0 || std::memcmp(d, "MTrk", 4) == 0) return true;
    int notes = 0;
    for (size_t i = 0; i + 2 < n; ++i) {
        if ((d[i] & 0xF0) == 0x90 && d[i + 1] < 128 && d[i + 2] > 0 && d[i + 2] < 128) notes++;
        if (notes >= 12) return true;
    }
    return false;
}

void parseSmfTrack(const uint8_t* p, size_t n, int division, std::vector<MidiNote>& notes) {
    const uint8_t* cur = p;
    const uint8_t* end = p + n;
    int tick = 0;
    uint8_t running = 0;
    int onTick[16][128];
    int onVel[16][128];
    std::memset(onTick, 0xFF, sizeof(onTick));
    auto close = [&](int ch, int note, int at) {
        if (ch < 0 || ch > 15 || note < 0 || note > 127) return;
        if (onTick[ch][note] >= 0) {
            MidiNote m;
            m.tick = onTick[ch][note];
            m.ch = ch;
            m.note = note;
            m.vel = onVel[ch][note];
            m.dur = std::max(1, at - onTick[ch][note]);
            notes.push_back(m);
            onTick[ch][note] = -1;
        }
    };
    while (cur < end) {
        tick += (int)readVlq(cur, end);
        if (cur >= end) break;
        uint8_t status = *cur;
        if (status < 0x80) {
            if (!running) break;
            status = running;
        } else {
            ++cur;
            if (status < 0xF0) running = status;
        }
        const uint8_t type = status & 0xF0;
        const uint8_t ch = status & 0x0F;
        if (status == 0xFF) {
            if (cur >= end) break;
            const uint8_t meta = *cur++;
            const uint32_t len = readVlq(cur, end);
            (void)meta;
            if (cur + len > end) break;
            cur += len;
            continue;
        }
        if (status == 0xF0 || status == 0xF7) {
            const uint32_t len = readVlq(cur, end);
            if (cur + len > end) break;
            cur += len;
            continue;
        }
        if (type == 0x90 || type == 0x80) {
            if (cur + 1 >= end) break;
            const int note = cur[0];
            const int vel = cur[1];
            cur += 2;
            if (type == 0x80 || vel == 0) close(ch, note, tick);
            else {
                close(ch, note, tick);
                onTick[ch][note] = tick;
                onVel[ch][note] = vel;
            }
        } else if (type == 0xC0 || type == 0xD0) {
            if (cur >= end) break;
            cur += 1;
        } else if (type == 0xF0) {
            running = 0;
        } else {
            if (cur + 1 >= end) break;
            cur += 2;
        }
    }
    for (int ch = 0; ch < 16; ++ch)
        for (int note = 0; note < 128; ++note)
            if (onTick[ch][note] >= 0) close(ch, note, tick + division);
    (void)division;
}

void parseSmf(const uint8_t* b, size_t n, std::vector<MidiNote>& notes, int& division) {
    division = 96;
    size_t i = 0;
    bool any = false;
    while (i + 8 <= n) {
        if (std::memcmp(b + i, "MThd", 4) == 0) {
            const uint32_t sz = ru32be(b + i + 4);
            if (i + 8 + sz <= n && sz >= 6) {
                division = ru16be(b + i + 12);
                if (division & 0x8000) division = 96;
                if (division <= 0) division = 96;
            }
            i += 8 + sz;
            continue;
        }
        if (std::memcmp(b + i, "MTrk", 4) == 0) {
            const uint32_t sz = ru32be(b + i + 4);
            if (i + 8 + sz <= n) {
                parseSmfTrack(b + i + 8, sz, division, notes);
                any = true;
            }
            i += 8 + (sz ? sz : 1);
            continue;
        }
        ++i;
    }
    if (!any && looksLikeMidi(b, n)) parseSmfTrack(b, n, division, notes);
}

bool inflateZlibBlock(const uint8_t* p, size_t n, std::vector<uint8_t>& out) {
    if (n < 4) return false;
    auto run = [&](int window) {
        z_stream st{};
        if (inflateInit2(&st, window) != Z_OK) return false;
        out.assign(std::min<size_t>(n * 16, 8u * 1024u * 1024u), 0);
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

bool lzssInflate(const uint8_t* src, size_t n, std::vector<uint8_t>& dst, size_t cap) {
    dst.clear();
    dst.reserve(std::min(cap, n * 8));
    size_t i = 0;
    while (i < n && dst.size() < cap) {
        const uint8_t flags = src[i++];
        for (int bit = 0; bit < 8 && i < n && dst.size() < cap; ++bit) {
            if (flags & (1u << bit)) {
                dst.push_back(src[i++]);
            } else {
                if (i + 1 >= n) return dst.size() > 32;
                const uint8_t a = src[i++];
                const uint8_t b = src[i++];
                int len = ((a >> 4) & 0x0F) + 3;
                int off = ((a & 0x0F) << 8) | b;
                if (off <= 0 || off > (int)dst.size()) {
                    len = ((b >> 4) & 0x0F) + 3;
                    off = ((b & 0x0F) << 8) | a;
                }
                if (off <= 0 || off > (int)dst.size()) return dst.size() > 32;
                const int start = (int)dst.size() - off;
                for (int k = 0; k < len && dst.size() < cap; ++k) dst.push_back(dst[(size_t)(start + k)]);
            }
        }
    }
    return dst.size() > 32;
}

int scaleTick(int tick, int division) {
    if (division <= 0) division = 96;
    return std::max(0, (int)((int64_t)tick * kPpq / division));
}

void collectMidiBlobs(const uint8_t* b, size_t n, std::vector<std::vector<MidiNote>>& blobs) {
    for (size_t i = 0; i + 8 < n; ++i) {
        if (std::memcmp(b + i, "MThd", 4) == 0 || std::memcmp(b + i, "MTrk", 4) == 0) {
            std::vector<MidiNote> notes;
            int div = 96;
            parseSmf(b + i, n - i, notes, div);
            if (!notes.empty()) {
                for (auto& m : notes) {
                    m.tick = scaleTick(m.tick, div);
                    m.dur = std::max(1, scaleTick(m.dur, div));
                }
                blobs.push_back(std::move(notes));
                i += 64;
            }
        } else if (i + 8 < n && std::memcmp(b + i, "OC31", 4) == 0) {
            uint32_t cap = ru32le(b + i + 4);
            if (cap < 64 || cap > 8u * 1024u * 1024u) cap = ru32be(b + i + 4);
            if (cap < 64 || cap > 8u * 1024u * 1024u) cap = 1u * 1024u * 1024u;
            std::vector<uint8_t> unpacked;
            if (lzssInflate(b + i + 8, n - (i + 8), unpacked, cap) && looksLikeMidi(unpacked.data(), unpacked.size())) {
                std::vector<MidiNote> notes;
                int div = 96;
                parseSmf(unpacked.data(), unpacked.size(), notes, div);
                if (!notes.empty()) {
                    for (auto& m : notes) {
                        m.tick = scaleTick(m.tick, div);
                        m.dur = std::max(1, scaleTick(m.dur, div));
                    }
                    blobs.push_back(std::move(notes));
                }
            }
            i += 8;
        }
    }
    if (blobs.empty()) {
        std::vector<uint8_t> inflated;
        if (inflateZlibBlock(b, n, inflated) && looksLikeMidi(inflated.data(), inflated.size())) {
            std::vector<MidiNote> notes;
            int div = 96;
            parseSmf(inflated.data(), inflated.size(), notes, div);
            if (!notes.empty()) {
                for (auto& m : notes) {
                    m.tick = scaleTick(m.tick, div);
                    m.dur = std::max(1, scaleTick(m.dur, div));
                }
                blobs.push_back(std::move(notes));
            }
        }
    }
}

void notesToPattern(const std::vector<MidiNote>& notes, Arranger::Pattern& p) {
    p.evs.clear();
    int last = 0;
    for (const MidiNote& m : notes) {
        const int tick = m.tick;
        const int dur = std::max(1, m.dur);
        last = std::max(last, tick + dur);
        uint8_t flags = kEvTrans;
        uint8_t trk = (uint8_t)m.ch;
        if (m.ch == 9) {
            flags = kEvAbs;
            trk = 0;
        } else if (m.ch == 1) {
            trk = 1;
        } else if (m.ch == 0) {
            trk = 2;
        } else {
            trk = (uint8_t)std::min(5, m.ch);
        }
        p.evs.push_back({(uint16_t)std::min(tick, 65535), trk, (uint8_t)m.note, (uint8_t)m.vel, (uint16_t)std::min(dur, 65535),
                         flags});
    }
    const int bar = kPpq * 4;
    p.lengthTicks = std::max(bar, ((last + bar - 1) / bar) * bar);
    if (p.lengthTicks > bar * 16) p.lengthTicks = bar * 16;
}

void applyBlobsToStyle(Arranger::Style& s, const std::vector<std::vector<MidiNote>>& blobs) {
    auto setPat = [&](Arranger::Pattern& dest, size_t idx) {
        if (idx >= blobs.size()) return;
        notesToPattern(blobs[idx], dest);
    };
    if (blobs.size() == 1) {
        notesToPattern(blobs[0], s.var[0]);
        s.var[1] = s.var[0];
        s.var[2] = s.var[0];
        s.var[3] = s.var[0];
        return;
    }
    if (blobs.size() <= 4) {
        for (size_t i = 0; i < blobs.size() && i < 4; ++i) setPat(s.var[i], i);
        return;
    }
    Arranger::Pattern* order[] = {&s.intro1, &s.intro2, &s.intro3, &s.var[0], &s.var[1], &s.var[2], &s.var[3],
                                  &s.fill[0], &s.fill[1], &s.fill[2], &s.fill[3], &s.brk, &s.end1, &s.end2, &s.end3};
    for (size_t i = 0; i < blobs.size() && i < 15; ++i) notesToPattern(blobs[i], *order[i]);
}

struct LoadedSample {
    int index = -1;
    std::string name;
    std::string file;
};

int findSample(const std::vector<LoadedSample>& samples, const std::string& key) {
    const std::string want = normName(key.c_str());
    if (want.empty()) return -1;
    for (const auto& s : samples) {
        if (normName(s.name.c_str()) == want) return s.index;
        if (normName(s.file.c_str()) == want) return s.index;
        if (s.file.size() >= key.size() && s.file.compare(s.file.size() - key.size(), key.size(), key) == 0) return s.index;
    }
    std::string stem = key;
    auto dot = stem.find('.');
    if (dot != std::string::npos) stem = stem.substr(0, dot);
    const std::string wantStem = normName(stem.c_str());
    for (const auto& s : samples) {
        if (normName(fileStem(s.file).c_str()) == wantStem) return s.index;
        if (normName(s.name.c_str()) == wantStem) return s.index;
    }
    return -1;
}

Patch makeSamplePatch(const char* name, const char* cat, const std::vector<Zone>& zones, bool drum) {
    Patch p;
    std::memset(p.name, 0, sizeof(p.name));
    std::memset(p.category, 0, sizeof(p.category));
    std::strncpy(p.name, name, sizeof(p.name) - 1);
    std::strncpy(p.category, cat, sizeof(p.category) - 1);
    p.sampled = true;
    p.model = drum ? Model::KitStandard : Model::Piano;
    p.attack = drum ? 0.4f : 0.8f;
    p.decay = drum ? 80.f : 400.f;
    p.sustain = drum ? 0.f : 0.72f;
    p.release = drum ? 90.f : 240.f;
    p.zones = zones;
    p.bus = drum ? BusDrums : BusKeyboard;
    return p;
}

struct KmpRegion {
    int original = 60, top = 127, tune = 0, level = 0, pan = 64;
    std::string sampleName;
};

struct KmpInst {
    std::string name;
    std::vector<KmpRegion> regions;
};

std::string readFixed(const uint8_t* p, int n) {
    std::string s((const char*)p, (size_t)n);
    while (!s.empty() && (s.back() == 0 || s.back() == ' ')) s.pop_back();
    return s;
}

void parseKmpBytes(const uint8_t* b, size_t n, std::vector<KmpInst>& out) {
    for (size_t i = 0; i + 18 <= n;) {
        if (std::memcmp(b + i, "MSP1", 4) != 0) {
            ++i;
            continue;
        }
        const uint32_t sz = ru32be(b + i + 4);
        if (sz < 18 || i + 8 + sz > n) {
            ++i;
            continue;
        }
        const uint8_t* payload = b + i + 8;
        KmpInst inst;
        inst.name = readFixed(payload, 16);
        const int nSamples = payload[16];
        size_t cursor = i + 8 + sz;
        if (cursor + 8 <= n && std::memcmp(b + cursor, "NAME", 4) == 0) {
            const uint32_t nsz = ru32be(b + cursor + 4);
            if (cursor + 8 + nsz <= n) {
                const std::string longer = readFixed(b + cursor + 8, std::min(24, (int)nsz));
                if (!longer.empty()) inst.name = longer;
                cursor += 8 + nsz;
            }
        }
        if (cursor + 8 <= n && std::memcmp(b + cursor, "RLP1", 4) == 0) {
            const uint32_t rsz = ru32be(b + cursor + 4);
            const uint8_t* rp = b + cursor + 8;
            const int count = std::min(nSamples > 0 ? nSamples : (int)(rsz / 18), (int)(rsz / 18));
            for (int r = 0; r < count; ++r) {
                const uint8_t* row = rp + r * 18;
                KmpRegion z;
                z.original = row[0] & 0x7F;
                z.top = row[1] & 0x7F;
                z.tune = (int8_t)row[2];
                z.level = (int8_t)row[3];
                z.pan = row[4] & 0x7F;
                z.sampleName = readFixed(row + 6, 12);
                inst.regions.push_back(z);
            }
            cursor += 8 + rsz;
        }
        if (!inst.regions.empty() || !inst.name.empty()) out.push_back(std::move(inst));
        i = std::max(cursor, i + 8);
    }
}

std::vector<Zone> zonesFromKmp(const KmpInst& inst, const std::vector<LoadedSample>& samples) {
    std::vector<Zone> zones;
    int low = 0;
    for (size_t r = 0; r < inst.regions.size(); ++r) {
        const KmpRegion& kr = inst.regions[r];
        Zone z;
        z.keyLow = low;
        z.keyHigh = kr.top;
        if (z.keyHigh < z.keyLow) z.keyHigh = z.keyLow;
        z.root = kr.original;
        z.tuneCents = (float)kr.tune;
        z.gain = dbToGain((float)kr.level * 0.5f);
        z.velLow = 0;
        z.velHigh = 127;
        z.sampleIndex = findSample(samples, kr.sampleName);
        if (z.sampleIndex < 0 && r < samples.size()) z.sampleIndex = samples[r].index;
        if (kr.sampleName.find("INTERNAL") == 0 || kr.sampleName.find("SKIPPED") == 0) {
            if (z.sampleIndex < 0 && !samples.empty()) z.sampleIndex = samples[std::min(r, samples.size() - 1)].index;
        }
        zones.push_back(z);
        low = kr.top + 1;
        if (low > 127) low = 127;
    }
    return zones;
}

bool isDrumKmp(const KmpInst& inst) {
    if (inst.regions.size() < 8) return false;
    int singles = 0;
    for (const auto& r : inst.regions)
        if (r.top <= r.original + 1) singles++;
    return singles * 2 >= (int)inst.regions.size();
}

int findPatchByName(Engine& eng, const std::string& name) {
    const std::string want = normName(name.c_str());
    if (want.empty()) return -1;
    int best = -1;
    size_t bestLen = 0;
    for (int i = 0; i < eng.soundCount(); ++i) {
        const std::string have = normName(eng.soundName(i));
        if (have == want) return i;
        if (have.size() >= 4 && want.size() >= 4 && (have.find(want) != std::string::npos || want.find(have) != std::string::npos)) {
            if (have.size() > bestLen) {
                bestLen = have.size();
                best = i;
            }
        }
    }
    return best;
}

void copyName40(char* dst, size_t n, const std::string& s) {
    std::memset(dst, 0, n);
    std::strncpy(dst, s.c_str(), n - 1);
}

}  // namespace

int Engine::loadPa4xSet(const char* folder, char* report, int reportLen) {
    if (report && reportLen > 0) report[0] = 0;
    if (!folder || !folder[0]) return -1;

    std::vector<std::string> files;
    walkFiles(folder, files);
    if (files.empty()) {
        struct stat st {};
        if (stat(folder, &st) == 0 && S_ISREG(st.st_mode)) files.push_back(folder);
    }
    if (files.empty()) return -1;

    std::vector<LoadedSample> loaded;
    int compressed = 0, skipped = 0, patchesAdded = 0, stylesAdded = 0;
    std::vector<int> kmpPatchIds;
    std::vector<int> drumPatchIds;
    int firstSampled = -1;

    auto addLoaded = [&](Sample&& s, const std::string& path, bool wasCompressed) {
        LoadedSample rec;
        rec.name = s.name[0] ? s.name : fileStem(path);
        rec.file = baseName(path);
        rec.index = addSample(std::move(s));
        loaded.push_back(rec);
        if (wasCompressed) compressed++;
        return rec.index;
    };

    for (const auto& path : files) {
        const std::string ext = upperExt(path);
        if (ext == ".WAV") {
            Sample s;
            if (loadWav(path.c_str(), s) > 0) {
                copyName40(s.name, sizeof(s.name), fileStem(path));
                addLoaded(std::move(s), path, false);
            } else {
                skipped++;
            }
        } else if (ext == ".KSF") {
            Sample s;
            bool comp = false;
            std::vector<uint8_t> bytes;
            if (readFileBytes(path.c_str(), bytes) && loadKsfBytes(bytes.data(), bytes.size(), s, &comp) > 0) {
                if (!s.name[0]) copyName40(s.name, sizeof(s.name), fileStem(path));
                addLoaded(std::move(s), path, comp);
            } else {
                skipped++;
            }
        } else if (ext == ".PCM") {
            std::vector<Sample> found;
            scanPcmBank(path.c_str(), found);
            if (found.empty()) skipped++;
            for (auto& s : found) addLoaded(std::move(s), path, false);
        }
    }

    for (const auto& path : files) {
        if (upperExt(path) != ".KMP") continue;
        std::vector<uint8_t> bytes;
        if (!readFileBytes(path.c_str(), bytes)) continue;
        std::vector<KmpInst> insts;
        parseKmpBytes(bytes.data(), bytes.size(), insts);
        for (const auto& inst : insts) {
            auto zones = zonesFromKmp(inst, loaded);
            int mapped = 0;
            for (const auto& z : zones)
                if (z.sampleIndex >= 0) mapped++;
            if (mapped == 0 && !loaded.empty()) {
                zones = zonesFromKmp(inst, loaded);
                int low = 0;
                for (size_t r = 0; r < zones.size(); ++r) {
                    zones[r].sampleIndex = loaded[std::min(r, loaded.size() - 1)].index;
                    zones[r].keyLow = low;
                    low = zones[r].keyHigh + 1;
                }
            }
            if (zones.empty() && !loaded.empty()) {
                Zone z;
                z.sampleIndex = loaded[0].index;
                z.root = 60;
                zones.push_back(z);
            }
            if (zones.empty()) continue;
            const bool drum = isDrumKmp(inst) || inst.name.find("Kit") != std::string::npos;
            const std::string nm = inst.name.empty() ? fileStem(path) : inst.name;
            Patch p = makeSamplePatch(nm.c_str(), guessCat(nm.c_str(), drum ? "Percussion" : "Imported"), zones, drum);
            if (drum) p.model = Model::Piano;
            const int id = addSampledInstrument(p);
            kmpPatchIds.push_back(id);
            if (drum) drumPatchIds.push_back(id);
            if (firstSampled < 0) firstSampled = id;
            patchesAdded++;
        }
    }

    if (kmpPatchIds.empty()) {
        for (const auto& rec : loaded) {
            Zone z;
            z.sampleIndex = rec.index;
            z.root = 60;
            Patch p = makeSamplePatch(rec.name.c_str(), "PCM", {z}, false);
            const int id = addSampledInstrument(p);
            if (firstSampled < 0) firstSampled = id;
            patchesAdded++;
        }
    }

    for (const auto& path : files) {
        if (upperExt(path) != ".PCG") continue;
        std::vector<uint8_t> bytes;
        if (!readFileBytes(path.c_str(), bytes)) continue;
        auto names = extractNames(bytes.data(), bytes.size());
        const bool drumBank = baseName(path).find("DK") != std::string::npos || baseName(path).find("dk") != std::string::npos;
        size_t kmpCursor = 0;
        for (size_t n = 0; n < names.size(); ++n) {
            if (findPatchByName(*this, names[n]) >= 0) continue;
            int src = findPatchByName(*this, names[n]);
            if (src < 0 && kmpCursor < kmpPatchIds.size()) src = kmpPatchIds[kmpCursor++];
            if (src < 0 && drumBank && !drumPatchIds.empty()) src = drumPatchIds[0];
            if (src < 0 && firstSampled >= 0) src = firstSampled;
            if (src < 0 || src >= soundCount()) continue;
            Patch p;
            {
                std::lock_guard<std::mutex> g(loadMu);
                p = patches[(size_t)src];
            }
            copyName40(p.name, sizeof(p.name), names[n]);
            copyName40(p.category, sizeof(p.category), guessCat(names[n].c_str(), drumBank ? "Percussion" : "Imported"));
            addSampledInstrument(p);
            patchesAdded++;
        }
    }

    int drumProg = !drumPatchIds.empty() ? drumPatchIds[0] : 32;
    int bassProg = 21;
    int accProg = firstSampled >= 0 ? firstSampled : 0;
    for (int i = 0; i < soundCount(); ++i) {
        const std::string cat = soundCategory(i);
        const std::string nm = normName(soundName(i));
        if (bassProg == 21 && (cat == std::string("Bass") || nm.find("bass") != std::string::npos)) bassProg = i;
        if (nm.find("kit") != std::string::npos || cat == std::string("Percussion")) {
            if (drumProg == 32) drumProg = i;
        }
    }

    auto ingestStyleFile = [&](const std::string& path, const std::string& fallbackName) {
        std::vector<uint8_t> bytes;
        if (!readFileBytes(path.c_str(), bytes)) return;
        auto names = extractNames(bytes.data(), bytes.size());
        if (names.empty()) names.push_back(fallbackName);
        std::vector<std::vector<MidiNote>> blobs;
        collectMidiBlobs(bytes.data(), bytes.size(), blobs);
        float tempo = 100.f;
        for (size_t i = 0; i + 1 < std::min(bytes.size(), (size_t)4096); ++i) {
            const int v = bytes[i];
            if (v >= 60 && v <= 200 && bytes[i + 1] == 0) {
                tempo = (float)v;
                break;
            }
        }
        const size_t perStyle = names.empty() ? 0 : blobs.size() / std::max((size_t)1, names.size());
        for (size_t n = 0; n < names.size(); ++n) {
            Arranger::Style style;
            std::vector<std::vector<MidiNote>> slice;
            if (!blobs.empty() && names.size() == 1) {
                slice = blobs;
            } else if (perStyle > 0 && n * perStyle < blobs.size()) {
                for (size_t k = 0; k < perStyle && n * perStyle + k < blobs.size(); ++k) {
                    slice.push_back(blobs[n * perStyle + k]);
                }
            } else if (n < blobs.size()) {
                slice.push_back(blobs[n]);
            }
            if (!slice.empty()) {
                copyName40(style.name, sizeof(style.name), names[n]);
                copyName40(style.category, sizeof(style.category), guessCat(names[n].c_str(), "Style"));
                style.tempo = tempo;
                applyBlobsToStyle(style, slice);
                style = completeStyle(std::move(style));
            } else {
                style = fallbackStyle(names[n].c_str(), guessCat(names[n].c_str(), "Style"), tempo);
            }
            for (auto* pat : {&style.var[0], &style.var[1], &style.var[2], &style.var[3], &style.intro1, &style.intro2,
                              &style.intro3, &style.fill[0], &style.fill[1], &style.fill[2], &style.fill[3], &style.brk,
                              &style.end1, &style.end2, &style.end3}) {
                pat->drumProg = drumProg;
                pat->bassProg = bassProg;
                pat->acc1 = accProg;
                pat->acc2 = accProg;
                pat->acc3 = accProg;
            }
            addStyle(std::move(style));
            stylesAdded++;
        }
    };

    for (const auto& path : files) {
        const std::string ext = upperExt(path);
        if (ext == ".STY" || ext == ".STG" || ext == ".MID" || ext == ".SMF" || ext == ".PAD") {
            ingestStyleFile(path, fileStem(path));
        }
    }

    if (report && reportLen > 0) {
        std::snprintf(report, (size_t)reportLen,
                      "{\"ok\":1,\"samples\":%d,\"patches\":%d,\"styles\":%d,\"compressed\":%d,\"skipped\":%d}",
                      (int)loaded.size(), patchesAdded, stylesAdded, compressed, skipped);
    }
    return (int)loaded.size();
}

}  // namespace pa
