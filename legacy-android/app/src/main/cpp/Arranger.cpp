#include "Engine.h"

#include <cstring>

namespace pa {

namespace {
constexpr uint8_t F_ABS = 0;
constexpr uint8_t F_BASS = 1;
constexpr uint8_t F_COMP = 2;
constexpr int BAR = kPpq * 4;

void add(Arranger::Pattern& p, int tick, uint8_t trk, uint8_t note, uint8_t vel, uint8_t dur, uint8_t flags) {
    if (tick < 0) return;
    p.evs.push_back({(uint16_t)tick, trk, note, vel, dur, flags});
}

void drums8(Arranger::Pattern& p, int bars, int kickVel, int snareVel, int hatVel, bool sixteenth) {
    for (int b = 0; b < bars; ++b) {
        const int t0 = b * BAR;
        add(p, t0, 0, 36, (uint8_t)kickVel, 24, F_ABS);
        add(p, t0 + kPpq * 2, 0, 36, (uint8_t)(kickVel - 8), 24, F_ABS);
        add(p, t0 + kPpq, 0, 38, (uint8_t)snareVel, 24, F_ABS);
        add(p, t0 + kPpq * 3, 0, 38, (uint8_t)snareVel, 24, F_ABS);
        const int step = sixteenth ? kPpq / 4 : kPpq / 2;
        for (int s = 0; s < BAR; s += step) {
            const bool accent = (s % kPpq) == 0;
            add(p, t0 + s, 0, 42, (uint8_t)(accent ? hatVel : hatVel - 22), 12, F_ABS);
        }
    }
}

void bassRoots(Arranger::Pattern& p, int bars, int vel, bool walking) {
    for (int b = 0; b < bars; ++b) {
        const int t0 = b * BAR;
        add(p, t0, 1, 0, (uint8_t)vel, 48, F_BASS);
        add(p, t0 + kPpq, 1, walking ? 7 : 0, (uint8_t)(vel - 12), 36, F_BASS);
        add(p, t0 + kPpq * 2, 1, 0, (uint8_t)vel, 48, F_BASS);
        add(p, t0 + kPpq * 3, 1, walking ? 4 : 7, (uint8_t)(vel - 16), 36, F_BASS);
        if (walking) add(p, t0 + kPpq * 3 + kPpq / 2, 1, 10, (uint8_t)(vel - 24), 18, F_BASS);
    }
}

void comp(Arranger::Pattern& p, int bars, int vel, bool offbeat) {
    for (int b = 0; b < bars; ++b) {
        const int t0 = b * BAR;
        if (offbeat) {
            add(p, t0 + kPpq / 2, 2, 0, (uint8_t)vel, 24, F_COMP);
            add(p, t0 + kPpq + kPpq / 2, 2, 1, (uint8_t)(vel - 8), 24, F_COMP);
            add(p, t0 + kPpq * 2 + kPpq / 2, 2, 2, (uint8_t)vel, 24, F_COMP);
            add(p, t0 + kPpq * 3 + kPpq / 2, 2, 0, (uint8_t)(vel - 8), 24, F_COMP);
        } else {
            add(p, t0, 2, 0, (uint8_t)vel, 60, F_COMP);
            add(p, t0 + kPpq * 2, 2, 1, (uint8_t)(vel - 6), 60, F_COMP);
        }
        add(p, t0, 3, 0, (uint8_t)(vel - 18), 90, F_COMP);
        if (bars >= 2 && b % 2 == 1) add(p, t0 + kPpq * 2, 4, 2, (uint8_t)(vel - 24), 80, F_COMP);
    }
}

void fillTom(Arranger::Pattern& p) {
    add(p, 0, 0, 42, 70, 8, F_ABS);
    add(p, kPpq, 0, 47, 100, 16, F_ABS);
    add(p, kPpq + kPpq / 2, 0, 45, 104, 16, F_ABS);
    add(p, kPpq * 2, 0, 43, 108, 16, F_ABS);
    add(p, kPpq * 2 + kPpq / 2, 0, 41, 112, 16, F_ABS);
    add(p, kPpq * 3, 0, 38, 118, 24, F_ABS);
    add(p, kPpq * 3 + kPpq / 2, 0, 36, 120, 24, F_ABS);
    p.lengthTicks = BAR;
}

void nameStyle(Arranger::Style& s, const char* n, const char* c, float tempo) {
    std::memset(s.name, 0, sizeof(s.name));
    std::memset(s.category, 0, sizeof(s.category));
    std::strncpy(s.name, n, sizeof(s.name) - 1);
    std::strncpy(s.category, c, sizeof(s.category) - 1);
    s.tempo = tempo;
}

int chordInterval(int type, int degree) {
    // degree 0=root 1=3rd 2=5th 3=7th 4=9th 7=fifth octave 10=6th
    const int maj3 = (type == 1 || type == 3 || type == 6) ? 3 : (type == 5 ? 5 : 4);
    const int fifth = type == 6 ? 6 : 7;
    const int seventh = (type == 2 || type == 3) ? 10 : (type == 4 ? 11 : 12);
    switch (degree) {
        case 0: return 0;
        case 1: return maj3;
        case 2: return fifth;
        case 3: return seventh;
        case 4: return 14;
        case 7: return fifth;
        case 10: return type == 1 ? 8 : 9;
        default: return degree;
    }
}

int bassNote(int root, int type, int degree) {
    const int iv = chordInterval(type, degree);
    return 36 + root + iv;
}

int compNote(int root, int type, int voice) {
    const int base = 60 + root;
    const int voicing[4] = {0, 1, 2, 3};
    return base + chordInterval(type, voicing[voice & 3]);
}

const Arranger::Pattern* patternFor(const Arranger::Style& st, Section sec) {
    switch (sec) {
        case Section::Intro1: return &st.intro1;
        case Section::Intro2: return &st.intro2;
        case Section::Intro3: return &st.intro3;
        case Section::Var1: return &st.var[0];
        case Section::Var2: return &st.var[1];
        case Section::Var3: return &st.var[2];
        case Section::Var4: return &st.var[3];
        case Section::Fill1: return &st.fill[0];
        case Section::Fill2: return &st.fill[1];
        case Section::Fill3: return &st.fill[2];
        case Section::Fill4: return &st.fill[3];
        case Section::Break: return &st.brk;
        case Section::Ending1: return &st.end1;
        case Section::Ending2: return &st.end2;
        case Section::Ending3: return &st.end3;
        default: return &st.var[0];
    }
}

bool isFill(Section s) { return s >= Section::Fill1 && s <= Section::Fill4; }
bool isEnding(Section s) { return s >= Section::Ending1 && s <= Section::Ending3; }
bool isIntro(Section s) { return s >= Section::Intro1 && s <= Section::Intro3; }

int varIndex(Section s) {
    if (s >= Section::Var1 && s <= Section::Var4) return (int)s - (int)Section::Var1 + 1;
    return 1;
}
}  // namespace

void Arranger::setup() { styles.clear(); }

int Arranger::styleCount() const { return (int)styles.size(); }
const char* Arranger::styleName(int id) const {
    if (id < 0 || id >= (int)styles.size()) return "";
    return styles[id].name;
}
const char* Arranger::styleCategory(int id) const {
    if (id < 0 || id >= (int)styles.size()) return "";
    return styles[id].category;
}
float Arranger::styleTempo(int id) const {
    if (id < 0 || id >= (int)styles.size()) return 100.0f;
    return styles[id].tempo;
}

void Arranger::start(ArrangerState& st) {
    st.running = true;
    st.playing.store(1);
    st.tickPos = 0;
    st.barLenTicks = 0;
    if (st.current == Section::None) st.current = (Section)((int)Section::Var1 + st.variation - 1);
    st.displaySection.store((int)st.current);
}
void Arranger::stop(ArrangerState& st) {
    st.running = false;
    st.playing.store(0);
    st.booked = Section::None;
}
void Arranger::book(ArrangerState& st, Section s) {
    if (s == Section::Break || s == Section::Ending3) {
        st.current = s;
        st.tickPos = 0;
        st.barLenTicks = 0;
        st.displaySection.store((int)s);
        if (!st.running) start(st);
        return;
    }
    if (st.autoFill && s >= Section::Var1 && s <= Section::Var4 && st.running &&
        st.current >= Section::Var1 && st.current <= Section::Var4 && s != st.current) {
        const int idx = (int)s - (int)Section::Var1;
        st.booked = s;
        st.current = (Section)((int)Section::Fill1 + idx);
        st.tickPos = 0;
        st.barLenTicks = 0;
        st.variation = idx + 1;
        st.displaySection.store((int)st.current);
        return;
    }
    st.booked = s;
    if (s >= Section::Var1 && s <= Section::Var4) st.variation = varIndex(s);
    if (!st.running) {
        st.current = s;
        st.displaySection.store((int)s);
    }
}
void Arranger::setStyle(ArrangerState& st, int id) {
    if (id < 0 || id >= (int)styles.size()) return;
    st.styleId = id;
    st.tempo = styles[id].tempo;
}
void Arranger::onChord(ArrangerState& st, int root, int type) {
    st.chordRoot = root;
    st.chordType = type;
    st.displayRoot.store(root);
    st.displayType.store(type);
}

void Arranger::renderTicks(Engine& eng, ArrangerState& st, int ticks, float) {
    if (!st.running || styles.empty()) return;
    const Style& sty = styles[st.styleId % (int)styles.size()];
    int& ph = st.barLenTicks;
    for (int t = 0; t < ticks; ++t) {
        const Pattern* pat = patternFor(sty, st.current);
        const int len = std::max(1, pat->lengthTicks);
        const int at = ph % len;
        for (const Ev& ev : pat->evs) {
            if ((int)ev.tick != at) continue;
            int note = ev.note;
            int bus = BusDrums;
            int inst = 32;
            int ch = 10 + ev.trk;
            if (ev.flags == F_ABS) {
                bus = BusDrums;
                inst = (sty.var[0].drumProg >= 0) ? sty.var[0].drumProg : 32;
            } else if (ev.flags == F_BASS) {
                note = bassNote(st.chordRoot, st.chordType, ev.note);
                bus = BusBass;
                inst = 21;
                ch = 9;
            } else {
                note = compNote(st.chordRoot, st.chordType, ev.note);
                bus = (ev.trk >= 4) ? BusPad : BusAcc;
                inst = (ev.trk == 2) ? 0 : (ev.trk == 3 ? 9 : 11);
                ch = 8;
            }
            eng.playInternal(inst, note, ev.vel, bus, ch);
        }
        ph++;
        if (ph >= len) {
            ph = 0;
            if (isFill(st.current) || isIntro(st.current)) {
                const Section next = st.booked != Section::None
                                             ? st.booked
                                             : (Section)((int)Section::Var1 + st.variation - 1);
                st.current = next;
                st.booked = Section::None;
                st.displaySection.store((int)st.current);
            } else if (isEnding(st.current) || st.current == Section::Break) {
                if (st.current == Section::Break) {
                    st.current = (Section)((int)Section::Var1 + st.variation - 1);
                    st.displaySection.store((int)st.current);
                } else {
                    stop(st);
                    return;
                }
            } else if (st.booked != Section::None) {
                st.current = st.booked;
                st.booked = Section::None;
                st.displaySection.store((int)st.current);
            }
        }
    }
}

static Arranger::Pattern makePop(int density) {
    Arranger::Pattern p;
    p.lengthTicks = BAR * 4;
    p.drumProg = 32;
    drums8(p, 4, 110, 100 + density * 4, 78 + density * 6, density >= 2);
    bassRoots(p, 4, 100, density >= 2);
    comp(p, 4, 78 + density * 6, density >= 1);
    if (density >= 3) {
        for (int b = 0; b < 4; ++b) add(p, b * BAR + kPpq * 3 + kPpq / 2, 0, 46, 70, 18, F_ABS);
    }
    return p;
}

static Arranger::Pattern makeBaladi(int density) {
    Arranger::Pattern p;
    p.lengthTicks = BAR * 4;
    p.drumProg = 33;
    for (int b = 0; b < 4; ++b) {
        const int t0 = b * BAR;
        // Dum Dum - tek - tek Dum - tek
        add(p, t0, 0, 36, 118, 24, F_ABS);
        add(p, t0 + kPpq / 2, 0, 36, 108, 20, F_ABS);
        add(p, t0 + kPpq + kPpq / 2, 0, 37, 100, 16, F_ABS);
        add(p, t0 + kPpq * 2 + kPpq / 2, 0, 37, 96, 16, F_ABS);
        add(p, t0 + kPpq * 3, 0, 36, 114, 24, F_ABS);
        add(p, t0 + kPpq * 3 + kPpq / 2, 0, 37, 90, 16, F_ABS);
        if (density >= 1) {
            for (int s = 0; s < BAR; s += kPpq / 2) add(p, t0 + s, 0, 42, (uint8_t)(s % kPpq == 0 ? 72 : 52), 8, F_ABS);
        }
        if (density >= 2) add(p, t0 + kPpq * 2, 0, 76, 80, 12, F_ABS);
    }
    bassRoots(p, 4, 104, density >= 2);
    for (int b = 0; b < 4; ++b) {
        const int t0 = b * BAR;
        add(p, t0, 2, 0, (uint8_t)(86 + density * 4), 36, F_COMP);
        add(p, t0 + kPpq, 2, 1, 80, 24, F_COMP);
        add(p, t0 + kPpq * 2, 2, 0, 84, 36, F_COMP);
        add(p, t0 + kPpq * 3, 2, 2, 78, 24, F_COMP);
        add(p, t0, 3, 0, 60, 110, F_COMP);
    }
    return p;
}

static Arranger::Pattern makeMaqsum(int density) {
    Arranger::Pattern p;
    p.lengthTicks = BAR * 4;
    p.drumProg = 33;
    for (int b = 0; b < 4; ++b) {
        const int t0 = b * BAR;
        add(p, t0, 0, 36, 120, 24, F_ABS);
        add(p, t0 + kPpq / 2, 0, 37, 88, 12, F_ABS);
        add(p, t0 + kPpq, 0, 37, 104, 16, F_ABS);
        add(p, t0 + kPpq * 2, 0, 36, 116, 24, F_ABS);
        add(p, t0 + kPpq * 3, 0, 37, 100, 16, F_ABS);
        if (density >= 1)
            for (int s = 0; s < BAR; s += kPpq / 2) add(p, t0 + s, 0, 42, 58, 8, F_ABS);
    }
    bassRoots(p, 4, 100, density >= 2);
    comp(p, 4, 82, true);
    return p;
}

static Arranger::Pattern makeBallad(int density) {
    Arranger::Pattern p;
    p.lengthTicks = BAR * 4;
    p.drumProg = 32;
    for (int b = 0; b < 4; ++b) {
        const int t0 = b * BAR;
        add(p, t0, 0, 36, 96, 48, F_ABS);
        add(p, t0 + kPpq * 2, 0, 38, 90, 36, F_ABS);
        if (density >= 1) {
            add(p, t0 + kPpq, 0, 42, 54, 12, F_ABS);
            add(p, t0 + kPpq * 3, 0, 42, 50, 12, F_ABS);
        }
        if (density >= 2) add(p, t0 + kPpq * 3 + kPpq / 2, 0, 46, 60, 20, F_ABS);
    }
    for (int b = 0; b < 4; ++b) {
        add(p, b * BAR, 1, 0, 92, 90, F_BASS);
        add(p, b * BAR + kPpq * 2, 1, 7, 80, 70, F_BASS);
    }
    comp(p, 4, 70 + density * 5, false);
    return p;
}

static Arranger::Pattern makeWaltz() {
    Arranger::Pattern p;
    p.lengthTicks = kPpq * 3 * 4;
    const int wbar = kPpq * 3;
    for (int b = 0; b < 4; ++b) {
        const int t0 = b * wbar;
        add(p, t0, 0, 36, 110, 24, F_ABS);
        add(p, t0 + kPpq, 0, 42, 70, 12, F_ABS);
        add(p, t0 + kPpq * 2, 0, 42, 70, 12, F_ABS);
        add(p, t0, 1, 0, 100, 48, F_BASS);
        add(p, t0 + kPpq, 2, 1, 80, 24, F_COMP);
        add(p, t0 + kPpq * 2, 2, 2, 76, 24, F_COMP);
    }
    return p;
}

static Arranger::Pattern introCount() {
    Arranger::Pattern p;
    p.lengthTicks = BAR;
    add(p, 0, 0, 42, 80, 8, F_ABS);
    add(p, kPpq, 0, 42, 80, 8, F_ABS);
    add(p, kPpq * 2, 0, 42, 90, 8, F_ABS);
    add(p, kPpq * 3, 0, 38, 110, 16, F_ABS);
    return p;
}

static Arranger::Pattern introPhrase() {
    Arranger::Pattern p;
    p.lengthTicks = BAR * 2;
    drums8(p, 2, 100, 90, 70, false);
    bassRoots(p, 2, 90, false);
    comp(p, 2, 72, false);
    add(p, BAR * 2 - kPpq / 2, 0, 49, 100, 48, F_ABS);
    return p;
}

static Arranger::Pattern endingPhrase() {
    Arranger::Pattern p;
    p.lengthTicks = BAR * 2;
    add(p, 0, 0, 36, 110, 24, F_ABS);
    add(p, kPpq, 0, 38, 100, 24, F_ABS);
    add(p, kPpq * 2, 0, 47, 108, 16, F_ABS);
    add(p, kPpq * 3, 0, 41, 112, 16, F_ABS);
    add(p, BAR, 0, 36, 120, 48, F_ABS);
    add(p, BAR, 0, 49, 114, 72, F_ABS);
    add(p, 0, 1, 0, 100, 48, F_BASS);
    add(p, BAR, 1, 0, 110, 80, F_BASS);
    add(p, 0, 2, 0, 90, 60, F_COMP);
    add(p, BAR, 2, 0, 100, 90, F_COMP);
    return p;
}

static Arranger::Pattern brkPat() {
    Arranger::Pattern p;
    p.lengthTicks = BAR;
    add(p, 0, 0, 36, 70, 8, F_ABS);
    add(p, kPpq * 3 + kPpq / 2, 0, 38, 118, 16, F_ABS);
    return p;
}

static Arranger::Style finish(Arranger::Style s) {
    s.intro3 = introCount();
    if (s.intro1.evs.empty()) s.intro1 = introPhrase();
    if (s.intro2.evs.empty()) s.intro2 = s.var[0];
    for (int i = 0; i < 4; ++i) {
        if (s.fill[i].evs.empty()) {
            s.fill[i] = Arranger::Pattern{};
            fillTom(s.fill[i]);
        }
    }
    if (s.brk.evs.empty()) s.brk = brkPat();
    if (s.end1.evs.empty()) s.end1 = endingPhrase();
    if (s.end2.evs.empty()) s.end2 = endingPhrase();
    if (s.end3.evs.empty()) {
        s.end3 = Arranger::Pattern{};
        s.end3.lengthTicks = BAR;
        add(s.end3, 0, 0, 36, 120, 48, F_ABS);
        add(s.end3, 0, 0, 49, 120, 72, F_ABS);
        add(s.end3, 0, 1, 0, 110, 72, F_BASS);
        add(s.end3, 0, 2, 0, 100, 72, F_COMP);
    }
    return s;
}

void buildArranger(Arranger& arr) {
    arr.styles.clear();

    auto pop = [&](const char* n, const char* c, float tempo) {
        Arranger::Style s;
        nameStyle(s, n, c, tempo);
        s.var[0] = makePop(0);
        s.var[1] = makePop(1);
        s.var[2] = makePop(2);
        s.var[3] = makePop(3);
        arr.styles.push_back(finish(s));
    };
    pop("8 Beat Pop", "Pop", 112);
    pop("Dance Pop", "Pop", 124);

    Arranger::Style ballad;
    nameStyle(ballad, "16 Beat Ballad", "Ballad", 72);
    ballad.var[0] = makeBallad(0);
    ballad.var[1] = makeBallad(1);
    ballad.var[2] = makeBallad(2);
    ballad.var[3] = makeBallad(3);
    arr.styles.push_back(finish(ballad));

    Arranger::Style slow;
    nameStyle(slow, "Slow Rock", "Ballad", 66);
    slow.var[0] = makeBallad(1);
    slow.var[1] = makeBallad(2);
    slow.var[2] = makePop(1);
    slow.var[3] = makePop(2);
    arr.styles.push_back(finish(slow));

    Arranger::Style blues;
    nameStyle(blues, "Shuffle Blues", "Blues", 92);
    blues.var[0] = makePop(1);
    blues.var[1] = makePop(2);
    blues.var[2] = makePop(2);
    blues.var[3] = makePop(3);
    arr.styles.push_back(finish(blues));

    Arranger::Style bossa;
    nameStyle(bossa, "Bossa Nova", "Latin", 118);
    bossa.var[0] = makePop(0);
    bossa.var[1] = makePop(1);
    bossa.var[2] = makePop(1);
    bossa.var[3] = makePop(2);
    arr.styles.push_back(finish(bossa));

    Arranger::Style rumba;
    nameStyle(rumba, "Rumba", "Latin", 104);
    rumba.var[0] = makePop(1);
    rumba.var[1] = makePop(1);
    rumba.var[2] = makePop(2);
    rumba.var[3] = makePop(3);
    arr.styles.push_back(finish(rumba));

    Arranger::Style waltz;
    nameStyle(waltz, "Waltz", "Ballroom", 90);
    waltz.var[0] = makeWaltz();
    waltz.var[1] = makeWaltz();
    waltz.var[2] = makeWaltz();
    waltz.var[3] = makeWaltz();
    arr.styles.push_back(finish(waltz));

    pop("Reggae", "World", 78);
    pop("Tango", "Ballroom", 120);

    auto arabic = [&](const char* n, float tempo, auto maker) {
        Arranger::Style s;
        nameStyle(s, n, "Oriental", tempo);
        s.var[0] = maker(0);
        s.var[1] = maker(1);
        s.var[2] = maker(2);
        s.var[3] = maker(3);
        s.intro1 = maker(1);
        s.intro1.lengthTicks = BAR * 2;
        arr.styles.push_back(finish(s));
    };
    arabic("Baladi", 98, makeBaladi);
    arabic("Maqsum", 108, makeMaqsum);
    arabic("Malfouf", 126, makeMaqsum);
    arabic("Saidi", 102, makeBaladi);
    arabic("Debka", 118, makeMaqsum);

    Arranger::Style miz;
    nameStyle(miz, "Mizrahi Pop", "Oriental", 114);
    miz.var[0] = makeBaladi(1);
    miz.var[1] = makePop(1);
    miz.var[2] = makeBaladi(2);
    miz.var[3] = makePop(3);
    arr.styles.push_back(finish(miz));
}

}  // namespace pa
