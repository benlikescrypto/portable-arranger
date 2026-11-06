#include "Engine.h"

#include <cstring>

namespace pa {

static void setName(char* dst, size_t n, const char* s) {
    std::memset(dst, 0, n);
    std::strncpy(dst, s, n - 1);
}

static Patch mk(const char* name, const char* cat, Model model, int bus, float a, float d, float s, float r,
                float cut, float res, float fenv, float bright, float cho, float rev, float vibD = 0.0f,
                float vibR = 5.2f) {
    Patch p;
    setName(p.name, sizeof(p.name), name);
    setName(p.category, sizeof(p.category), cat);
    p.model = model;
    p.bus = bus;
    p.attack = a;
    p.decay = d;
    p.sustain = s;
    p.release = r;
    p.cutoff = cut;
    p.reso = res;
    p.filtEnv = fenv;
    p.brightness = bright;
    p.chorus = cho;
    p.reverb = rev;
    p.vibDepth = vibD;
    p.vibRate = vibR;
    p.vibDelay = 0.32f;
    return p;
}

void buildFactory(std::vector<Patch>& patches, std::vector<std::string>&, std::vector<std::string>&,
                  std::vector<float>&) {
    patches.clear();
    patches.reserve(40);
    patches.push_back(mk("Concert Grand", "Piano", Model::Piano, BusKeyboard, 0.8f, 1800, 0.62f, 420, 9200, 0.08f, 0.18f, 0.62f, 0.08f, 0.24f));
    patches.push_back(mk("Bright Grand", "Piano", Model::BrightPiano, BusKeyboard, 0.6f, 1400, 0.55f, 360, 11000, 0.1f, 0.28f, 0.82f, 0.06f, 0.18f));
    patches.push_back(mk("Pop Piano", "Piano", Model::BrightPiano, BusKeyboard, 0.5f, 900, 0.5f, 280, 9800, 0.12f, 0.3f, 0.75f, 0.12f, 0.16f));
    patches.push_back(mk("Soft Piano", "Piano", Model::SoftPiano, BusKeyboard, 2.5f, 2200, 0.7f, 560, 6200, 0.06f, 0.12f, 0.4f, 0.1f, 0.3f));
    patches.push_back(mk("Electric Piano", "Electric", Model::Rhodes, BusKeyboard, 1.2f, 1200, 0.55f, 380, 5400, 0.18f, 0.22f, 0.55f, 0.28f, 0.26f, 0.012f, 4.6f));
    patches.push_back(mk("Wurly", "Electric", Model::Wurly, BusKeyboard, 1.0f, 800, 0.48f, 260, 4200, 0.22f, 0.35f, 0.6f, 0.2f, 0.18f));
    patches.push_back(mk("Clav", "Electric", Model::Clav, BusKeyboard, 0.4f, 280, 0.25f, 120, 3800, 0.28f, 0.45f, 0.7f, 0.08f, 0.1f));
    patches.push_back(mk("Israeli Violin", "Oriental", Model::Violin, BusKeyboard, 28.0f, 400, 0.82f, 240, 5200, 0.22f, 0.18f, 0.7f, 0.18f, 0.32f, 0.018f, 5.6f));
    patches.push_back(mk("Solo Violin", "Strings", Model::Violin, BusKeyboard, 32.0f, 500, 0.8f, 280, 4800, 0.2f, 0.16f, 0.62f, 0.16f, 0.3f, 0.016f, 5.4f));
    patches.push_back(mk("Oriental Strings", "Oriental", Model::OrientalStrings, BusKeyboard, 80.0f, 900, 0.88f, 520, 4600, 0.12f, 0.1f, 0.5f, 0.32f, 0.42f, 0.008f, 4.8f));
    patches.push_back(mk("Concert Strings", "Strings", Model::ConcertStrings, BusKeyboard, 90.0f, 1100, 0.9f, 640, 5000, 0.1f, 0.08f, 0.48f, 0.28f, 0.4f, 0.006f, 4.4f));
    patches.push_back(mk("Warm Pad", "Synth", Model::WarmPad, BusPad, 180.0f, 800, 0.92f, 900, 3200, 0.08f, 0.12f, 0.4f, 0.4f, 0.45f));
    patches.push_back(mk("Atmosphere", "Synth", Model::Atmosphere, BusPad, 260.0f, 1200, 0.9f, 1100, 2800, 0.1f, 0.08f, 0.35f, 0.35f, 0.5f));
    patches.push_back(mk("Oud", "Oriental", Model::Oud, BusKeyboard, 0.6f, 420, 0.0f, 260, 3600, 0.18f, 0.4f, 0.58f, 0.08f, 0.2f));
    patches.push_back(mk("Ney", "Oriental", Model::Ney, BusKeyboard, 40.0f, 500, 0.75f, 220, 2800, 0.16f, 0.2f, 0.55f, 0.1f, 0.28f, 0.02f, 5.1f));
    patches.push_back(mk("Kanun", "Oriental", Model::Kanun, BusKeyboard, 0.5f, 700, 0.15f, 320, 5400, 0.12f, 0.25f, 0.7f, 0.22f, 0.3f));
    patches.push_back(mk("Accordion", "Oriental", Model::Accordion, BusKeyboard, 8.0f, 200, 0.9f, 80, 4200, 0.14f, 0.1f, 0.6f, 0.35f, 0.16f));
    patches.push_back(mk("Mizrahi Sax", "Oriental", Model::Sax, BusKeyboard, 12.0f, 360, 0.78f, 180, 2600, 0.32f, 0.4f, 0.72f, 0.12f, 0.22f, 0.014f, 5.0f));
    patches.push_back(mk("Trumpet", "Brass", Model::Trumpet, BusKeyboard, 10.0f, 280, 0.8f, 140, 3800, 0.22f, 0.45f, 0.75f, 0.1f, 0.18f));
    patches.push_back(mk("Brass Section", "Brass", Model::Brass, BusKeyboard, 18.0f, 400, 0.85f, 200, 3400, 0.18f, 0.35f, 0.65f, 0.22f, 0.2f));
    patches.push_back(mk("Tenor Sax", "Woodwind", Model::Sax, BusKeyboard, 14.0f, 420, 0.8f, 200, 2400, 0.3f, 0.38f, 0.68f, 0.12f, 0.24f, 0.012f, 4.8f));
    patches.push_back(mk("Acoustic Bass", "Bass", Model::AcousticBass, BusBass, 1.2f, 260, 0.35f, 140, 900, 0.22f, 0.5f, 0.4f, 0.0f, 0.08f));
    patches.push_back(mk("Finger Bass", "Bass", Model::FingerBass, BusBass, 1.0f, 220, 0.4f, 120, 1100, 0.2f, 0.45f, 0.48f, 0.0f, 0.06f));
    patches.push_back(mk("Synth Bass", "Bass", Model::SynthBass, BusBass, 0.8f, 180, 0.3f, 90, 700, 0.42f, 0.7f, 0.55f, 0.05f, 0.05f));
    patches.push_back(mk("Jazz Organ", "Organ", Model::JazzOrgan, BusKeyboard, 2.0f, 80, 1.0f, 40, 5200, 0.08f, 0.05f, 0.55f, 0.25f, 0.12f));
    patches.push_back(mk("Rock Organ", "Organ", Model::RockOrgan, BusKeyboard, 1.5f, 60, 1.0f, 35, 6800, 0.1f, 0.08f, 0.7f, 0.3f, 0.1f));
    patches.push_back(mk("Square Lead", "Synth", Model::SquareLead, BusKeyboard, 4.0f, 300, 0.7f, 160, 4200, 0.2f, 0.3f, 0.7f, 0.15f, 0.18f, 0.01f, 5.5f));
    patches.push_back(mk("Saw Lead", "Synth", Model::SawLead, BusKeyboard, 6.0f, 340, 0.72f, 180, 4800, 0.18f, 0.28f, 0.75f, 0.18f, 0.2f, 0.012f, 5.3f));
    patches.push_back(mk("Nylon Guitar", "Guitar", Model::NylonGuitar, BusKeyboard, 0.8f, 700, 0.0f, 320, 4200, 0.12f, 0.3f, 0.55f, 0.1f, 0.22f));
    patches.push_back(mk("Bouzouki", "Oriental", Model::Bouzouki, BusKeyboard, 0.6f, 550, 0.05f, 280, 5000, 0.14f, 0.32f, 0.68f, 0.16f, 0.24f));
    patches.push_back(mk("Duduk", "Oriental", Model::Duduk, BusKeyboard, 50.0f, 600, 0.8f, 260, 2200, 0.2f, 0.18f, 0.5f, 0.12f, 0.34f, 0.022f, 4.7f));
    patches.push_back(mk("Standard Kit", "Percussion", Model::KitStandard, BusDrums, 0.4f, 80, 0.0f, 80, 8000, 0.1f, 0.0f, 0.7f, 0.0f, 0.08f));
    patches.push_back(mk("Arabic Kit", "Percussion", Model::KitArabic, BusDrums, 0.4f, 80, 0.0f, 80, 8000, 0.1f, 0.0f, 0.7f, 0.0f, 0.1f));
    patches.push_back(mk("Dance Kit", "Percussion", Model::KitDance, BusDrums, 0.3f, 70, 0.0f, 70, 9000, 0.1f, 0.0f, 0.8f, 0.0f, 0.06f));
}

}  // namespace pa
