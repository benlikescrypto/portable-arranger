#include "Engine.h"
#include "third_party/tsf.h"

#include <cmath>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

namespace pa {

static std::vector<std::string> gNames, gCats;
static std::vector<float> gTempos;

Engine::Engine() {
    buildFactory(patches, gNames, gCats, gTempos);
    arr.setup();
    buildArranger(arr);
    wireFactoryStylePrograms();
    rrPhase.assign(patches.size(), 0);
    if (!arr.styles.empty()) {
        arrSt.styleId = 0;
        arrSt.tempo = arr.styles[0].tempo;
        arrSt.current = Section::Var1;
        arrSt.variation = 1;
    }
    auto setupEq = [&](float sr) {
        eqLowL.setLowShelf(sr, 90.0f, 0.0f);
        eqLowR.setLowShelf(sr, 90.0f, 0.0f);
        eqMidL.setPeaking(sr, 1200.0f, 0.7f, 0.0f);
        eqMidR.setPeaking(sr, 1200.0f, 0.7f, 0.0f);
        eqHighL.setPeaking(sr, 6500.0f, 0.8f, 1.8f);
        eqHighR.setPeaking(sr, 6500.0f, 0.8f, 1.8f);
    };
    setupEq(48000.0f);
    drumComp.thresh = 0.35f;
    drumComp.ratio = 3.2f;
    drumComp.makeup = 1.15f;
    masterComp.thresh = 0.55f;
    masterComp.ratio = 2.2f;
    masterComp.makeup = 1.08f;
    factoryReady = true;
}

Engine::~Engine() {
    if (gmFont) {
        tsf_close(gmFont);
        gmFont = nullptr;
    }
}

void Engine::prepare(float sr) {
    sampleRate = sr > 1.0f ? sr : 48000.0f;
    eqLowL.setLowShelf(sampleRate, 90.0f, 0.0f);
    eqLowR.setLowShelf(sampleRate, 90.0f, 0.0f);
    eqMidL.setPeaking(sampleRate, 1200.0f, 0.7f, 0.0f);
    eqMidR.setPeaking(sampleRate, 1200.0f, 0.7f, 0.0f);
    eqHighL.setPeaking(sampleRate, 6500.0f, 0.8f, 1.8f);
    eqHighR.setPeaking(sampleRate, 6500.0f, 0.8f, 1.8f);
    if (gmFont) tsf_set_output(gmFont, TSF_STEREO_INTERLEAVED, (int)sampleRate, -4.0f);
}

void Engine::noteOn(int ch, int note, int vel) {
    midi.push({MidiKind::NoteOn, ch, note, vel, 0});
}
void Engine::noteOff(int ch, int note) { midi.push({MidiKind::NoteOff, ch, note, 0, 0}); }
void Engine::cc(int ch, int ctl, int val) { midi.push({MidiKind::Cc, ch, ctl, val, 0}); }
void Engine::pitchBend(int ch, int lsb, int msb) { midi.push({MidiKind::Pb, ch, lsb, msb, 0}); }
void Engine::programChange(int ch, int program) {
    const int part = ch >= 0 && ch < 4 ? ch : 0;
    midi.push({MidiKind::LoadInst, part, program, 0, 0});
}
void Engine::midiClock() { clockTicks.fetch_add(1, std::memory_order_relaxed); }
void Engine::midiTransportStart() { arrangerStart(); }
void Engine::midiTransportStop() { arrangerStop(); }
void Engine::midiTransportContinue() { arrangerStart(); }
void Engine::setPartProgram(int part, int instId) { midi.push({MidiKind::LoadInst, part, instId, 0, 0}); }
void Engine::setPartEnable(int part, bool on) { midi.push({MidiKind::Cc, 0x7f, part, on ? 1 : 0, 0}); }
void Engine::setSplit(int note) { splitNote = clampf((float)note, 0, 127); }
void Engine::setTempo(float bpm) { arrSt.tempo = clampf(bpm, 40.0f, 240.0f); }
void Engine::setMixer(int bus, float gain) {
    if (bus >= 0 && bus < kBusCount) mix.g[bus] = clampf(gain, 0.0f, 1.5f);
}
void Engine::arrangerStart() { midi.push({MidiKind::Style, 1, 0, 0, 0}); }
void Engine::arrangerStop() { midi.push({MidiKind::Style, 0, 0, 0, 0}); }
void Engine::arrangerToggle() { midi.push({MidiKind::Style, 2, 0, 0, 0}); }
void Engine::bookSection(int section) { midi.push({MidiKind::Style, 3, section, 0, 0}); }
void Engine::setStyle(int id) { midi.push({MidiKind::Style, 4, id, 0, 0}); }
void Engine::setSynchro(bool on) { arrSt.synchro = on; }
void Engine::setAutoFill(bool on) { arrSt.autoFill = on; }
void Engine::sustain(bool on) { midi.push({MidiKind::Cc, 0, 64, on ? 127 : 0, 0}); }
void Engine::setTranspose(int semis) { transpose = (int)clampf((float)semis, -24.0f, 24.0f); }
void Engine::setOctave(int oct) { octave = (int)clampf((float)oct, -3.0f, 3.0f); }
void Engine::setFx(int which, float mix) {
    mix = clampf(mix, 0.0f, 1.0f);
    if (which == 0) reverb.mix = mix * 0.42f;
    else if (which == 1) chorusMix = mix * 0.55f;
    else if (which == 2) delayFx.mix = mix * 0.45f;
}

const char* Engine::soundName(int id) const {
    if (id < 0 || id >= (int)patches.size()) return "";
    return patches[id].name;
}
const char* Engine::soundCategory(int id) const {
    if (id < 0 || id >= (int)patches.size()) return "";
    return patches[id].category;
}
const char* Engine::soundSource(int id) const {
    if (id < 0 || id >= (int)patches.size()) return "";
    switch (patches[id].source) {
        case PatchSource::Sfz: return "SFZ";
        case PatchSource::Korg: return "PA4X SET";
        case PatchSource::User: return "USER";
        default: return "FACTORY";
    }
}

static void gmProgramFor(const Patch& p, int& bank, int& program, bool drums) {
    bank = 0;
    program = 0;
    if (drums) {
        switch (p.model) {
            case Model::KitDance:
                program = 25;
                break;
            case Model::KitOrchestral:
                program = 48;
                break;
            case Model::KitLatin:
                program = 8;
                break;
            case Model::KitArabic:
            case Model::KitWorld:
                program = 40;
                break;
            default:
                program = 0;
                break;
        }
        return;
    }
    switch (p.model) {
        case Model::Piano:
            program = 0;
            break;
        case Model::BrightPiano:
            program = 1;
            break;
        case Model::SoftPiano:
            program = 0;
            break;
        case Model::UprightPiano:
            program = 0;
            break;
        case Model::DigitalPiano:
            program = 2;
            break;
        case Model::Rhodes:
            program = 4;
            break;
        case Model::Wurly:
            program = 5;
            break;
        case Model::Clav:
            program = 7;
            break;
        case Model::Harpsichord:
            program = 6;
            break;
        case Model::Violin:
            program = 40;
            break;
        case Model::OrientalStrings:
        case Model::ConcertStrings:
            program = 48;
            break;
        case Model::CinematicStrings:
            program = 49;
            break;
        case Model::Pizzicato:
            program = 45;
            break;
        case Model::SoloCello:
            program = 42;
            break;
        case Model::WarmPad:
            program = 89;
            break;
        case Model::Atmosphere:
            program = 99;
            break;
        case Model::Oud:
        case Model::Saz:
        case Model::Bouzouki:
            program = 105;
            break;
        case Model::Ney:
        case Model::Duduk:
            program = 77;
            break;
        case Model::Kanun:
            program = 15;
            break;
        case Model::Accordion:
            program = 21;
            break;
        case Model::Sax:
            program = 66;
            break;
        case Model::Trumpet:
            program = 56;
            break;
        case Model::Brass:
            program = 61;
            break;
        case Model::Trombone:
            program = 57;
            break;
        case Model::FrenchHorn:
            program = 60;
            break;
        case Model::Tuba:
            program = 58;
            break;
        case Model::SynthBrass:
            program = 62;
            break;
        case Model::AcousticBass:
        case Model::UprightBass:
            program = 32;
            break;
        case Model::FingerBass:
            program = 33;
            break;
        case Model::PickedBass:
            program = 34;
            break;
        case Model::SynthBass:
            program = 38;
            break;
        case Model::JazzOrgan:
            program = 17;
            break;
        case Model::RockOrgan:
            program = 18;
            break;
        case Model::ChurchOrgan:
        case Model::PipeOrgan:
            program = 19;
            break;
        case Model::DrawbarOrgan:
            program = 16;
            break;
        case Model::SquareLead:
            program = 80;
            break;
        case Model::SawLead:
        case Model::AnalogLead:
            program = 81;
            break;
        case Model::DigitalLead:
            program = 87;
            break;
        case Model::NylonGuitar:
            program = 24;
            break;
        case Model::SteelGuitar:
            program = 25;
            break;
        case Model::CleanGuitar:
            program = 27;
            break;
        case Model::MuteGuitar:
            program = 28;
            break;
        case Model::DistGuitar:
            program = 30;
            break;
        case Model::Flute:
            program = 73;
            break;
        case Model::Piccolo:
            program = 72;
            break;
        case Model::Clarinet:
            program = 71;
            break;
        case Model::Oboe:
            program = 68;
            break;
        case Model::Bassoon:
            program = 70;
            break;
        case Model::Pluck:
            program = 45;
            break;
        case Model::Choir:
            program = 52;
            break;
        case Model::Harp:
            program = 46;
            break;
        case Model::Vibraphone:
            program = 11;
            break;
        case Model::Marimba:
            program = 12;
            break;
        case Model::Xylophone:
            program = 13;
            break;
        case Model::Bells:
            program = 14;
            break;
        case Model::Timpani:
            program = 47;
            break;
        default:
            program = 0;
            break;
    }
}

int Engine::tsfChannelFor(int bus, int ch, bool drums) const {
    if (drums || bus == BusDrums) return 9;
    if (bus == BusBass) return 8;
    if (bus == BusPad) return 7;
    if (ch >= 0 && ch < 16) return ch;
    if (bus == BusAcc) return 4;
    return 0;
}

void Engine::applyTsfProgram(int tsfCh, const Patch& p) {
    if (!gmFont) return;
    const bool drums = isKit(p.model);
    int bank = 0, program = 0;
    gmProgramFor(p, bank, program, drums);
    if (drums) {
        tsf_channel_set_presetnumber(gmFont, tsfCh, program, 1);
    } else {
        tsf_channel_set_bank_preset(gmFont, tsfCh, bank, program);
    }
}

void Engine::startTsfVoice(const Patch& p, int note, int vel, int bus, int ch) {
    if (!gmFont) return;
    const bool drums = isKit(p.model);
    const int tch = tsfChannelFor(bus, ch, drums);
    applyTsfProgram(tch, p);
    const float vol = clampf(chanVol[ch & 15] * chanExpr[ch & 15] * 0.95f, 0.08f, 1.0f);
    tsf_channel_set_volume(gmFont, tch, vol);
    const int pw = (int)clampf(8192.0f + chanBend[ch & 15] * 8192.0f, 0.0f, 16383.0f);
    tsf_channel_set_pitchwheel(gmFont, tch, pw);
    tsf_channel_note_on(gmFont, tch, note, clampf((float)vel / 127.0f, 0.0f, 1.0f));
}

void Engine::tsfAllNotesOff(int fromCh, int toCh) {
    if (!gmFont) return;
    for (int c = fromCh; c <= toCh; ++c) tsf_channel_sounds_off_all(gmFont, c);
}

int Engine::loadSoundfont(const char* path) {
    if (gmFont) return 1;
    if (!path || !path[0]) return 0;
    tsf* font = tsf_load_filename(path);
    if (!font) return 0;
    tsf_set_max_voices(font, 128);
    const int sr = (int)(sampleRate > 1.0f ? sampleRate : 48000.0f);
    tsf_set_output(font, TSF_STEREO_INTERLEAVED, sr, -4.0f);
    tsf_channel_set_presetnumber(font, 9, 0, 1);
    std::lock_guard<std::mutex> g(loadMu);
    if (gmFont) tsf_close(gmFont);
    gmFont = font;
    return 1;
}

void Engine::wireFactoryStylePrograms() {
    int drum = -1, arabic = -1, dance = -1, latin = -1, world = -1;
    for (int i = 0; i < (int)patches.size(); ++i) {
        const Model m = patches[(size_t)i].model;
        if (m == Model::KitStandard && drum < 0) drum = i;
        if (m == Model::KitArabic && arabic < 0) arabic = i;
        if (m == Model::KitDance && dance < 0) dance = i;
        if (m == Model::KitLatin && latin < 0) latin = i;
        if (m == Model::KitWorld && world < 0) world = i;
    }
    if (arabic < 0) arabic = drum;
    if (dance < 0) dance = drum;
    if (latin < 0) latin = drum;
    if (world < 0) world = arabic;
    for (auto& s : arr.styles) {
        const std::string cat = s.category;
        int d = drum;
        if (cat == "Oriental") d = arabic;
        else if (cat == "Dance" || cat == "Disco") d = dance;
        else if (cat == "Latin") d = latin >= 0 ? latin : drum;
        else if (cat == "World") d = world;
        applyStylePrograms(s, d, -1, -1, -1, -1);
    }
}

int Engine::addSampledInstrument(const Patch& p) {
    std::lock_guard<std::mutex> g(loadMu);
    patches.push_back(p);
    rrPhase.push_back(0);
    return (int)patches.size() - 1;
}
int Engine::addSample(Sample&& s) {
    std::lock_guard<std::mutex> g(loadMu);
    samples.push_back(std::move(s));
    return (int)samples.size() - 1;
}
int Engine::addStyle(Arranger::Style style) {
    std::lock_guard<std::mutex> g(loadMu);
    arr.styles.push_back(std::move(style));
    return (int)arr.styles.size() - 1;
}

void Engine::playInternal(int instId, int note, int vel, int bus, int ch) {
    startVoice(instId, note, vel, bus, ch);
}
void Engine::stopInternal(int instId, int note, int ch) {
    stopVoices(note, ch, true, instId);
}

int Engine::stealVoice() {
    int best = 0;
    float score = 1e9f;
    for (int i = 0; i < kMaxVoices; ++i) {
        float s = voices[i].amp.level + (voices[i].active ? 0.0f : -10.0f) + voices[i].age * 0.0001f;
        if (voices[i].releasing) s -= 0.2f;
        if (s < score) {
            score = s;
            best = i;
        }
    }
    voices[best].amp.steal();
    voices[best].active = false;
    return best;
}

void Engine::startVoiceZone(int instId, const Patch& p, const Zone& z, int note, int vel, int bus, int ch) {
    int slot = -1;
    for (int i = 0; i < kMaxVoices; ++i) {
        if (!voices[i].active && voices[i].amp.idle()) {
            slot = i;
            break;
        }
    }
    if (slot < 0) slot = stealVoice();
    Voice& v = voices[slot];
    v = Voice{};
    v.active = true;
    v.note = note;
    v.chan = ch;
    v.vel = vel;
    v.inst = instId;
    v.bus = bus >= 0 ? bus : p.bus;
    v.model = p.model;
    v.rng = rng += 0x9E3779B9u;
    const float velAmt = clampf((float)vel / 127.0f, 0.0f, 1.0f);
    const float dyn = p.sampled ? velAmt * (0.4f + 0.6f * p.ampVel) : velCurve(vel);
    const float expr = chanVol[ch & 15] * chanExpr[ch & 15];
    v.gain = (p.sampled ? 0.95f : 0.48f) * dyn * expr * z.gain;
    v.cutoff = z.cutoff > 0 ? z.cutoff : p.cutoff;
    v.reso = z.resonance >= 0 ? z.resonance : p.reso;
    v.filtEnvAmt = p.filtEnv;
    v.brightness = p.brightness;
    v.vibRate = p.vibRate;
    v.vibDepth = p.vibDepth;
    v.reverbSend = p.reverb;
    v.chorusSend = p.chorus;
    v.delaySend = p.delay;
    float pan = clampf(p.pan + z.pan, -1.0f, 1.0f);
    v.panL = std::sqrt((1.0f - pan) * 0.5f);
    v.panR = std::sqrt((1.0f + pan) * 0.5f);
    v.amp.setTimes(sampleRate, p.attack, p.decay, p.sustain, p.release);
    v.filtEg.setTimes(sampleRate, p.attack * 0.6f, p.decay * 0.8f, p.sustain, p.release);
    v.amp.noteOn();
    v.filtEg.noteOn();
    v.filt.reset();
    v.filtR.reset();
    v.phase = 0.02f * (rng & 255);
    v.sampleIndex = -1;
    v.samplePos = z.offset;
    v.oneShot = p.sampled && (isKit(p.model) || v.bus == BusDrums);

    if (p.sampled && z.sampleIndex >= 0 && z.sampleIndex < (int)samples.size()) {
        const Sample& sm = samples[z.sampleIndex];
        v.sampleIndex = z.sampleIndex;
        const int root = z.root > 0 ? z.root : (sm.rootNote > 0 ? sm.rootNote : 60);
        const float target = midiToHz((float)note + z.tuneCents / 100.0f);
        const float rootHz = midiToHz((float)root);
        v.sampleInc = (target / rootHz) * ((double)sm.sampleRate / (double)sampleRate);
        v.sampleEnd = z.end > 0 ? std::min(z.end, sm.frames()) : sm.frames();
        const bool loop = z.loopMode == 0 ? false : (z.loopMode == 1 ? true : sm.loop);
        v.sampleLoop = loop && !v.oneShot;
        v.loopStart = z.loopStart >= 0 ? z.loopStart : sm.loopStart;
        v.loopEnd = z.loopEnd > v.loopStart ? z.loopEnd : sm.loopEnd;
        if (v.loopEnd <= v.loopStart) v.loopEnd = v.sampleEnd;
    }

    if (!p.sampled && isKit(p.model)) {
        v.drumT = 0;
        v.drumKind = note;
        v.amp.setTimes(sampleRate, 0.4f, 80.0f, 0.0f, 120.0f);
        if (note == 42 || note == 44) v.amp.setTimes(sampleRate, 0.2f, 40.0f, 0.0f, 50.0f);
        if (note == 46) v.amp.setTimes(sampleRate, 0.3f, 180.0f, 0.0f, 220.0f);
        if (note == 49 || note == 57) v.amp.setTimes(sampleRate, 0.5f, 900.0f, 0.0f, 1200.0f);
        v.bus = BusDrums;
    }

    if (!p.sampled && (isPluckModel(p.model) || isPianoFamily(p.model))) {
        const float freq = midiToHz((float)note);
        v.ksLen = std::max(24, std::min(kKsLen - 1, (int)(sampleRate / freq)));
        v.ksIdx = 0;
        v.ksFilter = 0;
        const int burst = std::max(4, v.ksLen / 7);
        for (int i = 0; i < v.ksLen; ++i) {
            float n = white(v.rng);
            const float tri = i < burst ? 1.0f - (float)i / (float)burst : 0.0f;
            const float window = i > v.ksLen * 3 / 4 ? 0.25f : 1.0f;
            v.ks[i] = (n * 0.75f + tri * (0.35f + 0.45f * velAmt)) * window;
        }
    }
}

void Engine::startVoice(int instId, int note, int vel, int bus, int ch) {
    if (instId < 0 || instId >= (int)patches.size() || vel <= 0) return;
    const Patch& p = patches[instId];
    if (gmFont && !p.sampled) {
        startTsfVoice(p, note, vel, bus, ch);
        return;
    }
    if (!p.sampled || p.zones.empty()) {
        Zone dummy;
        startVoiceZone(instId, p, dummy, note, vel, bus, ch);
        return;
    }
    const Zone* hits[8]{};
    int nh = 0;
    int seqLen = 1;
    for (const Zone& z : p.zones) {
        if (z.seqLength > seqLen) seqLen = z.seqLength;
        if (note >= z.keyLow && note <= z.keyHigh && vel >= z.velLow && vel <= z.velHigh) {
            if (nh < 8) hits[nh++] = &z;
        }
    }
    if (nh == 0) {
        startVoiceZone(instId, p, p.zones[0], note, vel, bus, ch);
        return;
    }
    uint8_t phase = 0;
    if (instId >= 0 && instId < (int)rrPhase.size()) {
        phase = rrPhase[(size_t)instId];
        rrPhase[(size_t)instId] = (uint8_t)((phase + 1) % std::max(1, seqLen));
    }
    int started = 0;
    for (int i = 0; i < nh; ++i) {
        const Zone* z = hits[i];
        if (z->seqLength > 1 && z->seqPosition != (int)(phase % z->seqLength) + 1) continue;
        startVoiceZone(instId, p, *z, note, vel, bus, ch);
        started++;
        if (started >= 4) break;
    }
    if (!started) startVoiceZone(instId, p, *hits[0], note, vel, bus, ch);
}

void Engine::stopVoices(int note, int ch, bool matchInst, int instId) {
    if (gmFont && !(sustainOn && (ch < 4 || ch < 0))) {
        if (ch < 0) {
            for (int c = 0; c < 4; ++c) tsf_channel_note_off(gmFont, c, note);
        } else {
            const int tch = tsfChannelFor(-1, ch, ch == 9);
            tsf_channel_note_off(gmFont, tch, note);
        }
    }
    for (int i = 0; i < kMaxVoices; ++i) {
        Voice& v = voices[i];
        if (!v.active) continue;
        if (v.note != note) continue;
        if (ch >= 0 && v.chan != ch && ch != 0x7f) continue;
        if (matchInst && v.inst != instId) continue;
        if (sustainOn && v.chan < 4) continue;
        if (v.oneShot) continue;
        v.amp.noteOff();
        v.filtEg.noteOff();
        v.releasing = true;
        v.active = false;
    }
}

void Engine::detectChord() {
    int pcs[12]{};
    int count = 0;
    int lowest = 128;
    for (int n = 0; n <= splitNote; ++n) {
        bool on = false;
        for (int ch = 0; ch < 16; ++ch)
            if (held[ch][n]) on = true;
        if (!on) continue;
        pcs[n % 12] = 1;
        count++;
        if (n < lowest) lowest = n;
    }
    if (count == 0) return;
    int bestRoot = lowest % 12;
    int bestType = 0;
    int bestScore = -1;
    const int templates[][12] = {
            {1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0},  // maj
            {1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0},  // min
            {1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0},  // 7
            {1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0},  // min7
            {1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1},  // maj7
            {1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0},  // sus4
            {1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0},  // dim
            {1, 0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0},  // 6
            {1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 0, 0},  // m6
            {1, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0},  // 9
            {1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0},  // sus2
            {1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0},  // aug
    };
    constexpr int kTypes = 12;
    for (int root = 0; root < 12; ++root) {
        for (int t = 0; t < kTypes; ++t) {
            int score = 0, extra = 0;
            for (int i = 0; i < 12; ++i) {
                const int pc = (i + root) % 12;
                if (pcs[pc] && templates[t][i]) score += 3;
                else if (pcs[pc] && !templates[t][i]) extra++;
                else if (!pcs[pc] && templates[t][i] && i != 0) score -= 1;
            }
            score -= extra;
            if (root == lowest % 12) score += 1;
            if (score > bestScore) {
                bestScore = score;
                bestRoot = root;
                bestType = t;
            }
        }
    }
    arr.onChord(arrSt, bestRoot, bestType);
}

void Engine::handle(const MidiEvent& e) {
    switch (e.kind) {
        case MidiKind::NoteOn: {
            const int ch = e.a, raw = e.b, vel = e.c;
            if (raw < 0 || raw > 127) return;
            held[ch & 15][raw] = 1;
            const bool left = raw <= splitNote;
            if (left) detectChord();
            if (left && arrSt.synchro && !arrSt.running) arr.start(arrSt);
            const int note = std::max(0, std::min(127, raw + transpose + octave * 12));
            if (left && partOn[3]) {
                startVoice(partProg[3], note, vel, BusBass, 3);
            } else {
                if (partOn[0]) startVoice(partProg[0], note, vel, BusKeyboard, 0);
                if (partOn[1] && partProg[1] >= 0) startVoice(partProg[1], note, vel, BusKeyboard, 1);
                if (partOn[2] && partProg[2] >= 0) startVoice(partProg[2], note, vel, BusKeyboard, 2);
            }
            break;
        }
        case MidiKind::NoteOff: {
            const int ch = e.a, raw = e.b;
            if (raw < 0 || raw > 127) return;
            held[ch & 15][raw] = 0;
            const int note = std::max(0, std::min(127, raw + transpose + octave * 12));
            stopVoices(note, -1, false, 0);
            if (note != raw) stopVoices(raw, -1, false, 0);
            detectChord();
            break;
        }
        case MidiKind::Cc:
            if (e.a == 0x7f) {
                if (e.b >= 0 && e.b < 4) partOn[e.b] = e.c != 0;
            } else if (e.b == 64) {
                sustainOn = e.c >= 64;
                if (gmFont) {
                    for (int c = 0; c < 4; ++c) tsf_channel_set_sustain(gmFont, c, sustainOn ? 1 : 0);
                }
                if (!sustainOn) {
                    for (int n = 0; n < 128; ++n) {
                        bool any = false;
                        for (int c = 0; c < 16; ++c)
                            if (held[c][n]) any = true;
                        if (!any) stopVoices(n, -1, false, 0);
                    }
                }
            } else if (e.b == 1) {
                for (auto& v : voices) v.vibDepth = (e.c / 127.0f) * 0.12f;
            } else if (e.b == 7) {
                chanVol[e.a & 15] = clampf(e.c / 127.0f, 0.0f, 1.0f);
                if (gmFont) tsf_channel_set_volume(gmFont, tsfChannelFor(-1, e.a, false), chanVol[e.a & 15]);
            } else if (e.b == 11) {
                chanExpr[e.a & 15] = clampf(e.c / 127.0f, 0.0f, 1.0f);
            } else if (e.b == 91) {
                setFx(0, e.c / 127.0f);
            } else if (e.b == 93) {
                setFx(1, e.c / 127.0f);
            } else if (e.b == 120 || e.b == 123) {
                tsfAllNotesOff(0, 15);
                for (auto& v : voices) {
                    v.amp.noteOff();
                    v.filtEg.noteOff();
                    v.releasing = true;
                    v.active = false;
                }
            }
            break;
        case MidiKind::Pb: {
            const int ch = e.a & 15;
            const int value = (e.b & 0x7f) | ((e.c & 0x7f) << 7);
            chanBend[ch] = (value - 8192) / 8192.0f;
            chanBendRatio[ch] = std::pow(2.0f, chanBend[ch] * 2.0f / 12.0f);
            if (gmFont) tsf_channel_set_pitchwheel(gmFont, tsfChannelFor(-1, ch, false), value);
            break;
        }
        case MidiKind::Pc:
            if (e.a >= 0 && e.a < 4) partProg[e.a] = e.b;
            if (gmFont && e.a >= 0 && e.a < 4 && e.b >= 0 && e.b < (int)patches.size()) {
                applyTsfProgram(e.a, patches[(size_t)e.b]);
            }
            break;
        case MidiKind::LoadInst:
            if (e.a >= 0 && e.a < 4) partProg[e.a] = e.b;
            if (gmFont && e.a >= 0 && e.a < 4 && e.b >= 0 && e.b < (int)patches.size()) {
                applyTsfProgram(e.a, patches[(size_t)e.b]);
            }
            break;
        case MidiKind::Style:
            if (e.a == 0 || (e.a == 2 && arrSt.running)) {
                for (int i = 0; i < arr.holdn; ++i) {
                    stopInternal(arr.holds[i].inst, arr.holds[i].note, arr.holds[i].ch);
                }
                arr.holdn = 0;
                tsfAllNotesOff(4, 9);
            }
            if (e.a == 0) arr.stop(arrSt);
            else if (e.a == 1) arr.start(arrSt);
            else if (e.a == 2) {
                if (arrSt.running) arr.stop(arrSt);
                else arr.start(arrSt);
            } else if (e.a == 3) arr.book(arrSt, (Section)e.b);
            else if (e.a == 4) arr.setStyle(arrSt, e.b);
            break;
        default:
            break;
    }
}

void Engine::renderSynth(Voice& v, float& L, float& R) {
    const float freq = midiToHz((float)v.note) * chanBendRatio[v.chan & 15];
    const float dt = freq / sampleRate;
    v.lfoDelay += 1.0f / sampleRate;
    const float vibAmt = v.lfoDelay > 0.32f ? v.vibDepth : 0.0f;
    v.lfo += v.vibRate / sampleRate;
    if (v.lfo > 1.0f) v.lfo -= 1.0f;
    const float vib = 1.0f + vibAmt * std::sin(kTwoPi * v.lfo);
    const float f = dt * vib;
    float osc = 0.0f;
    const float velB = v.vel / 127.0f;

    switch (v.model) {
        case Model::Piano:
        case Model::BrightPiano:
        case Model::SoftPiano: {
            const float t = v.age / sampleRate;
            const float B = v.model == Model::BrightPiano ? 0.00028f : (v.model == Model::SoftPiano ? 0.00012f : 0.0002f);
            const int parts = v.model == Model::SoftPiano ? 12 : 18;
            const float tilt = v.model == Model::BrightPiano ? 0.72f : (v.model == Model::SoftPiano ? 1.05f : 0.88f);
            float acc = 0.0f;
            const float ph = v.phase;
            for (int n = 1; n <= parts; ++n) {
                const float stretch = (float)n * std::sqrt(1.0f + B * (float)(n * n));
                float p = ph * stretch;
                p -= (float)(int)p;
                if (p < 0) p += 1.0f;
                const float decay = std::exp(-t * (2.4f + 0.38f * n * n * tilt) * (1.45f - 0.85f * velB));
                const float w = n == 1 ? 1.0f : (0.62f / std::pow((float)n, 0.72f));
                acc += std::sin(kTwoPi * p) * decay * w;
            }
            v.phase += f;
            if (v.phase > 1.0f) v.phase -= (float)(int)v.phase;
            float hammer = 0.0f;
            if (v.ksLen > 20) {
                const float a = v.ks[v.ksIdx];
                const int n1 = (v.ksIdx + 1) % v.ksLen;
                float mix = 0.5f * (a + v.ks[n1]);
                mix = v.ksFilter = v.ksFilter * 0.28f + mix * 0.72f;
                v.ks[v.ksIdx] = mix * 0.9965f;
                v.ksIdx = n1;
                hammer = mix;
            }
            const float click = white(v.rng) * std::exp(-t * 90.0f) * (0.08f + 0.22f * velB);
            osc = acc * 0.42f + hammer * 0.38f + click;
            break;
        }
        case Model::Rhodes: {
            v.fm += f * 1.0f;
            if (v.fm > 1.0f) v.fm -= 1.0f;
            const float mod = std::sin(kTwoPi * v.fm) * (1.8f + 3.5f * velB);
            v.phase += f;
            if (v.phase > 1.0f) v.phase -= 1.0f;
            osc = std::sin(kTwoPi * v.phase + mod) * 0.85f;
            osc += std::sin(kTwoPi * v.phase * 2.0f) * 0.06f;
            break;
        }
        case Model::Wurly: {
            v.phase += f;
            if (v.phase > 1.0f) v.phase -= 1.0f;
            osc = blepPulse(v.phase, f, 0.42f) * 0.4f + std::sin(kTwoPi * v.phase) * 0.55f;
            osc = fastTanh(osc * (1.4f + velB));
            break;
        }
        case Model::Clav: {
            v.phase += f;
            if (v.phase > 1.0f) v.phase -= 1.0f;
            osc = blepPulse(v.phase, f, 0.18f + 0.1f * velB);
            osc = fastTanh(osc * 2.2f) * 0.7f;
            break;
        }
        case Model::Violin:
        case Model::OrientalStrings:
        case Model::ConcertStrings: {
            v.phase += f;
            v.phase2 += f * 1.0026f;
            v.phase3 += f * 0.9971f;
            auto wrap = [](float& p) {
                if (p > 1.0f) p -= (int)p;
            };
            wrap(v.phase);
            wrap(v.phase2);
            wrap(v.phase3);
            const float saw = (blepSaw(v.phase, f) + blepSaw(v.phase2, f) + blepSaw(v.phase3, f)) / 3.0f;
            const float pulse = blepPulse(v.phase, f, 0.47f);
            osc = saw * 0.72f + pulse * 0.22f + white(v.rng) * 0.015f;
            break;
        }
        case Model::WarmPad:
        case Model::Atmosphere: {
            v.phase += f * 0.5f;
            v.phase2 += f * 0.5008f;
            v.phase3 += f * 0.4993f;
            auto wrap = [](float& p) { if (p > 1.0f) p -= (int)p; };
            wrap(v.phase);
            wrap(v.phase2);
            wrap(v.phase3);
            osc = (blepSaw(v.phase, f * 0.5f) + blepSaw(v.phase2, f * 0.5f) + std::sin(kTwoPi * v.phase3)) / 3.0f;
            if (v.model == Model::Atmosphere) osc += white(v.rng) * 0.05f;
            break;
        }
        case Model::Oud:
        case Model::NylonGuitar:
        case Model::Bouzouki:
        case Model::Kanun: {
            const float a = v.ks[v.ksIdx];
            const int n1 = (v.ksIdx + 1) % v.ksLen;
            float mix = 0.5f * (a + v.ks[n1]);
            const float damp = v.model == Model::Kanun ? 0.988f : (v.model == Model::Bouzouki ? 0.991f : 0.994f);
            mix = v.ksFilter = v.ksFilter * 0.35f + mix * 0.65f;
            v.ks[v.ksIdx] = mix * damp;
            v.ksIdx = n1;
            osc = mix * 1.8f;
            if (v.amp.stage == Adsr::Attack) osc += white(v.rng) * 0.12f;
            break;
        }
        case Model::Ney:
        case Model::Duduk: {
            v.phase += f;
            if (v.phase > 1.0f) v.phase -= 1.0f;
            const float breath = white(v.rng) * 0.12f * velB;
            osc = std::sin(kTwoPi * v.phase) + 0.18f * std::sin(kTwoPi * v.phase * 2.0f) +
                  0.07f * std::sin(kTwoPi * v.phase * 3.0f) + breath;
            osc *= 0.7f;
            break;
        }
        case Model::Accordion: {
            v.phase += f;
            v.phase2 += f * 1.0068f;
            v.phase3 += f * 0.9934f;
            auto wrap = [](float& p) { if (p > 1.0f) p -= (int)p; };
            wrap(v.phase);
            wrap(v.phase2);
            wrap(v.phase3);
            osc = (blepSaw(v.phase, f) + blepSaw(v.phase2, f) + blepPulse(v.phase3, f, 0.5f)) / 3.0f;
            break;
        }
        case Model::Sax: {
            v.phase += f;
            if (v.phase > 1.0f) v.phase -= 1.0f;
            osc = blepPulse(v.phase, f, 0.28f + 0.1f * velB);
            osc = fastTanh(osc * 1.6f);
            osc += white(v.rng) * 0.04f;
            break;
        }
        case Model::Trumpet:
        case Model::Brass: {
            v.phase += f;
            v.phase2 += f * (v.model == Model::Brass ? 1.003f : 1.0f);
            auto wrap = [](float& p) { if (p > 1.0f) p -= (int)p; };
            wrap(v.phase);
            wrap(v.phase2);
            osc = 0.55f * blepSaw(v.phase, f) + 0.45f * blepPulse(v.phase2, f, 0.42f);
            osc = fastTanh(osc * (1.3f + velB));
            break;
        }
        case Model::AcousticBass:
        case Model::FingerBass: {
            v.phase += f;
            if (v.phase > 1.0f) v.phase -= 1.0f;
            osc = std::sin(kTwoPi * v.phase) * 0.7f + blepSaw(v.phase, f) * 0.25f;
            if (v.amp.stage == Adsr::Attack) osc += white(v.rng) * 0.08f;
            break;
        }
        case Model::SynthBass: {
            v.phase += f;
            if (v.phase > 1.0f) v.phase -= 1.0f;
            osc = blepSaw(v.phase, f);
            osc = fastTanh(osc * 2.0f);
            break;
        }
        case Model::JazzOrgan:
        case Model::RockOrgan: {
            v.phase += f;
            if (v.phase > 1.0f) v.phase -= 1.0f;
            const float p = v.phase;
            float draw = std::sin(kTwoPi * p) + 0.7f * std::sin(kTwoPi * p * 2) + 0.5f * std::sin(kTwoPi * p * 3) +
                         0.35f * std::sin(kTwoPi * p * 4) + 0.2f * std::sin(kTwoPi * p * 6);
            if (v.model == Model::RockOrgan) draw += 0.4f * std::sin(kTwoPi * p * 8);
            osc = draw * 0.28f;
            break;
        }
        case Model::SquareLead:
        case Model::DigitalLead:
            v.phase += f;
            if (v.phase > 1.0f) v.phase -= 1.0f;
            osc = blepPulse(v.phase, f, v.model == Model::DigitalLead ? 0.28f : 0.5f);
            if (v.model == Model::DigitalLead) osc += std::sin(kTwoPi * v.phase * 2.0f) * 0.12f;
            break;
        case Model::SawLead:
        case Model::AnalogLead:
        case Model::SynthBrass:
            v.phase += f;
            v.phase2 += f * 1.007f;
            if (v.phase > 1.0f) v.phase -= 1.0f;
            if (v.phase2 > 1.0f) v.phase2 -= 1.0f;
            osc = blepSaw(v.phase, f);
            if (v.model != Model::SawLead) osc = 0.6f * osc + 0.4f * blepSaw(v.phase2, f);
            if (v.model == Model::SynthBrass) osc = fastTanh(osc * 1.5f);
            break;
        case Model::UprightPiano:
        case Model::DigitalPiano:
        case Model::Harpsichord: {
            const float t = v.age / sampleRate;
            const float B = v.model == Model::UprightPiano ? 0.0004f : 0.00016f;
            float acc = 0.0f;
            const float ph = v.phase;
            const int parts = v.model == Model::Harpsichord ? 14 : 12;
            for (int n = 1; n <= parts; ++n) {
                float p = ph * n * std::sqrt(1.0f + B * (float)(n * n));
                p -= (float)(int)p;
                const float decay = std::exp(-t * (3.0f + 0.5f * n * n) * (1.3f - 0.6f * velB));
                acc += std::sin(kTwoPi * p) * decay / std::pow((float)n, v.model == Model::Harpsichord ? 0.55f : 0.75f);
            }
            v.phase += f;
            if (v.phase > 1.0f) v.phase -= (float)(int)v.phase;
            osc = acc * 0.45f;
            if (v.model == Model::Harpsichord) {
                osc = 0.55f * fastTanh(blepPulse(v.phase, f, 0.14f) * 1.5f) + osc * 0.5f;
            } else if (v.ksLen > 20) {
                const float a = v.ks[v.ksIdx];
                const int n1 = (v.ksIdx + 1) % v.ksLen;
                float mix = 0.5f * (a + v.ks[n1]);
                v.ks[v.ksIdx] = (v.ksFilter = v.ksFilter * 0.3f + mix * 0.7f) * 0.995f;
                v.ksIdx = n1;
                osc += mix * 0.32f;
            }
            break;
        }
        case Model::ChurchOrgan:
        case Model::PipeOrgan:
        case Model::DrawbarOrgan: {
            v.phase += f;
            if (v.phase > 1.0f) v.phase -= 1.0f;
            const float p = v.phase;
            osc = std::sin(kTwoPi * p) + 0.5f * std::sin(kTwoPi * p * 2) + 0.35f * std::sin(kTwoPi * p * 3) +
                  0.2f * std::sin(kTwoPi * p * 4) + 0.12f * std::sin(kTwoPi * p * 5) + 0.08f * std::sin(kTwoPi * p * 8);
            if (v.model == Model::PipeOrgan) osc += 0.25f * std::sin(kTwoPi * p * 6);
            osc *= 0.28f;
            break;
        }
        case Model::SoloCello:
        case Model::CinematicStrings: {
            v.phase += f;
            v.phase2 += f * 1.003f;
            if (v.phase > 1.0f) v.phase -= 1.0f;
            if (v.phase2 > 1.0f) v.phase2 -= 1.0f;
            osc = 0.7f * blepSaw(v.phase, f) + 0.3f * std::sin(kTwoPi * v.phase2);
            break;
        }
        case Model::Trombone:
        case Model::FrenchHorn:
        case Model::Tuba: {
            v.phase += f;
            if (v.phase > 1.0f) v.phase -= 1.0f;
            osc = 0.55f * std::sin(kTwoPi * v.phase) + 0.45f * blepSaw(v.phase, f);
            if (v.model == Model::Tuba) osc = 0.7f * std::sin(kTwoPi * v.phase) + 0.3f * blepSaw(v.phase, f);
            osc = fastTanh(osc * 1.25f);
            break;
        }
        case Model::Flute:
        case Model::Piccolo: {
            v.phase += f;
            if (v.phase > 1.0f) v.phase -= 1.0f;
            osc = std::sin(kTwoPi * v.phase) + 0.12f * std::sin(kTwoPi * v.phase * 2) + white(v.rng) * 0.06f * velB;
            osc *= 0.7f;
            break;
        }
        case Model::Clarinet:
        case Model::Oboe:
        case Model::Bassoon: {
            v.phase += f;
            if (v.phase > 1.0f) v.phase -= 1.0f;
            osc = blepPulse(v.phase, f, v.model == Model::Oboe ? 0.22f : 0.33f);
            osc += 0.15f * std::sin(kTwoPi * v.phase * 3);
            osc = fastTanh(osc * 1.3f);
            break;
        }
        case Model::SteelGuitar:
        case Model::CleanGuitar:
        case Model::DistGuitar:
        case Model::MuteGuitar:
        case Model::Saz:
        case Model::Harp:
        case Model::Pizzicato:
        case Model::Pluck: {
            const float a = v.ks[v.ksIdx];
            const int n1 = (v.ksIdx + 1) % v.ksLen;
            float mix = 0.5f * (a + v.ks[n1]);
            float damp = 0.992f;
            if (v.model == Model::MuteGuitar || v.model == Model::Pizzicato || v.model == Model::Pluck) damp = 0.975f;
            if (v.model == Model::DistGuitar) damp = 0.989f;
            mix = v.ksFilter = v.ksFilter * 0.32f + mix * 0.68f;
            v.ks[v.ksIdx] = mix * damp;
            v.ksIdx = n1;
            osc = mix * 1.7f;
            if (v.model == Model::DistGuitar) osc = fastTanh(osc * 3.2f);
            break;
        }
        case Model::PickedBass:
        case Model::UprightBass: {
            v.phase += f;
            if (v.phase > 1.0f) v.phase -= 1.0f;
            osc = std::sin(kTwoPi * v.phase) * 0.65f + blepSaw(v.phase, f) * (v.model == Model::PickedBass ? 0.4f : 0.2f);
            if (v.amp.stage == Adsr::Attack) osc += white(v.rng) * (v.model == Model::PickedBass ? 0.14f : 0.06f);
            break;
        }
        case Model::Choir: {
            v.phase += f * 0.5f;
            v.phase2 += f * 0.5012f;
            v.phase3 += f * 0.4984f;
            auto wrap = [](float& p) { if (p > 1.0f) p -= (int)p; };
            wrap(v.phase);
            wrap(v.phase2);
            wrap(v.phase3);
            osc = (std::sin(kTwoPi * v.phase) + std::sin(kTwoPi * v.phase2) + blepSaw(v.phase3, f * 0.5f) * 0.3f) / 2.3f;
            break;
        }
        case Model::Vibraphone:
        case Model::Marimba:
        case Model::Xylophone:
        case Model::Bells: {
            v.phase += f;
            v.fm += f * (v.model == Model::Bells ? 3.5f : 1.4f);
            if (v.phase > 1.0f) v.phase -= 1.0f;
            if (v.fm > 1.0f) v.fm -= 1.0f;
            const float mod = std::sin(kTwoPi * v.fm) * (v.model == Model::Bells ? 2.2f : 0.8f);
            osc = std::sin(kTwoPi * v.phase + mod);
            osc += 0.15f * std::sin(kTwoPi * v.phase * 2.0f);
            break;
        }
        case Model::Timpani: {
            const float drop = std::exp(-v.age / (sampleRate * 0.4f));
            v.phase += f * (0.7f + 0.3f * drop);
            if (v.phase > 1.0f) v.phase -= 1.0f;
            osc = std::sin(kTwoPi * v.phase) * drop + white(v.rng) * 0.08f * drop;
            break;
        }
        default:
            v.phase += f;
            if (v.phase > 1.0f) v.phase -= 1.0f;
            osc = std::sin(kTwoPi * v.phase);
            break;
    }

    const float aenv = v.amp.process();
    const float fenv = v.filtEg.process();
    float y = osc;
    if (isPianoFamily(v.model) || v.model == Model::Bells || v.model == Model::Vibraphone ||
        v.model == Model::Marimba || v.model == Model::Xylophone) {
        const float toneA = clampf(0.22f + 0.62f * velB * v.brightness, 0.16f, 0.9f);
        y = v.tone.processLp(y, toneA);
    } else {
        const float keyTrack = std::pow(2.0f, ((float)v.note - 60.0f) / 36.0f);
        float cut = v.cutoff * keyTrack * (0.75f + 0.55f * velB * v.brightness) + v.filtEnvAmt * fenv * 6500.0f;
        cut = clampf(cut, 280.0f, sampleRate * 0.45f);
        v.filt.set(cut, v.reso, sampleRate);
        v.filt.tick(osc);
        y = v.filt.lp;
        if (v.model == Model::Clav || v.model == Model::Sax) y = 0.65f * v.filt.bp + 0.35f * v.filt.lp;
        if (v.model == Model::Ney || v.model == Model::Duduk || v.model == Model::Flute) y = 0.5f * v.filt.bp + 0.5f * v.filt.lp;
        if (v.model == Model::DistGuitar) y = fastTanh(y * 1.8f);
    }
    y = v.dc.process(y) * aenv * v.gain;
    L = y * v.panL;
    R = y * v.panR;
}

void Engine::renderDrum(Voice& v, float& L, float& R) {
    const float t = v.drumT;
    v.drumT += 1.0f / sampleRate;
    const float aenv = v.amp.process();
    float y = 0.0f;
    const int n = v.drumKind;
    const bool arabic = v.model == Model::KitArabic;

    auto body = [&](float startHz, float endHz, float decay) {
        const float f = startHz + (endHz - startHz) * (1.0f - std::exp(-t * 40.0f));
        v.phase += f / sampleRate;
        if (v.phase > 1.0f) v.phase -= 1.0f;
        return std::sin(kTwoPi * v.phase) * std::exp(-t * decay);
    };

    if (n == 36 || n == 35 || (arabic && (n == 41 || n == 43))) {
        const float pitch = (arabic ? 160.0f : 210.0f) * std::exp(-t * 18.0f) + (arabic ? 42.0f : 52.0f);
        v.phase += pitch / sampleRate;
        if (v.phase > 1.0f) v.phase -= 1.0f;
        const float click = white(v.rng) * std::exp(-t * 140.0f);
        y = std::sin(kTwoPi * v.phase) * std::exp(-t * 5.5f) * 1.55f + click * 0.55f;
        y = fastTanh(y);
    } else if (n == 38 || n == 40) {
        y = body(220.0f, 160.0f, 14.0f) * 0.35f;
        y += white(v.rng) * std::exp(-t * 12.0f) * 0.95f;
        v.filt.set(n == 40 ? 5200.0f : 3800.0f, 0.18f, sampleRate);
        v.filt.tick(y);
        y = 0.55f * v.filt.bp + 0.45f * v.filt.hp;
    } else if (n == 37 || n == 76 || n == 77) {
        y = white(v.rng) * std::exp(-t * 48.0f);
        v.filt.set(7000.0f, 0.25f, sampleRate);
        v.filt.tick(y);
        y = v.filt.hp;
    } else if (n == 42 || n == 44) {
        y = white(v.rng);
        v.filt.set(11000.0f, 0.12f, sampleRate);
        v.filt.tick(y);
        y = v.filt.hp * std::exp(-t * (n == 44 ? 70.0f : 48.0f));
    } else if (n == 46) {
        y = white(v.rng);
        v.filt.set(9000.0f, 0.1f, sampleRate);
        v.filt.tick(y);
        y = v.filt.hp * std::exp(-t * 6.5f);
    } else if (n == 49 || n == 57) {
        y = white(v.rng);
        v.filt.set(7200.0f, 0.35f, sampleRate);
        v.filt.tick(y);
        y = (v.filt.bp + v.filt.hp) * std::exp(-t * 2.6f) * 0.7f;
    } else if (n >= 45 && n <= 50) {
        const float start = 220.0f - (n - 45) * 20.0f;
        y = body(start, start * 0.6f, 6.5f);
        y += white(v.rng) * std::exp(-t * 36.0f) * 0.18f;
    } else if (n == 39) {
        float clap = 0;
        for (float off : {0.0f, 0.012f, 0.024f, 0.04f}) {
            const float tt = t - off;
            if (tt > 0) clap += white(v.rng) * std::exp(-tt * 24.0f);
        }
        y = clap * 0.7f;
    } else {
        y = body(240.0f, 110.0f, 9.0f) * 0.55f + white(v.rng) * std::exp(-t * 16.0f) * 0.35f;
    }

    y = v.dc.process(y) * aenv * v.gain * 1.35f;
    L = y * 0.72f;
    R = y * 0.72f;
}

void Engine::renderSample(Voice& v, float& L, float& R) {
    if (v.sampleIndex < 0 || v.sampleIndex >= (int)samples.size()) {
        L = R = 0;
        v.amp.process();
        return;
    }
    const Sample& sm = samples[v.sampleIndex];
    const int frames = sm.frames();
    const int ch = sm.channels >= 2 ? 2 : 1;
    const int end = v.sampleEnd > 1 ? v.sampleEnd : frames;
    if (sm.data.empty() || frames <= 1) {
        L = R = 0;
        return;
    }
    const bool looping = v.sampleLoop;
    const int ls = v.loopStart;
    const int le = v.loopEnd > ls ? v.loopEnd : end;
    const float sL = hermiteAt(sm.data.data(), frames, ch, 0, v.samplePos, ls, le, looping);
    const float sR =
            ch == 2 ? hermiteAt(sm.data.data(), frames, ch, 1, v.samplePos, ls, le, looping) : sL;
    v.samplePos += v.sampleInc * chanBendRatio[v.chan & 15];
    if (looping && v.samplePos >= le && le > ls) {
        v.samplePos = ls + std::fmod(v.samplePos - ls, (double)(le - ls));
    } else if (v.samplePos >= (double)end - 2) {
        v.amp.noteOff();
        v.active = false;
    }
    const float aenv = v.amp.process();
    const float fenv = v.filtEg.process();
    float yL = sL, yR = sR;
    if (v.cutoff < 18000.0f || v.filtEnvAmt > 0.01f) {
        float cut = v.cutoff * (0.55f + v.brightness * (v.vel / 127.0f) + v.filtEnvAmt * fenv);
        v.filt.set(cut, std::max(0.0f, v.reso), sampleRate);
        v.filtR.set(cut, std::max(0.0f, v.reso), sampleRate);
        v.filt.tick(yL);
        v.filtR.tick(yR);
        yL = v.filt.lp;
        yR = v.filtR.lp;
    }
    L = yL * aenv * v.gain * v.panL;
    R = yR * aenv * v.gain * v.panR;
}

void Engine::renderVoice(Voice& v, float* buses, float* sends, int) {
    float L = 0, R = 0;
    if (v.sampleIndex >= 0)
        renderSample(v, L, R);
    else if (isKit(v.model))
        renderDrum(v, L, R);
    else
        renderSynth(v, L, R);
    const int b = std::max(0, std::min(kBusCount - 2, v.bus));
    buses[b * 2] += L;
    buses[b * 2 + 1] += R;
    if (sends) {
        sends[0] += L * v.reverbSend;
        sends[1] += R * v.reverbSend;
        sends[2] += L * v.chorusSend;
        sends[3] += R * v.chorusSend;
        sends[4] += L * v.delaySend;
        sends[5] += R * v.delaySend;
    }
    v.age += 1.0f;
    if (v.amp.idle()) v.active = false;
}

void Engine::render(float* out, int frames) {
    MidiEvent e;
    while (midi.pop(e)) handle(e);

    const double ticksPerSample = (arrSt.tempo / 60.0) * (double)kPpq / (double)sampleRate;
    for (int i = 0; i < frames; ++i) {
        if (arrSt.running) {
            arrSt.tickPos += ticksPerSample;
            const int whole = (int)arrSt.tickPos;
            if (whole > 0) {
                arr.renderTicks(*this, arrSt, whole, sampleRate);
                arrSt.tickPos -= whole;
            }
        }

        float buses[kBusCount * 2]{};
        float sends[6]{};
        for (int v = 0; v < kMaxVoices; ++v) {
            if (voices[v].active || !voices[v].amp.idle()) renderVoice(voices[v], buses, sends, 1);
        }

        float dL = drumComp.process(buses[BusDrums * 2] * mix.g[BusDrums], sampleRate);
        float dR = drumComp.process(buses[BusDrums * 2 + 1] * mix.g[BusDrums], sampleRate);
        float accL = buses[BusAcc * 2] * mix.g[BusAcc] + buses[BusPad * 2] * mix.g[BusPad];
        float accR = buses[BusAcc * 2 + 1] * mix.g[BusAcc] + buses[BusPad * 2 + 1] * mix.g[BusPad];
        float L = buses[BusKeyboard * 2] * mix.g[BusKeyboard] + buses[BusBass * 2] * mix.g[BusBass] + dL + accL;
        float R = buses[BusKeyboard * 2 + 1] * mix.g[BusKeyboard] + buses[BusBass * 2 + 1] * mix.g[BusBass] + dR + accR;
        if (gmFont) {
            float tsfS[2] = {0.0f, 0.0f};
            tsf_render_float(gmFont, tsfS, 1, 0);
            L += tsfS[0];
            R += tsfS[1];
            sends[0] += tsfS[0] * 0.16f;
            sends[1] += tsfS[1] * 0.16f;
        }
        const float choL = chorus.processL(sends[2], sampleRate);
        const float choR = chorus.processR(sends[3], sampleRate);
        float dlyL = 0, dlyR = 0;
        delayFx.processSend(sends[4], sends[5], dlyL, dlyR, sampleRate);
        L += choL * chorusMix + dlyL * delayFx.mix;
        R += choR * chorusMix + dlyR * delayFx.mix;
        float revL = 0, revR = 0;
        reverb.processSend(sends[0], sends[1], revL, revR, sampleRate);
        L += revL * reverb.mix;
        R += revR * reverb.mix;
        L = eqHighL.process(eqMidL.process(eqLowL.process(L)));
        R = eqHighR.process(eqMidR.process(eqLowR.process(R)));
        L *= mix.g[BusMaster];
        R *= mix.g[BusMaster];
        L = limiter.process(outDcL.process(L));
        R = limiter.process(outDcR.process(R));
        out[i * 2] = clampf(L, -1.0f, 1.0f);
        out[i * 2 + 1] = clampf(R, -1.0f, 1.0f);
    }
}

int Engine::loadSfz(const char* path, char* report, int reportLen) {
    if (report && reportLen > 0) report[0] = 0;
    std::vector<Sample> loaded;
    Patch patch;
    std::string error;
    if (!parseSfzFile(path, loaded, patch, error)) {
        if (report && reportLen > 0) {
            std::snprintf(report, (size_t)reportLen, "{\"ok\":0,\"reason\":\"%s\"}", error.c_str());
        }
        return -1;
    }
    std::vector<int> remap(loaded.size(), -1);
    for (auto& z : patch.zones) {
        if (z.sampleIndex < 0 || z.sampleIndex >= (int)loaded.size()) continue;
        if (remap[(size_t)z.sampleIndex] < 0) remap[(size_t)z.sampleIndex] = addSample(std::move(loaded[(size_t)z.sampleIndex]));
        z.sampleIndex = remap[(size_t)z.sampleIndex];
    }
    const int id = addSampledInstrument(patch);
    if (report && reportLen > 0) {
        std::snprintf(report, (size_t)reportLen, "{\"ok\":1,\"id\":%d,\"zones\":%d}", id, (int)patch.zones.size());
    }
    return id;
}

int Engine::loadAbStyle(const char* path, char* report, int reportLen) {
    Arranger::Style style;
    std::string error;
    if (!parseAbStyleFile(path, style, error)) {
        if (report && reportLen > 0) {
            std::snprintf(report, (size_t)reportLen, "{\"ok\":0,\"reason\":\"%s\"}", error.c_str());
        }
        return -1;
    }
    int drum = -1, bass = -1, acc1 = -1, acc2 = -1, acc3 = -1;
    for (int i = 0; i < (int)patches.size(); ++i) {
        if (isKit(patches[(size_t)i].model) && drum < 0) drum = i;
        if (patches[(size_t)i].bus == BusBass && bass < 0) bass = i;
        if (patches[(size_t)i].model == Model::Piano && acc1 < 0) acc1 = i;
        if (patches[(size_t)i].model == Model::ConcertStrings && acc2 < 0) acc2 = i;
        if (patches[(size_t)i].model == Model::NylonGuitar && acc3 < 0) acc3 = i;
    }
    applyStylePrograms(style, drum, bass, acc1, acc2, acc3);
    const int id = addStyle(std::move(style));
    if (report && reportLen > 0) {
        std::snprintf(report, (size_t)reportLen, "{\"ok\":1,\"id\":%d}", id);
    }
    return id;
}

}  // namespace pa

