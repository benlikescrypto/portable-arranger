#include "Engine.h"

#include <algorithm>
#include <cctype>
#include <cstdio>
#include <cstring>
#include <dirent.h>
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

struct Marker {
    int tick = 0;
    std::string name;
};

std::string lowerCopy(std::string s) {
    for (char& c : s) c = (char)std::tolower((unsigned char)c);
    return s;
}

int markerSection(const std::string& raw) {
    std::string s = lowerCopy(raw);
    while (!s.empty() && s.back() == ' ') s.pop_back();
    // Korg records several Chord Variations per element (v1cv1..v1cv6).
    // Only CV1 is the C-major take. Playing every CV at once is a cluster wash.
    auto cvAt = s.find("cv");
    if (cvAt != std::string::npos && cvAt + 2 < s.size() && std::isdigit((unsigned char)s[cvAt + 2])) {
        if (s[cvAt + 2] != '1') return -1;
    }
    auto has = [&](const char* k) { return s.find(k) != std::string::npos; };
    if (has("v1cv1") || s == "v1") return 3;
    if (has("v2cv1") || s == "v2") return 4;
    if (has("v3cv1") || s == "v3") return 5;
    if (has("v4cv1") || s == "v4") return 6;
    if (has("i1cv1") || s == "i1") return 0;
    if (has("i2cv1") || s == "i2") return 1;
    if (has("i3cv1") || s == "i3") return 2;
    if (has("f1cv1") || s == "f1") return 7;
    if (has("f2cv1") || s == "f2") return 8;
    if (has("f3cv1") || s == "f3") return 9;
    if (has("f4cv1") || s == "f4") return 10;
    if (has("b1cv1") || has("brv") || s == "brk" || s == "break") return 11;
    if (has("e1cv1") || s == "e1") return 12;
    if (has("e2cv1") || s == "e2") return 13;
    if (has("e3cv1") || s == "e3") return 14;
    return -1;
}

std::string jsonSafe(const std::string& s) {
    std::string o;
    o.reserve(s.size());
    for (unsigned char c : s) {
        if (c == '"' || c == '\\') o += ' ';
        else if (c < 32) o += ' ';
        else o += (char)c;
    }
    return o;
}

void parseSmfTrack(const uint8_t* p, size_t n, int division, std::vector<MidiNote>& notes, std::vector<Marker>* markers,
                   int programs[16]) {
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
            if (cur + len > end) break;
            if (markers && (meta == 0x06 || meta == 0x03) && len > 0) {
                markers->push_back({tick, std::string((const char*)cur, (size_t)len)});
            }
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
        } else if (type == 0xC0) {
            if (cur >= end) break;
            if (programs && ch < 16) programs[ch] = cur[0] & 0x7f;
            cur += 1;
        } else if (type == 0xD0) {
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

bool parseStandardSmf(const uint8_t* b, size_t n, size_t offset, std::vector<MidiNote>& notes, std::vector<Marker>* markers,
                      int& division, int programs[16], size_t* consumed) {
    if (offset + 14 > n || std::memcmp(b + offset, "MThd", 4) != 0) return false;
    const uint32_t hdrLen = ru32be(b + offset + 4);
    if (hdrLen < 6 || offset + 8 + hdrLen > n) return false;
    const int ntrks = ru16be(b + offset + 10);
    division = ru16be(b + offset + 12);
    if (division & 0x8000) division = 96;
    if (division <= 0) division = 96;
    if (ntrks < 1 || ntrks > 64) return false;
    size_t i = offset + 8 + hdrLen;
    int parsed = 0;
    while (parsed < ntrks && i + 8 <= n) {
        const uint32_t sz = ru32be(b + i + 4);
        if (i + 8 + sz > n) break;
        if (std::memcmp(b + i, "MTrk", 4) == 0) {
            parseSmfTrack(b + i + 8, sz, division, notes, markers, programs);
            parsed++;
        }
        i += 8 + sz;
    }
    if (consumed) *consumed = i - offset;
    if (notes.empty()) return false;
    std::vector<MidiNote> keep;
    keep.reserve(notes.size());
    for (const auto& m : notes) {
        if (m.ch >= 8 && m.ch <= 15) keep.push_back(m);
    }
    // PA styles use 8–15. Converted / GM STY files often put the band on 0–7.
    if (keep.empty()) keep = notes;
    notes.swap(keep);
    return !notes.empty();
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

bool lzssRingInflate(const uint8_t* src, size_t n, std::vector<uint8_t>& dst, size_t cap, int window, int lookahead,
                     int threshold, uint8_t fill, bool lowBitLiteral, bool posLowFirst) {
    if (window <= 0 || (window & (window - 1)) != 0) return false;
    std::vector<uint8_t> ring((size_t)window, fill);
    int r = window - lookahead;
    if (r < 0) r = 0;
    size_t i = 0;
    dst.clear();
    dst.reserve(std::min(cap, n * 8));
    while (i < n && dst.size() < cap) {
        uint8_t flags = src[i++];
        for (int bit = 0; bit < 8 && i < n && dst.size() < cap; ++bit) {
            const bool literal = lowBitLiteral ? ((flags & 1u) != 0) : ((flags & 1u) == 0);
            flags = (uint8_t)(flags >> 1);
            if (literal) {
                const uint8_t c = src[i++];
                dst.push_back(c);
                ring[(size_t)r] = c;
                r = (r + 1) & (window - 1);
            } else {
                if (i + 1 >= n) return dst.size() > 32;
                const uint8_t a = src[i++];
                const uint8_t b = src[i++];
                int pos = 0;
                int len = 0;
                if (posLowFirst) {
                    pos = a | ((b & 0xF0) << 4);
                    len = (b & 0x0F) + threshold + 1;
                } else {
                    pos = ((a & 0x0F) << 8) | b;
                    len = ((a >> 4) & 0x0F) + threshold + 1;
                }
                pos &= window - 1;
                for (int k = 0; k < len && dst.size() < cap; ++k) {
                    const uint8_t c = ring[(size_t)((pos + k) & (window - 1))];
                    dst.push_back(c);
                    ring[(size_t)r] = c;
                    r = (r + 1) & (window - 1);
                }
            }
        }
    }
    return dst.size() > 32;
}

bool tryUnpackOc31Payload(const uint8_t* payload, size_t payloadN, size_t cap, std::vector<uint8_t>& unpacked) {
    if (lzssInflate(payload, payloadN, unpacked, cap)) return true;
    if (inflateZlibBlock(payload, payloadN, unpacked)) return true;
    const uint8_t fills[] = {0, 0x20};
    const int thresholds[] = {2, 3};
    for (uint8_t fill : fills) {
        for (int threshold : thresholds) {
            for (int lit = 0; lit < 2; ++lit) {
                for (int pos = 0; pos < 2; ++pos) {
                    if (lzssRingInflate(payload, payloadN, unpacked, cap, 4096, 18, threshold, fill, lit != 0, pos != 0))
                        return true;
                }
            }
        }
    }
    unpacked.clear();
    return false;
}

int scaleTick(int tick, int division) {
    if (division <= 0) division = 96;
    return std::max(0, (int)((int64_t)tick * kPpq / division));
}

void splitByMarkers(const std::vector<MidiNote>& notes, std::vector<Marker> markers, std::vector<std::vector<MidiNote>>& out) {
    std::vector<std::pair<int, int>> spans;
    for (const auto& mk : markers) {
        const int sec = markerSection(mk.name);
        if (sec >= 0) spans.push_back({mk.tick, sec});
    }
    if (spans.empty()) {
        if (!notes.empty()) out.push_back(notes);
        return;
    }
    std::sort(spans.begin(), spans.end());
    std::vector<std::vector<MidiNote>> sections(15);
    for (const auto& n : notes) {
        int sec = spans[0].second;
        int start = spans[0].first;
        for (const auto& sp : spans) {
            if (n.tick >= sp.first) {
                sec = sp.second;
                start = sp.first;
            }
        }
        MidiNote c = n;
        c.tick = std::max(0, n.tick - start);
        sections[(size_t)sec].push_back(c);
    }
    out.assign(15, {});
    for (int i = 0; i < 15; ++i) out[(size_t)i] = std::move(sections[(size_t)i]);
}

struct ParsedStyleSmf {
    std::vector<std::vector<MidiNote>> blobs;
    int program[16];
    ParsedStyleSmf() { std::fill(program, program + 16, -1); }
};

void ingestParsedSmf(std::vector<MidiNote> notes, std::vector<Marker> markers, int div, ParsedStyleSmf& out) {
    for (auto& m : notes) {
        m.tick = scaleTick(m.tick, div);
        m.dur = std::max(1, std::min(kPpq * 8, scaleTick(m.dur, div)));
    }
    for (auto& mk : markers) mk.tick = scaleTick(mk.tick, div);
    splitByMarkers(notes, markers, out.blobs);
}

bool tryParseSmfAt(const uint8_t* b, size_t n, size_t offset, ParsedStyleSmf& out, size_t* consumed) {
    std::vector<MidiNote> notes;
    std::vector<Marker> markers;
    int div = 96;
    int programs[16];
    std::fill(programs, programs + 16, -1);
    if (!parseStandardSmf(b, n, offset, notes, &markers, div, programs, consumed)) return false;
    std::copy(programs, programs + 16, out.program);
    ingestParsedSmf(std::move(notes), std::move(markers), div, out);
    return !out.blobs.empty();
}

void collectStyleSmfs(const uint8_t* b, size_t n, std::vector<ParsedStyleSmf>& found) {
    auto pushIf = [&](ParsedStyleSmf&& smf) {
        bool any = false;
        for (const auto& blob : smf.blobs)
            if (!blob.empty()) any = true;
        if (any) found.push_back(std::move(smf));
    };
    auto ingestMthdFrom = [&](const uint8_t* src, size_t srcN) {
        for (size_t i = 0; i + 8 < srcN; ++i) {
            if (src[i] != 'M' || src[i + 1] != 'T' || src[i + 2] != 'h' || src[i + 3] != 'd') continue;
            ParsedStyleSmf smf;
            size_t consumed = 0;
            if (tryParseSmfAt(src, srcN, i, smf, &consumed)) {
                pushIf(std::move(smf));
                i += std::max<size_t>(consumed, 8) - 1;
            }
        }
    };
    ingestMthdFrom(b, n);
    if (!found.empty()) return;
    auto tryPayload = [&](const uint8_t* payload, size_t payloadN, size_t cap) {
        std::vector<uint8_t> unpacked;
        if (!tryUnpackOc31Payload(payload, payloadN, cap, unpacked)) return false;
        ingestMthdFrom(unpacked.data(), unpacked.size());
        return !found.empty();
    };
    for (size_t i = 0; i + 8 < n; ++i) {
        if (std::memcmp(b + i, "OC31", 4) != 0) continue;
        uint32_t cap = ru32le(b + i + 4);
        if (cap < 64 || cap > 8u * 1024u * 1024u) cap = ru32be(b + i + 4);
        if (cap < 64 || cap > 8u * 1024u * 1024u) cap = 1u * 1024u * 1024u;
        const size_t payloads[] = {8, 10, 12, 16};
        for (size_t skip : payloads) {
            if (i + skip >= n) continue;
            if (tryPayload(b + i + skip, n - (i + skip), cap)) return;
        }
    }
    if (!found.empty()) return;
    if (n > 64 && std::memcmp(b, "KORF", 4) == 0) {
        uint32_t indexLen = ru32le(b + 32);
        if (indexLen < 24 || 36 + indexLen > n) indexLen = ru32be(b + 32);
        if (indexLen >= 24 && 36 + indexLen < n) {
            if (tryPayload(b + 36 + indexLen, n - (36 + indexLen), 2u * 1024u * 1024u)) return;
        }
    }
    std::vector<uint8_t> inflated;
    if (inflateZlibBlock(b, n, inflated)) {
        ParsedStyleSmf smf;
        size_t consumed = 0;
        if (tryParseSmfAt(inflated.data(), inflated.size(), 0, smf, &consumed)) pushIf(std::move(smf));
    }
}

void notesToPattern(const std::vector<MidiNote>& notes, Arranger::Pattern& p) {
    p.evs.clear();
    int last = 0;
    const int bar = kPpq * 4;
    for (const MidiNote& m : notes) {
        const int tick = m.tick;
        const int dur = std::max(1, std::min(m.dur, bar * 2));
        last = std::max(last, tick + dur);
        uint8_t flags = kEvTrans;
        uint8_t trk = 2;
        if (m.ch == 9 || m.ch == 10) {
            flags = kEvAbs;
            trk = 0;
        } else if (m.ch == 8 || m.ch == 1) {
            flags = kEvTrans;
            trk = 1;
        } else {
            flags = kEvTrans;
            const int accIndex = m.ch >= 11 ? (m.ch - 11) : (m.ch > 1 ? m.ch - 2 : 0);
            trk = (uint8_t)std::min(3, 2 + accIndex);
        }
        p.evs.push_back({(uint16_t)std::min(tick, 65535), trk, (uint8_t)m.note, (uint8_t)m.vel, (uint16_t)std::min(dur, 65535),
                         flags});
    }
    p.lengthTicks = std::max(bar, ((last + bar - 1) / bar) * bar);
    if (p.lengthTicks > bar * 8) p.lengthTicks = bar * 8;
}

void applyBlobsToStyle(Arranger::Style& s, const std::vector<std::vector<MidiNote>>& blobs) {
    if (blobs.empty()) return;
    if (blobs.size() == 15) {
        Arranger::Pattern* order[] = {&s.intro1, &s.intro2, &s.intro3, &s.var[0], &s.var[1], &s.var[2], &s.var[3],
                                      &s.fill[0], &s.fill[1], &s.fill[2], &s.fill[3], &s.brk, &s.end1, &s.end2, &s.end3};
        for (size_t i = 0; i < 15; ++i) notesToPattern(blobs[i], *order[i]);
        return;
    }
    notesToPattern(blobs[0], s.var[0]);
    for (size_t i = 1; i < blobs.size() && i < 4; ++i) notesToPattern(blobs[i], s.var[i]);
}

void applyPrograms(Arranger::Style& s, int drumProg, int bassProg, int acc1, int acc2, int acc3) {
    applyStylePrograms(s, drumProg, bassProg, acc1, acc2, acc3);
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
    prepareSampledPatch(p, drum);
    p.zones = zones;
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
        z.gain = clampf(dbToGain(clampf((float)kr.level, -12.0f, 12.0f)), 0.25f, 4.0f);
        z.pan = clampf(((float)kr.pan - 64.0f) / 64.0f, -1.0f, 1.0f);
        z.velLow = 0;
        z.velHigh = 127;
        z.sampleIndex = findSample(samples, kr.sampleName);
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
    if (files.empty()) {
        if (report && reportLen > 0) {
            std::snprintf(report, (size_t)reportLen, "{\"ok\":0,\"reason\":\"No files in the import folder\"}");
        }
        return -1;
    }

    std::vector<LoadedSample> loaded;
    int compressed = 0, skipped = 0, patchesAdded = 0, stylesAdded = 0, kmpFiles = 0;
    std::vector<int> kmpPatchIds;
    std::vector<int> drumPatchIds;
    int firstSampled = -1;
    std::string reason;

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
                if (reason.size() < 180) reason += "KSF decode failed (" + fileStem(path) + "). ";
            }
        } else if (ext == ".PCM") {
            std::vector<Sample> found;
            scanPcmBank(path.c_str(), found);
            if (found.empty()) {
                skipped++;
                if (reason.size() < 180) reason += "PCM bank had no SMP1/SMD1 (" + fileStem(path) + "). ";
            }
            for (auto& s : found) addLoaded(std::move(s), path, false);
        }
    }

    for (const auto& path : files) {
        if (upperExt(path) != ".KMP") continue;
        kmpFiles++;
        std::vector<uint8_t> bytes;
        if (!readFileBytes(path.c_str(), bytes)) {
            skipped++;
            continue;
        }
        std::vector<KmpInst> insts;
        parseKmpBytes(bytes.data(), bytes.size(), insts);
        if (insts.empty()) {
            skipped++;
            if (reason.size() < 180) reason += "KMP had no MSP1 regions (" + fileStem(path) + "). ";
            continue;
        }
        for (const auto& inst : insts) {
            auto zones = zonesFromKmp(inst, loaded);
            int mapped = 0;
            for (const auto& z : zones)
                if (z.sampleIndex >= 0) mapped++;
            if (mapped == 0) {
                skipped++;
                if (reason.size() < 180) {
                    reason += "KMP '";
                    reason += inst.name.empty() ? fileStem(path) : inst.name;
                    reason += "' did not match any decoded PCM/KSF. ";
                }
                continue;
            }
            const bool drum = isDrumKmp(inst) || inst.name.find("Kit") != std::string::npos;
            const std::string nm = inst.name.empty() ? fileStem(path) : inst.name;
            Patch p = makeSamplePatch(nm.c_str(), guessCat(nm.c_str(), drum ? "Percussion" : "Imported"), zones, drum);
            p.source = PatchSource::Korg;
            const int id = addSampledInstrument(p);
            kmpPatchIds.push_back(id);
            if (drum) drumPatchIds.push_back(id);
            if (firstSampled < 0) firstSampled = id;
            patchesAdded++;
        }
    }

    if (kmpPatchIds.empty() && kmpFiles == 0 && !loaded.empty()) {
        for (const auto& rec : loaded) {
            Zone z;
            z.sampleIndex = rec.index;
            z.root = 60;
            {
                std::lock_guard<std::mutex> g(loadMu);
                if (rec.index >= 0 && rec.index < (int)samples.size() && samples[(size_t)rec.index].rootNote > 0)
                    z.root = samples[(size_t)rec.index].rootNote;
            }
            Patch p = makeSamplePatch(rec.name.c_str(), "PCM", {z}, false);
            const int id = addSampledInstrument(p);
            if (firstSampled < 0) firstSampled = id;
            patchesAdded++;
        }
    } else if (kmpFiles > 0 && kmpPatchIds.empty()) {
        if (reason.size() < 180) reason += "SET KMP did not resolve to playable instruments. ";
    }

    int pcgFiles = 0;
    int pcgNames = 0;
    std::vector<std::string> pcgMissing;
    for (const auto& path : files) {
        if (upperExt(path) != ".PCG") continue;
        pcgFiles++;
        std::vector<uint8_t> bytes;
        std::vector<std::string> names, missing;
        if (readFileBytes(path.c_str(), bytes)) {
            pcgNames += parsePcgNames(bytes.data(), bytes.size(), names, missing);
            for (const auto& m : missing) {
                bool found = false;
                for (const auto& rec : loaded)
                    if (normName(rec.name.c_str()) == normName(m.c_str()) ||
                        normName(fileStem(rec.file).c_str()) == normName(fileStem(m).c_str()))
                        found = true;
                if (!found) pcgMissing.push_back(m);
            }
            for (const auto& nm : names) {
                bool have = false;
                {
                    std::lock_guard<std::mutex> g(loadMu);
                    for (const auto& p : patches)
                        if (normName(p.name) == normName(nm.c_str())) have = true;
                }
                if (!have && reason.size() < 220) {
                    // Names are preserved for the report; EDS-X synthesis is not reconstructed.
                }
            }
        }
        skipped++;
    }
    if (pcgFiles > 0 && reason.size() < 220) {
        reason += "PCG listed ";
        reason += std::to_string(pcgNames);
        reason += " program names; EDS-X parameters are unpublished, so playable instruments come from KMP/KSF. ";
        if (!pcgMissing.empty()) {
            reason += "Missing refs: ";
            reason += pcgMissing[0];
            reason += ". ";
        }
    }

    int sampledDrum = !drumPatchIds.empty() ? drumPatchIds[0] : -1;
    int sampledBass = -1;
    std::vector<int> sampledAcc;
    int factoryDrum = -1, factoryBass = -1, factoryAcc1 = -1, factoryAcc2 = -1, factoryAcc3 = -1;
    {
        std::lock_guard<std::mutex> g(loadMu);
        for (int i = 0; i < (int)patches.size(); ++i) {
            const Patch& p = patches[(size_t)i];
            if (!p.sampled) {
                if (isKit(p.model) && factoryDrum < 0) factoryDrum = i;
                if (p.bus == BusBass && factoryBass < 0) factoryBass = i;
                if (p.model == Model::Piano && factoryAcc1 < 0) factoryAcc1 = i;
                if (p.model == Model::ConcertStrings && factoryAcc2 < 0) factoryAcc2 = i;
                if (p.model == Model::NylonGuitar && factoryAcc3 < 0) factoryAcc3 = i;
                continue;
            }
            const std::string cat = p.category;
            const std::string nm = normName(p.name);
            const bool drum = cat == "Percussion" || nm.find("kit") != std::string::npos ||
                              nm.find("drum") != std::string::npos;
            const bool bass = cat == "Bass" || nm.find("bass") != std::string::npos;
            if (drum && sampledDrum < 0) sampledDrum = i;
            else if (bass && sampledBass < 0) sampledBass = i;
            else if (!drum) sampledAcc.push_back(i);
        }
    }
    const int drumProg = sampledDrum >= 0 ? sampledDrum : factoryDrum;
    const int bassProg = sampledBass >= 0 ? sampledBass : factoryBass;
    const int acc1 = !sampledAcc.empty() ? sampledAcc[0] : factoryAcc1;
    const int acc2 = sampledAcc.size() > 1 ? sampledAcc[1] : (sampledAcc.empty() ? factoryAcc2 : acc1);
    const int acc3 = sampledAcc.size() > 2 ? sampledAcc[2] : (sampledAcc.empty() ? factoryAcc3 : acc1);

    auto parseKorfNames = [&](const uint8_t* b, size_t n, std::vector<std::string>& names) {
        if (n < 64) return false;
        size_t tag = n;
        for (size_t i = 0; i + 4 <= 48; ++i) {
            if (std::memcmp(b + i, "KORF", 4) == 0) {
                tag = i;
                break;
            }
        }
        if (tag > 40) return false;
        uint32_t indexLen = ru32be(b + 32);
        if (indexLen < 24 || 36 + indexLen > n) indexLen = ru32le(b + 32);
        if (indexLen < 24 || 36 + indexLen > n) return false;
        const int entries = (int)(indexLen / 24);
        for (int e = 0; e < entries; ++e) {
            const uint8_t* row = b + 36 + (size_t)e * 24;
            if (row + 24 > b + n) break;
            const int kind = row[18];
            if (kind != 2 && kind != 0 && kind != 7) continue;
            if (kind == 7) continue;
            const std::string name = readFixed(row, 16);
            if (name.size() >= 3) names.push_back(name);
        }
        return names.size() >= 1;
    };

    auto ingestStyleFile = [&](const std::string& path, const std::string& fileName) {
        std::vector<uint8_t> bytes;
        if (!readFileBytes(path.c_str(), bytes)) {
            skipped++;
            return;
        }
        std::vector<ParsedStyleSmf> smfs;
        collectStyleSmfs(bytes.data(), bytes.size(), smfs);
        if (smfs.empty()) {
            skipped++;
            if (reason.size() < 280) {
                reason += "STY has no standard SMF";
                bool oc31 = false;
                bool korf = bytes.size() >= 4 && std::memcmp(bytes.data(), "KORF", 4) == 0;
                for (size_t i = 0; i + 4 < bytes.size(); ++i) {
                    if (std::memcmp(bytes.data() + i, "OC31", 4) == 0) {
                        oc31 = true;
                        break;
                    }
                }
                if (oc31) reason += " (Korg OC31, no playable MIDI recovered)";
                reason += " (" + fileName + " " + std::to_string(bytes.size()) + "B magic=";
                for (size_t i = 0; i < std::min<size_t>(bytes.size(), 4); ++i) {
                    const char c = (char)bytes[i];
                    reason += (c >= 32 && c < 127) ? c : '.';
                }
                reason += korf && !oc31 ? ", KORF header" : "";
                reason += "). ";
            }
            return;
        }
        std::vector<std::string> korf;
        parseKorfNames(bytes.data(), bytes.size(), korf);
        int addedHere = 0;
        for (size_t i = 0; i < smfs.size(); ++i) {
            Arranger::Style style;
            const std::string name = (i < korf.size()) ? korf[i] : (smfs.size() == 1 ? fileName : fileName + "-" + std::to_string((int)i + 1));
            copyName40(style.name, sizeof(style.name), name);
            copyName40(style.category, sizeof(style.category), "Style");
            applyBlobsToStyle(style, smfs[i].blobs);
            bool hasNotes = !style.var[0].evs.empty();
            for (int v = 1; v < 4 && !hasNotes; ++v) hasNotes = !style.var[v].evs.empty();
            if (!hasNotes) {
                Arranger::Pattern* cands[] = {&style.intro1, &style.intro2, &style.intro3, &style.fill[0], &style.end1,
                                              &style.end2};
                for (Arranger::Pattern* cand : cands) {
                    if (!cand->evs.empty()) {
                        style.var[0] = *cand;
                        hasNotes = true;
                        break;
                    }
                }
            }
            if (!hasNotes) continue;
            applyPrograms(style, drumProg, bassProg, acc1, acc2, acc3);
            addStyle(completeStyle(std::move(style)));
            stylesAdded++;
            addedHere++;
        }
        if (!addedHere) {
            skipped++;
            if (reason.size() < 180) reason += "STY SMF had no playable CV1 notes (" + fileName + "). ";
        }
    };

    auto skipStyleExt = [](const std::string& ext) {
        return ext == ".PCM" || ext == ".KMP" || ext == ".KSF" || ext == ".WAV" || ext == ".AIF" || ext == ".AIFF" ||
               ext == ".PCG" || ext == ".KST" || ext == ".SFZ" || ext == ".SF2" || ext == ".MP3" || ext == ".PNG" ||
               ext == ".JPG" || ext == ".JPEG";
    };
    for (const auto& path : files) {
        const std::string ext = upperExt(path);
        const bool styleExt = ext == ".STY" || ext == ".STG" || ext == ".MID" || ext == ".SMF";
        if (styleExt || ext.empty() || !skipStyleExt(ext)) {
            if (!styleExt && !ext.empty()) {
                std::vector<uint8_t> peek;
                if (!readFileBytes(path.c_str(), peek) || peek.size() < 8) continue;
                bool maybe = std::memcmp(peek.data(), "MThd", 4) == 0 || std::memcmp(peek.data(), "KORF", 4) == 0;
                if (!maybe) {
                    const size_t lim = std::min(peek.size(), (size_t)1024);
                    for (size_t i = 0; i + 4 < lim && !maybe; ++i) {
                        maybe = std::memcmp(peek.data() + i, "OC31", 4) == 0 || std::memcmp(peek.data() + i, "MThd", 4) == 0;
                    }
                }
                if (!maybe) continue;
            }
            ingestStyleFile(path, fileStem(path));
        }
    }

    if (stylesAdded > 0 && firstSampled < 0 && reason.size() < 180) {
        reason += "No SET PCM; style uses factory GM backing. ";
    }

    if (report && reportLen > 0) {
        std::snprintf(report, (size_t)reportLen,
                      "{\"ok\":1,\"samples\":%d,\"patches\":%d,\"styles\":%d,\"compressed\":%d,\"skipped\":%d,"
                      "\"pcgFiles\":%d,\"pcgNames\":%d,\"missing\":%d,\"reason\":\"%s\"}",
                      (int)loaded.size(), patchesAdded, stylesAdded, compressed, skipped, pcgFiles, pcgNames,
                      (int)pcgMissing.size(), jsonSafe(reason).c_str());
    }
    return (int)loaded.size();
}

}  // namespace pa
