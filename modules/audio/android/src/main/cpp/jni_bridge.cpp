#include "engine_c_api.h"

#include <jni.h>

#include <string>

static std::string jstr(JNIEnv* env, jstring value) {
    if (!value) return {};
    const char* chars = env->GetStringUTFChars(value, nullptr);
    std::string out = chars ? chars : "";
    env->ReleaseStringUTFChars(value, chars);
    return out;
}

static jstring jutf(JNIEnv* env, const char* value) { return env->NewStringUTF(value ? value : ""); }

extern "C" {

JNIEXPORT jboolean JNICALL
Java_expo_modules_arrangerboxaudio_EngineNative_nativeStart(JNIEnv*, jclass) {
    if (!arrangerbox_live_engine()) {
        arrangerbox_engine_create();
    }
    return arrangerbox_audio_start() ? JNI_TRUE : JNI_FALSE;
}

JNIEXPORT void JNICALL
Java_expo_modules_arrangerboxaudio_EngineNative_nativeStop(JNIEnv*, jclass) {
    arrangerbox_audio_stop();
}

JNIEXPORT void JNICALL
Java_expo_modules_arrangerboxaudio_EngineNative_nativeDestroy(JNIEnv*, jclass) {
    arrangerbox_audio_stop();
    if (auto* live = arrangerbox_live_engine()) {
        arrangerbox_engine_destroy(live);
    }
}

JNIEXPORT void JNICALL
Java_expo_modules_arrangerboxaudio_EngineNative_nativeNoteOn(JNIEnv*, jclass, jint ch, jint note, jint vel) {
    arrangerbox_note_on(ch, note, vel);
}
JNIEXPORT void JNICALL
Java_expo_modules_arrangerboxaudio_EngineNative_nativeNoteOff(JNIEnv*, jclass, jint ch, jint note) {
    arrangerbox_note_off(ch, note);
}
JNIEXPORT void JNICALL
Java_expo_modules_arrangerboxaudio_EngineNative_nativeCc(JNIEnv*, jclass, jint ch, jint ctl, jint val) {
    arrangerbox_cc(ch, ctl, val);
}
JNIEXPORT void JNICALL
Java_expo_modules_arrangerboxaudio_EngineNative_nativePitchBend(JNIEnv*, jclass, jint ch, jint lsb, jint msb) {
    arrangerbox_pitch_bend(ch, lsb, msb);
}
JNIEXPORT void JNICALL
Java_expo_modules_arrangerboxaudio_EngineNative_nativeProgramChange(JNIEnv*, jclass, jint ch, jint program) {
    arrangerbox_program_change(ch, program);
}
JNIEXPORT void JNICALL
Java_expo_modules_arrangerboxaudio_EngineNative_nativeSetPartProgram(JNIEnv*, jclass, jint part, jint inst) {
    arrangerbox_set_part_program(part, inst);
}
JNIEXPORT void JNICALL
Java_expo_modules_arrangerboxaudio_EngineNative_nativeSetPartEnable(JNIEnv*, jclass, jint part, jboolean on) {
    arrangerbox_set_part_enable(part, on ? 1 : 0);
}
JNIEXPORT void JNICALL
Java_expo_modules_arrangerboxaudio_EngineNative_nativeSetSplit(JNIEnv*, jclass, jint note) {
    arrangerbox_set_split(note);
}
JNIEXPORT void JNICALL
Java_expo_modules_arrangerboxaudio_EngineNative_nativeSetTempo(JNIEnv*, jclass, jfloat bpm) {
    arrangerbox_set_tempo(bpm);
}
JNIEXPORT void JNICALL
Java_expo_modules_arrangerboxaudio_EngineNative_nativeSetMixer(JNIEnv*, jclass, jint bus, jfloat gain) {
    arrangerbox_set_mixer(bus, gain);
}
JNIEXPORT void JNICALL
Java_expo_modules_arrangerboxaudio_EngineNative_nativeArrangerToggle(JNIEnv*, jclass) {
    arrangerbox_arranger_toggle();
}
JNIEXPORT void JNICALL
Java_expo_modules_arrangerboxaudio_EngineNative_nativeBookSection(JNIEnv*, jclass, jint section) {
    arrangerbox_book_section(section);
}
JNIEXPORT void JNICALL
Java_expo_modules_arrangerboxaudio_EngineNative_nativeSetStyle(JNIEnv*, jclass, jint id) {
    arrangerbox_set_style(id);
}
JNIEXPORT void JNICALL
Java_expo_modules_arrangerboxaudio_EngineNative_nativeSetSynchro(JNIEnv*, jclass, jboolean on) {
    arrangerbox_set_synchro(on ? 1 : 0);
}
JNIEXPORT void JNICALL
Java_expo_modules_arrangerboxaudio_EngineNative_nativeSetAutoFill(JNIEnv*, jclass, jboolean on) {
    arrangerbox_set_auto_fill(on ? 1 : 0);
}
JNIEXPORT void JNICALL
Java_expo_modules_arrangerboxaudio_EngineNative_nativeSetTranspose(JNIEnv*, jclass, jint semis) {
    arrangerbox_set_transpose(semis);
}
JNIEXPORT void JNICALL
Java_expo_modules_arrangerboxaudio_EngineNative_nativeSetOctave(JNIEnv*, jclass, jint oct) {
    arrangerbox_set_octave(oct);
}
JNIEXPORT void JNICALL
Java_expo_modules_arrangerboxaudio_EngineNative_nativeSetFx(JNIEnv*, jclass, jint which, jfloat mix) {
    arrangerbox_set_fx(which, mix);
}

JNIEXPORT jint JNICALL
Java_expo_modules_arrangerboxaudio_EngineNative_nativeSoundCount(JNIEnv*, jclass) {
    return arrangerbox_sound_count();
}
JNIEXPORT jstring JNICALL
Java_expo_modules_arrangerboxaudio_EngineNative_nativeSoundName(JNIEnv* env, jclass, jint id) {
    char buf[64];
    arrangerbox_sound_name(id, buf, sizeof(buf));
    return jutf(env, buf);
}
JNIEXPORT jstring JNICALL
Java_expo_modules_arrangerboxaudio_EngineNative_nativeSoundCategory(JNIEnv* env, jclass, jint id) {
    char buf[48];
    arrangerbox_sound_category(id, buf, sizeof(buf));
    return jutf(env, buf);
}
JNIEXPORT jstring JNICALL
Java_expo_modules_arrangerboxaudio_EngineNative_nativeSoundSource(JNIEnv* env, jclass, jint id) {
    char buf[24];
    arrangerbox_sound_source(id, buf, sizeof(buf));
    return jutf(env, buf);
}
JNIEXPORT jint JNICALL
Java_expo_modules_arrangerboxaudio_EngineNative_nativeStyleCount(JNIEnv*, jclass) {
    return arrangerbox_style_count();
}
JNIEXPORT jstring JNICALL
Java_expo_modules_arrangerboxaudio_EngineNative_nativeStyleName(JNIEnv* env, jclass, jint id) {
    char buf[64];
    arrangerbox_style_name(id, buf, sizeof(buf));
    return jutf(env, buf);
}
JNIEXPORT jstring JNICALL
Java_expo_modules_arrangerboxaudio_EngineNative_nativeStyleCategory(JNIEnv* env, jclass, jint id) {
    char buf[48];
    arrangerbox_style_category(id, buf, sizeof(buf));
    return jutf(env, buf);
}
JNIEXPORT jfloat JNICALL
Java_expo_modules_arrangerboxaudio_EngineNative_nativeStyleTempo(JNIEnv*, jclass, jint id) {
    return arrangerbox_style_tempo(id);
}
JNIEXPORT jfloat JNICALL
Java_expo_modules_arrangerboxaudio_EngineNative_nativeLatencyMs(JNIEnv*, jclass) {
    return arrangerbox_latency_ms();
}
JNIEXPORT jint JNICALL
Java_expo_modules_arrangerboxaudio_EngineNative_nativeChordRoot(JNIEnv*, jclass) {
    return arrangerbox_chord_root();
}
JNIEXPORT jint JNICALL
Java_expo_modules_arrangerboxaudio_EngineNative_nativeChordType(JNIEnv*, jclass) {
    return arrangerbox_chord_type();
}
JNIEXPORT jint JNICALL
Java_expo_modules_arrangerboxaudio_EngineNative_nativeSection(JNIEnv*, jclass) {
    return arrangerbox_section();
}
JNIEXPORT jboolean JNICALL
Java_expo_modules_arrangerboxaudio_EngineNative_nativeIsPlaying(JNIEnv*, jclass) {
    return arrangerbox_is_playing() ? JNI_TRUE : JNI_FALSE;
}
JNIEXPORT jfloat JNICALL
Java_expo_modules_arrangerboxaudio_EngineNative_nativeTempo(JNIEnv*, jclass) {
    return arrangerbox_tempo();
}
JNIEXPORT jint JNICALL
Java_expo_modules_arrangerboxaudio_EngineNative_nativeLoadWav(JNIEnv* env, jclass, jstring path, jstring name,
                                                             jstring category) {
    const auto p = jstr(env, path);
    const auto n = jstr(env, name);
    const auto c = jstr(env, category);
    return arrangerbox_load_wav(p.c_str(), n.c_str(), c.c_str());
}
JNIEXPORT jint JNICALL
Java_expo_modules_arrangerboxaudio_EngineNative_nativeLoadKsf(JNIEnv* env, jclass, jstring path, jstring name,
                                                             jstring category) {
    const auto p = jstr(env, path);
    const auto n = jstr(env, name);
    const auto c = jstr(env, category);
    return arrangerbox_load_ksf(p.c_str(), n.c_str(), c.c_str());
}
JNIEXPORT jint JNICALL
Java_expo_modules_arrangerboxaudio_EngineNative_nativeScanPcm(JNIEnv* env, jclass, jstring path) {
    const auto p = jstr(env, path);
    return arrangerbox_scan_pcm_bank(p.c_str());
}
JNIEXPORT jstring JNICALL
Java_expo_modules_arrangerboxaudio_EngineNative_nativeLoadPa4xSet(JNIEnv* env, jclass, jstring path) {
    const auto p = jstr(env, path);
    char buf[2048];
    arrangerbox_load_pa4x_set(p.c_str(), buf, sizeof(buf));
    return jutf(env, buf);
}
JNIEXPORT jstring JNICALL
Java_expo_modules_arrangerboxaudio_EngineNative_nativeLoadSfz(JNIEnv* env, jclass, jstring path) {
    const auto p = jstr(env, path);
    char buf[1024];
    arrangerbox_load_sfz(p.c_str(), buf, sizeof(buf));
    return jutf(env, buf);
}
JNIEXPORT jstring JNICALL
Java_expo_modules_arrangerboxaudio_EngineNative_nativeLoadAbStyle(JNIEnv* env, jclass, jstring path) {
    const auto p = jstr(env, path);
    char buf[1024];
    arrangerbox_load_abstyle(p.c_str(), buf, sizeof(buf));
    return jutf(env, buf);
}

JNIEXPORT void JNICALL
Java_expo_modules_arrangerboxmidi_MidiNative_nativeNoteOn(JNIEnv*, jclass, jint ch, jint note, jint vel) {
    arrangerbox_note_on(ch, note, vel);
}
JNIEXPORT void JNICALL
Java_expo_modules_arrangerboxmidi_MidiNative_nativeNoteOff(JNIEnv*, jclass, jint ch, jint note) {
    arrangerbox_note_off(ch, note);
}
JNIEXPORT void JNICALL
Java_expo_modules_arrangerboxmidi_MidiNative_nativeCc(JNIEnv*, jclass, jint ch, jint ctl, jint val) {
    arrangerbox_cc(ch, ctl, val);
}
JNIEXPORT void JNICALL
Java_expo_modules_arrangerboxmidi_MidiNative_nativePitchBend(JNIEnv*, jclass, jint ch, jint lsb, jint msb) {
    arrangerbox_pitch_bend(ch, lsb, msb);
}
JNIEXPORT void JNICALL
Java_expo_modules_arrangerboxmidi_MidiNative_nativeProgramChange(JNIEnv*, jclass, jint ch, jint program) {
    arrangerbox_program_change(ch, program);
}
JNIEXPORT void JNICALL
Java_expo_modules_arrangerboxmidi_MidiNative_nativeClock(JNIEnv*, jclass) {
    arrangerbox_midi_clock();
}
JNIEXPORT void JNICALL
Java_expo_modules_arrangerboxmidi_MidiNative_nativeStart(JNIEnv*, jclass) {
    arrangerbox_midi_start();
}
JNIEXPORT void JNICALL
Java_expo_modules_arrangerboxmidi_MidiNative_nativeStop(JNIEnv*, jclass) {
    arrangerbox_midi_stop();
}
JNIEXPORT void JNICALL
Java_expo_modules_arrangerboxmidi_MidiNative_nativeContinue(JNIEnv*, jclass) {
    arrangerbox_midi_continue();
}

}
