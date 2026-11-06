#include "Engine.h"

#include <algorithm>
#include <cctype>
#include <cstring>
#include <fstream>
#include <sstream>
#include <unordered_map>

namespace pa {
namespace {

std::string dirnameOf(const std::string& path) {
    const auto slash = path.find_last_of("/\\");
    return slash == std::string::npos ? std::string() : path.substr(0, slash);
}

std::string joinPath(const std::string& a, const std::string& b) {
    if (a.empty()) return b;
    if (b.empty()) return a;
    const char last = a.back();
    if (last == '/' || last == '\\') return a + b;
    return a + "/" + b;
}

std::string trim(const std::string& s) {
    size_t a = 0, b = s.size();
    while (a < b && std::isspace((unsigned char)s[a])) ++a;
    while (b > a && std::isspace((unsigned char)s[b - 1])) --b;
    return s.substr(a, b - a);
}

std::string unquote(std::string s) {
    s = trim(s);
    if (s.size() >= 2 && ((s.front() == '"' && s.back() == '"') || (s.front() == '\'' && s.back() == '\'')))
        return s.substr(1, s.size() - 2);
    return s;
}

int noteToken(const std::string& raw) {
    const std::string s = trim(raw);
    if (s.empty()) return 60;
    if (std::isdigit((unsigned char)s[0]) || s[0] == '-' || s[0] == '+') return std::atoi(s.c_str());
    static const char* names[] = {"c", "c#", "d", "d#", "e", "f", "f#", "g", "g#", "a", "a#", "b"};
    std::string n = s;
    for (char& c : n) c = (char)std::tolower((unsigned char)c);
    n.erase(std::remove(n.begin(), n.end(), ' '), n.end());
    int acc = 0;
    if (n.size() >= 2 && n[1] == 'b') {
        acc = -1;
        n = n.substr(0, 1) + n.substr(2);
    } else if (n.size() >= 2 && (n[1] == '#' || n[1] == 's')) {
        acc = 1;
        n = n.substr(0, 1) + n.substr(2);
    }
    int pc = -1;
    for (int i = 0; i < 12; ++i)
        if (n.size() >= std::strlen(names[i]) && n.compare(0, std::strlen(names[i]), names[i]) == 0) {
            pc = i;
            n = n.substr(std::strlen(names[i]));
            break;
        }
    if (pc < 0) return std::atoi(s.c_str());
    int oct = n.empty() ? 4 : std::atoi(n.c_str());
    return clampf((float)((oct + 1) * 12 + pc + acc), 0, 127);
}

struct Region {
    std::string sample;
    int lokey = 0, hikey = 127, lovel = 0, hivel = 127, root = 60;
    float tune = 0, volume = 0, pan = 0;
    int transpose = 0;
    int offset = 0, end = 0, loopStart = -1, loopEnd = -1, loopMode = -1;
    int seqLength = 1, seqPosition = 1;
    float attack = -1, decay = -1, sustain = -1, release = -1;
    float cutoff = -1, resonance = -1;
};

void applyOpcode(Region& r, const std::string& key, const std::string& val) {
    if (key == "sample") r.sample = unquote(val);
    else if (key == "lokey") r.lokey = noteToken(val);
    else if (key == "hikey") r.hikey = noteToken(val);
    else if (key == "key") r.lokey = r.hikey = r.root = noteToken(val);
    else if (key == "lovel") r.lovel = clampf((float)std::atoi(val.c_str()), 0, 127);
    else if (key == "hivel") r.hivel = clampf((float)std::atoi(val.c_str()), 0, 127);
    else if (key == "pitch_keycenter") r.root = noteToken(val);
    else if (key == "tune") r.tune = (float)std::atof(val.c_str());
    else if (key == "transpose") r.transpose = std::atoi(val.c_str());
    else if (key == "volume") r.volume = (float)std::atof(val.c_str());
    else if (key == "pan") r.pan = clampf((float)std::atof(val.c_str()) / 100.0f, -1.0f, 1.0f);
    else if (key == "offset") r.offset = std::max(0, std::atoi(val.c_str()));
    else if (key == "end") r.end = std::max(0, std::atoi(val.c_str()));
    else if (key == "loop_start") r.loopStart = std::max(0, std::atoi(val.c_str()));
    else if (key == "loop_end") r.loopEnd = std::max(0, std::atoi(val.c_str()));
    else if (key == "loop_mode") {
        const std::string m = trim(val);
        if (m == "no_loop" || m == "one_shot") r.loopMode = 0;
        else if (m == "loop_continuous" || m == "loop_sustain") r.loopMode = 1;
    } else if (key == "seq_length") r.seqLength = std::max(1, std::atoi(val.c_str()));
    else if (key == "seq_position") r.seqPosition = std::max(1, std::atoi(val.c_str()));
    else if (key == "ampeg_attack") r.attack = (float)std::atof(val.c_str()) * 1000.0f;
    else if (key == "ampeg_decay") r.decay = (float)std::atof(val.c_str()) * 1000.0f;
    else if (key == "ampeg_sustain") r.sustain = clampf((float)std::atof(val.c_str()) / 100.0f, 0.0f, 1.0f);
    else if (key == "ampeg_release") r.release = (float)std::atof(val.c_str()) * 1000.0f;
    else if (key == "cutoff") r.cutoff = (float)std::atof(val.c_str());
    else if (key == "resonance") r.resonance = clampf((float)std::atof(val.c_str()) / 40.0f, 0.0f, 0.95f);
}

bool readText(const char* path, std::string& text) {
    std::ifstream in(path, std::ios::binary);
    if (!in) return false;
    std::ostringstream ss;
    ss << in.rdbuf();
    text = ss.str();
    return true;
}

void tokenizeLine(const std::string& line, std::vector<std::pair<std::string, std::string>>& kv) {
    size_t i = 0;
    while (i < line.size()) {
        while (i < line.size() && std::isspace((unsigned char)line[i])) ++i;
        if (i >= line.size() || line[i] == '/' || line[i] == '#') break;
        size_t eq = line.find('=', i);
        if (eq == std::string::npos) break;
        std::string key = trim(line.substr(i, eq - i));
        i = eq + 1;
        while (i < line.size() && std::isspace((unsigned char)line[i])) ++i;
        std::string val;
        if (i < line.size() && (line[i] == '"' || line[i] == '\'')) {
            const char q = line[i++];
            while (i < line.size() && line[i] != q) val += line[i++];
            if (i < line.size()) ++i;
        } else {
            while (i < line.size() && !std::isspace((unsigned char)line[i])) {
                if (line[i] == '=' ) {
                    size_t k = i;
                    while (k > 0 && !std::isspace((unsigned char)line[k - 1])) --k;
                    if (k > i - (size_t)val.size() && k < i) {
                        i = k;
                        break;
                    }
                }
                val += line[i++];
            }
        }
        for (char& c : key) c = (char)std::tolower((unsigned char)c);
        if (!key.empty()) kv.push_back({key, val});
    }
}

std::string headerOf(const std::string& line) {
    const std::string t = trim(line);
    if (t.size() >= 2 && t.front() == '<' && t.back() == '>') {
        std::string h = t.substr(1, t.size() - 2);
        for (char& c : h) c = (char)std::tolower((unsigned char)c);
        return h;
    }
    return {};
}

}  // namespace

bool parseSfzFile(const char* path, std::vector<Sample>& samples, Patch& patch, std::string& error) {
    samples.clear();
    patch = Patch{};
    error.clear();
    if (!path) {
        error = "missing SFZ path";
        return false;
    }
    std::string text;
    if (!readText(path, text)) {
        error = "could not read SFZ";
        return false;
    }

    const std::string base = dirnameOf(path);
    std::string defaultPath;
    Region global{}, group{};
    std::vector<Region> regions;
    std::string section = "global";
    Region* cur = &global;

    std::istringstream in(text);
    std::string line;
    while (std::getline(in, line)) {
        if (!line.empty() && line.back() == '\r') line.pop_back();
        const auto cmt = line.find("//");
        if (cmt != std::string::npos) line = line.substr(0, cmt);
        const std::string hdr = headerOf(line);
        if (!hdr.empty()) {
            if (hdr == "control") section = "control";
            else if (hdr == "global") {
                section = "global";
                cur = &global;
            } else if (hdr == "group") {
                group = global;
                section = "group";
                cur = &group;
            } else if (hdr == "region") {
                regions.push_back(group);
                section = "region";
                cur = &regions.back();
            }
            continue;
        }
        std::vector<std::pair<std::string, std::string>> kv;
        tokenizeLine(line, kv);
        for (const auto& p : kv) {
            if (section == "control" && p.first == "default_path") {
                defaultPath = unquote(p.second);
                continue;
            }
            if (p.first == "global_label" || p.first == "master_label") {
                std::strncpy(patch.name, unquote(p.second).c_str(), sizeof(patch.name) - 1);
                continue;
            }
            applyOpcode(*cur, p.first, p.second);
        }
    }

    if (regions.empty()) {
        error = "SFZ has no <region> opcodes";
        return false;
    }

    std::unordered_map<std::string, int> loaded;
    int mapped = 0;
    for (auto& r : regions) {
        if (r.sample.empty()) continue;
        std::string rel = r.sample;
        for (char& c : rel)
            if (c == '\\') c = '/';
        const std::string full = joinPath(joinPath(base, defaultPath), rel);
        int si = -1;
        auto it = loaded.find(full);
        if (it != loaded.end()) {
            si = it->second;
        } else {
            Sample sm;
            if (loadWav(full.c_str(), sm) <= 0) {
                if (error.size() < 160) error += "missing sample " + rel + "; ";
                continue;
            }
            if (r.loopMode == 1 || (r.loopStart >= 0 && r.loopEnd > r.loopStart)) {
                sm.loop = true;
                if (r.loopStart >= 0) sm.loopStart = r.loopStart;
                if (r.loopEnd > sm.loopStart) sm.loopEnd = r.loopEnd;
            } else if (r.loopMode == 0) {
                sm.loop = false;
            }
            si = (int)samples.size();
            samples.push_back(std::move(sm));
            loaded[full] = si;
        }
        Zone z;
        z.keyLow = clampf((float)r.lokey, 0, 127);
        z.keyHigh = clampf((float)r.hikey, 0, 127);
        z.velLow = r.lovel;
        z.velHigh = r.hivel;
        z.root = r.root + r.transpose;
        z.tuneCents = r.tune;
        z.gain = dbToGain(clampf(r.volume, -24.0f, 12.0f));
        z.pan = r.pan;
        z.sampleIndex = si;
        z.seqLength = r.seqLength;
        z.seqPosition = r.seqPosition;
        z.offset = r.offset;
        z.end = r.end;
        z.loopStart = r.loopStart;
        z.loopEnd = r.loopEnd;
        z.loopMode = r.loopMode;
        z.cutoff = r.cutoff;
        z.resonance = r.resonance;
        patch.zones.push_back(z);
        if (r.attack >= 0) patch.attack = r.attack;
        if (r.decay >= 0) patch.decay = r.decay;
        if (r.sustain >= 0) patch.sustain = r.sustain;
        if (r.release >= 0) patch.release = r.release;
        mapped++;
    }
    if (mapped == 0) {
        if (error.empty()) error = "no SFZ regions resolved to WAV samples";
        return false;
    }
    prepareSampledPatch(patch, false);
    patch.source = PatchSource::Sfz;
    patch.sampled = true;
    if (!patch.name[0]) {
        const std::string stem = dirnameOf(path).empty() ? std::string(path) : std::string(path).substr(dirnameOf(path).size() + 1);
        std::strncpy(patch.name, stem.c_str(), sizeof(patch.name) - 1);
        auto* dot = std::strrchr(patch.name, '.');
        if (dot) *dot = 0;
    }
    if (!patch.category[0]) std::strncpy(patch.category, "Imported", sizeof(patch.category) - 1);
    return true;
}

}  // namespace pa
