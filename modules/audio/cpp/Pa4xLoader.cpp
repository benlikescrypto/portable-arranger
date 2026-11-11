#include "Engine.h"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <dirent.h>
#include <fstream>
#include <map>
#include <mutex>
#include <new>
#include <set>
#include <string>
#include <sys/stat.h>
#include <vector>
#ifdef _WIN32
#include <direct.h>
inline int paMkdir(const char* p) { return _mkdir(p); }
#else
inline int paMkdir(const char* p) { return mkdir(p, 0755); }
#endif
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
constexpr int Z_BUF_ERROR = -5;
constexpr int Z_NO_FLUSH = 0;
constexpr int Z_FINISH = 4;
inline int inflateInit2(z_stream*, int) { return -1; }
inline int inflate(z_stream*, int) { return -1; }
inline int inflateEnd(z_stream*) { return 0; }
#else
#include <zlib.h>
#endif

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
std::string readFixed(const uint8_t* p, int n);

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

void squashSpaces(std::string& s) {
    std::string o;
    o.reserve(s.size());
    bool sp = false;
    for (char c : s) {
        if (c == ' ' || c == '_' || c == '-' || c == '\t') {
            if (!o.empty()) sp = true;
            continue;
        }
        if (sp) {
            o.push_back(' ');
            sp = false;
        }
        o.push_back(c);
    }
    s.swap(o);
}

// Korg EnCVn (Pa4X manual) plus Yamaha SFF part names (documented SMF style files).
int markerSection(const std::string& raw) {
    std::string s = lowerCopy(raw);
    while (!s.empty() && (s.back() == ' ' || s.back() == 0)) s.pop_back();
    squashSpaces(s);
    if (s.find("sff") == 0 || s == "sint" || s == "sdec") return -1;

    if (s.find("main a") != std::string::npos) return 3;
    if (s.find("main b") != std::string::npos) return 4;
    if (s.find("main c") != std::string::npos) return 5;
    if (s.find("main d") != std::string::npos) return 6;
    if (s.find("intro a") != std::string::npos || s == "intro 1" || s.find("intro1") != std::string::npos) return 0;
    if (s.find("intro b") != std::string::npos || s == "intro 2" || s.find("intro2") != std::string::npos) return 1;
    if (s.find("intro c") != std::string::npos || s == "intro 3" || s.find("intro3") != std::string::npos) return 2;
    if (s.find("fill in aa") != std::string::npos || s.find("fill aa") != std::string::npos || s.find("fill in a") != std::string::npos)
        return 7;
    if (s.find("fill in bb") != std::string::npos || s.find("fill bb") != std::string::npos || s.find("fill in b") != std::string::npos)
        return 8;
    if (s.find("fill in cc") != std::string::npos || s.find("fill cc") != std::string::npos || s.find("fill in c") != std::string::npos)
        return 9;
    if (s.find("fill in dd") != std::string::npos || s.find("fill dd") != std::string::npos || s.find("fill in d") != std::string::npos)
        return 10;
    if (s.find("ending a") != std::string::npos || s.find("ending 1") != std::string::npos) return 12;
    if (s.find("ending b") != std::string::npos || s.find("ending 2") != std::string::npos) return 13;
    if (s.find("ending c") != std::string::npos || s.find("ending 3") != std::string::npos) return 14;
    if (s.find("break") != std::string::npos) return 11;

    auto findMark = [&](size_t from) -> size_t {
        for (size_t i = from; i + 4 < s.size(); ++i) {
            const char e = s[i];
            if (e != 'v' && e != 'i' && e != 'f' && e != 'e' && e != 'b') continue;
            if (s[i + 1] < '1' || s[i + 1] > '4') continue;
            if (s[i + 2] != 'c' || s[i + 3] != 'v') continue;
            if (s[i + 4] < '1' || s[i + 4] > '6') continue;
            return i;
        }
        return std::string::npos;
    };
    size_t at = findMark(0);
    char elem = 0;
    int n = 0;
    int cv = 1;
    if (at != std::string::npos) {
        elem = s[at];
        n = s[at + 1] - '0';
        cv = s[at + 4] - '0';
    } else if (s == "brk" || s.find("brv") != std::string::npos) {
        elem = 'b';
        n = 1;
        cv = 1;
    } else {
        return -1;
    }
    if (cv != 1) return -2;
    if (elem == 'i') return std::min(2, n - 1);
    if (elem == 'v') return 2 + n;
    if (elem == 'f') return 6 + n;
    if (elem == 'b') return 11;
    if (elem == 'e') return 11 + n;
    return -1;
}

bool looksLikeStyleMidi(const uint8_t* d, size_t n) {
    if (!d || n < 16) return false;
    auto has = [&](const char* tag) {
        const size_t t = std::strlen(tag);
        if (t == 0 || t > n) return false;
        for (size_t i = 0; i + t <= n; ++i)
            if (std::memcmp(d + i, tag, t) == 0) return true;
        return false;
    };
    return has("MThd") || has("MTrk") || has("v1cv1") || has("i1cv1") || has("f1cv1") || has("SFF1") || has("SFF2") ||
           has("Main A") || has("CASM");
}

void collectEncvnMarkers(const uint8_t* p, size_t n, int tick, std::vector<Marker>* markers) {
    if (!markers || !p || n < 5) return;
    for (size_t i = 0; i + 4 < n; ++i) {
        const char e = (char)p[i];
        if (e != 'v' && e != 'i' && e != 'f' && e != 'e' && e != 'b') continue;
        if (p[i + 1] < '1' || p[i + 1] > '4') continue;
        if (p[i + 2] != 'c' || p[i + 3] != 'v') continue;
        if (p[i + 4] < '1' || p[i + 4] > '6') continue;
        markers->push_back({tick, std::string((const char*)p + i, 5)});
        return;
    }
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
                   int programs[16], int* tempoBpm, int* barTicks = nullptr) {
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
                collectEncvnMarkers(cur, (size_t)len, tick, markers);
            }
            if (tempoBpm && meta == 0x51 && len >= 3) {
                const int us = (cur[0] << 16) | (cur[1] << 8) | cur[2];
                if (us > 0) *tempoBpm = std::max(40, std::min(240, 60000000 / us));
            }
            if (barTicks && meta == 0x58 && len >= 2) {
                const int nn = cur[0];
                const int dd = cur[1];
                const int den = 1 << std::max(0, std::min(6, dd));
                const int ticks = nn * division * 4 / std::max(1, den);
                if (ticks >= kPpq && ticks <= kPpq * 16) *barTicks = ticks;
            }
            cur += len;
            continue;
        }
        if (status == 0xF0 || status == 0xF7) {
            const uint32_t len = readVlq(cur, end);
            if (cur + len > end) break;
            collectEncvnMarkers(cur, (size_t)len, tick, markers);
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
                      int& division, int programs[16], size_t* consumed, int* tempoBpm, int* barTicks = nullptr) {
    if (offset + 14 > n || std::memcmp(b + offset, "MThd", 4) != 0) return false;
    const uint32_t hdrLen = ru32be(b + offset + 4);
    if (hdrLen < 6 || offset + 8 + hdrLen > n) return false;
    const int ntrks = ru16be(b + offset + 10);
    division = ru16be(b + offset + 12);
    if (division & 0x8000) division = 96;
    if (division <= 0) division = 96;
    if (ntrks < 1 || ntrks > 64) return false;
    size_t casm = n;
    for (size_t j = offset + 8 + hdrLen; j + 4 <= n; ++j) {
        if (std::memcmp(b + j, "CASM", 4) == 0) {
            casm = j;
            break;
        }
    }
    size_t i = offset + 8 + hdrLen;
    int parsed = 0;
    while (parsed < ntrks && i + 8 <= n && i < casm) {
        uint32_t sz = ru32be(b + i + 4);
        const size_t maxPay = std::min(casm, n) - (i + 8);
        if (sz > maxPay) sz = (uint32_t)maxPay;
        if (std::memcmp(b + i, "MTrk", 4) == 0) {
            parseSmfTrack(b + i + 8, sz, division, notes, markers, programs, tempoBpm, barTicks);
            parsed++;
        }
        i += 8 + sz;
        if (sz == 0) break;
    }
    if (consumed) *consumed = i - offset;
    return !notes.empty();
}

// Yamaha CASM Ctab/Ctb2: source MIDI channel -> accompaniment dest 9–16 (0-based 8–15).
void applyCasmChannelMap(const uint8_t* b, size_t n, std::vector<MidiNote>& notes, int programs[16]) {
    int map[16];
    for (int c = 0; c < 16; ++c) map[c] = c;
    bool any = false;
    auto walk = [&](const char* tag) {
        const size_t tlen = std::strlen(tag);
        for (size_t i = 0; i + 8 + 10 <= n; ++i) {
            if (std::memcmp(b + i, tag, tlen) != 0) continue;
            const uint32_t sz = ru32be(b + i + 4);
            if (sz < 10 || sz > 512 || i + 8 + sz > n) continue;
            const uint8_t src = b[i + 8];
            const uint8_t dst = b[i + 8 + 9];
            if (src > 15 || dst < 8 || dst > 15) continue;
            map[src] = dst;
            any = true;
        }
    };
    walk("Ctab");
    walk("Ctb2");
    if (!any) return;
    for (auto& m : notes) {
        if (m.ch >= 0 && m.ch < 16) m.ch = map[m.ch];
    }
    if (!programs) return;
    int next[16];
    std::fill(next, next + 16, -1);
    for (int c = 0; c < 16; ++c) {
        if (programs[c] < 0) continue;
        const int d = map[c];
        if (d >= 0 && d < 16) next[d] = programs[c];
    }
    std::copy(next, next + 16, programs);
}

bool containsTag(const uint8_t* b, size_t n, const char* tag) {
    if (!b || !tag) return false;
    const size_t t = std::strlen(tag);
    if (t == 0 || t > n) return false;
    for (size_t i = 0; i + t <= n; ++i)
        if (std::memcmp(b + i, tag, t) == 0) return true;
    return false;
}

void keepStyleChannels(std::vector<MidiNote>& notes, bool yamaha) {
    if (notes.empty()) return;
    bool high = false;
    for (const auto& m : notes)
        if (m.ch >= 8 && m.ch <= 15) high = true;
    if (!high) {
        for (auto& m : notes)
            if (m.ch >= 0 && m.ch < 8) m.ch += 8;
    }
    (void)yamaha;
    std::vector<MidiNote> keep;
    keep.reserve(notes.size());
    for (const auto& m : notes) {
        if (m.ch >= 8 && m.ch <= 15) keep.push_back(m);
    }
    if (!keep.empty()) notes.swap(keep);
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

bool lzwInflate(const uint8_t* src, size_t n, std::vector<uint8_t>& dst, size_t cap, bool lsbFirst, int maxBits) {
    if (n < 2 || maxBits < 9 || maxBits > 16) return false;
    constexpr int CLEAR = 256;
    struct Ent {
        int prev;
        uint8_t ch;
    };
    std::vector<Ent> dict((size_t)(1 << maxBits));
    auto resetDict = [&]() {
        for (int i = 0; i < 256; ++i) {
            dict[(size_t)i].prev = -1;
            dict[(size_t)i].ch = (uint8_t)i;
        }
    };
    resetDict();
    int nextCode = 257;
    int codeBits = 9;
    size_t i = 0;
    uint32_t acc = 0;
    int accBits = 0;
    auto readCode = [&]() -> int {
        while (accBits < codeBits) {
            if (i >= n) return -1;
            if (lsbFirst) {
                acc |= (uint32_t)src[i++] << accBits;
                accBits += 8;
            } else {
                acc = (acc << 8) | src[i++];
                accBits += 8;
            }
        }
        int code = 0;
        if (lsbFirst) {
            code = (int)(acc & ((1u << codeBits) - 1u));
            acc >>= codeBits;
            accBits -= codeBits;
        } else {
            code = (int)((acc >> (accBits - codeBits)) & ((1u << codeBits) - 1u));
            accBits -= codeBits;
        }
        return code;
    };
    auto firstByte = [&](int code) -> int {
        int guard = 0;
        while (code >= 256 && guard++ < 4096) {
            if (code >= nextCode) return -1;
            code = dict[(size_t)code].prev;
        }
        return code;
    };
    auto emit = [&](int code) -> bool {
        uint8_t stack[8192];
        int sp = 0;
        int cur = code;
        int guard = 0;
        while (cur >= 0 && guard++ < 8192) {
            if (cur < 256) {
                stack[sp++] = (uint8_t)cur;
                break;
            }
            if (cur >= nextCode) return false;
            stack[sp++] = dict[(size_t)cur].ch;
            cur = dict[(size_t)cur].prev;
        }
        while (sp > 0) {
            if (dst.size() >= cap) return false;
            dst.push_back(stack[--sp]);
        }
        return true;
    };
    dst.clear();
    dst.reserve(std::min(cap, n * 8));
    int prev = -1;
    for (;;) {
        const int code = readCode();
        if (code < 0) break;
        if (code == CLEAR) {
            resetDict();
            nextCode = 257;
            codeBits = 9;
            prev = -1;
            continue;
        }
        if (code > nextCode) break;
        if (code == nextCode) {
            if (prev < 0) break;
            const int fb = firstByte(prev);
            if (fb < 0 || !emit(prev)) break;
            if (dst.size() < cap) dst.push_back((uint8_t)fb);
        } else if (!emit(code)) {
            break;
        }
        if (prev >= 0 && nextCode < (1 << maxBits)) {
            const int fb = firstByte(code == nextCode ? prev : code);
            if (fb < 0) break;
            dict[(size_t)nextCode].prev = prev;
            dict[(size_t)nextCode].ch = (uint8_t)fb;
            nextCode++;
            if (nextCode >= (1 << codeBits) && codeBits < maxBits) codeBits++;
        }
        prev = code == nextCode ? nextCode - 1 : code;
        if (dst.size() >= cap) break;
    }
    return looksLikeStyleMidi(dst.data(), dst.size());
}

bool tryUnpackOc31Payload(const uint8_t* payload, size_t payloadN, size_t cap, std::vector<uint8_t>& unpacked) {
    auto accept = [&]() { return looksLikeStyleMidi(unpacked.data(), unpacked.size()); };
    if (inflateZlibBlock(payload, payloadN, unpacked) && accept()) return true;
    if (lzssInflate(payload, payloadN, unpacked, cap) && accept()) return true;
    const uint8_t fills[] = {0, 0x20};
    const int thresholds[] = {2, 3};
    for (uint8_t fill : fills) {
        for (int threshold : thresholds) {
            for (int lit = 0; lit < 2; ++lit) {
                for (int pos = 0; pos < 2; ++pos) {
                    if (lzssRingInflate(payload, payloadN, unpacked, cap, 4096, 18, threshold, fill, lit != 0, pos != 0) &&
                        accept())
                        return true;
                }
            }
        }
    }
    const uint8_t* p = payload;
    size_t pn = payloadN;
    if (pn >= 3 && p[0] == 0x1f && p[1] == 0x9d) {
        p += 3;
        pn -= 3;
    }
    const int maxBits[] = {12, 13};
    for (int bits : maxBits) {
        for (int lsb = 0; lsb < 2; ++lsb) {
            for (size_t skip = 0; skip <= 2 && skip < pn; ++skip) {
                if (lzwInflate(p + skip, pn - skip, unpacked, cap, lsb != 0, bits) && accept()) return true;
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
        if (sec >= 0 || sec == -2) spans.push_back({mk.tick, sec});
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
        if (n.tick < spans[0].first) continue;
        if (sec < 0) continue;
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
    int tempo = 0;
    int barTicks = kPpq * 4;
    bool yamaha = false;
    ParsedStyleSmf() { std::fill(program, program + 16, -1); }
};

void ingestParsedSmf(std::vector<MidiNote> notes, std::vector<Marker> markers, int div, ParsedStyleSmf& out) {
    for (auto& m : notes) {
        m.tick = scaleTick(m.tick, div);
        m.dur = std::max(1, std::min(kPpq * 8, scaleTick(m.dur, div)));
    }
    bool korg = false;
    for (auto& mk : markers) {
        mk.tick = scaleTick(mk.tick, div);
        const std::string s = lowerCopy(mk.name);
        if (s.find("v1cv") != std::string::npos || s.find("i1cv") != std::string::npos ||
            s.find("f1cv") != std::string::npos || s.find("e1cv") != std::string::npos)
            korg = true;
        if (s.find("sff") != std::string::npos || s.find("main a") != std::string::npos ||
            s.find("fill in") != std::string::npos || s.find("sint") != std::string::npos)
            out.yamaha = true;
    }
    if (korg) out.yamaha = false;
    keepStyleChannels(notes, out.yamaha);
    splitByMarkers(notes, markers, out.blobs);
}

bool tryParseSmfAt(const uint8_t* b, size_t n, size_t offset, ParsedStyleSmf& out, size_t* consumed) {
    std::vector<MidiNote> notes;
    std::vector<Marker> markers;
    int div = 96;
    int programs[16];
    std::fill(programs, programs + 16, -1);
    if (!parseStandardSmf(b, n, offset, notes, &markers, div, programs, consumed, &out.tempo, &out.barTicks)) return false;
    if (containsTag(b, n, "CASM")) applyCasmChannelMap(b, n, notes, programs);
    std::copy(programs, programs + 16, out.program);
    ingestParsedSmf(std::move(notes), std::move(markers), div, out);
    return !out.blobs.empty();
}

bool korfStyleIndex(const uint8_t* b, size_t n, size_t& dataOff, std::vector<std::string>& names) {
    size_t tag = n;
    for (size_t i = 0; i + 4 <= std::min(n, (size_t)48); ++i) {
        if (std::memcmp(b + i, "KORF", 4) == 0) {
            tag = i;
            break;
        }
    }
    if (tag > 40) return false;
    auto tryLenAt = [&](size_t off, bool be) {
        if (off + 4 > n) return false;
        const uint32_t len = be ? ru32be(b + off) : ru32le(b + off);
        if (len < 24 || (len % 24) != 0) return false;
        if (off + 4 + len > n) return false;
        const int entries = (int)(len / 24);
        if (entries < 1 || entries > 256) return false;
        std::vector<std::string> got;
        for (int e = 0; e < entries; ++e) {
            const uint8_t* row = b + off + 4 + (size_t)e * 24;
            const int kind = row[18];
            if (kind != 2 && kind != 0) continue;
            const std::string name = readFixed(row, 16);
            if (name.size() >= 2) got.push_back(name);
        }
        if (got.empty()) return false;
        dataOff = off + 4 + len;
        names.swap(got);
        return true;
    };
    // RicFreak Pa80/Pa4X: index length at bytes 33–36 (offset 32), KORF at 25–28.
    if (tryLenAt(32, true) || tryLenAt(32, false)) return true;
    if (tryLenAt(tag + 8, true) || tryLenAt(tag + 8, false)) return true;
    return false;
}

void korfKbegStarts(const uint8_t* b, size_t n, std::vector<size_t>& starts) {
    for (size_t i = 0; i + 8 <= n; ++i) {
        if (std::memcmp(b + i, "KBEG", 4) != 0) continue;
        size_t p = i + 4;
        while (p + 4 <= n && starts.size() < 64) {
            if (p + 4 <= n && std::memcmp(b + p, "KEND", 4) == 0) break;
            const uint32_t off = ru32be(b + p);
            if (off >= 8 && off + 16 < n) starts.push_back(off);
            p += 4;
        }
        if (!starts.empty()) return;
    }
}

void collectStyleSmfs(const uint8_t* b, size_t n, std::vector<ParsedStyleSmf>& found, std::vector<std::string>* namesOut) {
    auto pushIf = [&](ParsedStyleSmf&& smf) {
        bool any = false;
        for (const auto& blob : smf.blobs)
            if (!blob.empty()) any = true;
        if (any) found.push_back(std::move(smf));
    };
    auto ingestMthdFrom = [&](const uint8_t* src, size_t srcN) {
        const size_t before = found.size();
        for (size_t i = 0; i + 8 < srcN; ++i) {
            if (src[i] != 'M' || src[i + 1] != 'T' || src[i + 2] != 'h' || src[i + 3] != 'd') continue;
            ParsedStyleSmf smf;
            size_t consumed = 0;
            if (tryParseSmfAt(src, srcN, i, smf, &consumed)) {
                pushIf(std::move(smf));
                i += std::max<size_t>(consumed, 8) - 1;
            }
        }
        return found.size() > before;
    };
    auto ingestRawMidi = [&](const uint8_t* src, size_t srcN) {
        size_t off = 0;
        while (off < 256 && off < srcN && src[off] == (uint8_t)off) off++;
        std::vector<MidiNote> notes;
        std::vector<Marker> markers;
        int programs[16];
        std::fill(programs, programs + 16, -1);
        int tempo = 0;
        parseSmfTrack(src + off, srcN - off, 96, notes, &markers, programs, &tempo);
        if (notes.size() < 12) return false;
        if (containsTag(src, srcN, "CASM")) applyCasmChannelMap(src, srcN, notes, programs);
        ParsedStyleSmf smf;
        smf.tempo = tempo;
        std::copy(programs, programs + 16, smf.program);
        ingestParsedSmf(std::move(notes), std::move(markers), 96, smf);
        pushIf(std::move(smf));
        return true;
    };
    auto scanRegion = [&](const uint8_t* src, size_t srcN) {
        if (ingestMthdFrom(src, srcN)) return true;
        auto tryPayload = [&](const uint8_t* payload, size_t payloadN, size_t cap) {
            std::vector<uint8_t> unpacked;
            if (!tryUnpackOc31Payload(payload, payloadN, cap, unpacked)) return false;
            if (ingestMthdFrom(unpacked.data(), unpacked.size())) return true;
            return ingestRawMidi(unpacked.data(), unpacked.size());
        };
        for (size_t i = 0; i + 8 < srcN; ++i) {
            if (std::memcmp(src + i, "OC31", 4) != 0) continue;
            uint32_t cap = ru32le(src + i + 4);
            if (cap < 64 || cap > 8u * 1024u * 1024u) cap = ru32be(src + i + 4);
            if (cap < 64 || cap > 8u * 1024u * 1024u) cap = 1u * 1024u * 1024u;
            const size_t payloads[] = {8, 10, 12, 16};
            for (size_t skip : payloads) {
                if (i + skip >= srcN) continue;
                if (tryPayload(src + i + skip, srcN - (i + skip), cap)) return true;
            }
        }
        return false;
    };

    std::vector<std::string> korfNames;
    size_t dataOff = 0;
    const bool hasKorf = korfStyleIndex(b, n, dataOff, korfNames);
    if (hasKorf && namesOut) *namesOut = korfNames;
    if (hasKorf && dataOff < n) {
        size_t pos = dataOff;
        while (pos + 16 < n) {
            uint32_t sz = ru32be(b + pos + 4);
            uint32_t total = sz + 8;
            if (total < 24 || pos + total > n) {
                sz = ru32le(b + pos + 4);
                total = sz + 8;
            }
            if (total < 24 || pos + total > n) break;
            if (sz < 48) break;
            const size_t before = found.size();
            scanRegion(b + pos, total);
            if (found.size() == before) scanRegion(b + pos + 8, total - 8);
            pos += total;
        }
        if (!found.empty()) return;
        std::vector<size_t> kbeg;
        korfKbegStarts(b, n, kbeg);
        for (size_t off : kbeg) {
            if (off >= n) continue;
            scanRegion(b + off, n - off);
        }
        if (!found.empty()) return;
        scanRegion(b + dataOff, n - dataOff);
        if (!found.empty()) return;
    }
    scanRegion(b, n);
    if (!found.empty()) return;
    std::vector<uint8_t> inflated;
    if (inflateZlibBlock(b, n, inflated)) ingestMthdFrom(inflated.data(), inflated.size());
}

void notesToPattern(const std::vector<MidiNote>& notes, Arranger::Pattern& p, bool yamaha, int barTicks = 0) {
    p.evs.clear();
    int last = 0;
    const int bar = barTicks >= kPpq ? barTicks : kPpq * 4;
    for (const MidiNote& m : notes) {
        const int tick = m.tick;
        const int dur = std::max(1, std::min(m.dur, bar * 2));
        last = std::max(last, tick + dur);
        uint8_t flags = kEvTrans;
        uint8_t trk = 2;
        if (yamaha) {
            // Yamaha SFF: Rhythm 9–10, Bass 11, Chord/Pad/Phrase 12–16 (1-based).
            if (m.ch == 8 || m.ch == 9) {
                flags = kEvAbs;
                trk = 0;
            } else if (m.ch == 10) {
                flags = kEvTrans;
                trk = 1;
            } else {
                flags = kEvTrans;
                const int accIndex = m.ch >= 11 ? (m.ch - 11) : 0;
                trk = (uint8_t)std::min(4, 2 + accIndex);
            }
        } else if (m.ch == 9 || m.ch == 10) {
            flags = kEvAbs;
            trk = 0;
        } else if (m.ch == 8 || m.ch == 1) {
            flags = kEvTrans;
            trk = 1;
        } else {
            flags = kEvTrans;
            const int accIndex = m.ch >= 11 ? (m.ch - 11) : (m.ch > 1 ? m.ch - 2 : 0);
            trk = (uint8_t)std::min(4, 2 + accIndex);
        }
        p.evs.push_back({(uint16_t)std::min(tick, 65535), trk, (uint8_t)m.note, (uint8_t)m.vel, (uint16_t)std::min(dur, 65535),
                         flags});
    }
    p.lengthTicks = std::max(bar, ((last + bar - 1) / bar) * bar);
    if (p.lengthTicks > bar * 8) p.lengthTicks = bar * 8;
}

void applyBlobsToStyle(Arranger::Style& s, const std::vector<std::vector<MidiNote>>& blobs, bool yamaha, int barTicks = 0) {
    if (blobs.empty()) return;
    if (blobs.size() == 15) {
        Arranger::Pattern* order[] = {&s.intro1, &s.intro2, &s.intro3, &s.var[0], &s.var[1], &s.var[2], &s.var[3],
                                      &s.fill[0], &s.fill[1], &s.fill[2], &s.fill[3], &s.brk, &s.end1, &s.end2, &s.end3};
        for (size_t i = 0; i < 15; ++i) notesToPattern(blobs[i], *order[i], yamaha, barTicks);
    } else {
        notesToPattern(blobs[0], s.var[0], yamaha, barTicks);
        for (size_t i = 1; i < blobs.size() && i < 4; ++i) notesToPattern(blobs[i], s.var[i], yamaha, barTicks);
    }
    if (s.var[0].evs.empty()) {
        for (int i = 1; i < 4; ++i) {
            if (!s.var[i].evs.empty()) {
                s.var[0] = s.var[i];
                break;
            }
        }
    }
    for (int i = 1; i < 4; ++i) {
        if (s.var[i].evs.empty()) s.var[i] = s.var[0];
    }
}

void applyPrograms(Arranger::Style& s, int drumProg, int bassProg, int acc1, int acc2, int acc3) {
    applyStylePrograms(s, drumProg, bassProg, acc1, acc2, acc3);
}

struct LoadedSample {
    int index = -1;
    std::string name;
    std::string file;
    std::string id;
};

int findSample(const std::vector<LoadedSample>& samples, const std::string& key) {
    const std::string want = normName(key.c_str());
    if (want.empty()) return -1;
    for (const auto& s : samples) {
        if (!s.id.empty() && (s.id == key || normName(s.id.c_str()) == want)) return s.index;
        if (normName(s.name.c_str()) == want) return s.index;
        if (normName(s.file.c_str()) == want) return s.index;
        if (s.file.size() >= key.size() && s.file.compare(s.file.size() - key.size(), key.size(), key) == 0) return s.index;
    }
    std::string stem = key;
    auto dot = stem.find('.');
    if (dot != std::string::npos) stem = stem.substr(0, dot);
    const std::string wantStem = normName(stem.c_str());
    for (const auto& s : samples) {
        const std::string fileNm = normName(fileStem(s.file).c_str());
        const std::string sampleNm = normName(s.name.c_str());
        if (fileNm == wantStem || sampleNm == wantStem) return s.index;
        if (wantStem.size() >= 6) {
            if (fileNm.size() >= wantStem.size() && fileNm.compare(0, wantStem.size(), wantStem) == 0) return s.index;
            if (sampleNm.size() >= wantStem.size() && sampleNm.compare(0, wantStem.size(), wantStem) == 0) return s.index;
            if (wantStem.size() >= fileNm.size() && wantStem.compare(0, fileNm.size(), fileNm) == 0 && fileNm.size() >= 6)
                return s.index;
        }
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

bool isGenericBankName(const std::string& name) {
    std::string n = name;
    for (char& c : n) c = (char)std::toupper((unsigned char)c);
    return n == "RAM" || n == "PCM" || n == "SOUND" || n == "STYLE" || n == "PAD" || n == "MULTISMP" ||
           n == "MULTISAMPLE" || n == "SAMPLES";
}

void parseKmpCatalogNames(const uint8_t* b, size_t n, std::vector<std::string>& names) {
    for (size_t i = 0; i + 24 <= n;) {
        if (std::memcmp(b + i, "MSP1", 4) != 0) {
            ++i;
            continue;
        }
        const uint32_t sz = ru32be(b + i + 4);
        if (sz < 18 || i + 8 + sz > n) {
            ++i;
            continue;
        }
        std::string name = readFixed(b + i + 8, 16);
        size_t cursor = i + 8 + sz;
        if (cursor + 8 <= n && std::memcmp(b + cursor, "NAME", 4) == 0) {
            const uint32_t nsz = ru32be(b + cursor + 4);
            if (cursor + 8 + nsz <= n) {
                const std::string longer = readFixed(b + cursor + 8, std::min(24, (int)nsz));
                if (!longer.empty()) name = longer;
                cursor += 8 + nsz;
            }
        }
        if (name.size() >= 2 && !isGenericBankName(name)) names.push_back(name);
        i = std::max(cursor, i + 8);
    }
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
        if (!inst.regions.empty()) out.push_back(std::move(inst));
        i = std::max(cursor, i + 8);
    }
    if (!out.empty()) return;

    std::map<std::string, KmpInst> grouped;
    for (size_t i = 0; i + 32 <= n; ++i) {
        if (b[i] < 32 || b[i] >= 127 || !std::isalpha((unsigned char)b[i])) continue;
        if (i > 0 && (std::isalnum((unsigned char)b[i - 1]) || b[i - 1] == ' ' || b[i - 1] == '-')) continue;
        const std::string name = readFixed(b + i, 16);
        if (name.size() < 4) continue;
        if (name.find("Z110A") != std::string::npos || name.find("v3.") != std::string::npos) continue;
        int letters = 0;
        for (char c : name)
            if (std::isalpha((unsigned char)c)) letters++;
        if (letters < 3) continue;
        const uint8_t* idp = b + i + 16;
        const uint16_t rate = ru16be(idp + 12);
        if (!(rate == 44100 || rate == 48000 || rate == 32000 || rate == 22050)) continue;
        const int root = idp[14] & 0x7F;
        char idHex[17];
        static const char* kHex = "0123456789abcdef";
        for (int k = 0; k < 8; ++k) {
            idHex[k * 2] = kHex[idp[k] >> 4];
            idHex[k * 2 + 1] = kHex[idp[k] & 0x0f];
        }
        idHex[16] = 0;
        KmpRegion z;
        z.original = root;
        z.top = 127;
        z.sampleName = idHex;
        if (name.size() >= 2) {
            const char side = (char)std::toupper((unsigned char)name.back());
            if (name[name.size() - 2] == '-' && side == 'L') z.pan = 16;
            else if (name[name.size() - 2] == '-' && side == 'R') z.pan = 112;
        }
        KmpInst& inst = grouped[name];
        if (inst.name.empty()) inst.name = name;
        inst.regions.push_back(z);
        i += 24;
    }
    for (auto& kv : grouped) {
        auto& inst = kv.second;
        std::sort(inst.regions.begin(), inst.regions.end(),
                  [](const KmpRegion& a, const KmpRegion& b) { return a.original < b.original; });
        for (size_t r = 0; r < inst.regions.size(); ++r) {
            if (r + 1 < inst.regions.size()) {
                const int next = inst.regions[r + 1].original;
                inst.regions[r].top = next > inst.regions[r].original ? next - 1 : inst.regions[r].original;
            } else {
                inst.regions[r].top = 127;
            }
        }
        if (!inst.regions.empty()) out.push_back(std::move(inst));
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

void mkdirParents(const std::string& path) {
    std::string cur;
    for (size_t i = 0; i < path.size(); ++i) {
        const char c = path[i] == '\\' ? '/' : path[i];
        if (c == '/' && !cur.empty() && cur != "/" && cur != ".") paMkdir(cur.c_str());
        cur.push_back(c);
    }
    if (!cur.empty()) paMkdir(cur.c_str());
}

std::string decodedCacheDir(const std::string& root) { return root + "/.arrangerbox-cache"; }

void wr16le(FILE* f, uint16_t v) {
    uint8_t b[2] = {(uint8_t)v, (uint8_t)(v >> 8)};
    std::fwrite(b, 1, 2, f);
}

void wr32le(FILE* f, uint32_t v) {
    uint8_t b[4] = {(uint8_t)v, (uint8_t)(v >> 8), (uint8_t)(v >> 16), (uint8_t)(v >> 24)};
    std::fwrite(b, 1, 4, f);
}

bool writeWav16File(const char* path, const Sample& s) {
    const int ch = std::max(1, s.channels);
    const int frames = s.frames();
    if (frames <= 0) return false;
    const int sr = s.sampleRate > 0 ? s.sampleRate : 44100;
    const uint16_t blockAlign = (uint16_t)(ch * 2);
    const uint32_t byteRate = (uint32_t)sr * blockAlign;
    const uint32_t dataBytes = (uint32_t)frames * blockAlign;
    const uint32_t smplSize = 60;
    FILE* f = std::fopen(path, "wb");
    if (!f) return false;
    std::fwrite("RIFF", 1, 4, f);
    wr32le(f, 4 + (8 + 16) + (8 + smplSize) + (8 + dataBytes));
    std::fwrite("WAVE", 1, 4, f);
    std::fwrite("fmt ", 1, 4, f);
    wr32le(f, 16);
    wr16le(f, 1);
    wr16le(f, (uint16_t)ch);
    wr32le(f, (uint32_t)sr);
    wr32le(f, byteRate);
    wr16le(f, blockAlign);
    wr16le(f, 16);
    std::fwrite("smpl", 1, 4, f);
    wr32le(f, smplSize);
    wr32le(f, 0);
    wr32le(f, 0);
    wr32le(f, 0);
    wr32le(f, (uint32_t)std::max(0, std::min(127, s.rootNote)));
    wr32le(f, 0);
    wr32le(f, 0);
    wr32le(f, 0);
    wr32le(f, s.loop && s.loopEnd > s.loopStart ? 1u : 0u);
    wr32le(f, 0);
    wr32le(f, 0);
    wr32le(f, 0);
    wr32le(f, (uint32_t)std::max(0, s.loopStart));
    wr32le(f, (uint32_t)std::max(s.loopStart, s.loopEnd));
    wr32le(f, 0);
    wr32le(f, 0);
    std::fwrite("data", 1, 4, f);
    wr32le(f, dataBytes);
    for (int i = 0; i < frames; ++i) {
        for (int c = 0; c < ch; ++c) {
            const float x = s.data[(size_t)i * (size_t)ch + (size_t)c];
            int v = (int)std::lrintf(x * 32767.0f);
            if (v > 32767) v = 32767;
            if (v < -32768) v = -32768;
            wr16le(f, (uint16_t)(int16_t)v);
        }
    }
    std::fclose(f);
    return true;
}

bool readCacheLine(std::istream& in, std::string& line) {
    if (!std::getline(in, line)) return false;
    if (!line.empty() && line.back() == '\r') line.pop_back();
    return true;
}

bool decodedCacheReady(const std::string& dir, int* sampleCount, int* patchCount) {
    std::ifstream in(dir + "/manifest.txt");
    if (!in) return false;
    std::string magic, ver;
    in >> magic >> ver;
    if (magic != "ARRANGERBOX_CACHE" || ver != "1") return false;
    std::string tag;
    int nS = 0, nP = 0;
    in >> tag >> nS;
    if (tag != "S" || nS <= 0 || nS > 8000) return false;
    std::string rest;
    readCacheLine(in, rest);
    for (int i = 0; i < nS; ++i) {
        std::string wavName, sampleName, nums;
        if (!readCacheLine(in, wavName) || wavName.empty()) return false;
        if (!readCacheLine(in, sampleName)) return false;
        if (!readCacheLine(in, nums)) return false;
        const std::string wav = dir + "/" + wavName;
        struct stat st {};
        if (stat(wav.c_str(), &st) != 0 || st.st_size < 44) return false;
    }
    in >> tag >> nP;
    if (tag != "P" || nP <= 0 || nP > 8000) return false;
    if (sampleCount) *sampleCount = nS;
    if (patchCount) *patchCount = nP;
    return true;
}

bool peekMagic(const char* path, uint8_t mag[8], size_t* nread) {
    FILE* f = std::fopen(path, "rb");
    if (!f) return false;
    const size_t n = std::fread(mag, 1, 8, f);
    std::fclose(f);
    if (nread) *nread = n;
    return n >= 4;
}

bool looksLikeZipFile(const char* path) {
    uint8_t mag[8]{};
    size_t n = 0;
    return peekMagic(path, mag, &n) && mag[0] == 'P' && mag[1] == 'K';
}

std::string upperPath(std::string s) {
    for (char& c : s) c = (char)std::toupper((unsigned char)c);
    return s;
}

bool pathContainsFolder(const std::string& path, const char* folder) {
    const std::string u = upperPath(path);
    const std::string a = std::string("/") + folder + "/";
    const std::string b = std::string("\\") + folder + "\\";
    return u.find(a) != std::string::npos || u.find(b) != std::string::npos;
}

bool fileHasKorgSampleMagic(const char* path) {
    FILE* f = std::fopen(path, "rb");
    if (!f) return false;
    uint8_t mag[256]{};
    const size_t n = std::fread(mag, 1, sizeof(mag), f);
    std::fclose(f);
    for (size_t i = 0; i + 4 <= n; ++i) {
        if (std::memcmp(mag + i, "SMP1", 4) == 0 || std::memcmp(mag + i, "SMD1", 4) == 0 ||
            std::memcmp(mag + i, "SMP2", 4) == 0 || std::memcmp(mag + i, "SDD1", 4) == 0 ||
            std::memcmp(mag + i, "KORF", 4) == 0)
            return true;
    }
    if (n >= 4 && mag[0] == 0x01 && mag[1] == 0x00 && mag[2] == 0x01 && mag[3] == 0x14) return true;
    return false;
}

bool isPcmBankPath(const std::string& path) {
    const std::string ext = upperExt(path);
    if (ext == ".PCM" || ext == ".KSF") return true;
    if (ext == ".KMP" || ext == ".PCG" || ext == ".STY" || ext == ".STG" || ext == ".MID" || ext == ".SMF" ||
        ext == ".PAD" || ext == ".PRF" || ext == ".WAV" || ext == ".ZIP" || ext == ".SET")
        return false;
    return pathContainsFolder(path, "PCM") || pathContainsFolder(path, "MULTISMP") ||
           fileHasKorgSampleMagic(path.c_str());
}

const char* archiveKind(const char* path) {
    uint8_t mag[8]{};
    size_t n = 0;
    if (!peekMagic(path, mag, &n)) return nullptr;
    if (mag[0] == 'P' && mag[1] == 'K') return "zip";
    if (n >= 6 && mag[0] == '7' && mag[1] == 'z' && mag[2] == 0xBC && mag[3] == 0xAF && mag[4] == 0x27 && mag[5] == 0x1C)
        return "7z";
    if (n >= 4 && mag[0] == 'R' && mag[1] == 'a' && mag[2] == 'r' && mag[3] == '!') return "rar";
    return nullptr;
}

bool inflateRawToFile(const uint8_t* p, size_t n, const std::string& outPath) {
    FILE* o = std::fopen(outPath.c_str(), "wb");
    if (!o) return false;
    z_stream st{};
    if (inflateInit2(&st, -15) != Z_OK) {
        std::fclose(o);
        return false;
    }
    std::vector<uint8_t> buf(1u << 16);
    st.next_in = const_cast<Bytef*>(p);
    st.avail_in = (uInt)n;
    int err = Z_OK;
    while (err != Z_STREAM_END) {
        st.next_out = buf.data();
        st.avail_out = (uInt)buf.size();
        err = inflate(&st, Z_NO_FLUSH);
        const size_t got = buf.size() - (size_t)st.avail_out;
        if (got && std::fwrite(buf.data(), 1, got, o) != got) {
            inflateEnd(&st);
            std::fclose(o);
            return false;
        }
        if (err == Z_STREAM_END) break;
        if (err != Z_OK && err != Z_BUF_ERROR) {
            inflateEnd(&st);
            std::fclose(o);
            return false;
        }
        if (st.avail_in == 0) break;
    }
    inflateEnd(&st);
    std::fclose(o);
    return true;
}

bool extractZipArchive(const char* zipPath, const std::string& destDir, int& wrote, std::string& reason) {
    wrote = 0;
    FILE* f = std::fopen(zipPath, "rb");
    if (!f) return false;
    std::fseek(f, 0, SEEK_END);
    const long sz = std::ftell(f);
    if (sz < 22) {
        std::fclose(f);
        return false;
    }
    const long tailN = sz < 128000 ? sz : 128000;
    std::vector<uint8_t> tail((size_t)tailN);
    std::fseek(f, sz - tailN, SEEK_SET);
    if (std::fread(tail.data(), 1, tail.size(), f) != tail.size()) {
        std::fclose(f);
        return false;
    }
    int eocd = -1;
    for (int i = (int)tail.size() - 22; i >= 0; --i) {
        if (tail[(size_t)i] == 'P' && tail[(size_t)i + 1] == 'K' && tail[(size_t)i + 2] == 5 && tail[(size_t)i + 3] == 6) {
            eocd = i;
            break;
        }
    }
    if (eocd < 0) {
        std::fclose(f);
        return false;
    }
    const uint8_t* e = tail.data() + (size_t)eocd;
    uint64_t nrec = (uint16_t)(e[10] | (e[11] << 8));
    uint64_t cdsz = (uint32_t)(e[12] | (e[13] << 8) | (e[14] << 16) | (e[15] << 24));
    uint64_t cdoff = (uint32_t)(e[16] | (e[17] << 8) | (e[18] << 16) | (e[19] << 24));
    if (nrec == 0xffff || cdsz == 0xffffffffu || cdoff == 0xffffffffu) {
        int loc = -1;
        for (int i = eocd - 20; i >= 0; --i) {
            if (tail[(size_t)i] == 'P' && tail[(size_t)i + 1] == 'K' && tail[(size_t)i + 2] == 6 &&
                tail[(size_t)i + 3] == 7) {
                loc = i;
                break;
            }
        }
        if (loc < 0) {
            std::fclose(f);
            reason += "Zip64 SET locator missing. Unzip on a computer, then Import the .SET folder. ";
            return false;
        }
        uint64_t z64off = 0;
        std::memcpy(&z64off, tail.data() + (size_t)loc + 8, 8);
        uint8_t z64[56];
        std::fseek(f, (long)z64off, SEEK_SET);
        if (std::fread(z64, 1, 56, f) != 56 || std::memcmp(z64, "PK\x06\x06", 4) != 0) {
            std::fclose(f);
            reason += "Zip64 SET header unreadable. Unzip on a computer, then Import the .SET folder. ";
            return false;
        }
        std::memcpy(&nrec, z64 + 32, 8);
        std::memcpy(&cdsz, z64 + 40, 8);
        std::memcpy(&cdoff, z64 + 48, 8);
    }
    if (nrec > 200000 || cdsz > (uint64_t)sz) {
        std::fclose(f);
        return false;
    }
    std::vector<uint8_t> cd((size_t)cdsz);
    std::fseek(f, (long)cdoff, SEEK_SET);
    if (cdsz && std::fread(cd.data(), 1, (size_t)cdsz, f) != cdsz) {
        std::fclose(f);
        return false;
    }
    mkdirParents(destDir);
    size_t p = 0;
    for (uint64_t rec = 0; rec < nrec && p + 46 <= cd.size(); ++rec) {
        if (std::memcmp(cd.data() + p, "PK\x01\x02", 4) != 0) break;
        const uint16_t method = (uint16_t)(cd[p + 10] | (cd[p + 11] << 8));
        uint32_t csz =
            (uint32_t)(cd[p + 20] | (cd[p + 21] << 8) | (cd[p + 22] << 16) | (cd[p + 23] << 24));
        const uint16_t namelen = (uint16_t)(cd[p + 28] | (cd[p + 29] << 8));
        const uint16_t extra = (uint16_t)(cd[p + 30] | (cd[p + 31] << 8));
        const uint16_t comm = (uint16_t)(cd[p + 32] | (cd[p + 33] << 8));
        uint32_t localOff =
            (uint32_t)(cd[p + 42] | (cd[p + 43] << 8) | (cd[p + 44] << 16) | (cd[p + 45] << 24));
        if (p + 46 + namelen > cd.size()) break;
        std::string name((const char*)cd.data() + p + 46, namelen);
        p += 46 + namelen + extra + comm;
        if (name.find("..") != std::string::npos || name.find("__MACOSX") != std::string::npos) continue;
        if (name.empty() || name.back() == '/' || name.back() == '\\') continue;
        uint8_t lh[30];
        std::fseek(f, (long)localOff, SEEK_SET);
        if (std::fread(lh, 1, 30, f) != 30) continue;
        const uint16_t lname = (uint16_t)(lh[26] | (lh[27] << 8));
        const uint16_t lextra = (uint16_t)(lh[28] | (lh[29] << 8));
        const uint32_t lcsz =
            (uint32_t)(lh[18] | (lh[19] << 8) | (lh[20] << 16) | (lh[21] << 24));
        if (csz == 0 && lcsz > 0) csz = lcsz;
        std::fseek(f, (long)localOff + 30 + lname + lextra, SEEK_SET);
        std::vector<uint8_t> payload(csz);
        if (csz && std::fread(payload.data(), 1, csz, f) != csz) continue;
        std::string outPath = destDir + "/";
        for (char c : name) outPath.push_back(c == '\\' ? '/' : c);
        const auto slash = outPath.find_last_of('/');
        if (slash != std::string::npos) mkdirParents(outPath.substr(0, slash));
        bool ok = false;
        if (method == 0) {
            FILE* o = std::fopen(outPath.c_str(), "wb");
            if (o) {
                if (!csz || std::fwrite(payload.data(), 1, csz, o) == csz) ok = true;
                std::fclose(o);
            }
        } else if (method == 8) {
            ok = inflateRawToFile(payload.data(), payload.size(), outPath);
        }
        if (ok) wrote++;
    }
    std::fclose(f);
    return wrote > 0;
}

}  // namespace

int Engine::loadPa4xSet(const char* folder, char* report, int reportLen) {
    return loadPa4xNamed(folder, "", "", report, reportLen);
}

int Engine::loadPa4xNamed(const char* folder, const char* kind, const char* name, char* report, int reportLen) {
    if (report && reportLen > 0) report[0] = 0;
    if (!folder || !folder[0]) return -1;

    const std::string wantKind = kind && kind[0] ? std::string(kind) : std::string();
    const std::string wantName = name && name[0] ? std::string(name) : std::string();
    const bool named = !wantName.empty();
    auto matchesWant = [&](const std::string& n) {
        if (!named) return true;
        return normName(n.c_str()) == normName(wantName.c_str());
    };
    auto kindIs = [&](const char* k) {
        if (wantKind.empty()) return true;
        return normName(wantKind.c_str()) == normName(k);
    };
    const bool wantSound = !named || kindIs("sound");
    const bool wantStyle = !named || kindIs("style");
    const bool wantPad = named && kindIs("pad");
    int lastEngineId = -1;

    std::vector<std::string> files;
    std::string reason;
    std::string root = folder;
    struct stat rootSt {};
    const bool rootIsFile = stat(folder, &rootSt) == 0 && S_ISREG(rootSt.st_mode);
    auto collect = [&](const std::string& dir) {
        files.clear();
        walkFiles(dir, files);
    };
    if (rootIsFile) {
        const char* kind = archiveKind(folder);
        if (kind && std::strcmp(kind, "zip") != 0) {
            if (report && reportLen > 0) {
                std::snprintf(report, (size_t)reportLen,
                              "{\"ok\":0,\"reason\":\"This SET is a %s archive. Unzip it on a computer, then Import the "
                              ".SET folder (SOUND / PCM / STYLE).\"}",
                              kind);
            }
            return -1;
        }
        if (kind && std::strcmp(kind, "zip") == 0) {
            const std::string unpacked = std::string(folder) + "_unpacked";
            int wrote = 0;
            if (!extractZipArchive(folder, unpacked, wrote, reason)) {
                if (report && reportLen > 0) {
                    std::snprintf(report, (size_t)reportLen,
                                  "{\"ok\":0,\"reason\":\"Could not unzip the SET file. %s\"}", jsonSafe(reason).c_str());
                }
                return -1;
            }
            reason += "Unzipped " + std::to_string(wrote) + " files. ";
            root = unpacked;
            collect(root);
        } else {
            files.push_back(folder);
        }
    } else {
        collect(root);
        auto hasSampleFiles = [&]() {
            for (const auto& path : files) {
                const std::string ext = upperExt(path);
                if (ext == ".KMP" || ext == ".KSF" || ext == ".PCM" || ext == ".WAV" || isPcmBankPath(path))
                    return true;
            }
            return false;
        };
        if (!hasSampleFiles()) {
            std::vector<std::string> archives = files;
            for (const auto& path : archives) {
                if (!looksLikeZipFile(path.c_str())) continue;
                const std::string unpacked = path + "_unpacked";
                int wrote = 0;
                if (extractZipArchive(path.c_str(), unpacked, wrote, reason) && wrote > 0) {
                    reason += "Unzipped " + std::to_string(wrote) + " files. ";
                    collect(unpacked);
                    if (hasSampleFiles()) break;
                }
            }
        }
    }
    auto styleScore = [](const std::string& path) {
        const std::string ext = upperExt(path);
        std::string u = path;
        for (char& c : u) c = (char)std::toupper((unsigned char)c);
        int s = 0;
        if (u.find("/STYLE/") != std::string::npos || u.find("\\STYLE\\") != std::string::npos) s += 100;
        if (ext == ".MID" || ext == ".SMF") s += 50;
        else if (ext == ".STY") s += 40;
        return s;
    };
    std::stable_sort(files.begin(), files.end(),
                     [&](const std::string& a, const std::string& b) { return styleScore(a) > styleScore(b); });
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
    size_t sampleBytes = 0;
    constexpr size_t kMaxSampleBytes = 220ull * 1024ull * 1024ull;

    auto addLoaded = [&](Sample&& s, const std::string& path, bool wasCompressed) {
        const size_t add = s.data.size() * sizeof(float);
        if (sampleBytes + add > kMaxSampleBytes) {
            skipped++;
            if (reason.find("memory") == std::string::npos)
                reason += "Stopped loading PCM (phone memory). ";
            return -1;
        }
        LoadedSample rec;
        rec.name = s.name[0] ? s.name : fileStem(path);
        rec.file = baseName(path);
        rec.id = s.sourceId;
        rec.index = addSample(std::move(s));
        loaded.push_back(rec);
        sampleBytes += add;
        if (wasCompressed) compressed++;
        return rec.index;
    };

    const std::string cacheDir = rootIsFile ? std::string() : decodedCacheDir(root);
    bool usedCache = false;
    std::vector<int> addedPatchIds;
    auto rememberPatch = [&](int id, bool drum) {
        addedPatchIds.push_back(id);
        kmpPatchIds.push_back(id);
        if (drum) drumPatchIds.push_back(id);
        if (firstSampled < 0) firstSampled = id;
        lastEngineId = id;
        patchesAdded++;
    };

    auto loadDecodedCache = [&]() -> bool {
        int wantS = 0, wantP = 0;
        if (cacheDir.empty() || !decodedCacheReady(cacheDir, &wantS, &wantP)) return false;
        std::ifstream in(cacheDir + "/manifest.txt");
        if (!in) return false;
        std::string magic, ver, tag, rest;
        in >> magic >> ver >> tag >> wantS;
        if (!readCacheLine(in, rest)) return false;
        std::vector<Sample> pending;
        std::vector<std::string> pendingNames;
        pending.reserve((size_t)wantS);
        for (int i = 0; i < wantS; ++i) {
            std::string wavName, sampleName, nums;
            if (!readCacheLine(in, wavName) || !readCacheLine(in, sampleName) || !readCacheLine(in, nums)) return false;
            Sample s;
            if (loadWav((cacheDir + "/" + wavName).c_str(), s) <= 0) return false;
            copyName40(s.name, sizeof(s.name), sampleName);
            int sr = 0, ch = 0, rootNote = 60, loopS = 0, loopE = 0, loopOn = 0;
            std::sscanf(nums.c_str(), "%d %d %d %d %d %d", &sr, &ch, &rootNote, &loopS, &loopE, &loopOn);
            if (sr > 0) s.sampleRate = sr;
            if (ch > 0) s.channels = ch;
            if (rootNote > 0) s.rootNote = rootNote;
            if (loopOn) {
                s.loop = true;
                s.loopStart = loopS;
                s.loopEnd = loopE > loopS ? loopE : s.frames();
            }
            pending.push_back(std::move(s));
            pendingNames.push_back(sampleName.empty() ? wavName : sampleName);
        }
        if ((int)pending.size() != wantS) return false;
        in >> tag >> wantP;
        if (tag != "P" || wantP <= 0) return false;
        if (!readCacheLine(in, rest)) return false;
        struct PendingPatch {
            std::string name;
            std::string cat;
            int drum = 0;
            std::vector<Zone> zones;
        };
        std::vector<PendingPatch> pendingPatches;
        for (int i = 0; i < wantP; ++i) {
            PendingPatch inst;
            if (!readCacheLine(in, inst.name) || !readCacheLine(in, inst.cat)) return false;
            int nZ = 0;
            in >> inst.drum >> nZ;
            if (!readCacheLine(in, rest)) return false;
            if (nZ < 0 || nZ > 512) return false;
            for (int z = 0; z < nZ; ++z) {
                int sampleIdx = -1, keyLow = 0, keyHigh = 127, velLow = 0, velHigh = 127, rootNote = 60;
                int offset = 0, end = 0, loopS = -1, loopE = -1, loopMode = -1;
                float tune = 0, gain = 1, pan = 0;
                in >> sampleIdx >> keyLow >> keyHigh >> velLow >> velHigh >> rootNote >> tune >> gain >> pan >> offset >>
                    end >> loopS >> loopE >> loopMode;
                if (!readCacheLine(in, rest)) return false;
                if (sampleIdx < 0 || sampleIdx >= wantS) continue;
                Zone zone;
                zone.sampleIndex = sampleIdx;
                zone.keyLow = keyLow;
                zone.keyHigh = keyHigh;
                zone.velLow = velLow;
                zone.velHigh = velHigh;
                zone.root = rootNote;
                zone.tuneCents = tune;
                zone.gain = gain;
                zone.pan = pan;
                zone.offset = offset;
                zone.end = end;
                zone.loopStart = loopS;
                zone.loopEnd = loopE;
                zone.loopMode = loopMode;
                inst.zones.push_back(zone);
            }
            if (!inst.zones.empty()) pendingPatches.push_back(std::move(inst));
        }
        if (pendingPatches.empty()) return false;
        std::vector<int> cacheToEngine((size_t)wantS, -1);
        for (int i = 0; i < wantS; ++i) {
            cacheToEngine[(size_t)i] = addLoaded(std::move(pending[(size_t)i]), pendingNames[(size_t)i], false);
        }
        for (auto& inst : pendingPatches) {
            std::vector<Zone> zones;
            for (Zone z : inst.zones) {
                if (z.sampleIndex < 0 || z.sampleIndex >= wantS || cacheToEngine[(size_t)z.sampleIndex] < 0) continue;
                z.sampleIndex = cacheToEngine[(size_t)z.sampleIndex];
                zones.push_back(z);
            }
            if (zones.empty()) continue;
            Patch p = makeSamplePatch(inst.name.c_str(),
                                      guessCat(inst.name.c_str(), inst.cat.empty() ? "Imported" : inst.cat.c_str()), zones,
                                      inst.drum != 0);
            p.source = PatchSource::Korg;
            rememberPatch(addSampledInstrument(p), inst.drum != 0);
        }
        if (loaded.empty()) return false;
        reason += "Loaded converted sounds (skipped SET decode). ";
        return true;
    };

    auto loadDecodedCacheNamed = [&]() -> bool {
        int wantS = 0, wantP = 0;
        if (!named || !wantSound || cacheDir.empty() || !decodedCacheReady(cacheDir, &wantS, &wantP)) return false;
        std::ifstream in(cacheDir + "/manifest.txt");
        if (!in) return false;
        std::string magic, ver, tag, rest;
        in >> magic >> ver >> tag >> wantS;
        if (!readCacheLine(in, rest)) return false;
        struct CacheSample {
            std::string wavName;
            std::string sampleName;
            int sr = 0, ch = 0, rootNote = 60, loopS = 0, loopE = 0, loopOn = 0;
        };
        std::vector<CacheSample> cacheSamples;
        cacheSamples.reserve((size_t)wantS);
        for (int i = 0; i < wantS; ++i) {
            CacheSample s;
            std::string nums;
            if (!readCacheLine(in, s.wavName) || !readCacheLine(in, s.sampleName) || !readCacheLine(in, nums)) return false;
            std::sscanf(nums.c_str(), "%d %d %d %d %d %d", &s.sr, &s.ch, &s.rootNote, &s.loopS, &s.loopE, &s.loopOn);
            cacheSamples.push_back(std::move(s));
        }
        if ((int)cacheSamples.size() != wantS) return false;
        in >> tag >> wantP;
        if (tag != "P" || wantP <= 0) return false;
        if (!readCacheLine(in, rest)) return false;
        bool found = false;
        for (int i = 0; i < wantP; ++i) {
            std::string instName, cat;
            int drum = 0, nZ = 0;
            if (!readCacheLine(in, instName) || !readCacheLine(in, cat)) return false;
            in >> drum >> nZ;
            if (!readCacheLine(in, rest)) return false;
            if (nZ < 0 || nZ > 512) return false;
            std::vector<Zone> zones;
            std::vector<int> sampleIdx;
            for (int z = 0; z < nZ; ++z) {
                int si = -1, keyLow = 0, keyHigh = 127, velLow = 0, velHigh = 127, rootNote = 60;
                int offset = 0, end = 0, loopS = -1, loopE = -1, loopMode = -1;
                float tune = 0, gain = 1, pan = 0;
                in >> si >> keyLow >> keyHigh >> velLow >> velHigh >> rootNote >> tune >> gain >> pan >> offset >> end >>
                    loopS >> loopE >> loopMode;
                if (!readCacheLine(in, rest)) return false;
                Zone zone;
                zone.sampleIndex = si;
                zone.keyLow = keyLow;
                zone.keyHigh = keyHigh;
                zone.velLow = velLow;
                zone.velHigh = velHigh;
                zone.root = rootNote;
                zone.tuneCents = tune;
                zone.gain = gain;
                zone.pan = pan;
                zone.offset = offset;
                zone.end = end;
                zone.loopStart = loopS;
                zone.loopEnd = loopE;
                zone.loopMode = loopMode;
                zones.push_back(zone);
                sampleIdx.push_back(si);
            }
            if (found || !matchesWant(instName)) continue;
            std::map<int, int> cacheToEngine;
            for (int si : sampleIdx) {
                if (si < 0 || si >= wantS || cacheToEngine.count(si)) continue;
                const CacheSample& cs = cacheSamples[(size_t)si];
                Sample s;
                if (loadWav((cacheDir + "/" + cs.wavName).c_str(), s) <= 0) continue;
                copyName40(s.name, sizeof(s.name), cs.sampleName);
                if (cs.sr > 0) s.sampleRate = cs.sr;
                if (cs.ch > 0) s.channels = cs.ch;
                if (cs.rootNote > 0) s.rootNote = cs.rootNote;
                if (cs.loopOn) {
                    s.loop = true;
                    s.loopStart = cs.loopS;
                    s.loopEnd = cs.loopE > cs.loopS ? cs.loopE : s.frames();
                }
                cacheToEngine[si] = addLoaded(std::move(s), cs.sampleName, false);
            }
            std::vector<Zone> mapped;
            for (Zone z : zones) {
                auto it = cacheToEngine.find(z.sampleIndex);
                if (it == cacheToEngine.end() || it->second < 0) continue;
                z.sampleIndex = it->second;
                mapped.push_back(z);
            }
            if (mapped.empty()) continue;
            Patch p = makeSamplePatch(instName.c_str(), guessCat(instName.c_str(), cat.empty() ? "Imported" : cat.c_str()),
                                      mapped, drum != 0);
            p.source = PatchSource::Korg;
            rememberPatch(addSampledInstrument(p), drum != 0);
            found = true;
        }
        if (!found || loaded.empty()) return false;
        reason += "Loaded one converted sound. ";
        return true;
    };

    auto writeDecodedCache = [&]() {
        if (cacheDir.empty() || loaded.empty() || addedPatchIds.empty()) return;
        mkdirParents(cacheDir);
        std::map<int, int> engineToCache;
        for (int i = 0; i < (int)loaded.size(); ++i) {
            if (loaded[(size_t)i].index >= 0) engineToCache[loaded[(size_t)i].index] = i;
        }
        for (int i = 0; i < (int)loaded.size(); ++i) {
            char wavName[32];
            std::snprintf(wavName, sizeof(wavName), "s%04d.wav", i);
            const std::string wavPath = cacheDir + "/" + wavName;
            std::lock_guard<std::mutex> g(loadMu);
            if (loaded[(size_t)i].index < 0 || loaded[(size_t)i].index >= (int)samples.size()) continue;
            writeWav16File(wavPath.c_str(), samples[(size_t)loaded[(size_t)i].index]);
        }
        FILE* mf = std::fopen((cacheDir + "/manifest.txt").c_str(), "wb");
        if (!mf) return;
        std::fprintf(mf, "ARRANGERBOX_CACHE 1\nS %d\n", (int)loaded.size());
        for (int i = 0; i < (int)loaded.size(); ++i) {
            char wavName[32];
            std::snprintf(wavName, sizeof(wavName), "s%04d.wav", i);
            int sr = 44100, ch = 1, rootNote = 60, loopS = 0, loopE = 0, loopOn = 0;
            {
                std::lock_guard<std::mutex> g(loadMu);
                if (loaded[(size_t)i].index >= 0 && loaded[(size_t)i].index < (int)samples.size()) {
                    const Sample& s = samples[(size_t)loaded[(size_t)i].index];
                    sr = s.sampleRate;
                    ch = s.channels;
                    rootNote = s.rootNote;
                    loopS = s.loopStart;
                    loopE = s.loopEnd;
                    loopOn = s.loop ? 1 : 0;
                }
            }
            std::string nm = loaded[(size_t)i].name;
            for (char& c : nm)
                if (c == '\n' || c == '\r') c = ' ';
            std::fprintf(mf, "%s\n%s\n%d %d %d %d %d %d\n", wavName, nm.c_str(), sr, ch, rootNote, loopS, loopE, loopOn);
        }
        std::fprintf(mf, "P %d\n", (int)addedPatchIds.size());
        for (int id : addedPatchIds) {
            std::string name, cat;
            int drum = 0, nZ = 0;
            std::vector<Zone> zones;
            {
                std::lock_guard<std::mutex> g(loadMu);
                if (id < 0 || id >= (int)patches.size()) continue;
                const Patch& p = patches[(size_t)id];
                name = p.name;
                cat = p.category;
                drum = isKit(p.model) ? 1 : 0;
                zones = p.zones;
                nZ = (int)zones.size();
            }
            for (char& c : name)
                if (c == '\n' || c == '\r') c = ' ';
            for (char& c : cat)
                if (c == '\n' || c == '\r') c = ' ';
            std::fprintf(mf, "%s\n%s\n%d\n%d\n", name.c_str(), cat.c_str(), drum, nZ);
            for (const Zone& z : zones) {
                auto it = engineToCache.find(z.sampleIndex);
                const int sampleIdx = it == engineToCache.end() ? -1 : it->second;
                std::fprintf(mf, "%d %d %d %d %d %d %.6f %.6f %.6f %d %d %d %d %d\n", sampleIdx, z.keyLow, z.keyHigh,
                             z.velLow, z.velHigh, z.root, z.tuneCents, z.gain, z.pan, z.offset, z.end, z.loopStart,
                             z.loopEnd, z.loopMode);
            }
        }
        std::fclose(mf);
    };

    try {
    usedCache = named && wantSound ? loadDecodedCacheNamed() : (!named ? loadDecodedCache() : false);
    bool ramFull = false;
    std::set<std::string> neededSampleKeys;
    if (!usedCache && named && wantSound) {
        for (const auto& path : files) {
            if (upperExt(path) != ".KMP") continue;
            std::vector<uint8_t> bytes;
            if (!readFileBytes(path.c_str(), bytes)) continue;
            std::vector<KmpInst> insts;
            parseKmpBytes(bytes.data(), bytes.size(), insts);
            for (const auto& inst : insts) {
                if (!matchesWant(inst.name) && !matchesWant(fileStem(path))) continue;
                for (const auto& r : inst.regions) {
                    const std::string key = normName(r.sampleName.c_str());
                    if (!key.empty()) neededSampleKeys.insert(key);
                }
            }
        }
    }
    auto sampleWanted = [&](const Sample& s, const std::string& from) {
        if (!named || !wantSound) return true;
        if (neededSampleKeys.empty()) return matchesWant(s.name) || matchesWant(fileStem(from)) || matchesWant(s.sourceId);
        const std::string keys[] = {normName(s.name), normName(s.sourceId.c_str()), normName(fileStem(from).c_str()),
                                    normName(baseName(from).c_str())};
        for (const auto& key : keys) {
            if (!key.empty() && neededSampleKeys.count(key)) return true;
        }
        return matchesWant(s.name);
    };
    auto fileMaybeWanted = [&](const std::string& path) {
        if (!named || !wantSound) return true;
        if (neededSampleKeys.empty()) return false;
        const std::string keys[] = {normName(fileStem(path).c_str()), normName(baseName(path).c_str())};
        for (const auto& key : keys) {
            if (!key.empty() && neededSampleKeys.count(key)) return true;
            for (const auto& need : neededSampleKeys)
                if (!need.empty() && key.find(need) != std::string::npos) return true;
        }
        return false;
    };
    if (!usedCache && wantSound && !(named && neededSampleKeys.empty()))
    for (const auto& path : files) {
        if (ramFull) break;
        const std::string ext = upperExt(path);
        auto takeSamples = [&](std::vector<Sample>& found, const std::string& from, bool compressed) {
            for (auto& s : found) {
                if (!sampleWanted(s, from)) continue;
                if (addLoaded(std::move(s), from, compressed) < 0) {
                    ramFull = true;
                    return;
                }
            }
        };
        if (ext == ".WAV") {
            if (!fileMaybeWanted(path)) continue;
            Sample s;
            if (loadWav(path.c_str(), s) > 0) {
                copyName40(s.name, sizeof(s.name), fileStem(path));
                if (!sampleWanted(s, path)) continue;
                if (addLoaded(std::move(s), path, false) < 0) ramFull = true;
            } else {
                skipped++;
            }
        } else if (ext == ".KSF" || ext == ".KSC") {
            if (!fileMaybeWanted(path)) continue;
            Sample s;
            bool comp = false;
            std::vector<uint8_t> bytes;
            if (readFileBytes(path.c_str(), bytes) && loadKsfBytes(bytes.data(), bytes.size(), s, &comp) > 0) {
                if (!s.name[0]) copyName40(s.name, sizeof(s.name), fileStem(path));
                if (!sampleWanted(s, path)) continue;
                if (addLoaded(std::move(s), path, comp) < 0) ramFull = true;
            } else if (ext == ".KSF") {
                std::vector<Sample> found;
                scanPcmBank(path.c_str(), found);
                if (found.empty()) {
                    skipped++;
                    if (reason.size() < 180) reason += "KSF decode failed (" + fileStem(path) + "). ";
                }
                takeSamples(found, path, false);
            }
        } else if (ext == ".PCM" || isPcmBankPath(path)) {
            if (named && wantSound) continue;
            std::vector<Sample> found;
            scanPcmBank(path.c_str(), found);
            if (found.empty()) {
                skipped++;
                if (reason.size() < 220) reason += "PCM bank had no playable samples (" + fileStem(path) + "). ";
            }
            takeSamples(found, path, false);
        }
    }

    if (!usedCache && wantSound)
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
            if (named && !matchesWant(inst.name) && !matchesWant(fileStem(path))) continue;
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
            rememberPatch(addSampledInstrument(p), drum);
        }
    }

    if (!usedCache && named) {
        // One-at-a-time loads must not overwrite a full converted-sound cache.
    } else if (!usedCache) writeDecodedCache();

    if (!usedCache && kmpPatchIds.empty() && !loaded.empty() && wantSound) {
        for (const auto& rec : loaded) {
            if (named && !matchesWant(rec.name) && !matchesWant(fileStem(rec.file))) continue;
            Zone z;
            z.sampleIndex = rec.index;
            z.root = 60;
            {
                std::lock_guard<std::mutex> g(loadMu);
                if (rec.index >= 0 && rec.index < (int)samples.size() && samples[(size_t)rec.index].rootNote > 0)
                    z.root = samples[(size_t)rec.index].rootNote;
            }
            Patch p = makeSamplePatch(rec.name.c_str(), guessCat(rec.name.c_str(), "Imported"), {z}, false);
            p.source = PatchSource::Korg;
            rememberPatch(addSampledInstrument(p), false);
        }
        if (kmpFiles > 0) reason += "KMP names did not match PCM; loaded raw samples. Look in User. ";
    }

    int pcgFiles = 0;
    int pcgNames = 0;
    std::vector<std::string> pcgMissing;
    for (const auto& path : files) {
        if (named) break;
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

    auto pickGm = [&](int gm, bool drums, int fallback) {
        if (gm < 0) return fallback;
        std::lock_guard<std::mutex> g(loadMu);
        int best = fallback;
        int bestScore = -1;
        for (int i = 0; i < (int)patches.size(); ++i) {
            const Patch& p = patches[(size_t)i];
            if (p.sampled) continue;
            const bool kit = isKit(p.model);
            if (kit != drums) continue;
            int score = 1;
            if (drums) {
                if (gm == 25 && p.model == Model::KitDance) score = 4;
                else if (gm == 48 && p.model == Model::KitOrchestral) score = 4;
                else if (gm == 8 && p.model == Model::KitLatin) score = 4;
                else if ((gm == 40 || gm == 32) && (p.model == Model::KitWorld || p.model == Model::KitArabic)) score = 4;
            } else if (p.bus == BusBass && gm >= 32 && gm <= 39) {
                score = gm == 33 && p.model == Model::FingerBass ? 4 : (gm == 32 && p.model == Model::AcousticBass ? 4 : 3);
            } else if (gm <= 7 && (p.model == Model::Piano || p.model == Model::BrightPiano || p.model == Model::DigitalPiano)) {
                score = gm == 0 && p.model == Model::Piano ? 4 : 3;
            } else if (gm >= 24 && gm <= 31 &&
                       (p.model == Model::NylonGuitar || p.model == Model::SteelGuitar || p.model == Model::CleanGuitar ||
                        p.model == Model::DistGuitar)) {
                score = 3;
            } else if (gm >= 40 && gm <= 51 &&
                       (p.model == Model::Violin || p.model == Model::ConcertStrings || p.model == Model::CinematicStrings)) {
                score = 3;
            } else if (gm >= 56 && gm <= 63 && (p.model == Model::Trumpet || p.model == Model::Brass || p.model == Model::Trombone)) {
                score = 3;
            } else if (gm >= 16 && gm <= 20 &&
                       (p.model == Model::JazzOrgan || p.model == Model::RockOrgan || p.model == Model::DrawbarOrgan)) {
                score = 3;
            } else {
                continue;
            }
            if (score > bestScore) {
                bestScore = score;
                best = i;
            }
        }
        return best;
    };

    auto ingestStyleFile = [&](const std::string& path, const std::string& fileName) {
        std::vector<uint8_t> bytes;
        if (!readFileBytes(path.c_str(), bytes)) {
            skipped++;
            return;
        }
        std::vector<ParsedStyleSmf> smfs;
        std::vector<std::string> korf;
        collectStyleSmfs(bytes.data(), bytes.size(), smfs, &korf);
        if (smfs.empty()) {
            skipped++;
            if (reason.size() < 320) {
                reason += "Could not recover playable MIDI from ";
                reason += fileName;
                bool oc31 = false;
                for (size_t i = 0; i + 4 < bytes.size(); ++i) {
                    if (std::memcmp(bytes.data() + i, "OC31", 4) == 0) {
                        oc31 = true;
                        break;
                    }
                }
                reason += " magic=";
                for (size_t m = 0; m < std::min<size_t>(8, bytes.size()); ++m) {
                    const unsigned char c = bytes[m];
                    reason += (c >= 32 && c < 127) ? (char)c : '.';
                }
                if (!korf.empty()) {
                    reason += " listed ";
                    reason += std::to_string((int)korf.size());
                    reason += " PA4X styles";
                    if (!korf[0].empty()) {
                        reason += " (";
                        reason += korf[0];
                        if (korf.size() > 1) {
                            reason += ", ";
                            reason += korf[1];
                        }
                        reason += ")";
                    }
                    reason += ".";
                }
                if (oc31)
                    reason += " Native STY MIDI is OC31. On the Pa: Style Record > Export SMF, hold Shift and Execute.";
                else
                    reason += " Need a Pa Style Record SMF (markers v1cv1, channels 9-16).";
                reason += " ";
            }
            return;
        }
        int addedHere = 0;
        for (size_t i = 0; i < smfs.size(); ++i) {
            Arranger::Style style;
            const std::string name =
                (i < korf.size()) ? korf[i] : (smfs.size() == 1 ? fileName : fileName + "-" + std::to_string((int)i + 1));
            copyName40(style.name, sizeof(style.name), name);
            copyName40(style.category, sizeof(style.category), guessCat(name.c_str(), "Style"));
            if (smfs[i].tempo > 0) style.tempo = (float)smfs[i].tempo;
            applyBlobsToStyle(style, smfs[i].blobs, smfs[i].yamaha, smfs[i].barTicks);
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
            if (named && !matchesWant(name) && !matchesWant(fileName)) continue;
            const int* pc = smfs[i].program;
            const int d = pickGm(pc[9] >= 0 ? pc[9] : pc[10], true, drumProg);
            const int b = pickGm(pc[8], false, bassProg);
            const int a1 = pickGm(pc[11], false, acc1);
            const int a2 = pickGm(pc[12], false, acc2);
            const int a3 = pickGm(pc[13] >= 0 ? pc[13] : pc[14], false, acc3);
            applyPrograms(style, d, b, a1, a2, a3);
            lastEngineId = addStyle(completeStyle(std::move(style)));
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
               ext == ".JPG" || ext == ".JPEG" || ext == ".ZIP" || ext == ".PAD" || ext == ".SET" || ext == ".7Z" ||
               ext == ".RAR";
    };
    if (wantStyle || wantPad)
    for (const auto& path : files) {
        const std::string ext = upperExt(path);
        const bool padExt = ext == ".PAD";
        const bool styleExt = ext == ".STY" || ext == ".STG" || ext == ".MID" || ext == ".SMF";
        if (padExt && !wantPad) continue;
        if (ext == ".STY" && patchesAdded > 0 && !named) continue;
        if (styleExt || padExt || ext.empty() || !skipStyleExt(ext)) {
            if (!styleExt && !padExt && !ext.empty()) {
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

    const int ok = (!named || patchesAdded > 0 || stylesAdded > 0) ? 1 : 0;
    if (named && ok == 0 && reason.find("matching") == std::string::npos && reason.size() < 180) {
        reason += "Nothing matching that name. Native STY/PAD needs Style/Pad Record > Export SMF. ";
    }
    if (report && reportLen > 0) {
        std::snprintf(report, (size_t)reportLen,
                      "{\"ok\":%d,\"samples\":%d,\"patches\":%d,\"styles\":%d,\"compressed\":%d,\"skipped\":%d,"
                      "\"pcgFiles\":%d,\"pcgNames\":%d,\"missing\":%d,\"files\":%d,\"cached\":%d,\"engineId\":%d,"
                      "\"reason\":\"%s\"}",
                      ok, (int)loaded.size(), patchesAdded, stylesAdded, compressed, skipped, pcgFiles, pcgNames,
                      (int)pcgMissing.size(), (int)files.size(), usedCache ? 1 : 0, lastEngineId, jsonSafe(reason).c_str());
    }
    return named ? lastEngineId : (int)loaded.size();
    } catch (const std::bad_alloc&) {
        reason += "Out of memory loading this SET (KApro PCM is ~250MB compressed). ";
        if (report && reportLen > 0) {
            std::snprintf(report, (size_t)reportLen,
                          "{\"ok\":0,\"samples\":%d,\"patches\":%d,\"styles\":%d,\"reason\":\"%s\"}",
                          (int)loaded.size(), patchesAdded, stylesAdded, jsonSafe(reason).c_str());
        }
        return (int)loaded.size();
    }
}

int Engine::listPa4xCatalog(const char* folder, char* report, int reportLen) {
    if (report && reportLen > 0) report[0] = 0;
    if (!folder || !folder[0]) return -1;
    std::vector<std::string> files;
    std::string root = folder;
    struct stat rootSt {};
    if (stat(folder, &rootSt) == 0 && S_ISREG(rootSt.st_mode)) {
        files.push_back(folder);
        root = parentDir(folder);
    } else {
        walkFiles(folder, files);
    }
    struct CatItem {
        const char* kind;
        std::string name;
        std::string file;
    };
    std::vector<CatItem> items;
    auto have = [&](const char* kind, const std::string& name) {
        const std::string n = normName(name.c_str());
        for (const auto& it : items)
            if (it.kind == kind && normName(it.name.c_str()) == n) return true;
        return false;
    };
    auto push = [&](const char* kind, const std::string& name, const std::string& file) {
        if (name.size() < 2 || have(kind, name)) return;
        items.push_back({kind, name, baseName(file)});
    };
    auto korfNames = [&](const std::vector<uint8_t>& bytes, std::vector<std::string>& names) {
        size_t dataOff = 0;
        return korfStyleIndex(bytes.data(), bytes.size(), dataOff, names);
    };
    for (const auto& path : files) {
        const std::string ext = upperExt(path);
        if (ext == ".KMP") {
            std::vector<uint8_t> bytes;
            if (!readFileBytes(path.c_str(), bytes)) continue;
            std::vector<std::string> names;
            parseKmpCatalogNames(bytes.data(), bytes.size(), names);
            if (names.empty()) {
                std::vector<KmpInst> insts;
                parseKmpBytes(bytes.data(), bytes.size(), insts);
                for (const auto& inst : insts)
                    if (!inst.name.empty() && !isGenericBankName(inst.name)) names.push_back(inst.name);
            }
            for (const auto& n : names) push("sound", n, path);
            if (names.empty() && !isGenericBankName(fileStem(path))) push("sound", fileStem(path), path);
        } else if (ext == ".PCG") {
            std::vector<uint8_t> bytes;
            if (!readFileBytes(path.c_str(), bytes)) continue;
            std::vector<std::string> names, missing;
            parsePcgNames(bytes.data(), bytes.size(), names, missing);
            for (const auto& n : names)
                if (!isGenericBankName(n)) push("sound", n, path);
            if (names.empty() && !isGenericBankName(fileStem(path))) push("sound", fileStem(path), path);
        } else if (ext == ".WAV" || ext == ".KSF") {
            if (!isGenericBankName(fileStem(path))) push("sound", fileStem(path), path);
        } else if (ext == ".STY" || ext == ".STG" || ext == ".MID" || ext == ".SMF" || ext == ".PAD") {
            const char* kind = ext == ".PAD" ? "pad" : "style";
            std::vector<uint8_t> bytes;
            std::vector<std::string> names;
            std::ifstream in(path.c_str(), std::ios::binary);
            if (in) {
                bytes.resize(65536);
                in.read((char*)bytes.data(), (std::streamsize)bytes.size());
                bytes.resize((size_t)std::max<std::streamsize>(0, in.gcount()));
            }
            if (!bytes.empty() && korfNames(bytes, names)) {
                for (const auto& n : names)
                    if (!isGenericBankName(n)) push(kind, n, path);
            } else if (ext == ".MID" || ext == ".SMF" || !isGenericBankName(fileStem(path))) {
                push(kind, fileStem(path), path);
            }
        }
    }
    const std::string cacheDir = root.empty() ? std::string() : decodedCacheDir(root);
    if (!cacheDir.empty()) mkdirParents(cacheDir);
    const std::string outPath = cacheDir.empty() ? std::string(folder) + ".catalog.json" : cacheDir + "/catalog.json";
    FILE* out = std::fopen(outPath.c_str(), "wb");
    int sounds = 0, styles = 0, pads = 0;
    if (out) {
        std::fputs("{\"ok\":1,\"items\":[", out);
        for (size_t i = 0; i < items.size(); ++i) {
            const auto& it = items[i];
            if (std::strcmp(it.kind, "sound") == 0) sounds++;
            else if (std::strcmp(it.kind, "pad") == 0) pads++;
            else styles++;
            const char* cat = std::strcmp(it.kind, "sound") == 0 ? guessCat(it.name.c_str(), "Imported")
                                                                 : guessCat(it.name.c_str(), "Style");
            std::fprintf(out, "%s{\"kind\":\"%s\",\"name\":\"%s\",\"category\":\"%s\",\"file\":\"%s\"}", i ? "," : "",
                         it.kind, jsonSafe(it.name).c_str(), cat, jsonSafe(it.file).c_str());
        }
        std::fputs("]}", out);
        std::fclose(out);
    }
    if (report && reportLen > 0) {
        std::snprintf(report, (size_t)reportLen,
                      "{\"ok\":1,\"file\":\"%s\",\"sounds\":%d,\"styles\":%d,\"pads\":%d,\"items\":%d}",
                      jsonSafe(outPath).c_str(), sounds, styles, pads, (int)items.size());
    }
    return (int)items.size();
}

}  // namespace pa
