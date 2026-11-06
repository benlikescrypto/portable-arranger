#include "Engine.h"

#include <cstring>

namespace pa {

namespace {
constexpr uint8_t F_ABS = kEvAbs;
constexpr uint8_t F_BASS = kEvBass;
constexpr uint8_t F_COMP = kEvComp;

void releaseHolds(Engine& eng, Arranger& arr) {
    for (int i = 0; i < arr.holdn; ++i) {
        eng.stopInternal(arr.holds[i].inst, arr.holds[i].note, arr.holds[i].ch);
    }
    arr.holdn = 0;
}

void tickHolds(Engine& eng, Arranger& arr) {
    int w = 0;
    for (int i = 0; i < arr.holdn; ++i) {
        Arranger::Hold h = arr.holds[i];
        h.remain--;
        if (h.remain <= 0) {
            eng.stopInternal(h.inst, h.note, h.ch);
        } else {
            arr.holds[w++] = h;
        }
    }
    arr.holdn = w;
}

void captureHold(Arranger& arr, int inst, int note, int ch, int dur) {
    if (dur <= 0 || arr.holdn >= 64) return;
    arr.holds[arr.holdn++] = {dur, inst, note, ch};
}

int chordInterval(int type, int degree) {
    // 0 maj, 1 min, 2 7, 3 min7, 4 maj7, 5 sus4, 6 dim, 7 6, 8 m6, 9 9, 10 sus2, 11 aug
    const bool minor = type == 1 || type == 3 || type == 8;
    const int third = (type == 5 || type == 10) ? (type == 10 ? 2 : 5) : (minor ? 3 : 4);
    const int fifth = type == 6 ? 6 : (type == 11 ? 8 : 7);
    const int seventh = (type == 2 || type == 3) ? 10 : (type == 4 ? 11 : 12);
    const int sixth = minor ? 8 : 9;
    switch (degree) {
        case 0: return 0;
        case 1: return third;
        case 2: return fifth;
        case 3: return (type == 7 || type == 8) ? sixth : seventh;
        case 4: return type == 9 ? 14 : 14;
        case 7: return fifth;
        case 10: return sixth;
        default: return degree;
    }
}

int bassNote(int root, int type, int degree) {
    return 36 + root + chordInterval(type, degree);
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
    holdn = 0;
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
            int inst = pat->drumProg;
            int ch = 9;
            if (ev.flags == F_ABS) {
                bus = BusDrums;
                inst = pat->drumProg;
                ch = 9;
            } else if (ev.flags == F_BASS) {
                note = bassNote(st.chordRoot, st.chordType, ev.note);
                bus = BusBass;
                inst = pat->bassProg;
                ch = 8;
            } else if (ev.flags == kEvTrans) {
                note = (int)ev.note + st.chordRoot;
                while (note > 96) note -= 12;
                while (note < 24) note += 12;
                note = std::max(0, std::min(127, note));
                if (ev.trk == 0 || ((ev.note >= 35 && ev.note <= 81) && ev.trk == 9)) {
                    bus = BusDrums;
                    inst = pat->drumProg;
                    ch = 9;
                    note = ev.note;
                } else if (ev.trk == 1) {
                    bus = BusBass;
                    inst = pat->bassProg;
                    ch = 8;
                } else {
                    bus = BusAcc;
                    inst = ev.trk == 2 ? pat->acc1 : (ev.trk == 3 ? pat->acc2 : pat->acc3);
                    ch = 4 + std::max(0, std::min(2, (int)ev.trk - 2));
                }
            } else {
                note = compNote(st.chordRoot, st.chordType, ev.note);
                bus = BusAcc;
                inst = (ev.trk == 2) ? pat->acc1 : (ev.trk == 3 ? pat->acc2 : pat->acc3);
                ch = 4 + std::max(0, std::min(2, (int)ev.trk - 2));
            }
            if (inst < 0) continue;
            if (!st.chordSet && bus != BusDrums) continue;
            eng.playInternal(inst, note, ev.vel, bus, ch);
            if (bus != BusDrums) {
                captureHold(*this, inst, note, ch, ev.dur > 0 ? ev.dur : 24);
            }
        }
        tickHolds(eng, *this);
        ph++;
        if (ph >= len) {
            ph = 0;
            releaseHolds(eng, *this);
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

}  // namespace pa
