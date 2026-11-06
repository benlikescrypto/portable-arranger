#include "Engine.h"

#include <algorithm>
#include <cctype>
#include <cstring>
#include <fstream>
#include <sstream>

namespace pa {
namespace {

std::string trim(const std::string& s) {
    size_t a = 0, b = s.size();
    while (a < b && std::isspace((unsigned char)s[a])) ++a;
    while (b > a && std::isspace((unsigned char)s[b - 1])) --b;
    return s.substr(a, b - a);
}

Arranger::Pattern* sectionOf(Arranger::Style& s, const std::string& name) {
    if (name == "intro1") return &s.intro1;
    if (name == "intro2") return &s.intro2;
    if (name == "intro3") return &s.intro3;
    if (name == "var1" || name == "main_a") return &s.var[0];
    if (name == "var2" || name == "main_b") return &s.var[1];
    if (name == "var3" || name == "main_c") return &s.var[2];
    if (name == "var4" || name == "main_d") return &s.var[3];
    if (name == "fill1") return &s.fill[0];
    if (name == "fill2") return &s.fill[1];
    if (name == "fill3") return &s.fill[2];
    if (name == "fill4") return &s.fill[3];
    if (name == "break" || name == "brk") return &s.brk;
    if (name == "end1" || name == "ending1") return &s.end1;
    if (name == "end2" || name == "ending2") return &s.end2;
    if (name == "end3" || name == "ending3") return &s.end3;
    return nullptr;
}

const Arranger::Pattern* sectionOfConst(const Arranger::Style& s, const char* name) {
    return sectionOf(const_cast<Arranger::Style&>(s), name);
}

uint8_t flagOf(const std::string& s) {
    if (s == "bass") return kEvBass;
    if (s == "comp") return kEvComp;
    if (s == "trans") return kEvTrans;
    return kEvAbs;
}

const char* flagName(uint8_t f) {
    if (f == kEvBass) return "bass";
    if (f == kEvComp) return "comp";
    if (f == kEvTrans) return "trans";
    return "abs";
}

}  // namespace

void applyStylePrograms(Arranger::Style& style, int drum, int bass, int acc1, int acc2, int acc3) {
    auto set = [&](Arranger::Pattern& p) {
        p.drumProg = drum;
        p.bassProg = bass;
        p.acc1 = acc1;
        p.acc2 = acc2;
        p.acc3 = acc3;
    };
    set(style.intro1);
    set(style.intro2);
    set(style.intro3);
    for (int i = 0; i < 4; ++i) {
        set(style.var[i]);
        set(style.fill[i]);
    }
    set(style.brk);
    set(style.end1);
    set(style.end2);
    set(style.end3);
}

bool parseAbStyleFile(const char* path, Arranger::Style& style, std::string& error) {
    style = Arranger::Style{};
    error.clear();
    std::ifstream in(path);
    if (!in) {
        error = "could not read .abstyle";
        return false;
    }
    std::string line;
    if (!std::getline(in, line)) {
        error = "empty .abstyle";
        return false;
    }
    if (trim(line).find("ABSTYLE") != 0) {
        error = "missing ABSTYLE header";
        return false;
    }
    Arranger::Pattern* cur = &style.var[0];
    while (std::getline(in, line)) {
        if (!line.empty() && line.back() == '\r') line.pop_back();
        line = trim(line);
        if (line.empty() || line[0] == '#') continue;
        if (line.rfind("name=", 0) == 0) {
            std::strncpy(style.name, line.c_str() + 5, sizeof(style.name) - 1);
        } else if (line.rfind("category=", 0) == 0) {
            std::strncpy(style.category, line.c_str() + 9, sizeof(style.category) - 1);
        } else if (line.rfind("tempo=", 0) == 0) {
            style.tempo = clampf((float)std::atof(line.c_str() + 6), 40.0f, 240.0f);
        } else if (line.rfind("section=", 0) == 0) {
            cur = sectionOf(style, line.substr(8));
            if (!cur) cur = &style.var[0];
        } else if (line.rfind("length=", 0) == 0) {
            if (cur) cur->lengthTicks = std::max(kPpq, std::atoi(line.c_str() + 7));
        } else if (std::isdigit((unsigned char)line[0])) {
            if (!cur) continue;
            std::replace(line.begin(), line.end(), ',', ' ');
            std::istringstream ss(line);
            int tick = 0, trk = 0, note = 0, vel = 100, dur = 24;
            std::string flags = "abs";
            ss >> tick >> trk >> note >> vel >> dur >> flags;
            Arranger::Ev ev;
            ev.tick = (uint16_t)std::max(0, tick);
            ev.trk = (uint8_t)clampf((float)trk, 0, 15);
            ev.note = (uint8_t)clampf((float)note, 0, 127);
            ev.vel = (uint8_t)clampf((float)vel, 1, 127);
            ev.dur = (uint16_t)std::max(1, dur);
            ev.flags = flagOf(flags);
            cur->evs.push_back(ev);
        }
    }
    bool any = !style.var[0].evs.empty();
    for (int i = 1; i < 4; ++i) any = any || !style.var[i].evs.empty();
    if (!any) {
        error = ".abstyle has no variation events";
        return false;
    }
    style = completeStyle(std::move(style));
    return true;
}

bool writeAbStyleFile(const char* path, const Arranger::Style& style) {
    std::ofstream out(path);
    if (!out) return false;
    out << "ABSTYLE1\n";
    out << "name=" << style.name << "\n";
    out << "category=" << style.category << "\n";
    out << "tempo=" << style.tempo << "\n";
    const char* names[] = {"intro1", "intro2", "intro3", "var1", "var2", "var3", "var4",
                           "fill1",  "fill2",  "fill3",  "fill4", "break", "end1", "end2", "end3"};
    for (const char* n : names) {
        const Arranger::Pattern* p = sectionOfConst(style, n);
        if (!p || p->evs.empty()) continue;
        out << "section=" << n << "\n";
        out << "length=" << p->lengthTicks << "\n";
        for (const auto& e : p->evs) {
            out << e.tick << "," << (int)e.trk << "," << (int)e.note << "," << (int)e.vel << "," << e.dur << ","
                << flagName(e.flags) << "\n";
        }
    }
    return true;
}

}  // namespace pa
