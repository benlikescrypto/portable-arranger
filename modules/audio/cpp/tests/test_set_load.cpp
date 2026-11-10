#include "../Engine.h"

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
    for (int i = 0; i < n; ++i) o.push_back((uint8_t)(s[i] ? s[i] : ' '));
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

    std::printf("%s\n", fails ? "FAILED" : "ALL PASSED");
    return fails ? 1 : 0;
}
