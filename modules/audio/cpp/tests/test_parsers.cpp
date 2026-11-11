#include "../Dsp.h"
#include "../Engine.h"

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <memory>
#include <string>
#include <vector>

namespace pa {
int Engine::loadPa4xSet(const char*, char* report, int reportLen) {
    if (report && reportLen > 0) {
        std::strncpy(report, "{\"ok\":0}", (size_t)reportLen - 1);
        report[reportLen - 1] = 0;
    }
    return -1;
}
int Engine::loadPa4xNamed(const char*, const char*, const char*, char* report, int reportLen) {
    if (report && reportLen > 0) {
        std::strncpy(report, "{\"ok\":0}", (size_t)reportLen - 1);
        report[reportLen - 1] = 0;
    }
    return -1;
}
int Engine::listPa4xCatalog(const char*, char* report, int reportLen) {
    if (report && reportLen > 0) {
        std::strncpy(report, "{\"ok\":0}", (size_t)reportLen - 1);
        report[reportLen - 1] = 0;
    }
    return -1;
}
}

namespace {

int fails = 0;

void expect(bool ok, const char* name) {
    if (ok) {
        std::printf("PASS %s\n", name);
    } else {
        std::printf("FAIL %s\n", name);
        fails++;
    }
}

std::string tempDir() {
    const char* dir = std::getenv("TEMP");
    if (!dir) dir = std::getenv("TMP");
    if (!dir) dir = ".";
    return dir;
}

std::string tempWav() { return tempDir() + "/arrangerbox_parser_test.wav"; }

void wu32be(std::vector<uint8_t>& b, uint32_t v) {
    b.push_back((uint8_t)((v >> 24) & 0xff));
    b.push_back((uint8_t)((v >> 16) & 0xff));
    b.push_back((uint8_t)((v >> 8) & 0xff));
    b.push_back((uint8_t)(v & 0xff));
}

void writeChunk(std::vector<uint8_t>& b, const char* id, const std::vector<uint8_t>& payload) {
    b.insert(b.end(), id, id + 4);
    wu32be(b, (uint32_t)payload.size());
    b.insert(b.end(), payload.begin(), payload.end());
}

std::vector<uint8_t> makeUncompressedKsf(int frames = 48, int sr = 44100) {
    std::vector<uint8_t> smp1(32, 0);
    const char* nm = "TestTone";
    std::memcpy(smp1.data(), nm, std::strlen(nm));
    smp1[20] = 0;
    smp1[23] = 4;
    smp1[27] = (uint8_t)(frames - 1);
    std::vector<uint8_t> smd1(12 + (size_t)frames * 2, 0);
    smd1[0] = (uint8_t)((sr >> 24) & 0xff);
    smd1[1] = (uint8_t)((sr >> 16) & 0xff);
    smd1[2] = (uint8_t)((sr >> 8) & 0xff);
    smd1[3] = (uint8_t)(sr & 0xff);
    smd1[7] = 16;
    smd1[8] = (uint8_t)((frames >> 24) & 0xff);
    smd1[9] = (uint8_t)((frames >> 16) & 0xff);
    smd1[10] = (uint8_t)((frames >> 8) & 0xff);
    smd1[11] = (uint8_t)(frames & 0xff);
    for (int i = 0; i < frames; ++i) {
        const int16_t s = (int16_t)(std::sin(i * 0.3) * 12000);
        smd1[12 + i * 2] = (uint8_t)((s >> 8) & 0xff);
        smd1[13 + i * 2] = (uint8_t)(s & 0xff);
    }
    std::vector<uint8_t> file;
    writeChunk(file, "SMP1", smp1);
    writeChunk(file, "SMD1", smd1);
    return file;
}

void writeWav16Stereo(const std::string& path, int frames = 64, int sr = 44100) {
    const int dataBytes = frames * 2 * 2;
    std::vector<uint8_t> b(44 + (size_t)dataBytes, 0);
    std::memcpy(b.data(), "RIFF", 4);
    const uint32_t riffSize = 36 + (uint32_t)dataBytes;
    std::memcpy(b.data() + 4, &riffSize, 4);
    std::memcpy(b.data() + 8, "WAVEfmt ", 8);
    const uint32_t fmtSize = 16;
    const uint16_t format = 1, ch = 2, bits = 16;
    const uint32_t byteRate = (uint32_t)sr * 2 * 2;
    const uint16_t blockAlign = 4;
    std::memcpy(b.data() + 16, &fmtSize, 4);
    std::memcpy(b.data() + 20, &format, 2);
    std::memcpy(b.data() + 22, &ch, 2);
    std::memcpy(b.data() + 24, &sr, 4);
    std::memcpy(b.data() + 28, &byteRate, 4);
    std::memcpy(b.data() + 32, &blockAlign, 2);
    std::memcpy(b.data() + 34, &bits, 2);
    std::memcpy(b.data() + 36, "data", 4);
    const uint32_t dataSize = (uint32_t)dataBytes;
    std::memcpy(b.data() + 40, &dataSize, 4);
    for (int i = 0; i < frames; ++i) {
        const int16_t l = (int16_t)(std::sin(i * 0.2) * 8000);
        const int16_t r = (int16_t)(std::sin(i * 0.2 + 0.4) * 8000);
        std::memcpy(b.data() + 44 + (size_t)i * 4, &l, 2);
        std::memcpy(b.data() + 46 + (size_t)i * 4, &r, 2);
    }
    std::ofstream out(path, std::ios::binary);
    out.write((const char*)b.data(), (std::streamsize)b.size());
}

float rms(const float* x, int n) {
    double a = 0;
    for (int i = 0; i < n; ++i) a += (double)x[i] * x[i];
    return (float)std::sqrt(a / std::max(1, n));
}

}  // namespace

int main() {
    const float y = pa::hermiteAt(std::vector<float>{0.f, 1.f, 0.f, -1.f}.data(), 4, 1, 0, 1.0, 0, 4, false);
    expect(std::fabs(y - 1.f) < 0.001f, "hermite_at_sample");

    const float looped = pa::hermiteAt(std::vector<float>{0.2f, 0.4f, 0.6f, 0.8f}.data(), 4, 1, 0, 3.0, 1, 4, true);
    expect(looped > 0.1f, "hermite_loop_wraps");

    const std::string wav = tempWav();
    writeWav16Stereo(wav);
    pa::Sample s;
    const int frames = pa::loadWav(wav.c_str(), s);
    expect(frames == 64, "wav_frame_count");
    expect(s.channels == 2, "wav_keeps_stereo");
    expect(s.sampleRate == 44100, "wav_sample_rate");
    expect(s.frames() == 64, "wav_frames_helper");

    auto engHeap = std::make_unique<pa::Engine>();
    pa::Engine& eng = *engHeap;
    eng.prepare(48000.0f);
    expect(eng.soundCount() >= 80, "factory_sound_count");
    expect(eng.styleCount() >= 20, "factory_style_count");
    expect(std::strcmp(eng.soundName(0), "Concert Grand") == 0, "factory_id0_stable");
    expect(std::strcmp(eng.soundName(21), "Acoustic Bass") == 0, "factory_id21_stable");
    expect(std::strstr(eng.soundCategory(13), "Orient") != nullptr || std::strlen(eng.soundCategory(13)) > 0,
           "factory_oud_category");
    expect(eng.styleTempo(0) > 40.0f, "factory_style_tempo");

    std::vector<float> buf(256 * 2, 0.0f);
    eng.render(buf.data(), 256);
    expect(rms(buf.data(), 512) < 0.02f, "silence_before_notes");

    eng.noteOn(0, 72, 100);
    eng.noteOn(0, 76, 90);
    eng.noteOn(0, 79, 80);
    buf.assign(2048 * 2, 0.0f);
    eng.render(buf.data(), 2048);
    expect(rms(buf.data(), 4096) > 0.001f, "polyphony_makes_audio");

    eng.noteOff(0, 72);
    eng.noteOff(0, 76);
    eng.noteOff(0, 79);
    eng.cc(0, 64, 127);
    eng.noteOn(0, 60, 110);
    eng.noteOff(0, 60);
    buf.assign(512 * 2, 0.0f);
    eng.render(buf.data(), 512);
    expect(rms(buf.data(), 1024) > 0.0005f, "sustain_pedal_holds");
    eng.cc(0, 64, 0);

    eng.pitchBend(0, 0, 96);
    eng.noteOn(0, 67, 100);
    buf.assign(512 * 2, 0.0f);
    eng.render(buf.data(), 512);
    expect(rms(buf.data(), 1024) > 0.0005f, "pitch_bend_note_sounds");
    eng.noteOff(0, 67);
    eng.pitchBend(0, 0, 64);

    eng.setPartProgram(0, 4);
    eng.noteOn(0, 64, 100);
    buf.assign(1024 * 2, 0.0f);
    eng.render(buf.data(), 1024);
    expect(rms(buf.data(), 2048) > 0.0005f, "instrument_change_ep");
    eng.noteOff(0, 64);

    eng.noteOn(1, 48, 100);
    eng.noteOn(1, 52, 100);
    eng.noteOn(1, 55, 100);
    buf.assign(256 * 2, 0.0f);
    eng.render(buf.data(), 256);
    expect(eng.currentChordType() >= 0, "chord_detect_runs");
    eng.noteOff(1, 48);
    eng.noteOff(1, 52);
    eng.noteOff(1, 55);

    eng.setStyle(0);
    eng.setTempo(120);
    eng.arrangerStart();
    buf.assign(4800 * 2, 0.0f);
    eng.render(buf.data(), 4800);
    expect(eng.isPlaying(), "arranger_running");
    expect(rms(buf.data(), 9600) > 0.0001f, "arranger_makes_audio");
    eng.bookSection(5);
    eng.render(buf.data(), 4800);
    eng.arrangerStop();
    buf.assign(256 * 2, 0.0f);
    eng.render(buf.data(), 256);
    expect(!eng.isPlaying(), "arranger_stops");

    const std::string sfzPath = tempDir() + "/arrangerbox_test.sfz";
    const std::string samplePath = tempDir() + "/arrangerbox_sfz.wav";
    writeWav16Stereo(samplePath, 2048);
    {
        std::ofstream sfz(sfzPath);
        sfz << "<global>\n"
            << "ampeg_attack=0.01 ampeg_release=0.2\n"
            << "<region>\n"
            << "sample=arrangerbox_sfz.wav lokey=0 hikey=60 lovel=0 hivel=63 pitch_keycenter=60 loop_mode=loop_continuous loop_start=32 loop_end=2000\n"
            << "<region>\n"
            << "sample=arrangerbox_sfz.wav lokey=0 hikey=60 lovel=64 hivel=127 pitch_keycenter=60\n"
            << "<region>\n"
            << "sample=arrangerbox_sfz.wav lokey=61 hikey=127 pitch_keycenter=72\n";
    }
    char report[256];
    const int sfzId = eng.loadSfz(sfzPath.c_str(), report, sizeof(report));
    expect(sfzId >= 0, "sfz_loads");
    if (sfzId >= 0) {
        eng.setPartProgram(0, sfzId);
        eng.noteOn(0, 40, 40);
        eng.noteOn(0, 40, 100);
        eng.noteOn(0, 80, 90);
        buf.assign(1024 * 2, 0.0f);
        eng.render(buf.data(), 1024);
        expect(rms(buf.data(), 2048) > 0.0001f, "sfz_velocity_and_key_zones");
        eng.noteOff(0, 40);
        eng.noteOff(0, 80);
        buf.assign(48000 * 2, 0.0f);
        eng.render(buf.data(), 48000);
        const float tail = rms(buf.data() + 40000, 8000);
        expect(tail < 0.0005f, "sfz_loop_stops_after_key_up");
    }

    {
        auto isolated = std::make_unique<pa::Engine>();
        isolated->prepare(48000.0f);
        pa::Sample looped;
        looped.sampleRate = 44100;
        looped.channels = 1;
        looped.rootNote = 60;
        looped.loop = true;
        looped.loopStart = 64;
        looped.loopEnd = 2048;
        looped.data.assign(4096, 0.0f);
        for (int i = 0; i < 4096; ++i) looped.data[(size_t)i] = std::sin((float)i * 0.12f) * 0.4f;
        pa::Patch patch;
        pa::prepareSampledPatch(patch, false);
        std::snprintf(patch.name, sizeof(patch.name), "Loop Hold");
        pa::Zone z;
        z.sampleIndex = isolated->addSample(std::move(looped));
        z.root = 60;
        patch.zones.push_back(z);
        const int id = isolated->addSampledInstrument(patch);
        isolated->setPartProgram(0, id);
        isolated->noteOn(0, 72, 110);
        buf.assign(8192 * 2, 0.0f);
        isolated->render(buf.data(), 8192);
        expect(rms(buf.data(), 16384) > 0.01f, "looped_sample_sounds_while_held");
        isolated->noteOff(0, 72);
        buf.assign(48000 * 2, 0.0f);
        isolated->render(buf.data(), 48000);
        const float tail = rms(buf.data() + 20000, 16000);
        if (tail >= 0.0005f) std::printf("looped tail rms=%.6f\n", tail);
        expect(tail < 0.0005f, "looped_sample_stops_after_key_up");
        float peakStep = 0.0f;
        for (int i = 2; i < 4000; ++i) {
            const float a = buf[(size_t)(i - 1) * 2];
            const float b = buf[(size_t)i * 2];
            peakStep = std::max(peakStep, std::abs(b - a));
        }
        expect(peakStep < 0.12f, "looped_sample_release_has_no_click");
    }

    const std::string stylePath = tempDir() + "/arrangerbox_test.abstyle";
    {
        std::ofstream st(stylePath);
        st << "ABSTYLE1\nname=Test Groove\ncategory=Pop\ntempo=100\nsection=var1\nlength=384\n";
        st << "0,0,36,110,24,abs\n96,0,38,100,24,abs\n0,1,0,100,48,bass\n48,2,0,80,24,comp\n";
        st << "section=var2\nlength=384\n0,0,36,120,24,abs\n192,0,38,110,24,abs\n0,1,0,108,48,bass\n";
    }
    const int styleId = eng.loadAbStyle(stylePath.c_str(), report, sizeof(report));
    expect(styleId >= 0, "abstyle_loads");

    const auto ksfBytes = makeUncompressedKsf();
    pa::Sample ksf;
    expect(pa::loadKsfBytes(ksfBytes.data(), ksfBytes.size(), ksf) > 0, "ksf_uncompressed_loads");
    expect(ksf.sampleRate == 44100, "ksf_sample_rate");
    expect(std::strstr(ksf.name, "TestTone") != nullptr, "ksf_name");

    const uint8_t pcg[] = {'P', 'R', 'G', '1', 0, 0, 0, 32, 'S', 't', 'a', 'g', 'e', ' ', 'G', 'r', 'a', 'n', 'd', ' ',
                           0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0};
    std::vector<std::string> names, missing;
    pa::parsePcgNames(pcg, sizeof(pcg), names, missing);
    bool foundGrand = false;
    for (const auto& n : names)
        if (n.find("Stage") != std::string::npos) foundGrand = true;
    expect(foundGrand, "pcg_extracts_program_name");

    std::printf("%s\n", fails ? "FAILED" : "OK");
    return fails ? 1 : 0;
}
