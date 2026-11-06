#include "Engine.h"

#include <cctype>
#include <cstring>
#include <set>

namespace pa {
namespace {

bool printableName(const char* p, int n, std::string& out) {
    int start = -1, end = -1;
    for (int i = 0; i < n; ++i) {
        const unsigned char c = (unsigned char)p[i];
        if (c >= 32 && c < 127 && c != '\\') {
            if (start < 0) start = i;
            end = i;
        } else if (start >= 0) {
            break;
        }
    }
    if (start < 0 || end - start + 1 < 3) return false;
    out.assign(p + start, (size_t)(end - start + 1));
    while (!out.empty() && out.back() == ' ') out.pop_back();
    int letters = 0;
    for (char c : out)
        if (std::isalpha((unsigned char)c)) letters++;
    return letters >= 2 && out.size() >= 3 && out.size() <= 24;
}

uint32_t ru32be(const uint8_t* p) {
    return ((uint32_t)p[0] << 24) | ((uint32_t)p[1] << 16) | ((uint32_t)p[2] << 8) | (uint32_t)p[3];
}

bool isChunkId(const uint8_t* p) {
    int letters = 0;
    for (int i = 0; i < 4; ++i) {
        if (std::isalnum((unsigned char)p[i])) letters++;
        else return false;
    }
    return letters == 4;
}

}  // namespace

int parsePcgNames(const uint8_t* bytes, size_t n, std::vector<std::string>& names, std::vector<std::string>& missing) {
    names.clear();
    missing.clear();
    if (!bytes || n < 16) return 0;
    std::set<std::string> uniq;
    std::set<std::string> refs;

    auto consider = [&](const std::string& s) {
        if (s.size() >= 4) {
            const std::string up = [&] {
                std::string o = s;
                for (char& c : o) c = (char)std::toupper((unsigned char)c);
                return o;
            }();
            if (up.find(".KMP") != std::string::npos || up.find(".KSF") != std::string::npos ||
                up.find(".PCM") != std::string::npos) {
                refs.insert(s);
                return;
            }
        }
        if (uniq.insert(s).second) names.push_back(s);
    };

    for (size_t i = 0; i + 8 < n;) {
        if (isChunkId(bytes + i)) {
            const uint32_t sz = ru32be(bytes + i + 4);
            if (sz >= 8 && sz < n && i + 8 + sz <= n) {
                const char id[5] = {(char)bytes[i], (char)bytes[i + 1], (char)bytes[i + 2], (char)bytes[i + 3], 0};
                const bool programish = std::strcmp(id, "PRG1") == 0 || std::strcmp(id, "PBS1") == 0 ||
                                        std::strcmp(id, "DKT1") == 0 || std::strcmp(id, "CMB1") == 0 ||
                                        std::strcmp(id, "PRG2") == 0 || std::strcmp(id, "PCG1") == 0;
                if (programish) {
                    const uint8_t* payload = bytes + i + 8;
                    const size_t pn = sz;
                    for (size_t p = 0; p + 16 < pn; p += 16) {
                        std::string name;
                        if (printableName((const char*)payload + p, 24, name)) consider(name);
                    }
                }
                i += 8 + sz;
                continue;
            }
        }
        ++i;
    }

    if (names.empty()) {
        for (size_t i = 0; i + 16 < n; i += 8) {
            std::string name;
            if (printableName((const char*)bytes + i, 16, name)) consider(name);
            if (names.size() > 256) break;
        }
    }
    for (const auto& r : refs) missing.push_back(r);
    return (int)names.size();
}

}  // namespace pa
