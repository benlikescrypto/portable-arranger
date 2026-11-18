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
#include <atomic>
#include <thread>

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
        eng.setSynchro(false);  // key 40 is a chord key: it would start the style
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

    {
        // A User sound the loader flagged as a kit (one-key-wide regions) must still
        // stop on key-up when played from the keyboard.
        auto isolated = std::make_unique<pa::Engine>();
        isolated->prepare(48000.0f);
        pa::Sample longHit;
        longHit.sampleRate = 48000;
        longHit.channels = 1;
        longHit.rootNote = 60;
        longHit.data.assign(48000 * 10, 0.0f);
        for (size_t i = 0; i < longHit.data.size(); ++i) longHit.data[i] = std::sin((float)i * 0.05f) * 0.4f;
        pa::Patch patch;
        pa::prepareSampledPatch(patch, true);
        std::snprintf(patch.name, sizeof(patch.name), "Kit Flagged");
        pa::Zone z;
        z.sampleIndex = isolated->addSample(std::move(longHit));
        z.root = 60;
        patch.zones.push_back(z);
        const int id = isolated->addSampledInstrument(patch);
        isolated->setPartProgram(0, id);
        isolated->noteOn(0, 60, 110);
        buf.assign(4800 * 2, 0.0f);
        isolated->render(buf.data(), 4800);
        expect(rms(buf.data(), 9600) > 0.01f, "kit_flagged_user_sound_plays");
        isolated->noteOff(0, 60);
        buf.assign(48000 * 2, 0.0f);
        isolated->render(buf.data(), 48000);
        const float tail = rms(buf.data() + 30000, 30000);
        if (tail >= 0.0005f) std::printf("kit-flagged tail rms=%.6f\n", tail);
        expect(tail < 0.0005f, "kit_flagged_user_sound_stops_after_key_up");
    }

    {
        // A key whose own zone (or closest-root zone) has no loaded sample must still
        // sound by borrowing the nearest zone that does.
        auto isolated = std::make_unique<pa::Engine>();
        isolated->prepare(48000.0f);
        pa::Sample tone;
        tone.sampleRate = 48000;
        tone.channels = 1;
        tone.rootNote = 48;
        tone.data.assign(48000, 0.0f);
        for (size_t i = 0; i < tone.data.size(); ++i) tone.data[i] = std::sin((float)i * 0.05f) * 0.4f;
        pa::Patch patch;
        pa::prepareSampledPatch(patch, false);
        std::snprintf(patch.name, sizeof(patch.name), "Gappy");
        const int good = isolated->addSample(std::move(tone));
        pa::Zone low;
        low.keyLow = 0;
        low.keyHigh = 59;
        low.root = 48;
        low.sampleIndex = good;
        pa::Zone missing;  // e.g. a KMP region whose PCM was not found
        missing.keyLow = 60;
        missing.keyHigh = 127;
        missing.root = 72;
        missing.sampleIndex = -1;
        pa::Zone overlapMissing;  // closer root than `low` for note 55, but empty
        overlapMissing.keyLow = 50;
        overlapMissing.keyHigh = 59;
        overlapMissing.root = 55;
        overlapMissing.sampleIndex = 9999;
        patch.zones = {low, missing, overlapMissing};
        const int id = isolated->addSampledInstrument(patch);
        isolated->setPartProgram(0, id);
        for (int note : {72, 55}) {
            isolated->noteOn(0, note, 110);
            buf.assign(4800 * 2, 0.0f);
            isolated->render(buf.data(), 4800);
            const float level = rms(buf.data(), 9600);
            if (level <= 0.01f) std::printf("note %d rms=%.6f\n", note, level);
            expect(level > 0.01f, note == 72 ? "key_with_missing_sample_still_sounds"
                                             : "overlapping_missing_zone_not_chosen");
            isolated->noteOff(0, note);
            buf.assign(48000 * 2, 0.0f);
            isolated->render(buf.data(), 48000);
        }
    }

    {
        // Bus faders must reach every path: built-in synth (incl. its reverb send) and
        // the GM SoundFont, which renders outside the bus mix. The Lower part (left of
        // the split) belongs to the keyboard bus, not the style's bass bus.
        auto levelFor = [&](pa::Engine& e, int note, float kbd) {
            e.setMixer(0, kbd);
            e.noteOn(0, note, 110);
            buf.assign(9600 * 2, 0.0f);
            e.render(buf.data(), 9600);
            const float level = rms(buf.data(), 19200);
            e.noteOff(0, note);
            buf.assign(48000 * 2, 0.0f);
            e.render(buf.data(), 48000);
            return level;
        };
        auto synth = std::make_unique<pa::Engine>();
        synth->prepare(48000.0f);
        const float synthOn = levelFor(*synth, 72, 1.0f);
        const float synthOff = levelFor(*synth, 72, 0.0f);
        if (synthOff >= synthOn * 0.01f) std::printf("synth kbd on=%.6f off=%.6f\n", synthOn, synthOff);
        expect(synthOn > 0.001f && synthOff < synthOn * 0.01f, "keyboard_fader_mutes_synth_and_reverb");

        std::string sf2 = __FILE__;
        sf2 = sf2.substr(0, sf2.find_last_of("/\\")) + "/../../factory/GeneralUser-GS.sf2";
        auto gm = std::make_unique<pa::Engine>();
        gm->prepare(48000.0f);
        if (gm->loadSoundfont(sf2.c_str()) > 0) {
            const float gmOn = levelFor(*gm, 72, 1.0f);
            const float gmHalf = levelFor(*gm, 72, 0.5f);
            const float gmOff = levelFor(*gm, 72, 0.0f);
            if (!(gmOff < gmOn * 0.01f && gmHalf < gmOn * 0.75f))
                std::printf("gm kbd on=%.6f half=%.6f off=%.6f\n", gmOn, gmHalf, gmOff);
            expect(gmOn > 0.001f && gmHalf < gmOn * 0.75f && gmOff < gmOn * 0.01f, "keyboard_fader_scales_soundfont");
            gm->setPartProgram(3, 0);
            gm->setPartEnable(3, true);
            gm->setSplit(60);
            gm->setSynchro(false);  // a left-hand note would otherwise start the style
            const float lowOn = levelFor(*gm, 40, 1.0f);
            const float lowOff = levelFor(*gm, 40, 0.0f);
            if (!(lowOff < lowOn * 0.01f)) std::printf("lower on=%.6f off=%.6f\n", lowOn, lowOff);
            expect(lowOn > 0.001f && lowOff < lowOn * 0.01f, "lower_part_follows_keyboard_fader");
        } else {
            std::printf("SKIP soundfont fader test (no %s)\n", sf2.c_str());
        }
    }

    {
        // Key-up release is exponential (eases out like a real damper/room): no jump
        // at note-off, -20 dB at a third of the release time, -60 dB at the full time,
        // then the voice is freed.
        pa::Adsr env;
        const float sr = 48000.0f, relMs = 300.0f;
        env.setTimes(sr, 1.0f, 1.0f, 1.0f, relMs);
        env.noteOn();
        float held = 0;
        for (int i = 0; i < 4800; ++i) held = env.process();
        env.noteOff();
        const float first = env.process();
        const int n = (int)(relMs * 0.001f * sr);
        float atThird = 0, atFull = 0;
        for (int i = 1; i < n; ++i) {
            const float y = env.process();
            if (i == n / 3) atThird = y;
            atFull = y;
        }
        const float dbThird = 20.0f * std::log10(atThird / held);
        const float dbFull = 20.0f * std::log10(atFull / held);
        int extra = 0;
        while (!env.idle() && extra < n) {
            env.process();
            extra++;
        }
        if (std::fabs(first - held) > 0.01f || dbThird > -18.0f || dbThird < -22.0f || dbFull > -58.0f)
            std::printf("release held=%.3f first=%.3f third=%.1fdB full=%.1fdB extra=%d\n", held, first, dbThird, dbFull, extra);
        expect(std::fabs(first - held) < 0.01f, "release_starts_without_jump");
        expect(dbThird < -18.0f && dbThird > -22.0f, "release_is_exponential");
        expect(dbFull <= -58.0f, "release_reaches_minus_60db");
        expect(env.idle(), "release_frees_voice");
    }

    {
        // Note events come from several threads at once (JS, USB-MIDI, the native
        // keyboard's UI thread). None may be lost or duplicated.
        static pa::MidiQueue<1024> q;
        constexpr int kPerThread = 50000;
        std::atomic<bool> done{false};
        std::vector<int> seen(2 * kPerThread, 0);
        std::thread consumer([&] {
            pa::MidiEvent e;
            for (;;) {
                bool got = false;
                while (q.pop(e)) {
                    seen[(size_t)(e.a * kPerThread + e.b)]++;
                    got = true;
                }
                if (!got && done.load()) {
                    while (q.pop(e)) seen[(size_t)(e.a * kPerThread + e.b)]++;
                    break;
                }
            }
        });
        auto producer = [&](int id) {
            for (int i = 0; i < kPerThread; ++i) {
                pa::MidiEvent e;
                e.a = id;
                e.b = i;
                while (!q.push(e)) std::this_thread::yield();
            }
        };
        std::thread p0(producer, 0), p1(producer, 1);
        p0.join();
        p1.join();
        done = true;
        consumer.join();
        int wrong = 0;
        for (int v : seen)
            if (v != 1) wrong++;
        if (wrong) std::printf("midi queue: %d events lost or duplicated\n", wrong);
        expect(wrong == 0, "midi_queue_safe_with_two_producers");
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
    {
        // Note transposition: recorded in C major 7, played on other chords.
        expect(pa::nttNote(64, 0, 1) == 63, "ntt_minor_third");
        expect(pa::nttNote(71, 2, 2) == 72, "ntt_dominant_seventh");
        expect(pa::nttNote(67, 0, 6) == 66, "ntt_dim_fifth");
        expect(pa::nttNote(60, 5, 0) == 65, "ntt_root_moves");
    }

    {
        // Arranger controls on a stand-alone engine (factory styles, built-in synth).
        auto e = std::make_unique<pa::Engine>();
        e->prepare(48000.0f);
        std::vector<float> b;
        auto run = [&](float secs) {
            const int n = (int)(secs * 48000.0f);
            b.assign((size_t)n * 2, 0.0f);
            for (int off = 0; off < n; off += 256) e->render(b.data() + off * 2, std::min(256, n - off));
        };
        e->setTempo(120.0f);
        e->setSynchro(false);
        e->setAutoFill(false);
        e->bookSection((int)pa::Section::Var1);
        e->arrangerStart();
        run(0.76f);  // 1.5 beats at 120 bpm
        expect(e->isPlaying(), "style_starts");
        expect((int)e->query(pa::QBeat) == 1, "beat_counter_advances");
        e->bookSection((int)pa::Section::Var2);
        run(0.05f);
        expect(e->currentSection() == (int)pa::Section::Var1 &&
                       (int)e->query(pa::QBooked) == (int)pa::Section::Var2,
               "variation_waits_for_bar_line");
        run(1.5f);
        expect(e->currentSection() == (int)pa::Section::Var2 && (int)e->query(pa::QBooked) == 0,
               "variation_changes_on_bar_line");
        e->setAutoFill(true);
        e->bookSection((int)pa::Section::Var3);
        run(0.02f);
        expect(e->currentSection() == (int)pa::Section::Fill3, "auto_fill_starts_now");
        run(2.2f);
        expect(e->currentSection() == (int)pa::Section::Var3, "auto_fill_lands_on_variation");
        e->control(pa::CmdFade, 0, 2, 0.5f);
        run(0.8f);
        expect(!e->isPlaying(), "fade_out_stops_style");
        expect(e->currentSection() == (int)pa::Section::Var3, "stop_keeps_variation");

        e->control(pa::CmdFade, 0, 1, 0.5f);
        run(0.05f);
        const float fadeMid = e->query(pa::QFade);
        run(0.7f);
        expect(e->isPlaying() && fadeMid < 0.5f && e->query(pa::QFade) > 0.99f, "fade_in_starts_and_rises");
        e->bookSection((int)pa::Section::Ending1);
        run(12.0f);
        expect(!e->isPlaying(), "ending_stops_style");

        // Synchro Start + Synchro Stop from the chord hand.
        e->setSplit(60);
        e->setSynchro(true);
        e->control(pa::CmdSynchroStop, 0, 1, 0.0f);
        e->noteOn(0, 48, 100);
        run(0.05f);
        expect(e->isPlaying(), "synchro_start");
        e->noteOff(0, 48);
        run(0.05f);
        expect(!e->isPlaying(), "synchro_stop");
        e->control(pa::CmdSynchroStop, 0, 0, 0.0f);
        e->setSynchro(false);

        // One-finger chords: C with a black key below is C minor, with a white key C7.
        e->control(pa::CmdChordMode, 0, 1, 0.0f);
        e->noteOn(0, 48, 100);
        e->noteOn(0, 46, 100);
        run(0.02f);
        expect(e->currentChordRoot() == 0 && e->currentChordType() == 1, "one_finger_minor");
        expect((int)e->query(pa::QChordHeld) == 1, "chord_held_reported");
        e->noteOff(0, 46);
        e->noteOff(0, 48);
        e->noteOn(0, 48, 100);
        e->noteOn(0, 47, 100);
        run(0.02f);
        expect(e->currentChordRoot() == 0 && e->currentChordType() == 2, "one_finger_seventh");
        e->noteOff(0, 47);
        e->noteOff(0, 48);
        run(0.02f);
        expect((int)e->query(pa::QChordHeld) == 0, "chord_release_reported");
        e->control(pa::CmdChordMode, 0, 0, 0.0f);

        // Bass inversion: E G C reads as C with E in the bass.
        e->control(pa::CmdBassInversion, 0, 1, 0.0f);
        e->noteOn(0, 40, 100);
        e->noteOn(0, 43, 100);
        e->noteOn(0, 48, 100);
        run(0.02f);
        expect(e->currentChordRoot() == 0 && (int)e->query(pa::QBassRoot) == 4, "bass_inversion_reports_bass");
        for (int n : {40, 43, 48}) e->noteOff(0, n);
        run(0.3f);

        // Channel mute and the per-part octave.
        auto level = [&](int note) {
            e->noteOn(0, note, 110);
            run(0.2f);
            const float r = rms(b.data(), (int)b.size());
            e->noteOff(0, note);
            run(1.0f);
            return r;
        };
        const float up1 = level(72);
        e->control(pa::CmdChannelMute, 0, 1, 0.0f);
        const float muted = level(72);
        e->control(pa::CmdChannelMute, 0, 0, 0.0f);
        expect(up1 > 0.001f && muted < up1 * 0.01f, "channel_mute_silences_part");
        e->control(pa::CmdChannelGain, 0, 0, 0.5f);
        const float half = level(72);
        e->control(pa::CmdChannelGain, 0, 0, 1.0f);
        expect(half < up1 * 0.75f && half > up1 * 0.25f, "channel_gain_scales_part");
        e->control(pa::CmdPartOctave, 0, 1, 0.0f);
        e->noteOn(0, 72, 110);
        run(0.05f);
        e->noteOff(0, 72);
        run(1.2f);
        expect(e->query(pa::QVoices) < 1.0f, "octave_shifted_note_releases");
        e->control(pa::CmdPartOctave, 0, 0, 0.0f);

        // Split off: the upper part plays on the left side too.
        e->setPartEnable(3, false);
        e->control(pa::CmdSplitOn, 0, 0, 0.0f);
        const float fullLeft = level(40);
        e->control(pa::CmdSplitOn, 0, 1, 0.0f);
        const float splitLeft = level(40);
        expect(fullLeft > 0.001f && splitLeft < fullLeft * 0.01f, "split_off_plays_upper_everywhere");

        // Ensemble adds harmony under Upper 1.
        e->noteOn(0, 48, 100);
        e->noteOn(0, 52, 100);
        e->noteOn(0, 55, 100);
        run(0.02f);
        for (int n : {48, 52, 55}) e->noteOff(0, n);
        e->control(pa::CmdEnsemble, 0, 3, 0.0f);
        e->noteOn(0, 79, 100);
        run(0.02f);
        const float withEns = e->query(pa::QVoices);
        e->noteOff(0, 79);
        run(1.2f);
        expect(withEns >= 4.0f, "ensemble_block_adds_three_voices");
        expect(e->query(pa::QVoices) < 1.0f, "ensemble_notes_release");
        e->control(pa::CmdEnsemble, 0, 0, 0.0f);

        // Metronome runs without the style.
        e->control(pa::CmdMetronome, 0, 1, 0.8f);
        e->control(pa::CmdMetronomeRun, 0, 1, 0.0f);
        run(0.6f);
        expect((int)e->query(pa::QMetroBeat) == 1, "metronome_counts_beats");
        e->control(pa::CmdMetronomeRun, 0, 0, 0.0f);
        e->control(pa::CmdMetronome, 0, 0, 0.0f);

        // Pads play on their own channel and stop.
        e->query(pa::QPeakL);
        e->control(pa::CmdPadOn, 0, 72, 110.0f, 1);
        run(0.2f);
        expect(e->query(pa::QPeakL) > 0.001f && e->query(pa::QActivity + 11) > 0.1f, "pad_plays");
        e->control(pa::CmdPadsOff, 0, 0, 0.0f);
        run(1.2f);
        expect(e->query(pa::QVoices) < 1.0f, "pads_off_stops");

        // Quarter-tone sub scale changes the played pitch of that key only.
        auto zeroCross = [&](int note) {
            e->noteOn(0, note, 110);
            run(0.4f);
            int zc = 0;
            for (size_t i = 24000; i + 2 < b.size(); i += 2)
                if ((b[i] <= 0.0f) != (b[i + 2] <= 0.0f)) zc++;
            e->noteOff(0, note);
            run(1.0f);
            return zc;
        };
        e->setPartProgram(0, 0);
        const int plain = zeroCross(64);
        e->control(pa::CmdScaleCents, 4, 0, -50.0f);
        const int quarter = zeroCross(64);
        e->control(pa::CmdScaleCents, 4, 0, 0.0f);
        if (!(quarter < plain)) std::printf("sub scale zc plain=%d quarter=%d\n", plain, quarter);
        expect(quarter < plain, "sub_scale_lowers_key");
    }

    {
        // The same controls on the GM SoundFont path the app uses for factory sounds.
        std::string sf2 = __FILE__;
        sf2 = sf2.substr(0, sf2.find_last_of("/\\")) + "/../../factory/GeneralUser-GS.sf2";
        auto g = std::make_unique<pa::Engine>();
        g->prepare(48000.0f);
        if (g->loadSoundfont(sf2.c_str()) > 0) {
            std::vector<float> b;
            auto run = [&](float secs) {
                const int n = (int)(secs * 48000.0f);
                b.assign((size_t)n * 2, 0.0f);
                for (int off = 0; off < n; off += 256) g->render(b.data() + off * 2, std::min(256, n - off));
            };
            auto level = [&](int note) {
                g->noteOn(0, note, 110);
                run(0.25f);
                const float r = rms(b.data(), (int)b.size());
                g->noteOff(0, note);
                run(1.5f);
                return r;
            };
            g->setSynchro(false);
            const float on = level(72);
            g->control(pa::CmdChannelMute, 0, 1, 0.0f);
            const float muted = level(72);
            g->control(pa::CmdChannelMute, 0, 0, 0.0f);
            expect(on > 0.001f && muted < on * 0.02f, "gm_channel_mute");
            g->control(pa::CmdChannelGain, 0, 0, 0.4f);
            const float low = level(72);
            g->control(pa::CmdChannelGain, 0, 0, 1.0f);
            expect(low < on * 0.8f && low > 0.0005f, "gm_channel_gain");
            g->query(pa::QPeakL);
            g->control(pa::CmdPadOn, 0, 67, 110.0f, 0);
            run(0.3f);
            expect(g->query(pa::QPeakL) > 0.002f, "gm_pad_plays");
            g->control(pa::CmdPadsOff, 0, 0, 0.0f);
            run(2.0f);
            g->query(pa::QPeakL);
            run(0.1f);
            expect(g->query(pa::QPeakL) < 0.01f, "gm_pads_off");
            g->control(pa::CmdMetronome, 0, 1, 1.0f);
            g->control(pa::CmdMetronomeRun, 0, 1, 0.0f);
            run(0.1f);
            expect(g->query(pa::QPeakL) > 0.002f, "gm_metronome_sounds");
            g->control(pa::CmdMetronomeRun, 0, 0, 0.0f);
        } else {
            std::printf("SKIP gm control tests (no %s)\n", sf2.c_str());
        }
    }

    {
        // AI drum style: per-element SFZ slice kits (kit=), 3/4 meter, ArrangerBox SFZ opcodes.
        const std::string dir = tempDir();
        writeWav16Stereo(dir + "/ab_ai_kit.wav", 9600);
        {
            std::ofstream k(dir + "/ab_ai_kit.sfz");
            k << "<control>\n<global> global_label=Waltz Kit ab_kit=1 ab_category=AI Kit\n";
            k << "<group>\nloop_mode=one_shot\n";
            k << "<region> sample=ab_ai_kit.wav key=0 offset=0 end=4799\n";
            k << "<region> sample=ab_ai_kit.wav key=1 offset=4800 end=9599\n";
        }
        auto e = std::make_unique<pa::Engine>();
        e->prepare(48000.0f);
        char rep[256];
        const int kitId = e->loadSfz((dir + "/ab_ai_kit.sfz").c_str(), rep, sizeof(rep));
        expect(kitId >= 0 && std::strstr(rep, "\"zones\":2") != nullptr, "sfz_header_line_opcodes");
        expect(kitId >= 0 && std::strcmp(e->soundCategory(kitId), "AI Kit") == 0 &&
                       std::strcmp(e->soundName(kitId), "Waltz Kit") == 0,
               "sfz_ab_category_and_label");
        {
            std::ofstream st(dir + "/ab_ai_waltz.abstyle");
            st << "ABSTYLE1\nname=AI Waltz\ncategory=AI Drums\ntempo=120\nmeter=3\n";
            st << "section=var1\nlength=288\nkit=ab_ai_kit.sfz\n0,0,0,127,96,abs\n96,0,1,127,96,abs\n";
            st << "section=var2\nlength=288\nkit=ab_ai_kit.sfz\n0,0,1,127,96,abs\n";
        }
        const int before = e->soundCount();
        const int sid = e->loadAbStyle((dir + "/ab_ai_waltz.abstyle").c_str(), rep, sizeof(rep));
        expect(sid >= 0 && std::strstr(rep, "\"kits\":1,\"kitsFailed\":0") != nullptr, "abstyle_kit_loads_once");
        expect(e->soundCount() == before + 1, "abstyle_kit_shared_between_sections");
        std::vector<float> b;
        int maxBeat = 0;
        auto run = [&](float secs) {
            const int n = (int)(secs * 48000.0f);
            b.assign((size_t)n * 2, 0.0f);
            for (int off = 0; off < n; off += 256) {
                e->render(b.data() + off * 2, std::min(256, n - off));
                maxBeat = std::max(maxBeat, (int)e->query(pa::QBeat));
            }
        };
        e->setStyle(sid);
        e->setTempo(120.0f);
        e->setSynchro(false);
        e->setAutoFill(false);
        e->bookSection((int)pa::Section::Var1);
        e->arrangerStart();
        run(0.08f);
        expect(rms(b.data(), (int)b.size()) > 0.003f, "ai_kit_slice_plays");
        run(0.12f);
        e->bookSection((int)pa::Section::Var2);
        run(1.1f);  // 1.3 s: still inside the first 3/4 bar (1.5 s at 120 bpm)
        expect(e->currentSection() == (int)pa::Section::Var1, "meter3_variation_waits_for_bar");
        run(0.4f);  // 1.7 s
        expect(e->currentSection() == (int)pa::Section::Var2, "meter3_variation_on_bar_line");
        run(3.0f);
        expect(maxBeat == 2, "meter3_beat_display_counts_three");
        e->arrangerStop();
    }

    if (const char* aiStyle = std::getenv("AB_AI_STYLE")) {
        // Real output of the ArrangerBox AI server (see server/tests/e2e.mjs).
        auto e = std::make_unique<pa::Engine>();
        e->prepare(48000.0f);
        char rep[256];
        const int sid = e->loadAbStyle(aiStyle, rep, sizeof(rep));
        std::printf("AI style %s -> %s\n", aiStyle, rep);
        expect(sid >= 0 && std::strstr(rep, "\"kitsFailed\":0") != nullptr && std::strstr(rep, "\"kits\":0,") == nullptr,
               "ai_server_style_loads_with_kits");
        std::vector<float> b;
        auto level = [&](float secs) {
            const int n = (int)(secs * 48000.0f);
            b.assign((size_t)n * 2, 0.0f);
            for (int off = 0; off < n; off += 256) e->render(b.data() + off * 2, std::min(256, n - off));
            return rms(b.data(), (int)b.size());
        };
        e->setStyle(sid);
        e->setSynchro(false);
        e->setAutoFill(true);
        const float tempo = e->styleTempo(sid);
        bool allPlay = true;
        for (int v = 0; v < 4; ++v) {
            e->setTempo(v % 2 ? tempo * 0.7f : tempo * 1.25f);
            e->bookSection((int)pa::Section::Var1 + v);
            if (!e->isPlaying()) e->arrangerStart();
            const float l = level(3.0f);
            std::printf("  var%d at %.1f bpm rms %.4f section %d\n", v + 1, e->tempo(), l, e->currentSection());
            allPlay = allPlay && l > 0.005f;
        }
        expect(allPlay, "ai_server_variations_play_at_any_tempo");
        e->setTempo(tempo);
        e->bookSection((int)pa::Section::Fill1);
        const float fill = level(0.5f);
        expect(fill > 0.005f, "ai_server_fill_plays");
        e->bookSection((int)pa::Section::Ending1);
        level(30.0f);
        expect(!e->isPlaying(), "ai_server_ending_stops");
    }
    if (const char* aiSfz = std::getenv("AB_AI_SFZ")) {
        auto e = std::make_unique<pa::Engine>();
        e->prepare(48000.0f);
        // Measure the samples' own release, not the reverb / delay tail, and keep the low
        // test notes from being chord keys that start the style (Synchro Start).
        e->setSynchro(false);
        e->setSplit(0);
        e->setFx(0, 0.0f);
        e->setFx(1, 0.0f);
        e->setFx(2, 0.0f);
        std::string list(aiSfz);
        size_t pos = 0;
        bool all = true;
        int count = 0;
        while (pos <= list.size()) {
            size_t semi = list.find(';', pos);
            if (semi == std::string::npos) semi = list.size();
            const std::string path = list.substr(pos, semi - pos);
            pos = semi + 1;
            if (path.empty()) continue;
            char rep[256];
            const int id = e->loadSfz(path.c_str(), rep, sizeof(rep));
            std::printf("AI sound %s -> %s (%s)\n", path.c_str(), rep, id >= 0 ? e->soundCategory(id) : "-");
            if (id < 0) {
                all = false;
                continue;
            }
            count++;
            e->setPartProgram(0, id);
            std::vector<float> b((size_t)48000 * 2);
            for (int note : {36, 48, 60, 72, 84}) {
                e->noteOn(0, note, 100);
                for (int off = 0; off < 24000; off += 256) e->render(b.data() + off * 2, std::min(256, 24000 - off));
                const float held = rms(b.data(), 24000 * 2);
                e->noteOff(0, note);
                for (int off = 0; off < 48000; off += 256) e->render(b.data() + off * 2, std::min(256, 48000 - off));
                const float after = rms(b.data() + 40000 * 2, 8000 * 2);
                std::printf("  note %d held rms %.4f, 0.8 s after release %.5f\n", note, held, after);
                all = all && held > 0.003f && after < held * 0.2f;
            }
        }
        expect(all && count > 0, "ai_server_sounds_play_and_release");
    }

    // AI stems: two MP3s (440 Hz and 1 kHz, 1.5 s) play in sync, mute, seek and stop at the end.
    {
        std::string here = __FILE__;
        here = here.substr(0, here.find_last_of("/\\"));
        const std::string paths = here + "/fixtures/stem_a440.mp3\n" + here + "/fixtures/stem_b1000.mp3";
        auto e = std::make_unique<pa::Engine>();
        e->prepare(48000.0f);
        char rep[256];
        const int n = e->loadStems(paths.c_str(), rep, sizeof(rep));
        std::printf("stems: %s\n", rep);
        expect(n == 2 && std::strstr(rep, "\"rate\":44100") != nullptr, "stems_load_mp3");
        std::vector<float> b((size_t)48000 * 2);
        auto run = [&](int frames) {
            for (int off = 0; off < frames; off += 256) e->render(b.data() + off * 2, std::min(256, frames - off));
        };
        auto tone = [&](float f, int from, int count) {  // Goertzel power at f (left channel)
            const float w = 2.0f * 3.14159265f * f / 48000.0f, c = 2.0f * std::cos(w);
            float s1 = 0, s2 = 0;
            for (int i = 0; i < count; ++i) {
                const float s0 = b[(size_t)(from + i) * 2] + c * s1 - s2;
                s2 = s1;
                s1 = s0;
            }
            return std::sqrt(std::max(0.0f, s1 * s1 + s2 * s2 - c * s1 * s2)) / (float)count;
        };
        run(4800);
        expect(std::fabs(e->query(pa::QStemLen) - 1.5f) < 0.06f && e->query(pa::QStemPlaying) == 0.0f &&
                   rms(b.data(), 4800 * 2) < 1e-4f,
               "stems_loaded_stopped_and_silent");
        e->control(pa::CmdStemGain, 0, 0, 1.0f);
        e->control(pa::CmdStemGain, 1, 0, 1.0f);
        e->control(pa::CmdStemPlay, 0, 0, 1.0f);
        run(24000);
        const float pos = e->query(pa::QStemPos);
        const float a1 = tone(440, 12000, 9600), b1 = tone(1000, 12000, 9600);
        std::printf("  both: pos %.3f s, 440 Hz %.3f, 1 kHz %.3f, playing %.0f\n", pos, a1, b1, e->query(pa::QStemPlaying));
        expect(std::fabs(pos - 0.5f) < 0.02f, "stems_play_at_real_speed_after_resampling");
        expect(a1 > 0.05f && b1 > 0.05f && e->query(pa::QStemLevel + 0) > 0.2f && e->query(pa::QStemLevel + 1) > 0.2f,
               "stems_mix_both");
        e->control(pa::CmdStemGain, 1, 0, 0.0f);
        run(12000);
        const float a2 = tone(440, 4800, 7200), b2 = tone(1000, 4800, 7200);
        std::printf("  stem 2 muted: 440 Hz %.3f, 1 kHz %.4f\n", a2, b2);
        expect(a2 > 0.05f && b2 < a2 * 0.01f, "stems_mute_one");
        e->control(pa::CmdStemSeek, 0, 0, 0.2f);
        run(4800);
        expect(std::fabs(e->query(pa::QStemPos) - 0.3f) < 0.03f, "stems_seek");
        run(48000);
        run(48000);
        expect(e->query(pa::QStemPlaying) == 0.0f, "stems_stop_at_end");
        e->control(pa::CmdStemPlay, 0, 0, 1.0f);
        run(4800);
        expect(e->query(pa::QStemPlaying) == 1.0f && e->query(pa::QStemPos) < 0.15f, "stems_replay_from_start");
        const int n2 = e->loadStems((here + "/fixtures/stem_b1000.mp3").c_str(), rep, sizeof(rep));
        run(4800);
        expect(n2 == 1 && e->query(pa::QStemPlaying) == 0.0f && std::fabs(e->query(pa::QStemLen) - 1.5f) < 0.06f,
               "stems_replace_while_playing");
        expect(e->loadStems((here + "/fixtures/missing.mp3").c_str(), rep, sizeof(rep)) < 0 &&
                   std::strstr(rep, "\"ok\":0") != nullptr,
               "stems_missing_file_reported");
        e->clearStems();
        run(4800);
        expect(e->query(pa::QStemLen) == 0.0f, "stems_clear");
    }

    // Real AI-server stems (AB_AI_STEMS="original.mp3;vocals.mp3;…" from server/tests/e2e.mjs stems):
    // they decode, line up with each other, and the stems added together sound like the original.
    if (const char* aiStems = std::getenv("AB_AI_STEMS")) {
        std::string list = aiStems;
        for (char& ch : list)
            if (ch == ';') ch = '\n';
        auto e = std::make_unique<pa::Engine>();
        e->prepare(48000.0f);
        char rep[256];
        const int n = e->loadStems(list.c_str(), rep, sizeof(rep));
        std::printf("AI stems -> %s\n", rep);
        expect(n >= 2, "ai_server_stems_load");
        const int len = 48000 * 2;
        std::vector<float> orig((size_t)len * 2), sum((size_t)len * 2), tmp((size_t)len * 2);
        auto take = [&](std::vector<float>& dst, bool original) {
            for (int i = 0; i < n; ++i) e->control(pa::CmdStemGain, i, 0, (i == 0) == original ? 1.0f : 0.0f);
            e->control(pa::CmdStemSeek, 0, 0, 20.0f);
            e->control(pa::CmdStemPlay, 0, 0, 1.0f);
            for (int off = 0; off < 9600; off += 256) e->render(tmp.data(), 256);  // seek + gain glide
            for (int off = 0; off < len; off += 256) e->render(dst.data() + off * 2, std::min(256, len - off));
            e->control(pa::CmdStemPlay, 0, 0, 0.0f);
            for (int off = 0; off < 4800; off += 256) e->render(tmp.data(), 256);
        };
        take(orig, true);
        take(sum, false);
        auto corr = [&](int lag) {
            double xy = 0, xx = 0, yy = 0;
            for (int i = 2000; i < len - 2000; ++i) {
                const double x = orig[(size_t)i * 2], y = sum[(size_t)(i + lag) * 2];
                xy += x * y;
                xx += x * x;
                yy += y * y;
            }
            return xy / std::sqrt(xx * yy + 1e-20);
        };
        int best = 0;
        double bestC = -2;
        for (int lag = -400; lag <= 400; ++lag) {
            const double c = corr(lag);
            if (c > bestC) bestC = c, best = lag;
        }
        std::printf("  original vs stems added up: correlation %.4f at lag %d samples\n", bestC, best);
        expect(bestC > 0.97 && best == 0, "ai_server_stems_aligned_and_sum_to_song");
    }

    return fails ? 1 : 0;
}
