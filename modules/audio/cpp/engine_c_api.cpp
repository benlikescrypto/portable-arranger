#include "engine_c_api.h"

#include "Engine.h"

#include <cstring>
#include <mutex>
#include <string>

namespace {
std::mutex gMu;
pa::Engine* gLive = nullptr;

pa::Engine* live() { return gLive; }

void copyName(const char* src, char* out, int maxLen) {
    if (!out || maxLen <= 0) return;
    if (!src) src = "";
    std::strncpy(out, src, static_cast<size_t>(maxLen - 1));
    out[maxLen - 1] = 0;
}

int loadSampled(const char* path, const char* name, const char* category, bool ksf) {
    auto* e = live();
    if (!e || !path) return -1;
    pa::Sample s;
    const int n = ksf ? pa::loadKsf(path, s) : pa::loadWav(path, s);
    if (n <= 0) return -1;
    const int root = s.rootNote > 0 ? s.rootNote : 60;
    const int si = e->addSample(std::move(s));
    pa::Patch p;
    std::strncpy(p.name, name ? name : "Imported", sizeof(p.name) - 1);
    std::strncpy(p.category, category ? category : "Imported", sizeof(p.category) - 1);
    pa::prepareSampledPatch(p, false);
    pa::Zone z;
    z.sampleIndex = si;
    z.root = root;
    p.zones.push_back(z);
    return e->addSampledInstrument(p);
}
}  // namespace

pa::Engine* arrangerbox_live_engine() { return gLive; }

extern "C" {

void* arrangerbox_engine_create(void) {
    auto* e = new pa::Engine();
    std::lock_guard<std::mutex> lock(gMu);
    gLive = e;
    return e;
}

void arrangerbox_engine_destroy(void* handle) {
    auto* e = static_cast<pa::Engine*>(handle);
    std::lock_guard<std::mutex> lock(gMu);
    if (gLive == e) gLive = nullptr;
    delete e;
}

void arrangerbox_engine_prepare(void* handle, float sampleRate) {
    auto* e = static_cast<pa::Engine*>(handle);
    if (e) e->prepare(sampleRate);
}

void arrangerbox_engine_render(void* handle, float* out, int frames) {
    auto* e = static_cast<pa::Engine*>(handle);
    if (e && out && frames > 0) e->render(out, frames);
}

void arrangerbox_engine_set_latency_ms(void* handle, float ms) {
    auto* e = static_cast<pa::Engine*>(handle);
    if (e) e->setLatencyMs(ms);
}

void arrangerbox_note_on(int ch, int note, int vel) {
    if (auto* e = live()) e->noteOn(ch, note, vel);
}
void arrangerbox_note_off(int ch, int note) {
    if (auto* e = live()) e->noteOff(ch, note);
}
void arrangerbox_cc(int ch, int ctl, int val) {
    if (auto* e = live()) e->cc(ch, ctl, val);
}
void arrangerbox_pitch_bend(int ch, int lsb, int msb) {
    if (auto* e = live()) e->pitchBend(ch, lsb, msb);
}
void arrangerbox_program_change(int ch, int program) {
    if (auto* e = live()) e->programChange(ch, program);
}
void arrangerbox_midi_clock(void) {
    if (auto* e = live()) e->midiClock();
}
void arrangerbox_midi_start(void) {
    if (auto* e = live()) e->midiTransportStart();
}
void arrangerbox_midi_stop(void) {
    if (auto* e = live()) e->midiTransportStop();
}
void arrangerbox_midi_continue(void) {
    if (auto* e = live()) e->midiTransportContinue();
}

void arrangerbox_set_part_program(int part, int inst) {
    if (auto* e = live()) e->setPartProgram(part, inst);
}
void arrangerbox_set_part_enable(int part, int on) {
    if (auto* e = live()) e->setPartEnable(part, on != 0);
}
void arrangerbox_set_split(int note) {
    if (auto* e = live()) e->setSplit(note);
}
void arrangerbox_set_tempo(float bpm) {
    if (auto* e = live()) e->setTempo(bpm);
}
void arrangerbox_set_mixer(int bus, float gain) {
    if (auto* e = live()) e->setMixer(bus, gain);
}
void arrangerbox_arranger_toggle(void) {
    if (auto* e = live()) e->arrangerToggle();
}
void arrangerbox_arranger_start(void) {
    if (auto* e = live()) e->arrangerStart();
}
void arrangerbox_arranger_stop(void) {
    if (auto* e = live()) e->arrangerStop();
}
void arrangerbox_book_section(int section) {
    if (auto* e = live()) e->bookSection(section);
}
void arrangerbox_set_style(int id) {
    if (auto* e = live()) e->setStyle(id);
}
void arrangerbox_set_synchro(int on) {
    if (auto* e = live()) e->setSynchro(on != 0);
}
void arrangerbox_set_auto_fill(int on) {
    if (auto* e = live()) e->setAutoFill(on != 0);
}
void arrangerbox_set_transpose(int semis) {
    if (auto* e = live()) e->setTranspose(semis);
}
void arrangerbox_set_octave(int oct) {
    if (auto* e = live()) e->setOctave(oct);
}
void arrangerbox_set_fx(int which, float mix) {
    if (auto* e = live()) e->setFx(which, mix);
}

int arrangerbox_sound_count(void) { return live() ? live()->soundCount() : 0; }
void arrangerbox_sound_name(int id, char* out, int maxLen) {
    copyName(live() ? live()->soundName(id) : "", out, maxLen);
}
void arrangerbox_sound_category(int id, char* out, int maxLen) {
    copyName(live() ? live()->soundCategory(id) : "", out, maxLen);
}
void arrangerbox_sound_source(int id, char* out, int maxLen) {
    copyName(live() ? live()->soundSource(id) : "", out, maxLen);
}
int arrangerbox_style_count(void) { return live() ? live()->styleCount() : 0; }
void arrangerbox_style_name(int id, char* out, int maxLen) {
    copyName(live() ? live()->styleName(id) : "", out, maxLen);
}
void arrangerbox_style_category(int id, char* out, int maxLen) {
    copyName(live() ? live()->styleCategory(id) : "", out, maxLen);
}
float arrangerbox_style_tempo(int id) { return live() ? live()->styleTempo(id) : 0; }
float arrangerbox_latency_ms(void) { return live() ? live()->latencyMs() : 0; }
int arrangerbox_chord_root(void) { return live() ? live()->currentChordRoot() : 0; }
int arrangerbox_chord_type(void) { return live() ? live()->currentChordType() : 0; }
int arrangerbox_section(void) { return live() ? live()->currentSection() : 0; }
int arrangerbox_is_playing(void) { return live() && live()->isPlaying() ? 1 : 0; }
float arrangerbox_tempo(void) { return live() ? live()->tempo() : 0; }
uint32_t arrangerbox_midi_clock_count(void) { return live() ? live()->midiClockCount() : 0; }

int arrangerbox_load_wav(const char* path, const char* name, const char* category) {
    return loadSampled(path, name, category, false);
}
int arrangerbox_load_ksf(const char* path, const char* name, const char* category) {
    return loadSampled(path, name, category, true);
}
int arrangerbox_scan_pcm_bank(const char* path) {
    auto* e = live();
    if (!e || !path) return 0;
    std::vector<pa::Sample> found;
    pa::scanPcmBank(path, found);
    int added = 0;
    for (auto& s : found) {
        pa::Patch p;
        std::strncpy(p.name, s.name[0] ? s.name : "PCM Sample", sizeof(p.name) - 1);
        std::strncpy(p.category, "Imported", sizeof(p.category) - 1);
        pa::prepareSampledPatch(p, false);
        const int root = s.rootNote > 0 ? s.rootNote : 60;
        const int si = e->addSample(std::move(s));
        pa::Zone z;
        z.sampleIndex = si;
        z.root = root;
        p.zones.push_back(z);
        e->addSampledInstrument(p);
        added++;
    }
    return added;
}

int arrangerbox_load_pa4x_set(const char* folder, char* report, int reportLen) {
    auto* e = live();
    if (!e || !folder) {
        if (report && reportLen > 0) {
            std::strncpy(report, "{\"ok\":0}", static_cast<size_t>(reportLen - 1));
            report[reportLen - 1] = 0;
        }
        return -1;
    }
    return e->loadPa4xSet(folder, report, reportLen);
}

int arrangerbox_load_pa4x_named(const char* folder, const char* kind, const char* name, char* report, int reportLen) {
    auto* e = live();
    if (!e || !folder) {
        if (report && reportLen > 0) {
            std::strncpy(report, "{\"ok\":0}", static_cast<size_t>(reportLen - 1));
            report[reportLen - 1] = 0;
        }
        return -1;
    }
    return e->loadPa4xNamed(folder, kind, name, report, reportLen);
}

int arrangerbox_list_pa4x_catalog(const char* folder, char* report, int reportLen) {
    auto* e = live();
    if (!e || !folder) {
        if (report && reportLen > 0) {
            std::strncpy(report, "{\"ok\":0}", static_cast<size_t>(reportLen - 1));
            report[reportLen - 1] = 0;
        }
        return -1;
    }
    return e->listPa4xCatalog(folder, report, reportLen);
}

int arrangerbox_load_sfz(const char* path, char* report, int reportLen) {
    auto* e = live();
    if (!e || !path) {
        if (report && reportLen > 0) {
            std::strncpy(report, "{\"ok\":0}", static_cast<size_t>(reportLen - 1));
            report[reportLen - 1] = 0;
        }
        return -1;
    }
    return e->loadSfz(path, report, reportLen);
}

int arrangerbox_load_abstyle(const char* path, char* report, int reportLen) {
    auto* e = live();
    if (!e || !path) {
        if (report && reportLen > 0) {
            std::strncpy(report, "{\"ok\":0}", static_cast<size_t>(reportLen - 1));
            report[reportLen - 1] = 0;
        }
        return -1;
    }
    return e->loadAbStyle(path, report, reportLen);
}

int arrangerbox_load_soundfont(const char* path) {
    if (!live()) arrangerbox_engine_create();
    auto* e = live();
    if (!e || !path) return 0;
    return e->loadSoundfont(path);
}

}  // extern "C"
