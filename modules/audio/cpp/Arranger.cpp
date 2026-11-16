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

// Note transposition for recorded style tracks. Style Record data is played in
// C major 7, so each source pitch class is moved to the matching degree of the
// chord being played: E becomes Eb on minor chords, B becomes Bb on 7ths, etc.
int nttPitchClass(int pc, int type) {
    // 0 maj, 1 min, 2 7, 3 min7, 4 maj7, 5 sus4, 6 dim, 7 6, 8 m6, 9 9, 10 sus2, 11 aug
    const bool minor = type == 1 || type == 3 || type == 8 || type == 6;
    switch (pc) {
        case 4:  // third
            if (type == 5) return 5;
            if (type == 10) return 2;
            return minor ? 3 : 4;
        case 7:  // fifth
            if (type == 6) return 6;
            if (type == 11) return 8;
            return 7;
        case 11:  // major seventh
            if (type == 2 || type == 3 || type == 9) return 10;
            if (type == 4) return 11;
            if (type == 6 || type == 7 || type == 8) return 9;
            return 12;  // plain triads: double the root
        case 3:  // a recorded minor third stays minor only on minor chords
            return minor ? 3 : 4;
        case 10:
            return (type == 4) ? 11 : 10;
        default:
            return pc;
    }
}

}  // namespace

int nttNote(int srcNote, int root, int type) {
    const int oct = srcNote / 12;
    const int pc = srcNote % 12;
    return oct * 12 + nttPitchClass(pc, type) + root;
}

namespace {

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
int Arranger::styleBeats(int id) const {
    if (id < 0 || id >= (int)styles.size()) return 4;
    return std::max(2, std::min(7, styles[id].beats));
}

void Arranger::start(ArrangerState& st) {
    st.running = true;
    st.playing.store(1);
    st.tickPos = 0;
    st.barLenTicks = 0;
    st.totalTicks = 0;
    st.displayBeat.store(0);
    st.displayBar.store(1);
    if (st.current == Section::None) st.current = (Section)((int)Section::Var1 + st.variation - 1);
    st.displaySection.store((int)st.current);
}
void Arranger::stop(ArrangerState& st) {
    st.running = false;
    st.playing.store(0);
    st.booked = Section::None;
    st.displayBooked.store(0);
    // The next start plays the selected variation, not the ending that just stopped it.
    if (isEnding(st.current) || isFill(st.current) || st.current == Section::Break)
        st.current = (Section)((int)Section::Var1 + st.variation - 1);
    st.displaySection.store((int)st.current);
    holdn = 0;
}
namespace {
Section varSection(const ArrangerState& st) {
    return (Section)((int)Section::Var1 + std::max(1, std::min(4, st.variation)) - 1);
}

bool isVariation(Section s) { return s >= Section::Var1 && s <= Section::Var4; }

void setBooked(ArrangerState& st, Section s) {
    st.booked = s;
    st.displayBooked.store((int)s);
}
}  // namespace

// Pa-style element timing while the style runs:
//  - Variation / Ending / Intro: switch on the next bar line.
//  - Fill / Break (and the auto fill into a new variation): start now, at the same
//    position inside the bar, so they finish on the bar line.
void Arranger::book(ArrangerState& st, Section s) {
    if (s == Section::None) return;
    if (!st.running) {
        if (isFill(s) || s == Section::Break) return;  // nothing to fill from
        if (isVariation(s)) st.variation = varIndex(s);
        st.current = s;
        setBooked(st, Section::None);
        st.displaySection.store((int)s);
        return;
    }
    const int barTicks = styleBeats(st.styleId % std::max(1, (int)styles.size())) * kPpq;
    auto startNow = [&](Section el, Section after) {
        st.current = el;
        st.afterFill = after;
        st.barLenTicks = st.barLenTicks % barTicks;
        st.displaySection.store((int)el);
    };
    if (isVariation(s)) {
        st.variation = varIndex(s);
        if (st.autoFill && isVariation(st.current) && s != st.current) {
            const int idx = (int)s - (int)Section::Var1;
            startNow((Section)((int)Section::Fill1 + idx), s);
            setBooked(st, Section::None);
            return;
        }
        if (s == st.current) {
            setBooked(st, Section::None);
            return;
        }
        setBooked(st, s);
        return;
    }
    if (isFill(s) || s == Section::Break) {
        startNow(s, varSection(st));
        setBooked(st, Section::None);
        return;
    }
    // Intro or Ending: next bar line.
    setBooked(st, s);
}

void Arranger::setStyle(ArrangerState& st, int id) {
    if (id < 0 || id >= (int)styles.size()) return;
    // Tempo is left alone: the UI sets the style tempo, or keeps the current one (Tempo Lock).
    st.styleId = id;
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
    const int beats = std::max(2, std::min(7, sty.beats));
    const int barTicks = beats * kPpq;
    int& ph = st.barLenTicks;
    for (int t = 0; t < ticks; ++t) {
        if (!st.running) return;
        const Pattern* pat = patternFor(sty, st.current);
        const int len = std::max(1, pat->lengthTicks);
        const int at = ph % len;
        // With Memory off the accompaniment only sounds while chord keys are down.
        const bool accOk = st.memory || st.chordHeld;
        const int bassRoot = (st.bassInversion && st.bassRoot >= 0) ? st.bassRoot : st.chordRoot;
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
                note = (ev.note == 0) ? 36 + bassRoot : bassNote(st.chordRoot, st.chordType, ev.note);
                bus = BusBass;
                inst = pat->bassProg;
                ch = 8;
            } else if (ev.flags == kEvTrans) {
                if (ev.trk == 0 || ((ev.note >= 35 && ev.note <= 81) && ev.trk == 9)) {
                    bus = BusDrums;
                    inst = pat->drumProg;
                    ch = 9;
                    note = ev.note;
                } else {
                    const bool bassTrk = ev.trk == 1;
                    const int root = bassTrk ? bassRoot : st.chordRoot;
                    // The bass plays the inversion note where the recording plays the root.
                    const int type = (bassTrk && root != st.chordRoot && ev.note % 12 == 0) ? 0 : st.chordType;
                    note = nttNote(ev.note, root, type);
                    while (note > 96) note -= 12;
                    while (note < 24) note += 12;
                    note = std::max(0, std::min(127, note));
                    if (bassTrk) {
                        bus = BusBass;
                        inst = pat->bassProg;
                        ch = 8;
                    } else {
                        bus = BusAcc;
                        inst = ev.trk == 2 ? pat->acc1 : (ev.trk == 3 ? pat->acc2 : pat->acc3);
                        ch = 4 + std::max(0, std::min(2, (int)ev.trk - 2));
                    }
                }
            } else {
                note = compNote(st.chordRoot, st.chordType, ev.note);
                bus = BusAcc;
                inst = (ev.trk == 2) ? pat->acc1 : (ev.trk == 3 ? pat->acc2 : pat->acc3);
                ch = 4 + std::max(0, std::min(2, (int)ev.trk - 2));
            }
            if (inst < 0) continue;
            if (bus != BusDrums && !accOk) continue;
            if (bus == BusBass && st.manualBass) continue;
            eng.playInternal(inst, note, ev.vel, bus, ch);
            if (bus != BusDrums) {
                captureHold(*this, inst, note, ch, ev.dur > 0 ? ev.dur : 24);
            }
        }
        tickHolds(eng, *this);
        ph++;
        st.totalTicks++;
        st.displayBeat.store((int)((st.totalTicks / kPpq) % beats));
        st.displayBar.store((int)(st.totalTicks / barTicks) + 1);

        // Booked variation / ending / intro: change on the bar line.
        if (st.booked != Section::None && isVariation(st.current) && ph < len && ph % barTicks == 0) {
            releaseHolds(eng, *this);
            st.current = st.booked;
            setBooked(st, Section::None);
            st.displaySection.store((int)st.current);
            ph = 0;
            continue;
        }
        if (ph >= len) {
            ph = 0;
            releaseHolds(eng, *this);
            if (isFill(st.current) || isIntro(st.current) || st.current == Section::Break) {
                Section next = varSection(st);
                if (st.booked != Section::None) {
                    next = st.booked;
                    setBooked(st, Section::None);
                } else if (st.afterFill != Section::None) {
                    next = st.afterFill;
                }
                st.afterFill = Section::None;
                st.current = next;
                st.displaySection.store((int)st.current);
            } else if (isEnding(st.current)) {
                stop(st);
                return;
            } else if (st.booked != Section::None) {
                st.current = st.booked;
                setBooked(st, Section::None);
                st.displaySection.store((int)st.current);
            }
        }
    }
}

}  // namespace pa
