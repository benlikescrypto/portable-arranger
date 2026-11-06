#pragma once

#include "Dsp.h"

#include <atomic>
#include <cstdint>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

namespace pa {

struct Sample {
    std::vector<float> data;
    int sampleRate = 44100;
    int loopStart = 0;
    int loopEnd = 0;
    bool loop = false;
    char name[32]{};
};

struct Zone {
    int keyLow = 0, keyHigh = 127, velLow = 0, velHigh = 127, root = 60;
    float tuneCents = 0.0f;
    float gain = 1.0f;
    int sampleIndex = -1;
};

struct Patch {
    char name[40]{};
    char category[24]{};
    Model model = Model::Piano;
    bool sampled = false;
    float attack = 3, decay = 400, sustain = 0.72f, release = 280;
    float cutoff = 8000, reso = 0.15f, filtEnv = 0.25f;
    float chorus = 0.15f, reverb = 0.22f;
    float brightness = 0.55f;
    float vibRate = 5.0f, vibDepth = 0.0f, vibDelay = 0.35f;
    float pan = 0.0f;
    int bus = BusKeyboard;
    std::vector<Zone> zones;
};

struct Voice {
    bool active = false;
    int note = 0, chan = 0, vel = 0, inst = 0, bus = 0;
    float age = 0;
    Model model = Model::Piano;
    Adsr amp, filtEg;
    Svf filt;
    DcBlock dc;
    OnePole tone;
    float phase = 0, phase2 = 0, phase3 = 0, fm = 0;
    float lfo = 0, lfoDelay = 0;
    float panL = 0.7f, panR = 0.7f;
    float gain = 0.2f;
    float cutoff = 8000, reso = 0.1f, filtEnvAmt = 0;
    float vibRate = 5, vibDepth = 0, brightness = 0.5f;
    float reverbSend = 0.2f, chorusSend = 0.1f;
    double samplePos = 0, sampleInc = 1;
    int sampleIndex = -1;
    float ks[kKsLen]{};
    int ksLen = 200, ksIdx = 0;
    float ksFilter = 0;
    uint32_t rng = 1;
    float drumT = 0, drumPitch = 0, drumNoise = 0;
    int drumKind = 0;
    bool releasing = false;
};

enum class MidiKind : uint8_t { NoteOn, NoteOff, Cc, Pb, Style, LoadInst, Pc, Clock };

struct MidiEvent {
    MidiKind kind{};
    int a = 0, b = 0, c = 0, d = 0;
};

template <size_t N>
struct MidiQueue {
    MidiEvent q[N]{};
    std::atomic<uint32_t> w{0}, r{0};
    bool push(const MidiEvent& e) {
        const uint32_t wi = w.load(std::memory_order_relaxed);
        const uint32_t ni = (wi + 1) % N;
        if (ni == r.load(std::memory_order_acquire)) return false;
        q[wi] = e;
        w.store(ni, std::memory_order_release);
        return true;
    }
    bool pop(MidiEvent& e) {
        const uint32_t ri = r.load(std::memory_order_relaxed);
        if (ri == w.load(std::memory_order_acquire)) return false;
        e = q[ri];
        r.store((ri + 1) % N, std::memory_order_release);
        return true;
    }
};

struct Mixer {
    float g[kBusCount] = {0.95f, 0.92f, 0.88f, 0.82f, 0.75f, 0.90f};
    float pan[kBusCount] = {0, 0, 0, 0, 0, 0};
};

enum class Section : int {
    None = 0,
    Intro1, Intro2, Intro3,
    Var1, Var2, Var3, Var4,
    Fill1, Fill2, Fill3, Fill4,
    Break,
    Ending1, Ending2, Ending3
};

struct ArrangerState {
    bool running = false;
    bool synchro = true;
    bool autoFill = true;
    int styleId = 0;
    int variation = 1;
    Section current = Section::Var1;
    Section booked = Section::None;
    float tempo = 100.0f;
    int chordRoot = 0;
    int chordType = 0;  // 0 maj, 1 min, 2 7, 3 min7, 4 maj7, 5 sus4, 6 dim
    int split = 60;
    double tickPos = 0;
    int barLenTicks = kPpq * 4;
    int sectionLenTicks = kPpq * 4 * 4;
    std::atomic<int> displayRoot{0};
    std::atomic<int> displayType{0};
    std::atomic<int> displaySection{4};
    std::atomic<int> playing{0};
};

class Arranger;
class Engine;

void buildFactory(std::vector<Patch>& patches, std::vector<std::string>& styleNames,
                  std::vector<std::string>& styleCats, std::vector<float>& styleTempos);
void buildArranger(Arranger& arr);
int loadWav(const char* path, Sample& out);
int loadKsf(const char* path, Sample& out);
int scanPcmBank(const char* path, std::vector<Sample>& out);
bool readFileBytes(const char* path, std::vector<uint8_t>& bytes);
int loadKsfBytes(const uint8_t* bytes, size_t n, Sample& out, bool* compressed = nullptr);
Arranger::Style completeStyle(Arranger::Style s);
Arranger::Style fallbackStyle(const char* name, const char* cat, float tempo);

class Arranger {
public:
    void setup();
    void start(ArrangerState& st);
    void stop(ArrangerState& st);
    void book(ArrangerState& st, Section s);
    void setStyle(ArrangerState& st, int id);
    void onChord(ArrangerState& st, int root, int type);
    void renderTicks(Engine& eng, ArrangerState& st, int ticks, float sr);
    int styleCount() const;
    const char* styleName(int id) const;
    const char* styleCategory(int id) const;
    float styleTempo(int id) const;

    struct Ev {
        uint16_t tick;
        uint8_t trk, note, vel;
        uint16_t dur;
        uint8_t flags;
    };
    struct Pattern {
        std::vector<Ev> evs;
        int lengthTicks = kPpq * 16;
        int drumProg = 32, bassProg = 21, acc1 = 0, acc2 = 9, acc3 = 10;
    };
    struct Style {
        char name[40]{};
        char category[24]{};
        float tempo = 100;
        Pattern intro1, intro2, intro3;
        Pattern var[4];
        Pattern fill[4];
        Pattern brk, end1, end2, end3;
    };
    std::vector<Style> styles;

    struct Hold {
        int remain = 0, inst = 0, note = 0, ch = 0;
    };
    Hold holds[64]{};
    int holdn = 0;
};

class Engine {
public:
    Engine();
    ~Engine();

    void prepare(float sr);
    void render(float* out, int frames);
    void setLatencyMs(float ms) { latency.store(ms); }

    void noteOn(int ch, int note, int vel);
    void noteOff(int ch, int note);
    void cc(int ch, int ctl, int val);
    void pitchBend(int ch, int lsb, int msb);
    void programChange(int ch, int program);
    void midiClock();
    void midiTransportStart();
    void midiTransportStop();
    void midiTransportContinue();
    void setPartProgram(int part, int instId);
    void setPartEnable(int part, bool on);
    void setSplit(int note);
    void setTempo(float bpm);
    void setMixer(int bus, float gain);
    void arrangerStart();
    void arrangerStop();
    void arrangerToggle();
    void bookSection(int section);
    void setStyle(int id);
    void setSynchro(bool on);
    void setAutoFill(bool on);
    void sustain(bool on);

    int soundCount() const { return (int)patches.size(); }
    const char* soundName(int id) const;
    const char* soundCategory(int id) const;
    int styleCount() const { return arr.styleCount(); }
    const char* styleName(int id) const { return arr.styleName(id); }
    const char* styleCategory(int id) const { return arr.styleCategory(id); }
    float styleTempo(int id) const { return arr.styleTempo(id); }

    int addSampledInstrument(const Patch& p);
    int addSample(Sample&& s);
    int addStyle(Arranger::Style style);
    int loadPa4xSet(const char* folder, char* report, int reportLen);

    float latencyMs() const { return latency.load(); }
    int currentChordRoot() const { return arrSt.displayRoot.load(); }
    int currentChordType() const { return arrSt.displayType.load(); }
    int currentSection() const { return arrSt.displaySection.load(); }
    bool isPlaying() const { return arrSt.playing.load() != 0; }
    float tempo() const { return arrSt.tempo; }
    int variation() const { return arrSt.variation; }
    uint32_t midiClockCount() const { return clockTicks.load(); }

    void playInternal(int instId, int note, int vel, int bus, int ch);
    void stopInternal(int instId, int note, int ch);

    float sampleRate = 48000.0f;

private:
    void handle(const MidiEvent& e);
    void startVoice(int instId, int note, int vel, int bus, int ch);
    void stopVoices(int note, int ch, bool matchInst, int instId);
    int stealVoice();
    void renderVoice(Voice& v, float* buses, int frames);
    void renderSynth(Voice& v, float& L, float& R);
    void renderDrum(Voice& v, float& L, float& R);
    void renderSample(Voice& v, float& L, float& R);
    void detectChord();

    MidiQueue<1024> midi;
    Voice voices[kMaxVoices];
    std::vector<Patch> patches;
    std::vector<Sample> samples;
    Arranger arr;
    ArrangerState arrSt;
    Mixer mix;
    Reverb reverb;
    Chorus chorus;
    PeakEq eqLowL, eqMidL, eqHighL, eqLowR, eqMidR, eqHighR;
    Compressor drumComp, masterComp;
    Limiter limiter;
    DcBlock outDcL, outDcR;

    int partProg[4] = {0, 7, -1, 21};
    bool partOn[4] = {true, false, false, true};
    int splitNote = 60;
    bool sustainOn = false;
    uint8_t held[16][128]{};
    float chanBend[16]{};
    float chanBendRatio[16] = {1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1};
    uint32_t rng = 0xA341316Cu;
    std::atomic<float> latency{8.0f};
    std::atomic<uint32_t> clockTicks{0};
    std::mutex loadMu;
    bool factoryReady = false;
};

}  // namespace pa
