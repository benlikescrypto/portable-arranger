#include "../Engine.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <memory>
#include <string>
#include <vector>
#ifdef _WIN32
#include <direct.h>
static int mk(const char* p) { return _mkdir(p); }
#else
#include <sys/stat.h>
static int mk(const char* p) { return mkdir(p, 0755); }
#endif

namespace {

int fails = 0;

void expect(bool ok, const char* name) {
    std::printf("%s %s\n", ok ? "PASS" : "FAIL", name);
    if (!ok) fails++;
}

void be32(std::vector<uint8_t>& o, uint32_t v) {
    o.push_back((uint8_t)(v >> 24));
    o.push_back((uint8_t)(v >> 16));
    o.push_back((uint8_t)(v >> 8));
    o.push_back((uint8_t)v);
}

void chunk(std::vector<uint8_t>& o, const char* id, const std::vector<uint8_t>& payload) {
    o.insert(o.end(), id, id + 4);
    be32(o, (uint32_t)payload.size());
    o.insert(o.end(), payload.begin(), payload.end());
}

void padName(std::vector<uint8_t>& o, const char* s, int n) {
    const int len = (int)std::strlen(s);
    for (int i = 0; i < n; ++i) o.push_back((uint8_t)(i < len ? s[i] : ' '));
}

std::vector<uint8_t> makeKsf(const char* name, int frames, int root) {
    (void)root;
    std::vector<uint8_t> pcm16;
    for (int i = 0; i < frames; ++i) {
        const float t = (float)i / 44100.0f;
        const int16_t s = (int16_t)(std::sin(2.0f * 3.14159265f * 440.0f * t) * 12000.0f);
        pcm16.push_back((uint8_t)((s >> 8) & 255));
        pcm16.push_back((uint8_t)(s & 255));
    }
    std::vector<uint8_t> smp1;
    padName(smp1, name, 16);
    be32(smp1, 0);
    be32(smp1, 0);
    be32(smp1, 0);
    be32(smp1, (uint32_t)frames);
    std::vector<uint8_t> smd1;
    be32(smd1, 44100);
    smd1.push_back(0x20);
    smd1.push_back(0);
    smd1.push_back(1);
    smd1.push_back(16);
    be32(smd1, (uint32_t)frames);
    smd1.insert(smd1.end(), pcm16.begin(), pcm16.end());
    std::vector<uint8_t> nam;
    padName(nam, name, 24);
    std::vector<uint8_t> out;
    chunk(out, "SMP1", smp1);
    chunk(out, "SMD1", smd1);
    chunk(out, "NAME", nam);
    return out;
}

void be16(std::vector<uint8_t>& o, uint16_t v) {
    o.push_back((uint8_t)(v >> 8));
    o.push_back((uint8_t)v);
}

std::vector<uint8_t> makePaKorfPcm(const char* name, const uint8_t id[8], int frames) {
    std::vector<uint8_t> audio;
    audio.reserve((size_t)frames);
    int acc = 0;
    for (int i = 0; i < frames; ++i) {
        const float t = (float)i / 44100.0f;
        const int16_t s = (int16_t)(std::sin(2.0f * 3.14159265f * 440.0f * t) * 12000.0f);
        int d = (s - acc) / 256;
        if (d > 127) d = 127;
        if (d < -128) d = -128;
        acc += d * 256;
        audio.push_back((uint8_t)(int8_t)d);
    }
    std::vector<uint8_t> dir(96, 0);
    dir[0] = 0x00;
    dir[1] = 0x5e;
    dir[2] = 0x00;
    dir[3] = 0x06;
    dir[4] = 0x00;
    dir[5] = 0x02;
    dir[6] = 0x00;
    dir[7] = 0x1c;
    for (int i = 0; i < 24 && name[i]; ++i) dir[8 + (size_t)i] = (uint8_t)name[i];
    dir[0x31] = 0x04;
    dir[0x32] = 0x00;
    dir[0x33] = 0x08;
    std::memcpy(dir.data() + 0x34, id, 8);

    std::vector<uint8_t> payload(66, 0);
    std::memcpy(payload.data(), id, 8);
    payload[8] = 0x01;
    payload[9] = 0x80;
    payload[12] = 0xac;
    payload[13] = 0x44;
    payload[14] = (uint8_t)((audio.size() >> 24) & 0xff);
    payload[15] = (uint8_t)((audio.size() >> 16) & 0xff);
    payload[16] = (uint8_t)((audio.size() >> 8) & 0xff);
    payload[17] = (uint8_t)(audio.size() & 0xff);
    payload.insert(payload.end(), audio.begin(), audio.end());

    std::vector<uint8_t> body(0x24, 0);
    body[0x0f] = 'K';
    body[0x10] = 'O';
    body[0x11] = 'R';
    body[0x12] = 'F';
    body.insert(body.end(), dir.begin(), dir.end());
    body.insert(body.end(), {0, 0, 0, 0});
    body.insert(body.end(), {0x12, 0x00, 0x00, 0x18});
    be32(body, (uint32_t)payload.size());
    body.insert(body.end(), payload.begin(), payload.end());

    std::vector<uint8_t> out;
    out.insert(out.end(), {0x01, 0x00, 0x01, 0x14});
    be32(out, (uint32_t)body.size());
    out.insert(out.end(), body.begin(), body.end());
    return out;
}

std::vector<uint8_t> makePaKorfKmp(const char* instName, const uint8_t id[8], int root) {
    std::vector<uint8_t> out(8, 0);
    out[0] = 0x01;
    out[1] = 0x00;
    out[2] = 0x01;
    out[3] = 0x14;
    padName(out, instName, 16);
    out.insert(out.end(), id, id + 8);
    out.insert(out.end(), {0, 0, 0, 0});
    be16(out, 44100);
    out.push_back((uint8_t)root);
    out.push_back(0);
    return out;
}

std::vector<uint8_t> makeKmp(const char* instName, const char* sampleName) {
    std::vector<uint8_t> msp;
    padName(msp, instName, 16);
    msp.push_back(1);
    msp.push_back(1);
    std::vector<uint8_t> rlp(18, 0);
    rlp[0] = 60;
    rlp[1] = 127;
    rlp[4] = 64;
    for (int i = 0; i < 12 && sampleName[i]; ++i) rlp[6 + i] = (uint8_t)sampleName[i];
    std::vector<uint8_t> nam;
    padName(nam, instName, 24);
    std::vector<uint8_t> out;
    chunk(out, "MSP1", msp);
    chunk(out, "NAME", nam);
    chunk(out, "RLP1", rlp);
    return out;
}

void writeFile(const std::string& path, const std::vector<uint8_t>& bytes) {
    FILE* f = std::fopen(path.c_str(), "wb");
    if (!f) {
        std::printf("FAIL write %s\n", path.c_str());
        fails++;
        return;
    }
    if (!bytes.empty()) std::fwrite(bytes.data(), 1, bytes.size(), f);
    std::fclose(f);
}

void mkdirs(const std::string& path) {
    std::string cur;
    for (size_t i = 0; i < path.size(); ++i) {
        const char c = path[i] == '\\' ? '/' : path[i];
        if (c == '/' && !cur.empty()) mk(cur.c_str());
        cur.push_back(c);
    }
    if (!cur.empty()) mk(cur.c_str());
}

std::vector<uint8_t> storeZip(const std::string& name, const std::vector<uint8_t>& data) {
    auto u16 = [](uint16_t v) {
        return std::vector<uint8_t>{(uint8_t)v, (uint8_t)(v >> 8)};
    };
    auto u32 = [](uint32_t v) {
        return std::vector<uint8_t>{(uint8_t)v, (uint8_t)(v >> 8), (uint8_t)(v >> 16), (uint8_t)(v >> 24)};
    };
    std::vector<uint8_t> local;
    const char* pk = "PK\x03\x04";
    local.insert(local.end(), pk, pk + 4);
    auto app = [&](const std::vector<uint8_t>& x) { local.insert(local.end(), x.begin(), x.end()); };
    app(u16(20));
    app(u16(0));
    app(u16(0));
    app(u16(0));
    app(u16(0));
    app(u32(0));
    app(u32((uint32_t)data.size()));
    app(u32((uint32_t)data.size()));
    app(u16((uint16_t)name.size()));
    app(u16(0));
    local.insert(local.end(), name.begin(), name.end());
    local.insert(local.end(), data.begin(), data.end());
    std::vector<uint8_t> cd;
    const char* pkc = "PK\x01\x02";
    cd.insert(cd.end(), pkc, pkc + 4);
    auto cap = [&](const std::vector<uint8_t>& x) { cd.insert(cd.end(), x.begin(), x.end()); };
    cap(u16(20));
    cap(u16(20));
    cap(u16(0));
    cap(u16(0));
    cap(u16(0));
    cap(u16(0));
    cap(u32(0));
    cap(u32((uint32_t)data.size()));
    cap(u32((uint32_t)data.size()));
    cap(u16((uint16_t)name.size()));
    cap(u16(0));
    cap(u16(0));
    cap(u16(0));
    cap(u16(0));
    cap(u32(0));
    cap(u32(0));
    cd.insert(cd.end(), name.begin(), name.end());
    std::vector<uint8_t> eocd;
    const char* pke = "PK\x05\x06";
    eocd.insert(eocd.end(), pke, pke + 4);
    auto eap = [&](const std::vector<uint8_t>& x) { eocd.insert(eocd.end(), x.begin(), x.end()); };
    eap(u16(0));
    eap(u16(0));
    eap(u16(1));
    eap(u16(1));
    eap(u32((uint32_t)cd.size()));
    eap(u32((uint32_t)local.size()));
    eap(u16(0));
    std::vector<uint8_t> zip = local;
    zip.insert(zip.end(), cd.begin(), cd.end());
    zip.insert(zip.end(), eocd.begin(), eocd.end());
    return zip;
}

int patchesAdded(const char* report) {
    const char* p = std::strstr(report, "\"patches\":");
    return p ? std::atoi(p + 10) : 0;
}

int samplesAdded(const char* report) {
    const char* p = std::strstr(report, "\"samples\":");
    return p ? std::atoi(p + 10) : 0;
}

}  // namespace

int main() {
    auto engHeap = std::make_unique<pa::Engine>();
    pa::Engine& eng = *engHeap;
    eng.prepare(44100.0f);
    const int factorySounds = eng.soundCount();

    mk("tmp");
    mkdirs("tmp/KApro.SET/PCM");
    mkdirs("tmp/KApro.SET/MULTISMP");
    mkdirs("tmp/KApro.SET/SOUND");
    const auto ksf = makeKsf("PianoC3", 2048, 60);
    writeFile("tmp/KApro.SET/PCM/RAM01.PCM", ksf);
    writeFile("tmp/KApro.SET/MULTISMP/RAM.KMP", makeKmp("KApro Piano", "PianoC3"));

    char report[2048]{};
    eng.loadPa4xSet("tmp/KApro.SET", report, (int)sizeof(report));
    std::printf("FOLDER report=%s\n", report);
    expect(samplesAdded(report) >= 1, "folder_samples");
    expect(patchesAdded(report) >= 1, "folder_patches");
    expect(eng.soundCount() > factorySounds, "folder_catalog");

    FILE* cacheMan = std::fopen("tmp/KApro.SET/.arrangerbox-cache/manifest.txt", "rb");
    expect(cacheMan != nullptr, "writes_converted_cache");
    if (cacheMan) std::fclose(cacheMan);
    auto engCached = std::make_unique<pa::Engine>();
    engCached->prepare(44100.0f);
    const int factoryCached = engCached->soundCount();
    report[0] = 0;
    engCached->loadPa4xSet("tmp/KApro.SET", report, (int)sizeof(report));
    std::printf("CACHE report=%s\n", report);
    expect(std::strstr(report, "\"cached\":1") != nullptr, "reloads_converted_cache");
    expect(samplesAdded(report) >= 1, "cache_samples");
    expect(patchesAdded(report) >= 1, "cache_patches");
    expect(engCached->soundCount() > factoryCached, "cache_catalog");

    auto engNamed = std::make_unique<pa::Engine>();
    engNamed->prepare(44100.0f);
    const int factoryNamed = engNamed->soundCount();
    report[0] = 0;
    engNamed->listPa4xCatalog("tmp/KApro.SET", report, (int)sizeof(report));
    std::printf("CATALOG report=%s\n", report);
    expect(std::strstr(report, "\"sounds\":") != nullptr, "catalog_json");
    FILE* catalogFile = std::fopen("tmp/KApro.SET/.arrangerbox-cache/catalog.json", "rb");
    expect(catalogFile != nullptr, "writes_catalog_json");
    if (catalogFile) std::fclose(catalogFile);
    report[0] = 0;
    const int namedId =
        engNamed->loadPa4xNamed("tmp/KApro.SET", "sound", "KApro Piano", report, (int)sizeof(report));
    std::printf("NAMED report=%s\n", report);
    expect(namedId >= 0, "named_engine_id");
    expect(std::strstr(report, "\"ok\":1") != nullptr, "named_ok");
    expect(engNamed->soundCount() == factoryNamed + 1, "named_one_patch");

    auto engLoose = std::make_unique<pa::Engine>();
    engLoose->prepare(44100.0f);
    const int factoryLoose = engLoose->soundCount();
    report[0] = 0;
    const int looseId =
        engLoose->loadPa4xNamed("tmp/KApro.SET", "sound", "KApro Piano Stage", report, (int)sizeof(report));
    std::printf("LOOSE report=%s\n", report);
    expect(looseId >= 0, "loose_named_engine_id");
    expect(std::strstr(report, "\"ok\":1") != nullptr, "loose_named_ok");
    expect(engLoose->soundCount() == factoryLoose + 1, "loose_named_one_patch");

    auto engFromCache = std::make_unique<pa::Engine>();
    engFromCache->prepare(44100.0f);
    report[0] = 0;
    const int cacheId =
        engFromCache->loadPa4xNamed("tmp/KApro.SET", "sound", "KApro Piano Stage", report, (int)sizeof(report));
    std::printf("CACHE_NAMED report=%s\n", report);
    expect(cacheId >= 0, "cache_named_engine_id");
    expect(std::strstr(report, "\"cached\":1") != nullptr, "cache_named_uses_wav");
    expect(patchesAdded(report) == 1, "cache_named_one_patch");

    mkdirs("tmp/Layers.SET/PCM");
    mkdirs("tmp/Layers.SET/MULTISMP");
    auto layerPcm = makeKsf("PianoC2", 512, 48);
    const auto other = makeKsf("OtherSax", 512, 62);
    layerPcm.insert(layerPcm.end(), other.begin(), other.end());
    writeFile("tmp/Layers.SET/PCM/RAM01.PCM", layerPcm);
    writeFile("tmp/Layers.SET/MULTISMP/RAM.KMP", makeKmp("Piano C2", "PianoC2"));
    auto engLayer = std::make_unique<pa::Engine>();
    engLayer->prepare(44100.0f);
    report[0] = 0;
    const int layerId = engLayer->loadPa4xNamed("tmp/Layers.SET", "sound", "Piano", report, (int)sizeof(report));
    std::printf("LAYER report=%s\n", report);
    expect(layerId >= 0, "layer_engine_id");
    expect(samplesAdded(report) == 1, "layer_decodes_one_sample");
    expect(patchesAdded(report) == 1, "layer_one_patch");

    const auto zip = storeZip("PCM/RAM01.PCM", ksf);
    writeFile("tmp/KAproOnline.SET", zip);
    auto eng2 = std::make_unique<pa::Engine>();
    eng2->prepare(44100.0f);
    const int factory2 = eng2->soundCount();
    report[0] = 0;
    eng2->loadPa4xSet("tmp/KAproOnline.SET", report, (int)sizeof(report));
    std::printf("ZIPSET report=%s\n", report);
    expect(samplesAdded(report) >= 1, "zipset_samples");
    expect(patchesAdded(report) >= 1, "zipset_patches");
    expect(eng2->soundCount() > factory2, "zipset_catalog");

    const uint8_t korfId[8] = {0x85, 0x71, 0x84, 0x00, 0x44, 0x85, 0xce, 0xb6};
    mkdirs("tmp/PaKorf.SET/PCM");
    mkdirs("tmp/PaKorf.SET/MULTISMP");
    writeFile("tmp/PaKorf.SET/PCM/RAM01.PCM", makePaKorfPcm("KApro Legato O-L", korfId, 2048));
    writeFile("tmp/PaKorf.SET/MULTISMP/RAM.KMP", makePaKorfKmp("KApro Legato O-L", korfId, 60));
    auto eng3 = std::make_unique<pa::Engine>();
    eng3->prepare(44100.0f);
    const int factory3 = eng3->soundCount();
    report[0] = 0;
    eng3->loadPa4xSet("tmp/PaKorf.SET", report, (int)sizeof(report));
    std::printf("KORF report=%s\n", report);
    expect(samplesAdded(report) >= 1, "korf_samples");
    expect(patchesAdded(report) >= 1, "korf_patches");
    expect(eng3->soundCount() > factory3, "korf_catalog");

    const char* realPcm =
        "tmp/musikant/unpacked/Pa4X_MUSIKANT_Paket_Dezember2020.SET/PCM/RAM01.PCM";
    FILE* real = std::fopen(realPcm, "rb");
    if (real) {
        std::fclose(real);
        auto eng4 = std::make_unique<pa::Engine>();
        eng4->prepare(44100.0f);
        report[0] = 0;
        eng4->loadPa4xSet(realPcm, report, (int)sizeof(report));
        std::printf("REAL RAM01 report=%s\n", report);
        expect(samplesAdded(report) >= 8, "real_ram01_samples");
        expect(patchesAdded(report) >= 1, "real_ram01_patches");
    } else {
        std::printf("SKIP real_ram01 (SET not on disk)\n");
    }

    const char* realSets[] = {"tmp/musikant/unpacked/Pa4X_MUSIKANT_Paket_Dezember2020.SET",
                              "../../../../tmp/musikant/unpacked/Pa4X_MUSIKANT_Paket_Dezember2020.SET"};
    const char* realSet = nullptr;
    for (const char* cand : realSets) {
        std::string probe = std::string(cand) + "/MULTISMP/RAM.KMP";
        FILE* f = std::fopen(probe.c_str(), "rb");
        if (f) {
            std::fclose(f);
            realSet = cand;
            break;
        }
    }
    if (realSet) {
        const char* groups[] = {"KApro Legato O", "KApro Fast Str",  "KApro Solo Cel", "KApro Bayan Disk",
                                "KApro Alpen Acco", "KApro Orchestr", "KApro Diatonic D", "KApro Dah-Dat",
                                "KApro Dooeeah", "KApro Bah Fall", "KApro Bap"};
        for (const char* group : groups) {
            auto engReal = std::make_unique<pa::Engine>();
            engReal->prepare(44100.0f);
            const int before = engReal->soundCount();
            report[0] = 0;
            const auto t0 = std::chrono::steady_clock::now();
            const int id = engReal->loadPa4xNamed(realSet, "sound", group, report, (int)sizeof(report));
            const auto ms = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - t0).count();
            std::printf("REAL NAMED %s %lldms report=%.240s\n", group, (long long)ms, report);
            expect(id >= 0 && engReal->soundCount() == before + 1, "real_named_one_patch");
            expect(samplesAdded(report) >= 4, "real_named_samples");
            expect(ms < 3000, "real_named_fast");
            // Compressed SET PCM used to decode with a huge drifting DC offset, which the
            // output DC blocker removed along with most of the level (~25 dB too quiet).
            if (id >= 0) {
                engReal->setSynchro(false);
                engReal->setPartProgram(0, id);
                engReal->noteOn(0, 60, 100);
                std::vector<float> out(22050 * 2);
                engReal->render(out.data(), 22050);
                engReal->noteOff(0, 60);
                float peak = 0;
                for (float x : out) peak = std::max(peak, std::fabs(x));
                std::printf("REAL LEVEL %s peak=%.3f\n", group, peak);
                expect(peak > 0.08f, "real_named_user_sound_is_loud_enough");  // old decoder: 0.006-0.075

                // Release follows the instrument: accordion stops almost at once,
                // strings ring on briefly. Effects off so only the dry release counts.
                const bool acco = std::strstr(group, "Acco") != nullptr;
                const bool strings = std::strstr(group, "Legato") != nullptr || std::strstr(group, "Fast Str") != nullptr;
                if (acco || strings) {
                    auto eng = std::make_unique<pa::Engine>();
                    eng->prepare(44100.0f);
                    eng->setSynchro(false);
                    for (int fx = 0; fx < 3; ++fx) eng->setFx(fx, 0.0f);
                    const int rid = eng->loadPa4xNamed(realSet, "sound", group, report, (int)sizeof(report));
                    eng->setPartProgram(0, rid);
                    eng->noteOn(0, 60, 100);
                    std::vector<float> held(22050 * 2);
                    eng->render(held.data(), 22050);
                    eng->noteOff(0, 60);
                    std::vector<float> after(4410 * 2);  // skip the first 100 ms of release
                    eng->render(after.data(), 4410);
                    eng->render(after.data(), 4410);  // measure 100-200 ms after key-up
                    auto rmsOf = [](const std::vector<float>& b, size_t from) {
                        double q = 0;
                        for (size_t i = from; i < b.size(); ++i) q += (double)b[i] * b[i];
                        return std::sqrt(q / std::max<size_t>(1, b.size() - from));
                    };
                    const double heldRms = rmsOf(held, held.size() / 2);
                    const double tailDb = 20.0 * std::log10(rmsOf(after, 0) / std::max(1e-9, heldRms));
                    std::printf("REAL RELEASE %s 100-200ms after key-up: %.1f dB\n", group, tailDb);
                    if (acco) expect(tailDb < -50.0, "real_accordion_stops_quickly");
                    if (strings) expect(tailDb > -40.0, "real_strings_ring_after_release");
                }
            }
        }
        // Neighbouring keys must play at similar levels. These sounds jumped 13-23 dB
        // between keys: samples decoded as deltas, zones not level-matched, and two
        // same-named multisamples merged onto alternate keys.
        for (const char* group : {"KApro Solo Cel", "KApro Legato O", "KApro Solo Str"}) {
            auto eng = std::make_unique<pa::Engine>();
            eng->prepare(48000.0f);
            eng->setSynchro(false);
            for (int fx = 0; fx < 3; ++fx) eng->setFx(fx, 0.0f);
            const int gid = eng->loadPa4xNamed(realSet, "sound", group, report, (int)sizeof(report));
            if (gid < 0) continue;
            eng->setPartProgram(0, gid);
            std::vector<float> buf(48000 * 2), tail(48000 * 2);
            double prevDb = 0, worst = 0;
            int worstKey = 0;
            for (int note = 36; note <= 96; ++note) {
                eng->noteOn(0, note, 100);
                eng->render(buf.data(), 48000);
                // How loud the note gets: loudest 100 ms in its first second (a slow
                // bow attack reaches the same level, just later).
                double loudest = 0;
                for (size_t w = 0; w + 9600 <= buf.size(); w += 9600) {
                    double q = 0;
                    for (size_t i = w; i < w + 9600; ++i) q += (double)buf[i] * buf[i];
                    loudest = std::max(loudest, q / 9600.0);
                }
                const double db = 10.0 * std::log10(loudest + 1e-12);
                if (note > 36 && std::fabs(db - prevDb) > worst) {
                    worst = std::fabs(db - prevDb);
                    worstKey = note;
                }
                prevDb = db;
                eng->noteOff(0, note);
                eng->render(tail.data(), 48000);
            }
            std::printf("REAL KEYS %s worst neighbour jump %.1f dB at key %d\n", group, worst, worstKey);
            expect(worst < 8.0, "real_neighbouring_keys_even");
        }
        // Low notes must be a clean, steady tone. Read as plain 8-bit samples (wrong:
        // the bytes are deltas) low notes repeated at only ~0.65 and sounded muffled.
        for (const char* group : {"KApro Alpen Acco", "KApro Legato O"}) {
            auto eng = std::make_unique<pa::Engine>();
            eng->prepare(48000.0f);
            eng->setSynchro(false);
            for (int fx = 0; fx < 3; ++fx) eng->setFx(fx, 0.0f);
            const int gid = eng->loadPa4xNamed(realSet, "sound", group, report, (int)sizeof(report));
            if (gid < 0) continue;
            eng->setPartProgram(0, gid);
            double sum = 0;
            int count = 0;
            std::vector<float> buf(48000 * 2), tail(48000 * 2);
            for (int note : {48, 50, 52, 53, 55, 57}) {
                eng->noteOn(0, note, 100);
                eng->render(buf.data(), 48000);  // 1 s; analyse 0.6-0.8 s (sustain)
                eng->noteOff(0, note);
                eng->render(tail.data(), 48000);
                // Search every period up to ~20 Hz: ensembles double the bass an octave
                // below, so the tone may repeat at twice the played note's period.
                const int from = 28800, len = 9600;
                double best = 0;
                for (int L = 20; L <= 2400; ++L) {
                    double xy = 0, xx = 0, yy = 0;
                    for (int i = from; i < from + len; ++i) {
                        const double a = buf[(size_t)i * 2], b = buf[(size_t)(i + L) * 2];
                        xy += a * b;
                        xx += a * a;
                        yy += b * b;
                    }
                    if (xx > 0 && yy > 0) best = std::max(best, xy / std::sqrt(xx * yy));
                }
                sum += best;
                count++;
            }
            const double clarity = count ? sum / count : 0;
            std::printf("REAL CLARITY %s low notes periodicity %.3f\n", group, clarity);
            expect(clarity > 0.85, "real_low_notes_clean");
        }
    } else {
        std::printf("SKIP real_named (SET not on disk)\n");
    }

    std::printf("%s\n", fails ? "FAILED" : "ALL PASSED");
    return fails ? 1 : 0;
}
