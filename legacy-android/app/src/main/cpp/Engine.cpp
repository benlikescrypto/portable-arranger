#include "Engine.h"

#include <android/log.h>

#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, "PAEngine", __VA_ARGS__)

namespace pa {

static std::vector<std::string> gNames, gCats;
static std::vector<float> gTempos;

Engine::Engine() {
    buildFactory(patches, gNames, gCats, gTempos);
    arr.setup();
    buildArranger(arr);
    auto setupEq = [&](float sr) {
        eqLowL.setLowShelf(sr, 90.0f, 1.6f);
        eqLowR.setLowShelf(sr, 90.0f, 1.6f);
        eqMidL.setPeaking(sr, 1200.0f, 0.7f, 0.6f);
        eqMidR.setPeaking(sr, 1200.0f, 0.7f, 0.6f);
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

Engine::~Engine() { stop(); }

bool Engine::openStream(oboe::SharingMode mode) {
    oboe::AudioStreamBuilder b;
    b.setDirection(oboe::Direction::Output);
    b.setPerformanceMode(oboe::PerformanceMode::LowLatency);
    b.setSharingMode(mode);
    b.setFormat(oboe::AudioFormat::Float);
    b.setChannelCount(2);
    b.setSampleRate(48000);
    b.setSampleRateConversionQuality(oboe::SampleRateConversionQuality::Medium);
    b.setDataCallback(this);
    b.setErrorCallback(this);
    oboe::Result r = b.openStream(stream);
    return r == oboe::Result::OK && stream != nullptr;
}

bool Engine::start() {
    stop();
    if (!openStream(oboe::SharingMode::Exclusive)) {
        LOGI("Exclusive audio failed, trying shared");
        if (!openStream(oboe::SharingMode::Shared)) {
            LOGI("Failed to open audio stream");
            return false;
        }
    }
    sampleRate = (float)stream->getSampleRate();
    eqLowL.setLowShelf(sampleRate, 90.0f, 1.6f);
    eqLowR.setLowShelf(sampleRate, 90.0f, 1.6f);
    eqMidL.setPeaking(sampleRate, 1200.0f, 0.7f, 0.6f);
    eqMidR.setPeaking(sampleRate, 1200.0f, 0.7f, 0.6f);
    eqHighL.setPeaking(sampleRate, 6500.0f, 0.8f, 1.8f);
    eqHighR.setPeaking(sampleRate, 6500.0f, 0.8f, 1.8f);
    const auto burst = stream->getFramesPerBurst();
    latency.store((burst * 2.0f / sampleRate) * 1000.0f);
    const auto req = stream->requestStart();
    LOGI("Audio started sr=%d burst=%d res=%s", (int)sampleRate, burst, oboe::convertToText(req));
    return req == oboe::Result::OK;
}

void Engine::stop() {
    if (stream) {
        stream->stop();
        stream->close();
        stream.reset();
    }
}

void Engine::onErrorAfterClose(oboe::AudioStream*, oboe::Result) {
    start();
}

void Engine::noteOn(int ch, int note, int vel) {
    midi.push({MidiKind::NoteOn, ch, note, vel, 0});
}
void Engine::noteOff(int ch, int note) { midi.push({MidiKind::NoteOff, ch, note, 0, 0}); }
void Engine::cc(int ch, int ctl, int val) { midi.push({MidiKind::Cc, ch, ctl, val, 0}); }
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

const char* Engine::soundName(int id) const {
    if (id < 0 || id >= (int)patches.size()) return "";
    return patches[id].name;
}
const char* Engine::soundCategory(int id) const {
    if (id < 0 || id >= (int)patches.size()) return "";
    return patches[id].category;
}

int Engine::addSampledInstrument(const Patch& p) {
    std::lock_guard<std::mutex> g(loadMu);
    patches.push_back(p);
    return (int)patches.size() - 1;
}
int Engine::addSample(Sample&& s) {
    std::lock_guard<std::mutex> g(loadMu);
    samples.push_back(std::move(s));
    return (int)samples.size() - 1;
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

void Engine::startVoice(int instId, int note, int vel, int bus, int ch) {
    if (instId < 0 || instId >= (int)patches.size() || vel <= 0) return;
    const Patch& p = patches[instId];
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
    v.gain = velCurve(vel) * 0.22f;
    v.cutoff = p.cutoff;
    v.reso = p.reso;
    v.filtEnvAmt = p.filtEnv;
    v.brightness = p.brightness;
    v.vibRate = p.vibRate;
    v.vibDepth = p.vibDepth;
    v.reverbSend = p.reverb;
    v.chorusSend = p.chorus;
    const float pan = clampf(p.pan, -1.0f, 1.0f);
    v.panL = std::sqrt((1.0f - pan) * 0.5f);
    v.panR = std::sqrt((1.0f + pan) * 0.5f);
    v.amp.setTimes(sampleRate, p.attack, p.decay, p.sustain, p.release);
    v.filtEg.setTimes(sampleRate, p.attack * 0.6f, p.decay * 0.8f, p.sustain, p.release);
    v.amp.noteOn();
    v.filtEg.noteOn();
    v.filt.reset();
    v.phase = 0.02f * (rng & 255);
    v.sampleIndex = -1;
    v.samplePos = 0;

    if (p.sampled && !p.zones.empty()) {
        for (const Zone& z : p.zones) {
            if (note >= z.keyLow && note <= z.keyHigh && vel >= z.velLow && vel <= z.velHigh) {
                v.sampleIndex = z.sampleIndex;
                v.gain *= z.gain;
                if (z.sampleIndex >= 0 && z.sampleIndex < (int)samples.size()) {
                    const Sample& sm = samples[z.sampleIndex];
                    const float target = midiToHz((float)note + z.tuneCents / 100.0f);
                    const float rootHz = midiToHz((float)z.root);
                    v.sampleInc = (target / rootHz) * ((double)sm.sampleRate / (double)sampleRate);
                }
                break;
            }
        }
    }

    if (isKit(p.model)) {
        v.drumT = 0;
        v.drumKind = note;
        v.amp.setTimes(sampleRate, 0.4f, 80.0f, 0.0f, 120.0f);
        if (note == 42 || note == 44) v.amp.setTimes(sampleRate, 0.2f, 40.0f, 0.0f, 50.0f);
        if (note == 46) v.amp.setTimes(sampleRate, 0.3f, 180.0f, 0.0f, 220.0f);
        if (note == 49 || note == 57) v.amp.setTimes(sampleRate, 0.5f, 900.0f, 0.0f, 1200.0f);
        v.bus = BusDrums;
    }

    if (p.model == Model::Oud || p.model == Model::NylonGuitar || p.model == Model::Bouzouki ||
        p.model == Model::Kanun) {
        const float freq = midiToHz((float)note);
        v.ksLen = std::max(20, std::min(kKsLen - 1, (int)(sampleRate / freq)));
        v.ksIdx = 0;
        v.ksFilter = 0;
        for (int i = 0; i < v.ksLen; ++i) {
            float n = white(v.rng);
            if (i > v.ksLen * 0.85f) n *= 0.2f;
            v.ks[i] = n;
        }
    }
}

void Engine::stopVoices(int note, int ch, bool matchInst, int instId) {
    for (int i = 0; i < kMaxVoices; ++i) {
        Voice& v = voices[i];
        if (!v.active) continue;
        if (v.note != note) continue;
        if (ch >= 0 && v.chan != ch && ch != 0x7f) continue;
        if (matchInst && v.inst != instId) continue;
        if (sustainOn && v.chan < 4) continue;
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
    };
    for (int root = 0; root < 12; ++root) {
        for (int t = 0; t < 7; ++t) {
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
            const int ch = e.a, note = e.b, vel = e.c;
            if (note < 0 || note > 127) return;
            held[ch & 15][note] = 1;
            const bool left = note <= splitNote;
            if (left) detectChord();
            if (left && arrSt.synchro && !arrSt.running) arr.start(arrSt);
            if (left && !partOn[3]) return;
            if (!left || partOn[3]) {
                if (!left) {
                    if (partOn[0]) startVoice(partProg[0], note, vel, BusKeyboard, 0);
                    if (partOn[1] && partProg[1] >= 0) startVoice(partProg[1], note, vel, BusKeyboard, 1);
                    if (partOn[2] && partProg[2] >= 0) startVoice(partProg[2], note, vel, BusKeyboard, 2);
                } else {
                    startVoice(partProg[3], note, vel, BusBass, 3);
                }
            }
            break;
        }
        case MidiKind::NoteOff: {
            const int ch = e.a, note = e.b;
            if (note < 0 || note > 127) return;
            held[ch & 15][note] = 0;
            stopVoices(note, -1, false, 0);
            detectChord();
            break;
        }
        case MidiKind::Cc:
            if (e.a == 0x7f) {
                if (e.b >= 0 && e.b < 4) partOn[e.b] = e.c != 0;
            } else if (e.b == 64) {
                sustainOn = e.c >= 64;
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
            }
            break;
        case MidiKind::LoadInst:
            if (e.a >= 0 && e.a < 4) partProg[e.a] = e.b;
            break;
        case MidiKind::Style:
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
    const float freq = midiToHz((float)v.note);
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
            const float inharm = 1.0f + (v.model == Model::BrightPiano ? 0.00035f : 0.00022f);
            float acc = 0.0f;
            float pn = v.phase;
            float w = f;
            const int parts = v.model == Model::SoftPiano ? 8 : 12;
            for (int n = 1; n <= parts; ++n) {
                const float damp = std::exp(-0.018f * n * n * (0.4f + (1.0f - velB)));
                acc += std::sin(kTwoPi * pn) * damp / (float)n;
                pn += w * inharm;
                if (pn > 1.0f) pn -= (int)pn;
                w *= inharm;
            }
            osc = acc * 0.55f + white(v.rng) * 0.04f * v.amp.level * (v.amp.stage == Adsr::Attack ? 1.0f : 0.15f);
            v.phase += f;
            if (v.phase > 1.0f) v.phase -= (int)v.phase;
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
            v.phase += f;
            if (v.phase > 1.0f) v.phase -= 1.0f;
            osc = blepPulse(v.phase, f, 0.5f);
            break;
        case Model::SawLead:
            v.phase += f;
            if (v.phase > 1.0f) v.phase -= 1.0f;
            osc = blepSaw(v.phase, f);
            break;
        default:
            v.phase += f;
            if (v.phase > 1.0f) v.phase -= 1.0f;
            osc = std::sin(kTwoPi * v.phase);
            break;
    }

    const float aenv = v.amp.process();
    const float fenv = v.filtEg.process();
    float cut = v.cutoff * (0.45f + v.brightness * velB + v.filtEnvAmt * fenv);
    v.filt.set(cut, v.reso, sampleRate);
    v.filt.tick(osc);
    float y = v.filt.lp;
    if (v.model == Model::Clav || v.model == Model::Sax) y = 0.65f * v.filt.bp + 0.35f * v.filt.lp;
    if (v.model == Model::Ney || v.model == Model::Duduk) y = 0.5f * v.filt.bp + 0.5f * v.filt.lp;
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
        y = body(arabic ? 95.0f : 130.0f, 48.0f, 8.0f) * 1.4f;
        y += white(v.rng) * std::exp(-t * 90.0f) * 0.35f;
        y = fastTanh(y * 1.6f);
    } else if (n == 38 || n == 40) {
        y = body(190.0f, 140.0f, 16.0f) * 0.4f;
        y += white(v.rng) * std::exp(-t * 18.0f) * 0.85f;
        v.filt.set(3500.0f, 0.2f, sampleRate);
        v.filt.tick(y);
        y = v.filt.bp;
    } else if (n == 37 || n == 76 || n == 77) {
        y = white(v.rng) * std::exp(-t * 55.0f);
        v.filt.set(6500.0f, 0.3f, sampleRate);
        v.filt.tick(y);
        y = v.filt.hp;
    } else if (n == 42 || n == 44) {
        y = white(v.rng);
        v.filt.set(9000.0f, 0.15f, sampleRate);
        v.filt.tick(y);
        y = v.filt.hp * std::exp(-t * 55.0f);
    } else if (n == 46) {
        y = white(v.rng);
        v.filt.set(7500.0f, 0.12f, sampleRate);
        v.filt.tick(y);
        y = v.filt.hp * std::exp(-t * 8.0f);
    } else if (n == 49 || n == 57) {
        y = white(v.rng);
        v.filt.set(6000.0f, 0.4f, sampleRate);
        v.filt.tick(y);
        y = (v.filt.bp + v.filt.hp) * std::exp(-t * 3.2f) * 0.6f;
    } else if (n >= 45 && n <= 50) {
        const float start = 180.0f - (n - 45) * 18.0f;
        y = body(start, start * 0.55f, 7.0f);
        y += white(v.rng) * std::exp(-t * 40.0f) * 0.2f;
    } else if (n == 39) {
        float clap = 0;
        for (float off : {0.0f, 0.011f, 0.023f, 0.038f}) {
            const float tt = t - off;
            if (tt > 0) clap += white(v.rng) * std::exp(-tt * 28.0f);
        }
        y = clap * 0.6f;
    } else {
        y = body(220.0f, 90.0f, 10.0f) * 0.6f + white(v.rng) * std::exp(-t * 20.0f) * 0.3f;
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
    if (sm.data.empty()) {
        L = R = 0;
        return;
    }
    float s = hermite(sm.data.data(), (int)sm.data.size(), v.samplePos);
    v.samplePos += v.sampleInc;
    if (sm.loop && v.samplePos >= sm.loopEnd && sm.loopEnd > sm.loopStart) {
        v.samplePos = sm.loopStart + std::fmod(v.samplePos - sm.loopStart, (double)(sm.loopEnd - sm.loopStart));
    } else if (v.samplePos >= (double)sm.data.size() - 2) {
        v.amp.noteOff();
        v.active = false;
    }
    const float aenv = v.amp.process();
    s = v.dc.process(s) * aenv * v.gain;
    L = s * v.panL;
    R = s * v.panR;
}

void Engine::renderVoice(Voice& v, float* buses, int) {
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
        for (int v = 0; v < kMaxVoices; ++v) {
            if (voices[v].active || !voices[v].amp.idle()) renderVoice(voices[v], buses, 1);
        }

        float dL = drumComp.process(buses[BusDrums * 2] * mix.g[BusDrums], sampleRate);
        float dR = drumComp.process(buses[BusDrums * 2 + 1] * mix.g[BusDrums], sampleRate);
        float accL = buses[BusAcc * 2] * mix.g[BusAcc] + buses[BusPad * 2] * mix.g[BusPad];
        float accR = buses[BusAcc * 2 + 1] * mix.g[BusAcc] + buses[BusPad * 2 + 1] * mix.g[BusPad];
        const float cL = chorus.processL(accL, sampleRate);
        const float cR = chorus.processR(accR, sampleRate);
        float L = buses[BusKeyboard * 2] * mix.g[BusKeyboard] + buses[BusBass * 2] * mix.g[BusBass] + dL + cL;
        float R = buses[BusKeyboard * 2 + 1] * mix.g[BusKeyboard] + buses[BusBass * 2 + 1] * mix.g[BusBass] + dR + cR;
        reverb.process(L, R, L, R, sampleRate);
        L = eqHighL.process(eqMidL.process(eqLowL.process(L)));
        R = eqHighR.process(eqMidR.process(eqLowR.process(R)));
        L = masterComp.process(L, sampleRate) * mix.g[BusMaster];
        R = masterComp.process(R, sampleRate) * mix.g[BusMaster];
        L = limiter.process(outDcL.process(L));
        R = limiter.process(outDcR.process(R));
        out[i * 2] = clampf(L, -1.0f, 1.0f);
        out[i * 2 + 1] = clampf(R, -1.0f, 1.0f);
    }
}

oboe::DataCallbackResult Engine::onAudioReady(oboe::AudioStream*, void* data, int32_t numFrames) {
    render(static_cast<float*>(data), numFrames);
    return oboe::DataCallbackResult::Continue;
}

}  // namespace pa
