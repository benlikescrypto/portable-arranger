#include "Engine.h"

#include <jni.h>

#include <cstring>
#include <string>

using pa::Engine;
using pa::Patch;
using pa::Sample;
using pa::Zone;

static Engine* eng(jlong h) { return reinterpret_cast<Engine*>(h); }

extern "C" {

JNIEXPORT jlong JNICALL Java_com_portablearranger_engine_NativeEngine_create(JNIEnv*, jobject) {
    return reinterpret_cast<jlong>(new Engine());
}

JNIEXPORT void JNICALL Java_com_portablearranger_engine_NativeEngine_destroy(JNIEnv*, jobject, jlong h) {
    delete eng(h);
}

JNIEXPORT jboolean JNICALL Java_com_portablearranger_engine_NativeEngine_start(JNIEnv*, jobject, jlong h) {
    return eng(h)->start() ? JNI_TRUE : JNI_FALSE;
}

JNIEXPORT void JNICALL Java_com_portablearranger_engine_NativeEngine_stop(JNIEnv*, jobject, jlong h) {
    eng(h)->stop();
}

JNIEXPORT void JNICALL Java_com_portablearranger_engine_NativeEngine_noteOn(JNIEnv*, jobject, jlong h, jint ch,
                                                                           jint note, jint vel) {
    eng(h)->noteOn(ch, note, vel);
}

JNIEXPORT void JNICALL Java_com_portablearranger_engine_NativeEngine_noteOff(JNIEnv*, jobject, jlong h, jint ch,
                                                                            jint note) {
    eng(h)->noteOff(ch, note);
}

JNIEXPORT void JNICALL Java_com_portablearranger_engine_NativeEngine_cc(JNIEnv*, jobject, jlong h, jint ch, jint ctl,
                                                                       jint value) {
    eng(h)->cc(ch, ctl, value);
}

JNIEXPORT void JNICALL Java_com_portablearranger_engine_NativeEngine_setPartProgram(JNIEnv*, jobject, jlong h,
                                                                                   jint part, jint inst) {
    eng(h)->setPartProgram(part, inst);
}

JNIEXPORT void JNICALL Java_com_portablearranger_engine_NativeEngine_setPartEnable(JNIEnv*, jobject, jlong h,
                                                                                  jint part, jboolean on) {
    eng(h)->setPartEnable(part, on);
}

JNIEXPORT void JNICALL Java_com_portablearranger_engine_NativeEngine_setSplit(JNIEnv*, jobject, jlong h, jint note) {
    eng(h)->setSplit(note);
}

JNIEXPORT void JNICALL Java_com_portablearranger_engine_NativeEngine_setTempo(JNIEnv*, jobject, jlong h, jfloat bpm) {
    eng(h)->setTempo(bpm);
}

JNIEXPORT void JNICALL Java_com_portablearranger_engine_NativeEngine_setMixer(JNIEnv*, jobject, jlong h, jint bus,
                                                                             jfloat gain) {
    eng(h)->setMixer(bus, gain);
}

JNIEXPORT void JNICALL Java_com_portablearranger_engine_NativeEngine_arrangerToggle(JNIEnv*, jobject, jlong h) {
    eng(h)->arrangerToggle();
}

JNIEXPORT void JNICALL Java_com_portablearranger_engine_NativeEngine_arrangerStart(JNIEnv*, jobject, jlong h) {
    eng(h)->arrangerStart();
}

JNIEXPORT void JNICALL Java_com_portablearranger_engine_NativeEngine_arrangerStop(JNIEnv*, jobject, jlong h) {
    eng(h)->arrangerStop();
}

JNIEXPORT void JNICALL Java_com_portablearranger_engine_NativeEngine_bookSection(JNIEnv*, jobject, jlong h, jint s) {
    eng(h)->bookSection(s);
}

JNIEXPORT void JNICALL Java_com_portablearranger_engine_NativeEngine_setStyle(JNIEnv*, jobject, jlong h, jint id) {
    eng(h)->setStyle(id);
}

JNIEXPORT void JNICALL Java_com_portablearranger_engine_NativeEngine_setSynchro(JNIEnv*, jobject, jlong h,
                                                                               jboolean on) {
    eng(h)->setSynchro(on);
}

JNIEXPORT void JNICALL Java_com_portablearranger_engine_NativeEngine_setAutoFill(JNIEnv*, jobject, jlong h,
                                                                                jboolean on) {
    eng(h)->setAutoFill(on);
}

JNIEXPORT jint JNICALL Java_com_portablearranger_engine_NativeEngine_soundCount(JNIEnv*, jobject, jlong h) {
    return eng(h)->soundCount();
}

JNIEXPORT jstring JNICALL Java_com_portablearranger_engine_NativeEngine_soundName(JNIEnv* env, jobject, jlong h,
                                                                                 jint id) {
    return env->NewStringUTF(eng(h)->soundName(id));
}

JNIEXPORT jstring JNICALL Java_com_portablearranger_engine_NativeEngine_soundCategory(JNIEnv* env, jobject, jlong h,
                                                                                     jint id) {
    return env->NewStringUTF(eng(h)->soundCategory(id));
}

JNIEXPORT jint JNICALL Java_com_portablearranger_engine_NativeEngine_styleCount(JNIEnv*, jobject, jlong h) {
    return eng(h)->styleCount();
}

JNIEXPORT jstring JNICALL Java_com_portablearranger_engine_NativeEngine_styleName(JNIEnv* env, jobject, jlong h,
                                                                                 jint id) {
    return env->NewStringUTF(eng(h)->styleName(id));
}

JNIEXPORT jstring JNICALL Java_com_portablearranger_engine_NativeEngine_styleCategory(JNIEnv* env, jobject, jlong h,
                                                                                     jint id) {
    return env->NewStringUTF(eng(h)->styleCategory(id));
}

JNIEXPORT jfloat JNICALL Java_com_portablearranger_engine_NativeEngine_styleTempo(JNIEnv*, jobject, jlong h, jint id) {
    return eng(h)->styleTempo(id);
}

JNIEXPORT jfloat JNICALL Java_com_portablearranger_engine_NativeEngine_latencyMs(JNIEnv*, jobject, jlong h) {
    return eng(h)->latencyMs();
}

JNIEXPORT jint JNICALL Java_com_portablearranger_engine_NativeEngine_chordRoot(JNIEnv*, jobject, jlong h) {
    return eng(h)->currentChordRoot();
}

JNIEXPORT jint JNICALL Java_com_portablearranger_engine_NativeEngine_chordType(JNIEnv*, jobject, jlong h) {
    return eng(h)->currentChordType();
}

JNIEXPORT jint JNICALL Java_com_portablearranger_engine_NativeEngine_section(JNIEnv*, jobject, jlong h) {
    return eng(h)->currentSection();
}

JNIEXPORT jboolean JNICALL Java_com_portablearranger_engine_NativeEngine_isPlaying(JNIEnv*, jobject, jlong h) {
    return eng(h)->isPlaying() ? JNI_TRUE : JNI_FALSE;
}

JNIEXPORT jfloat JNICALL Java_com_portablearranger_engine_NativeEngine_tempo(JNIEnv*, jobject, jlong h) {
    return eng(h)->tempo();
}

JNIEXPORT jint JNICALL Java_com_portablearranger_engine_NativeEngine_loadWavInstrument(JNIEnv* env, jobject, jlong h,
                                                                                      jstring jpath, jstring jname,
                                                                                      jstring jcat) {
    const char* path = env->GetStringUTFChars(jpath, nullptr);
    Sample s;
    const int n = pa::loadWav(path, s);
    env->ReleaseStringUTFChars(jpath, path);
    if (n <= 0) return -1;
    const int si = eng(h)->addSample(std::move(s));
    Patch p;
    const char* name = env->GetStringUTFChars(jname, nullptr);
    const char* cat = env->GetStringUTFChars(jcat, nullptr);
    std::strncpy(p.name, name, sizeof(p.name) - 1);
    std::strncpy(p.category, cat, sizeof(p.category) - 1);
    env->ReleaseStringUTFChars(jname, name);
    env->ReleaseStringUTFChars(jcat, cat);
    p.sampled = true;
    p.model = pa::Model::Piano;
    p.attack = 0.8f;
    p.decay = 400;
    p.sustain = 0.7f;
    p.release = 250;
    Zone z;
    z.sampleIndex = si;
    z.root = 60;
    p.zones.push_back(z);
    return eng(h)->addSampledInstrument(p);
}

JNIEXPORT jint JNICALL Java_com_portablearranger_engine_NativeEngine_loadKsfInstrument(JNIEnv* env, jobject, jlong h,
                                                                                      jstring jpath, jstring jname,
                                                                                      jstring jcat) {
    const char* path = env->GetStringUTFChars(jpath, nullptr);
    Sample s;
    const int n = pa::loadKsf(path, s);
    env->ReleaseStringUTFChars(jpath, path);
    if (n <= 0) return -1;
    const int si = eng(h)->addSample(std::move(s));
    Patch p;
    const char* name = env->GetStringUTFChars(jname, nullptr);
    const char* cat = env->GetStringUTFChars(jcat, nullptr);
    std::strncpy(p.name, name, sizeof(p.name) - 1);
    std::strncpy(p.category, cat, sizeof(p.category) - 1);
    env->ReleaseStringUTFChars(jname, name);
    env->ReleaseStringUTFChars(jcat, cat);
    p.sampled = true;
    p.attack = 0.8f;
    p.decay = 500;
    p.sustain = 0.7f;
    p.release = 280;
    Zone z;
    z.sampleIndex = si;
    z.root = 60;
    p.zones.push_back(z);
    return eng(h)->addSampledInstrument(p);
}

JNIEXPORT jint JNICALL Java_com_portablearranger_engine_NativeEngine_scanPcmBank(JNIEnv* env, jobject, jlong h,
                                                                                jstring jpath) {
    const char* path = env->GetStringUTFChars(jpath, nullptr);
    std::vector<Sample> found;
    pa::scanPcmBank(path, found);
    env->ReleaseStringUTFChars(jpath, path);
    int added = 0;
    for (auto& s : found) {
        Patch p;
        std::strncpy(p.name, s.name[0] ? s.name : "PCM Sample", sizeof(p.name) - 1);
        std::strncpy(p.category, "Imported", sizeof(p.category) - 1);
        p.sampled = true;
        p.attack = 0.6f;
        p.decay = 400;
        p.sustain = 0.75f;
        p.release = 240;
        const int si = eng(h)->addSample(std::move(s));
        Zone z;
        z.sampleIndex = si;
        p.zones.push_back(z);
        eng(h)->addSampledInstrument(p);
        added++;
    }
    return added;
}

}  // extern "C"
