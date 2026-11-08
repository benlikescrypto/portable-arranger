#include "Engine.h"

#include <algorithm>
#include <cstring>

namespace pa {
namespace {

constexpr int BAR = kPpq * 4;

void add(Arranger::Pattern& p, int tick, uint8_t trk, uint8_t note, uint8_t vel, uint16_t dur, uint8_t flags) {
    if (tick < 0) return;
    p.evs.push_back({(uint16_t)tick, trk, note, vel, dur, flags});
}

void nameStyle(Arranger::Style& s, const char* n, const char* c, float tempo) {
    std::memset(s.name, 0, sizeof(s.name));
    std::memset(s.category, 0, sizeof(s.category));
    std::strncpy(s.name, n, sizeof(s.name) - 1);
    std::strncpy(s.category, c, sizeof(s.category) - 1);
    s.tempo = tempo;
}

void hats(Arranger::Pattern& p, int t0, int step, int vel, int openAt = -1) {
    for (int s = 0; s < BAR; s += step) {
        const bool accent = (s % kPpq) == 0;
        add(p, t0 + s, 0, (openAt >= 0 && s == openAt) ? 46 : 42, (uint8_t)(accent ? vel : vel - 18), 10, kEvAbs);
    }
}

void bassFour(Arranger::Pattern& p, int bars, int vel, const int* deg, int ndeg) {
    for (int b = 0; b < bars; ++b) {
        const int t0 = b * BAR;
        for (int i = 0; i < ndeg; ++i) {
            add(p, t0 + i * (BAR / ndeg), 1, (uint8_t)deg[i], (uint8_t)(vel - (i % 2 ? 10 : 0)), 28, kEvBass);
        }
    }
}

void compOffbeat(Arranger::Pattern& p, int bars, int vel) {
    for (int b = 0; b < bars; ++b) {
        const int t0 = b * BAR;
        add(p, t0 + kPpq / 2, 2, 0, (uint8_t)vel, 22, kEvComp);
        add(p, t0 + kPpq + kPpq / 2, 2, 1, (uint8_t)(vel - 8), 22, kEvComp);
        add(p, t0 + kPpq * 2 + kPpq / 2, 2, 2, (uint8_t)vel, 22, kEvComp);
        add(p, t0 + kPpq * 3 + kPpq / 2, 2, 0, (uint8_t)(vel - 8), 22, kEvComp);
        add(p, t0, 3, 0, (uint8_t)(vel - 20), 90, kEvComp);
    }
}

void padHold(Arranger::Pattern& p, int bars, int vel) {
    for (int b = 0; b < bars; ++b) add(p, b * BAR, 4, 0, (uint8_t)vel, BAR - 8, kEvComp);
}

Arranger::Pattern popRock(int dens, bool rock) {
    Arranger::Pattern p;
    p.lengthTicks = BAR * 4;
    for (int b = 0; b < 4; ++b) {
        const int t0 = b * BAR;
        add(p, t0, 0, 36, rock ? 118 : 108, 24, kEvAbs);
        if (dens >= 2) add(p, t0 + kPpq / 2, 0, 36, 92, 16, kEvAbs);
        add(p, t0 + kPpq, 0, 38, rock ? 114 : 100, 24, kEvAbs);
        add(p, t0 + kPpq * 2, 0, 36, 104, 24, kEvAbs);
        add(p, t0 + kPpq * 3, 0, 38, rock ? 116 : 102, 24, kEvAbs);
        hats(p, t0, dens >= 2 ? kPpq / 4 : kPpq / 2, 70 + dens * 4, dens >= 3 ? kPpq * 3 + kPpq / 2 : -1);
        if (rock && dens >= 2) add(p, t0 + kPpq * 3 + kPpq / 2, 0, 46, 80, 16, kEvAbs);
    }
    const int four[] = {0, 0, 7, 0};
    const int walk[] = {0, 7, 0, 4};
    bassFour(p, 4, 104, dens >= 2 ? walk : four, 4);
    if (dens == 0)
        for (int b = 0; b < 4; ++b) add(p, b * BAR, 2, 0, 70, 80, kEvComp);
    else
        compOffbeat(p, 4, 76 + dens * 4);
    if (dens >= 2) padHold(p, 4, 48);
    return p;
}

Arranger::Pattern discoFunk(int dens, bool funk) {
    Arranger::Pattern p;
    p.lengthTicks = BAR * 4;
    for (int b = 0; b < 4; ++b) {
        const int t0 = b * BAR;
        add(p, t0, 0, 36, 116, 20, kEvAbs);
        add(p, t0 + kPpq, 0, 36, 110, 16, kEvAbs);
        add(p, t0 + kPpq * 2, 0, 36, 116, 20, kEvAbs);
        add(p, t0 + kPpq * 3, 0, 36, 110, 16, kEvAbs);
        add(p, t0 + kPpq, 0, 38, funk ? 96 : 88, 16, kEvAbs);
        add(p, t0 + kPpq * 3, 0, 38, funk ? 100 : 90, 16, kEvAbs);
        if (funk) {
            add(p, t0 + kPpq / 2, 0, 38, 48, 8, kEvAbs);
            add(p, t0 + kPpq + kPpq / 4, 0, 38, 42, 8, kEvAbs);
            add(p, t0 + kPpq * 2 + kPpq / 2, 0, 38, 50, 8, kEvAbs);
        }
        for (int s = 0; s < BAR; s += kPpq / 2) {
            add(p, t0 + s, 0, (s % kPpq == kPpq / 2) ? 46 : 42, (uint8_t)((s % kPpq == 0) ? 82 : 64), 8, kEvAbs);
        }
        if (dens >= 2) add(p, t0 + kPpq * 3 + kPpq / 2, 0, 39, 90, 12, kEvAbs);
    }
    const int disco[] = {0, 0, 0, 7};
    const int funkb[] = {0, 7, 10, 7};
    bassFour(p, 4, 108, funk ? funkb : disco, 4);
    compOffbeat(p, 4, 80 + dens * 3);
    return p;
}

Arranger::Pattern balladPat(int dens) {
    Arranger::Pattern p;
    p.lengthTicks = BAR * 4;
    for (int b = 0; b < 4; ++b) {
        const int t0 = b * BAR;
        add(p, t0, 0, 36, 92, 48, kEvAbs);
        add(p, t0 + kPpq * 2, 0, 38, 86, 36, kEvAbs);
        if (dens >= 1) {
            add(p, t0 + kPpq, 0, 42, 52, 12, kEvAbs);
            add(p, t0 + kPpq * 3, 0, 42, 48, 12, kEvAbs);
        }
        if (dens >= 2) add(p, t0 + kPpq * 3 + kPpq / 2, 0, 46, 58, 18, kEvAbs);
        add(p, t0, 1, 0, 92, 90, kEvBass);
        add(p, t0 + kPpq * 2, 1, 7, 80, 70, kEvBass);
        add(p, t0, 2, 0, (uint8_t)(68 + dens * 4), 70, kEvComp);
        add(p, t0 + kPpq * 2, 2, 1, (uint8_t)(64 + dens * 4), 70, kEvComp);
        add(p, t0, 3, 0, 50, 110, kEvComp);
    }
    return p;
}

Arranger::Pattern swingJazz(int dens) {
    Arranger::Pattern p;
    p.lengthTicks = BAR * 4;
    const int swing = kPpq / 3;
    for (int b = 0; b < 4; ++b) {
        const int t0 = b * BAR;
        add(p, t0, 0, 36, dens ? 90 : 70, 24, kEvAbs);
        add(p, t0 + kPpq * 2, 0, 38, 96, 20, kEvAbs);
        for (int beat = 0; beat < 4; ++beat) {
            add(p, t0 + beat * kPpq, 0, 51, (uint8_t)(beat % 2 ? 62 : 78), 12, kEvAbs);
            add(p, t0 + beat * kPpq + swing * 2, 0, 51, 50, 8, kEvAbs);
        }
        if (dens >= 2) add(p, t0 + kPpq * 3 + swing, 0, 44, 60, 8, kEvAbs);
        add(p, t0, 1, 0, 96, 40, kEvBass);
        add(p, t0 + kPpq, 1, 7, 88, 32, kEvBass);
        add(p, t0 + kPpq * 2, 1, 10, 90, 32, kEvBass);
        add(p, t0 + kPpq * 3, 1, 7, 86, 28, kEvBass);
        add(p, t0 + kPpq / 3, 2, 1, (uint8_t)(70 + dens * 4), 20, kEvComp);
        add(p, t0 + kPpq + kPpq / 3, 2, 2, 66, 20, kEvComp);
        add(p, t0 + kPpq * 2 + kPpq / 3, 2, 0, 70, 20, kEvComp);
        add(p, t0 + kPpq * 3 + kPpq / 3, 2, 1, 64, 20, kEvComp);
    }
    return p;
}

Arranger::Pattern salsaPat(int dens) {
    Arranger::Pattern p;
    p.lengthTicks = BAR * 4;
    for (int b = 0; b < 4; ++b) {
        const int t0 = b * BAR;
        add(p, t0, 0, 36, 110, 16, kEvAbs);
        add(p, t0 + kPpq, 0, 36, 100, 12, kEvAbs);
        add(p, t0 + kPpq * 2 + kPpq / 2, 0, 36, 108, 16, kEvAbs);
        add(p, t0 + kPpq / 2, 0, 75, 90, 8, kEvAbs);
        add(p, t0 + kPpq + kPpq / 2, 0, 76, 86, 8, kEvAbs);
        add(p, t0 + kPpq * 2, 0, 75, 88, 8, kEvAbs);
        add(p, t0 + kPpq * 3 + kPpq / 2, 0, 76, 84, 8, kEvAbs);
        add(p, t0 + kPpq * 3, 0, 39, 80, 10, kEvAbs);
        if (dens >= 1) hats(p, t0, kPpq / 2, 58);
        const int tumbao[] = {0, 0, 7, 0};
        add(p, t0, 1, (uint8_t)tumbao[0], 108, 20, kEvBass);
        add(p, t0 + kPpq + kPpq / 2, 1, 0, 100, 18, kEvBass);
        add(p, t0 + kPpq * 2, 1, 7, 104, 22, kEvBass);
        add(p, t0 + kPpq * 3 + kPpq / 2, 1, 0, 96, 16, kEvBass);
        add(p, t0, 2, 0, 78, 24, kEvComp);
        add(p, t0 + kPpq, 2, 2, 74, 18, kEvComp);
        add(p, t0 + kPpq * 2, 2, 1, 80, 24, kEvComp);
        add(p, t0 + kPpq * 3, 2, 0, 72, 18, kEvComp);
    }
    (void)dens;
    return p;
}

Arranger::Pattern merenguePat(int dens) {
    Arranger::Pattern p;
    p.lengthTicks = BAR * 4;
    for (int b = 0; b < 4; ++b) {
        const int t0 = b * BAR;
        for (int s = 0; s < BAR; s += kPpq / 2) add(p, t0 + s, 0, 36, (uint8_t)(s % kPpq == 0 ? 110 : 96), 10, kEvAbs);
        add(p, t0 + kPpq / 2, 0, 38, 88, 8, kEvAbs);
        add(p, t0 + kPpq * 1 + kPpq / 2, 0, 38, 90, 8, kEvAbs);
        add(p, t0 + kPpq * 2 + kPpq / 2, 0, 38, 88, 8, kEvAbs);
        add(p, t0 + kPpq * 3 + kPpq / 2, 0, 38, 92, 8, kEvAbs);
        hats(p, t0, kPpq / 4, 64 + dens * 4);
        const int bass[] = {0, 0, 0, 7};
        bassFour(p, 1, 110, bass, 4);
        p.evs.erase(p.evs.end() - 4, p.evs.end());
        bassFour(p, 1, 110, bass, 4);
        add(p, t0, 1, 0, 110, 20, kEvBass);
        add(p, t0 + kPpq, 1, 0, 100, 20, kEvBass);
        add(p, t0 + kPpq * 2, 1, 0, 110, 20, kEvBass);
        add(p, t0 + kPpq * 3, 1, 7, 100, 20, kEvBass);
        compOffbeat(p, 1, 82);
    }
    return p;
}

Arranger::Pattern dembowPat(int dens) {
    Arranger::Pattern p;
    p.lengthTicks = BAR * 4;
    for (int b = 0; b < 4; ++b) {
        const int t0 = b * BAR;
        add(p, t0, 0, 36, 120, 20, kEvAbs);
        add(p, t0 + kPpq * 2, 0, 36, 116, 20, kEvAbs);
        add(p, t0 + kPpq + kPpq / 2, 0, 38, 110, 16, kEvAbs);
        add(p, t0 + kPpq * 3, 0, 38, 108, 16, kEvAbs);
        if (dens >= 1) add(p, t0 + kPpq / 2, 0, 42, 60, 8, kEvAbs);
        hats(p, t0, kPpq / 2, 62);
        add(p, t0, 1, 0, 114, 40, kEvBass);
        add(p, t0 + kPpq * 2, 1, 0, 108, 36, kEvBass);
        if (dens >= 2) add(p, t0 + kPpq * 3 + kPpq / 2, 1, 7, 90, 16, kEvBass);
        add(p, t0 + kPpq / 2, 2, 0, 70, 18, kEvComp);
        add(p, t0 + kPpq * 2 + kPpq / 2, 2, 1, 66, 18, kEvComp);
    }
    return p;
}

Arranger::Pattern rumbaPat(int dens) {
    Arranger::Pattern p;
    p.lengthTicks = BAR * 4;
    for (int b = 0; b < 4; ++b) {
        const int t0 = b * BAR;
        add(p, t0, 0, 36, 104, 20, kEvAbs);
        add(p, t0 + kPpq / 2, 0, 37, 70, 10, kEvAbs);
        add(p, t0 + kPpq, 0, 38, 96, 16, kEvAbs);
        add(p, t0 + kPpq * 2, 0, 36, 100, 20, kEvAbs);
        add(p, t0 + kPpq * 3 + kPpq / 2, 0, 38, 90, 12, kEvAbs);
        add(p, t0 + kPpq * 2 + kPpq / 2, 0, 54, 80, 12, kEvAbs);
        if (dens) hats(p, t0, kPpq / 2, 56);
        add(p, t0, 1, 0, 100, 36, kEvBass);
        add(p, t0 + kPpq * 2, 1, 7, 90, 32, kEvBass);
        add(p, t0 + kPpq / 2, 2, 0, 74, 24, kEvComp);
        add(p, t0 + kPpq * 2 + kPpq / 2, 2, 1, 70, 24, kEvComp);
    }
    return p;
}

Arranger::Pattern flamencoPat(int dens) {
    Arranger::Pattern p;
    p.lengthTicks = BAR * 4;
    for (int b = 0; b < 4; ++b) {
        const int t0 = b * BAR;
        add(p, t0, 0, 36, 100, 16, kEvAbs);
        add(p, t0 + kPpq / 2, 0, 39, 88, 8, kEvAbs);
        add(p, t0 + kPpq, 0, 39, 70, 8, kEvAbs);
        add(p, t0 + kPpq + kPpq / 2, 0, 39, 92, 8, kEvAbs);
        add(p, t0 + kPpq * 2, 0, 36, 104, 16, kEvAbs);
        add(p, t0 + kPpq * 3, 0, 39, 86, 8, kEvAbs);
        add(p, t0 + kPpq * 3 + kPpq / 2, 0, 39, 96, 8, kEvAbs);
        add(p, t0, 1, 0, 102, 28, kEvBass);
        add(p, t0 + kPpq, 1, 7, 88, 20, kEvBass);
        add(p, t0 + kPpq * 2, 1, 0, 100, 28, kEvBass);
        add(p, t0 + kPpq * 3, 1, 4, 86, 18, kEvBass);
        add(p, t0, 2, 0, (uint8_t)(82 + dens * 4), 18, kEvComp);
        add(p, t0 + kPpq / 2, 2, 1, 70, 12, kEvComp);
        add(p, t0 + kPpq * 2, 2, 2, 78, 18, kEvComp);
        add(p, t0 + kPpq * 3 + kPpq / 2, 2, 0, 74, 12, kEvComp);
    }
    return p;
}

Arranger::Pattern countryPat(int dens) {
    Arranger::Pattern p;
    p.lengthTicks = BAR * 4;
    for (int b = 0; b < 4; ++b) {
        const int t0 = b * BAR;
        add(p, t0, 0, 36, 108, 24, kEvAbs);
        add(p, t0 + kPpq, 0, 38, 100, 20, kEvAbs);
        add(p, t0 + kPpq * 2, 0, 36, 104, 24, kEvAbs);
        add(p, t0 + kPpq * 3, 0, 38, 102, 20, kEvAbs);
        hats(p, t0, kPpq / 2, 68);
        add(p, t0, 1, 0, 104, 40, kEvBass);
        add(p, t0 + kPpq, 1, 0, 88, 20, kEvBass);
        add(p, t0 + kPpq * 2, 1, 7, 96, 32, kEvBass);
        add(p, t0 + kPpq * 3, 1, 0, 86, 20, kEvBass);
        add(p, t0, 2, 0, 72, 30, kEvComp);
        add(p, t0 + kPpq, 2, 1, 78, 22, kEvComp);
        add(p, t0 + kPpq * 2, 2, 0, 72, 30, kEvComp);
        add(p, t0 + kPpq * 3, 2, 2, 76, 22, kEvComp);
        if (dens >= 2) add(p, t0 + kPpq * 3 + kPpq / 2, 3, 4, 60, 16, kEvComp);
    }
    return p;
}

Arranger::Pattern gospelPat(int dens) {
    Arranger::Pattern p;
    p.lengthTicks = BAR * 4;
    for (int b = 0; b < 4; ++b) {
        const int t0 = b * BAR;
        add(p, t0, 0, 36, 112, 24, kEvAbs);
        add(p, t0 + kPpq / 2, 0, 36, 80, 12, kEvAbs);
        add(p, t0 + kPpq, 0, 38, 108, 20, kEvAbs);
        add(p, t0 + kPpq * 2, 0, 36, 110, 20, kEvAbs);
        add(p, t0 + kPpq * 3, 0, 38, 110, 20, kEvAbs);
        hats(p, t0, kPpq / 4, 60 + dens * 6, kPpq * 3 + kPpq / 2);
        add(p, t0, 1, 0, 108, 28, kEvBass);
        add(p, t0 + kPpq, 1, 4, 92, 20, kEvBass);
        add(p, t0 + kPpq * 2, 1, 7, 100, 24, kEvBass);
        add(p, t0 + kPpq * 3, 1, 4, 90, 18, kEvBass);
        add(p, t0, 2, 0, 84, 28, kEvComp);
        add(p, t0 + kPpq / 2, 2, 1, 70, 14, kEvComp);
        add(p, t0 + kPpq * 2, 2, 2, 80, 28, kEvComp);
        add(p, t0, 3, 0, 62, 100, kEvComp);
    }
    return p;
}

Arranger::Pattern rnbPat(int dens) {
    Arranger::Pattern p;
    p.lengthTicks = BAR * 4;
    for (int b = 0; b < 4; ++b) {
        const int t0 = b * BAR;
        add(p, t0, 0, 36, 118, 24, kEvAbs);
        add(p, t0 + kPpq * 2 + kPpq / 2, 0, 36, 100, 16, kEvAbs);
        add(p, t0 + kPpq * 2, 0, 38, 104, 18, kEvAbs);
        add(p, t0 + kPpq * 3 + kPpq / 2, 0, 39, 88, 12, kEvAbs);
        hats(p, t0, kPpq / 4, 58);
        add(p, t0, 1, 0, 112, 36, kEvBass);
        add(p, t0 + kPpq * 2, 1, 7, 96, 24, kEvBass);
        if (dens >= 2) add(p, t0 + kPpq * 3 + kPpq / 2, 1, 10, 80, 14, kEvBass);
        add(p, t0 + kPpq / 2, 2, 0, 64, 20, kEvComp);
        add(p, t0 + kPpq * 2 + kPpq / 2, 2, 1, 60, 20, kEvComp);
        padHold(p, 1, 42);
    }
    return p;
}

Arranger::Pattern baladiPat(int dens) {
    Arranger::Pattern p;
    p.lengthTicks = BAR * 4;
    for (int b = 0; b < 4; ++b) {
        const int t0 = b * BAR;
        add(p, t0, 0, 36, 118, 24, kEvAbs);
        add(p, t0 + kPpq / 2, 0, 36, 108, 20, kEvAbs);
        add(p, t0 + kPpq + kPpq / 2, 0, 37, 100, 16, kEvAbs);
        add(p, t0 + kPpq * 2 + kPpq / 2, 0, 37, 96, 16, kEvAbs);
        add(p, t0 + kPpq * 3, 0, 36, 114, 24, kEvAbs);
        add(p, t0 + kPpq * 3 + kPpq / 2, 0, 37, 90, 16, kEvAbs);
        if (dens >= 1) hats(p, t0, kPpq / 2, 56);
        if (dens >= 2) add(p, t0 + kPpq * 2, 0, 76, 80, 12, kEvAbs);
        add(p, t0, 1, 0, 104, 36, kEvBass);
        add(p, t0 + kPpq, 1, dens >= 2 ? 7 : 0, 90, 24, kEvBass);
        add(p, t0 + kPpq * 2, 1, 0, 100, 36, kEvBass);
        add(p, t0 + kPpq * 3, 1, 4, 86, 22, kEvBass);
        add(p, t0, 2, 0, (uint8_t)(86 + dens * 4), 36, kEvComp);
        add(p, t0 + kPpq, 2, 1, 80, 24, kEvComp);
        add(p, t0 + kPpq * 2, 2, 0, 84, 36, kEvComp);
        add(p, t0 + kPpq * 3, 2, 2, 78, 24, kEvComp);
        add(p, t0, 3, 0, 60, 110, kEvComp);
    }
    return p;
}

Arranger::Pattern maqsumPat(int dens) {
    Arranger::Pattern p;
    p.lengthTicks = BAR * 4;
    for (int b = 0; b < 4; ++b) {
        const int t0 = b * BAR;
        add(p, t0, 0, 36, 120, 24, kEvAbs);
        add(p, t0 + kPpq / 2, 0, 37, 88, 12, kEvAbs);
        add(p, t0 + kPpq, 0, 37, 104, 16, kEvAbs);
        add(p, t0 + kPpq * 2, 0, 36, 116, 24, kEvAbs);
        add(p, t0 + kPpq * 3, 0, 37, 100, 16, kEvAbs);
        if (dens >= 1) hats(p, t0, kPpq / 2, 54);
        add(p, t0, 1, 0, 102, 40, kEvBass);
        add(p, t0 + kPpq * 2, 1, dens >= 2 ? 7 : 0, 94, 32, kEvBass);
        compOffbeat(p, 1, 80);
    }
    return p;
}

Arranger::Pattern horaPat(int dens) {
    Arranger::Pattern p;
    p.lengthTicks = BAR * 4;
    for (int b = 0; b < 4; ++b) {
        const int t0 = b * BAR;
        add(p, t0, 0, 36, 112, 18, kEvAbs);
        add(p, t0 + kPpq / 2, 0, 42, 70, 8, kEvAbs);
        add(p, t0 + kPpq, 0, 38, 100, 16, kEvAbs);
        add(p, t0 + kPpq * 2, 0, 36, 108, 18, kEvAbs);
        add(p, t0 + kPpq * 3, 0, 38, 102, 16, kEvAbs);
        hats(p, t0, kPpq / 2, 60);
        add(p, t0, 1, 0, 108, 28, kEvBass);
        add(p, t0 + kPpq, 1, 7, 92, 20, kEvBass);
        add(p, t0 + kPpq * 2, 1, 0, 104, 28, kEvBass);
        add(p, t0 + kPpq * 3, 1, 4, 90, 18, kEvBass);
        add(p, t0, 2, 0, 84, 20, kEvComp);
        add(p, t0 + kPpq / 2, 2, 1, 70, 12, kEvComp);
        add(p, t0 + kPpq * 2, 2, 2, 80, 20, kEvComp);
        if (dens >= 2) add(p, t0 + kPpq * 3, 3, 4, 64, 16, kEvComp);
    }
    return p;
}

Arranger::Pattern greekPat(int dens) {
    Arranger::Pattern p;
    p.lengthTicks = BAR * 4;
    for (int b = 0; b < 4; ++b) {
        const int t0 = b * BAR;
        add(p, t0, 0, 36, 110, 16, kEvAbs);
        add(p, t0 + kPpq, 0, 42, 72, 8, kEvAbs);
        add(p, t0 + kPpq * 2, 0, 38, 100, 16, kEvAbs);
        add(p, t0 + kPpq * 3, 0, 42, 68, 8, kEvAbs);
        add(p, t0 + kPpq / 2, 0, 76, 70, 8, kEvAbs);
        add(p, t0, 1, 0, 106, 32, kEvBass);
        add(p, t0 + kPpq * 2, 1, 7, 94, 28, kEvBass);
        add(p, t0, 2, 0, 80, 24, kEvComp);
        add(p, t0 + kPpq, 2, 1, 72, 16, kEvComp);
        add(p, t0 + kPpq * 2, 2, 2, 78, 24, kEvComp);
        add(p, t0 + kPpq * 3, 2, 0, 70, 16, kEvComp);
        if (dens) add(p, t0, 3, 0, 55, 100, kEvComp);
    }
    return p;
}

Arranger::Pattern karsilamaPat() {
    Arranger::Pattern p;
    const int bar9 = (kPpq * 9) / 2;
    p.lengthTicks = bar9 * 4;
    for (int b = 0; b < 4; ++b) {
        const int t0 = b * bar9;
        add(p, t0, 0, 36, 118, 16, kEvAbs);
        add(p, t0 + kPpq, 0, 37, 90, 10, kEvAbs);
        add(p, t0 + kPpq * 2, 0, 36, 110, 14, kEvAbs);
        add(p, t0 + kPpq * 3, 0, 37, 96, 10, kEvAbs);
        add(p, t0 + kPpq * 4, 0, 37, 88, 10, kEvAbs);
        add(p, t0, 1, 0, 108, 28, kEvBass);
        add(p, t0 + kPpq * 2, 1, 7, 92, 20, kEvBass);
        add(p, t0, 2, 0, 80, 22, kEvComp);
        add(p, t0 + kPpq * 2, 2, 1, 74, 18, kEvComp);
    }
    return p;
}

Arranger::Pattern waltzPat() {
    Arranger::Pattern p;
    p.lengthTicks = kPpq * 3 * 4;
    const int wbar = kPpq * 3;
    for (int b = 0; b < 4; ++b) {
        const int t0 = b * wbar;
        add(p, t0, 0, 36, 110, 24, kEvAbs);
        add(p, t0 + kPpq, 0, 42, 70, 12, kEvAbs);
        add(p, t0 + kPpq * 2, 0, 42, 70, 12, kEvAbs);
        add(p, t0, 1, 0, 100, 48, kEvBass);
        add(p, t0 + kPpq, 2, 1, 80, 24, kEvComp);
        add(p, t0 + kPpq * 2, 2, 2, 76, 24, kEvComp);
    }
    return p;
}

Arranger::Pattern fillTom() {
    Arranger::Pattern p;
    p.lengthTicks = BAR;
    add(p, 0, 0, 42, 70, 8, kEvAbs);
    add(p, kPpq, 0, 47, 100, 16, kEvAbs);
    add(p, kPpq + kPpq / 2, 0, 45, 104, 16, kEvAbs);
    add(p, kPpq * 2, 0, 43, 108, 16, kEvAbs);
    add(p, kPpq * 2 + kPpq / 2, 0, 41, 112, 16, kEvAbs);
    add(p, kPpq * 3, 0, 38, 118, 24, kEvAbs);
    add(p, kPpq * 3 + kPpq / 2, 0, 36, 120, 24, kEvAbs);
    return p;
}

Arranger::Pattern fillSnare() {
    Arranger::Pattern p;
    p.lengthTicks = BAR;
    for (int i = 0; i < 8; ++i) add(p, i * (kPpq / 2), 0, 38, (uint8_t)(80 + i * 4), 10, kEvAbs);
    add(p, kPpq * 3 + kPpq / 2, 0, 36, 120, 16, kEvAbs);
    return p;
}

Arranger::Pattern introCount() {
    Arranger::Pattern p;
    p.lengthTicks = BAR;
    add(p, 0, 0, 42, 80, 8, kEvAbs);
    add(p, kPpq, 0, 42, 80, 8, kEvAbs);
    add(p, kPpq * 2, 0, 42, 90, 8, kEvAbs);
    add(p, kPpq * 3, 0, 38, 110, 16, kEvAbs);
    return p;
}

Arranger::Pattern endingPhrase() {
    Arranger::Pattern p;
    p.lengthTicks = BAR * 2;
    add(p, 0, 0, 36, 110, 24, kEvAbs);
    add(p, kPpq, 0, 38, 100, 24, kEvAbs);
    add(p, kPpq * 2, 0, 47, 108, 16, kEvAbs);
    add(p, kPpq * 3, 0, 41, 112, 16, kEvAbs);
    add(p, BAR, 0, 36, 120, 48, kEvAbs);
    add(p, BAR, 0, 49, 114, 72, kEvAbs);
    add(p, 0, 1, 0, 100, 48, kEvBass);
    add(p, BAR, 1, 0, 110, 80, kEvBass);
    add(p, 0, 2, 0, 90, 60, kEvComp);
    add(p, BAR, 2, 0, 100, 90, kEvComp);
    return p;
}

Arranger::Pattern brkPat() {
    Arranger::Pattern p;
    p.lengthTicks = BAR;
    add(p, 0, 0, 36, 70, 8, kEvAbs);
    add(p, kPpq * 3 + kPpq / 2, 0, 38, 118, 16, kEvAbs);
    return p;
}

Arranger::Style finish(Arranger::Style s) {
    if (s.intro3.evs.empty()) s.intro3 = introCount();
    if (s.intro1.evs.empty()) {
        s.intro1 = s.var[0];
        s.intro1.lengthTicks = std::max(BAR, s.intro1.lengthTicks / 2);
    }
    if (s.intro2.evs.empty()) s.intro2 = s.var[1].evs.empty() ? s.var[0] : s.var[1];
    for (int i = 0; i < 4; ++i) {
        if (s.fill[i].evs.empty()) s.fill[i] = (i % 2) ? fillSnare() : fillTom();
    }
    if (s.brk.evs.empty()) s.brk = brkPat();
    if (s.end1.evs.empty()) s.end1 = endingPhrase();
    if (s.end2.evs.empty()) s.end2 = endingPhrase();
    if (s.end3.evs.empty()) {
        s.end3.lengthTicks = BAR;
        add(s.end3, 0, 0, 36, 120, 48, kEvAbs);
        add(s.end3, 0, 0, 49, 120, 72, kEvAbs);
        add(s.end3, 0, 1, 0, 110, 72, kEvBass);
        add(s.end3, 0, 2, 0, 100, 72, kEvComp);
    }
    return s;
}

void drumsOnly(Arranger::Pattern& p) {
    p.evs.erase(std::remove_if(p.evs.begin(), p.evs.end(),
                               [](const Arranger::Ev& e) { return e.flags == kEvBass || e.flags == kEvComp; }),
                p.evs.end());
    p.bassProg = -1;
    p.acc1 = -1;
    p.acc2 = -1;
    p.acc3 = -1;
}

void drumsOnlyStyle(Arranger::Style& s) {
    drumsOnly(s.intro1);
    drumsOnly(s.intro2);
    drumsOnly(s.intro3);
    for (int i = 0; i < 4; ++i) {
        drumsOnly(s.var[i]);
        drumsOnly(s.fill[i]);
    }
    drumsOnly(s.brk);
    drumsOnly(s.end1);
    drumsOnly(s.end2);
    drumsOnly(s.end3);
}

Arranger::Style factoryDrumStyle(Arranger::Style s) {
    s = finish(std::move(s));
    drumsOnlyStyle(s);
    return s;
}

using Maker = Arranger::Pattern (*)(int);

void pushVariations(Arranger& arr, const char* name, const char* cat, float tempo, Maker maker) {
    Arranger::Style s;
    nameStyle(s, name, cat, tempo);
    s.var[0] = maker(0);
    s.var[1] = maker(1);
    s.var[2] = maker(2);
    s.var[3] = maker(3);
    arr.styles.push_back(factoryDrumStyle(std::move(s)));
}

}  // namespace

Arranger::Style completeStyle(Arranger::Style s) { return finish(std::move(s)); }

Arranger::Style fallbackStyle(const char* name, const char* cat, float tempo) {
    Arranger::Style s;
    nameStyle(s, name, cat ? cat : "Style", tempo);
    s.var[0] = popRock(1, false);
    s.var[1] = popRock(2, false);
    s.var[2] = popRock(2, false);
    s.var[3] = popRock(3, false);
    return finish(std::move(s));
}

void buildArranger(Arranger& arr) {
    arr.styles.clear();
    auto rock = [](int d) { return popRock(d, true); };
    auto pop = [](int d) { return popRock(d, false); };
    auto disco = [](int d) { return discoFunk(d, false); };
    auto funk = [](int d) { return discoFunk(d, true); };

    pushVariations(arr, "8 Beat Pop", "Pop", 112, pop);
    pushVariations(arr, "Dance Pop", "Pop", 124, disco);
    pushVariations(arr, "Soft Pop", "Pop", 100, pop);
    pushVariations(arr, "Classic Rock", "Rock", 118, rock);
    pushVariations(arr, "Hard Rock", "Rock", 128, rock);
    pushVariations(arr, "16 Beat Ballad", "Ballad", 72, balladPat);
    pushVariations(arr, "Slow Rock", "Ballad", 66, balladPat);
    pushVariations(arr, "Disco Night", "Disco", 120, disco);
    pushVariations(arr, "Euro Dance", "Dance", 128, disco);
    pushVariations(arr, "Funky Groove", "Funk", 108, funk);
    pushVariations(arr, "Swing Jazz", "Jazz", 132, swingJazz);
    pushVariations(arr, "Jazz Ballad", "Jazz", 88, swingJazz);
    pushVariations(arr, "Salsa", "Latin", 96, salsaPat);
    pushVariations(arr, "Merengue", "Latin", 140, merenguePat);
    pushVariations(arr, "Reggaeton", "Latin", 96, dembowPat);
    pushVariations(arr, "Rumba", "Latin", 104, rumbaPat);
    pushVariations(arr, "Flamenco", "World", 118, flamencoPat);
    pushVariations(arr, "Country Train", "Country", 112, countryPat);
    pushVariations(arr, "Gospel Shout", "Gospel", 108, gospelPat);
    pushVariations(arr, "R&B Slow", "R&B", 78, rnbPat);
    pushVariations(arr, "Baladi", "Oriental", 98, baladiPat);
    pushVariations(arr, "Maqsum", "Oriental", 108, maqsumPat);
    pushVariations(arr, "Saidi", "Oriental", 102, baladiPat);
    pushVariations(arr, "Malfouf", "Oriental", 126, maqsumPat);
    pushVariations(arr, "Israeli Hora", "World", 132, horaPat);
    pushVariations(arr, "Greek Syrtaki", "World", 120, greekPat);
    pushVariations(arr, "Arabic Pop", "Oriental", 114, baladiPat);

    Arranger::Style waltz;
    nameStyle(waltz, "Waltz", "Ballad", 90);
    waltz.var[0] = waltzPat();
    waltz.var[1] = waltzPat();
    waltz.var[2] = waltzPat();
    waltz.var[3] = waltzPat();
    arr.styles.push_back(factoryDrumStyle(std::move(waltz)));

    Arranger::Style kar;
    nameStyle(kar, "Turkish 9/8", "World", 126);
    kar.var[0] = karsilamaPat();
    kar.var[1] = karsilamaPat();
    kar.var[2] = karsilamaPat();
    kar.var[3] = karsilamaPat();
    arr.styles.push_back(factoryDrumStyle(std::move(kar)));

    Arranger::Style miz;
    nameStyle(miz, "Mizrahi Pop", "Oriental", 114);
    miz.var[0] = baladiPat(1);
    miz.var[1] = popRock(1, false);
    miz.var[2] = baladiPat(2);
    miz.var[3] = popRock(3, false);
    arr.styles.push_back(factoryDrumStyle(std::move(miz)));

    Arranger::Style bossa;
    nameStyle(bossa, "Bossa Nova", "Latin", 118);
    bossa.var[0] = rumbaPat(0);
    bossa.var[1] = rumbaPat(1);
    bossa.var[2] = rumbaPat(2);
    bossa.var[3] = rumbaPat(3);
    arr.styles.push_back(factoryDrumStyle(std::move(bossa)));
}

}  // namespace pa
