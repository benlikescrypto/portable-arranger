#include "Engine.h"

#include <cstring>

namespace pa {

static void setName(char* dst, size_t n, const char* s) {
    std::memset(dst, 0, n);
    std::strncpy(dst, s, n - 1);
}

static Patch mk(const char* name, const char* cat, Model model, int bus, float a, float d, float s, float r,
                float cut, float res, float fenv, float bright, float cho, float rev, float vibD = 0.0f,
                float vibR = 5.2f, float delay = 0.0f) {
    Patch p;
    setName(p.name, sizeof(p.name), name);
    setName(p.category, sizeof(p.category), cat);
    p.model = model;
    p.bus = bus;
    p.source = PatchSource::Factory;
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
    p.delay = delay;
    p.vibDepth = vibD;
    p.vibRate = vibR;
    p.vibDelay = 0.32f;
    return p;
}

void buildFactory(std::vector<Patch>& patches, std::vector<std::string>&, std::vector<std::string>&,
                  std::vector<float>&) {
    patches.clear();
    patches.reserve(160);
    // Keep the original 34 IDs stable for existing UI/part defaults.
    patches.push_back(mk("Concert Grand", "Piano", Model::Piano, BusKeyboard, 1.2f, 2600, 0.42f, 480, 16000, 0.04f, 0.08f, 0.78f, 0.04f, 0.14f));
    patches.push_back(mk("Bright Grand", "Piano", Model::BrightPiano, BusKeyboard, 0.8f, 1800, 0.38f, 360, 18000, 0.05f, 0.12f, 0.9f, 0.03f, 0.1f));
    patches.push_back(mk("Pop Piano", "Piano", Model::BrightPiano, BusKeyboard, 0.7f, 1200, 0.4f, 280, 17000, 0.06f, 0.14f, 0.85f, 0.06f, 0.1f));
    patches.push_back(mk("Soft Piano", "Piano", Model::SoftPiano, BusKeyboard, 3.0f, 3200, 0.5f, 620, 12000, 0.04f, 0.06f, 0.55f, 0.05f, 0.18f));
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

    // Expanded factory ROM — modeled instruments, unique voicings.
    patches.push_back(mk("Studio Grand", "Piano", Model::Piano, BusKeyboard, 1.1f, 2200, 0.4f, 400, 15000, 0.05f, 0.1f, 0.74f, 0.05f, 0.12f));
    patches.push_back(mk("Upright Piano", "Piano", Model::UprightPiano, BusKeyboard, 1.6f, 1400, 0.32f, 260, 11000, 0.06f, 0.1f, 0.62f, 0.04f, 0.12f));
    patches.push_back(mk("Honky Piano", "Piano", Model::UprightPiano, BusKeyboard, 0.7f, 900, 0.35f, 180, 4800, 0.18f, 0.3f, 0.7f, 0.22f, 0.12f, 0.008f, 3.8f));
    patches.push_back(mk("Digital Piano", "Piano", Model::DigitalPiano, BusKeyboard, 0.9f, 1400, 0.6f, 300, 7800, 0.08f, 0.14f, 0.66f, 0.18f, 0.2f));
    patches.push_back(mk("Stage EP", "Electric", Model::Rhodes, BusKeyboard, 1.6f, 1500, 0.62f, 420, 4800, 0.16f, 0.18f, 0.5f, 0.38f, 0.28f, 0.01f, 4.2f));
    patches.push_back(mk("Suitcase EP", "Electric", Model::Rhodes, BusKeyboard, 2.0f, 1800, 0.7f, 520, 3600, 0.2f, 0.12f, 0.42f, 0.42f, 0.32f, 0.014f, 4.0f));
    patches.push_back(mk("Reed EP", "Electric", Model::Wurly, BusKeyboard, 0.8f, 700, 0.4f, 220, 3900, 0.24f, 0.4f, 0.64f, 0.18f, 0.16f));
    patches.push_back(mk("Phaser Clav", "Electric", Model::Clav, BusKeyboard, 0.35f, 220, 0.18f, 90, 3200, 0.34f, 0.5f, 0.78f, 0.28f, 0.08f));
    patches.push_back(mk("Harpsichord", "Electric", Model::Harpsichord, BusKeyboard, 0.3f, 520, 0.0f, 180, 6200, 0.1f, 0.2f, 0.72f, 0.12f, 0.18f));

    patches.push_back(mk("Church Organ", "Organ", Model::ChurchOrgan, BusKeyboard, 18.0f, 120, 1.0f, 90, 4600, 0.06f, 0.04f, 0.45f, 0.08f, 0.38f));
    patches.push_back(mk("Pipe Organ", "Organ", Model::PipeOrgan, BusKeyboard, 22.0f, 150, 1.0f, 110, 4200, 0.05f, 0.03f, 0.4f, 0.05f, 0.46f));
    patches.push_back(mk("Drawbar Organ", "Organ", Model::DrawbarOrgan, BusKeyboard, 2.2f, 70, 1.0f, 30, 6000, 0.09f, 0.06f, 0.62f, 0.32f, 0.14f));
    patches.push_back(mk("Gospel Organ", "Organ", Model::RockOrgan, BusKeyboard, 1.8f, 50, 1.0f, 28, 7200, 0.12f, 0.1f, 0.75f, 0.36f, 0.12f));
    patches.push_back(mk("Theatre Organ", "Organ", Model::ChurchOrgan, BusKeyboard, 12.0f, 90, 1.0f, 60, 5400, 0.08f, 0.08f, 0.58f, 0.2f, 0.3f));

    patches.push_back(mk("Solo Cello", "Strings", Model::SoloCello, BusKeyboard, 40.0f, 600, 0.84f, 320, 3200, 0.18f, 0.14f, 0.5f, 0.14f, 0.34f, 0.02f, 5.0f));
    patches.push_back(mk("Chamber Strings", "Strings", Model::ConcertStrings, BusKeyboard, 70.0f, 900, 0.88f, 500, 4400, 0.11f, 0.1f, 0.46f, 0.24f, 0.38f));
    patches.push_back(mk("Symphonic Strings", "Strings", Model::ConcertStrings, BusPad, 110.0f, 1300, 0.92f, 720, 3800, 0.08f, 0.06f, 0.42f, 0.3f, 0.48f));
    patches.push_back(mk("Cinematic Strings", "Strings", Model::CinematicStrings, BusPad, 160.0f, 1400, 0.94f, 900, 3000, 0.07f, 0.05f, 0.38f, 0.22f, 0.55f));
    patches.push_back(mk("Pizzicato Strings", "Strings", Model::Pizzicato, BusKeyboard, 0.5f, 280, 0.0f, 220, 4800, 0.14f, 0.25f, 0.6f, 0.08f, 0.2f));
    patches.push_back(mk("Octave Strings", "Strings", Model::OrientalStrings, BusKeyboard, 95.0f, 1000, 0.9f, 580, 4100, 0.1f, 0.08f, 0.44f, 0.26f, 0.4f));

    patches.push_back(mk("Muted Trumpet", "Brass", Model::Trumpet, BusKeyboard, 12.0f, 240, 0.7f, 120, 2600, 0.28f, 0.4f, 0.55f, 0.08f, 0.14f));
    patches.push_back(mk("Trombone", "Brass", Model::Trombone, BusKeyboard, 16.0f, 360, 0.82f, 180, 2400, 0.2f, 0.32f, 0.5f, 0.1f, 0.2f));
    patches.push_back(mk("French Horn", "Brass", Model::FrenchHorn, BusKeyboard, 28.0f, 500, 0.86f, 260, 2200, 0.14f, 0.18f, 0.42f, 0.12f, 0.28f));
    patches.push_back(mk("Tuba", "Brass", Model::Tuba, BusBass, 20.0f, 400, 0.8f, 200, 900, 0.16f, 0.28f, 0.35f, 0.04f, 0.16f));
    patches.push_back(mk("Pop Brass", "Brass", Model::Brass, BusKeyboard, 14.0f, 320, 0.8f, 160, 4000, 0.2f, 0.38f, 0.7f, 0.18f, 0.16f));
    patches.push_back(mk("Synth Brass", "Brass", Model::SynthBrass, BusKeyboard, 10.0f, 280, 0.78f, 140, 3600, 0.22f, 0.4f, 0.68f, 0.28f, 0.14f));

    patches.push_back(mk("Concert Flute", "Woodwind", Model::Flute, BusKeyboard, 18.0f, 360, 0.78f, 160, 3200, 0.12f, 0.16f, 0.55f, 0.08f, 0.26f, 0.018f, 5.2f));
    patches.push_back(mk("Piccolo", "Woodwind", Model::Piccolo, BusKeyboard, 12.0f, 280, 0.72f, 120, 5400, 0.1f, 0.14f, 0.7f, 0.06f, 0.22f, 0.02f, 5.8f));
    patches.push_back(mk("Clarinet", "Woodwind", Model::Clarinet, BusKeyboard, 16.0f, 400, 0.8f, 180, 2800, 0.18f, 0.22f, 0.5f, 0.1f, 0.2f));
    patches.push_back(mk("Oboe", "Woodwind", Model::Oboe, BusKeyboard, 20.0f, 380, 0.8f, 170, 2600, 0.22f, 0.28f, 0.58f, 0.1f, 0.24f, 0.016f, 4.9f));
    patches.push_back(mk("Bassoon", "Woodwind", Model::Bassoon, BusKeyboard, 22.0f, 420, 0.82f, 200, 1600, 0.16f, 0.2f, 0.4f, 0.08f, 0.22f));
    patches.push_back(mk("Alto Sax", "Woodwind", Model::Sax, BusKeyboard, 13.0f, 380, 0.8f, 190, 2800, 0.28f, 0.36f, 0.66f, 0.14f, 0.22f, 0.012f, 5.1f));
    patches.push_back(mk("Soprano Sax", "Woodwind", Model::Sax, BusKeyboard, 11.0f, 340, 0.76f, 160, 3400, 0.26f, 0.34f, 0.72f, 0.12f, 0.2f, 0.015f, 5.4f));
    patches.push_back(mk("Klezmer Clarinet", "Woodwind", Model::Clarinet, BusKeyboard, 10.0f, 300, 0.74f, 140, 3000, 0.24f, 0.32f, 0.62f, 0.16f, 0.18f, 0.02f, 5.6f));

    patches.push_back(mk("Steel Guitar", "Guitar", Model::SteelGuitar, BusKeyboard, 0.7f, 650, 0.0f, 280, 5000, 0.14f, 0.32f, 0.62f, 0.12f, 0.2f));
    patches.push_back(mk("Folk Guitar", "Guitar", Model::SteelGuitar, BusKeyboard, 0.9f, 800, 0.05f, 340, 4400, 0.1f, 0.24f, 0.52f, 0.16f, 0.24f));
    patches.push_back(mk("Clean Electric", "Guitar", Model::CleanGuitar, BusKeyboard, 1.0f, 500, 0.12f, 220, 3800, 0.16f, 0.28f, 0.58f, 0.32f, 0.16f));
    patches.push_back(mk("Jazz Guitar", "Guitar", Model::CleanGuitar, BusKeyboard, 1.4f, 700, 0.2f, 280, 2800, 0.12f, 0.2f, 0.45f, 0.28f, 0.18f));
    patches.push_back(mk("Muted Guitar", "Guitar", Model::MuteGuitar, BusKeyboard, 0.4f, 160, 0.0f, 90, 2600, 0.22f, 0.4f, 0.5f, 0.06f, 0.08f));
    patches.push_back(mk("Overdrive Guitar", "Guitar", Model::DistGuitar, BusKeyboard, 0.6f, 420, 0.15f, 180, 3200, 0.2f, 0.35f, 0.7f, 0.08f, 0.12f));
    patches.push_back(mk("Distorted Guitar", "Guitar", Model::DistGuitar, BusKeyboard, 0.5f, 360, 0.1f, 150, 2800, 0.28f, 0.45f, 0.8f, 0.05f, 0.1f));

    patches.push_back(mk("Upright Bass", "Bass", Model::UprightBass, BusBass, 1.4f, 300, 0.28f, 160, 800, 0.2f, 0.48f, 0.36f, 0.0f, 0.1f));
    patches.push_back(mk("Picked Bass", "Bass", Model::PickedBass, BusBass, 0.7f, 180, 0.32f, 100, 1400, 0.24f, 0.5f, 0.55f, 0.0f, 0.06f));
    patches.push_back(mk("Fretless Bass", "Bass", Model::FingerBass, BusBass, 1.6f, 280, 0.5f, 180, 1000, 0.16f, 0.3f, 0.4f, 0.08f, 0.12f, 0.01f, 4.4f));
    patches.push_back(mk("Slap Bass", "Bass", Model::PickedBass, BusBass, 0.4f, 140, 0.18f, 80, 1800, 0.3f, 0.6f, 0.65f, 0.0f, 0.05f));
    patches.push_back(mk("Sub Bass", "Bass", Model::SynthBass, BusBass, 1.2f, 220, 0.4f, 110, 420, 0.38f, 0.65f, 0.4f, 0.0f, 0.04f));
    patches.push_back(mk("Acid Bass", "Bass", Model::SynthBass, BusBass, 0.5f, 120, 0.22f, 70, 900, 0.5f, 0.85f, 0.7f, 0.04f, 0.04f));

    patches.push_back(mk("Saz", "Oriental", Model::Saz, BusKeyboard, 0.55f, 480, 0.04f, 240, 4600, 0.16f, 0.34f, 0.66f, 0.14f, 0.22f));
    patches.push_back(mk("Qanun", "Oriental", Model::Kanun, BusKeyboard, 0.45f, 640, 0.12f, 300, 5800, 0.11f, 0.22f, 0.74f, 0.24f, 0.28f));
    patches.push_back(mk("Greek Bouzouki", "Oriental", Model::Bouzouki, BusKeyboard, 0.5f, 500, 0.04f, 250, 5200, 0.13f, 0.3f, 0.7f, 0.18f, 0.22f));
    patches.push_back(mk("Bandoneon", "Oriental", Model::Accordion, BusKeyboard, 9.0f, 180, 0.88f, 70, 3600, 0.16f, 0.12f, 0.52f, 0.3f, 0.2f));
    patches.push_back(mk("Musette Accordion", "Oriental", Model::Accordion, BusKeyboard, 7.0f, 160, 0.92f, 60, 4800, 0.12f, 0.08f, 0.64f, 0.4f, 0.14f));
    patches.push_back(mk("Desert Ney", "Oriental", Model::Ney, BusKeyboard, 48.0f, 560, 0.78f, 240, 2400, 0.18f, 0.22f, 0.5f, 0.1f, 0.32f, 0.024f, 4.8f));

    patches.push_back(mk("Analog Lead", "Synth", Model::AnalogLead, BusKeyboard, 5.0f, 280, 0.68f, 150, 3600, 0.22f, 0.32f, 0.72f, 0.16f, 0.16f, 0.014f, 5.6f));
    patches.push_back(mk("Digital Lead", "Synth", Model::DigitalLead, BusKeyboard, 3.0f, 220, 0.6f, 120, 5200, 0.16f, 0.26f, 0.78f, 0.12f, 0.14f, 0.01f, 6.0f));
    patches.push_back(mk("Soft Pad", "Synth", Model::WarmPad, BusPad, 220.0f, 900, 0.94f, 1000, 2600, 0.06f, 0.08f, 0.36f, 0.45f, 0.5f));
    patches.push_back(mk("Choir Pad", "Synth", Model::Choir, BusPad, 200.0f, 800, 0.92f, 860, 2400, 0.08f, 0.1f, 0.4f, 0.28f, 0.48f));
    patches.push_back(mk("Synth Strings", "Synth", Model::CinematicStrings, BusPad, 140.0f, 1000, 0.9f, 700, 3400, 0.1f, 0.12f, 0.5f, 0.34f, 0.4f));
    patches.push_back(mk("Poly Synth", "Synth", Model::SawLead, BusKeyboard, 12.0f, 400, 0.75f, 220, 4000, 0.14f, 0.2f, 0.62f, 0.3f, 0.22f));
    patches.push_back(mk("Pluck Synth", "Synth", Model::Pluck, BusKeyboard, 0.6f, 240, 0.05f, 180, 4200, 0.2f, 0.4f, 0.7f, 0.22f, 0.16f, 0.0f, 5.0f, 0.12f));
    patches.push_back(mk("Arp Pluck", "Synth", Model::Pluck, BusKeyboard, 0.4f, 180, 0.0f, 120, 5000, 0.18f, 0.35f, 0.75f, 0.18f, 0.12f, 0.0f, 5.0f, 0.2f));
    patches.push_back(mk("Pulse Lead", "Synth", Model::SquareLead, BusKeyboard, 4.5f, 260, 0.66f, 140, 3800, 0.24f, 0.34f, 0.68f, 0.12f, 0.16f));
    patches.push_back(mk("Dark Texture", "Synth", Model::Atmosphere, BusPad, 300.0f, 1400, 0.9f, 1200, 1800, 0.12f, 0.08f, 0.3f, 0.2f, 0.55f));

    patches.push_back(mk("Concert Choir", "Choir", Model::Choir, BusPad, 90.0f, 700, 0.88f, 500, 2800, 0.1f, 0.1f, 0.48f, 0.16f, 0.42f));
    patches.push_back(mk("Ahhs", "Choir", Model::Choir, BusPad, 120.0f, 800, 0.9f, 640, 2600, 0.08f, 0.08f, 0.42f, 0.2f, 0.46f));
    patches.push_back(mk("Concert Harp", "Mallets", Model::Harp, BusKeyboard, 0.5f, 900, 0.0f, 420, 5200, 0.08f, 0.16f, 0.62f, 0.12f, 0.3f));
    patches.push_back(mk("Vibraphone", "Mallets", Model::Vibraphone, BusKeyboard, 1.2f, 1100, 0.35f, 480, 4600, 0.12f, 0.18f, 0.7f, 0.35f, 0.28f, 0.02f, 5.8f));
    patches.push_back(mk("Marimba", "Mallets", Model::Marimba, BusKeyboard, 0.6f, 360, 0.0f, 220, 3800, 0.14f, 0.22f, 0.6f, 0.08f, 0.16f));
    patches.push_back(mk("Xylophone", "Mallets", Model::Xylophone, BusKeyboard, 0.4f, 220, 0.0f, 140, 6200, 0.1f, 0.18f, 0.75f, 0.06f, 0.14f));
    patches.push_back(mk("Glockenspiel", "Mallets", Model::Bells, BusKeyboard, 0.3f, 800, 0.15f, 500, 7800, 0.08f, 0.12f, 0.8f, 0.1f, 0.26f));
    patches.push_back(mk("Tubular Bells", "Mallets", Model::Bells, BusKeyboard, 1.0f, 1800, 0.4f, 900, 4200, 0.1f, 0.14f, 0.55f, 0.12f, 0.4f));
    patches.push_back(mk("Timpani", "Percussion", Model::Timpani, BusDrums, 0.8f, 700, 0.0f, 400, 800, 0.18f, 0.3f, 0.4f, 0.0f, 0.22f));

    patches.push_back(mk("Latin Kit", "Percussion", Model::KitLatin, BusDrums, 0.35f, 70, 0.0f, 70, 8500, 0.1f, 0.0f, 0.72f, 0.0f, 0.1f));
    patches.push_back(mk("World Kit", "Percussion", Model::KitWorld, BusDrums, 0.35f, 75, 0.0f, 75, 7800, 0.1f, 0.0f, 0.68f, 0.0f, 0.12f));
    patches.push_back(mk("Orchestral Perc", "Percussion", Model::KitOrchestral, BusDrums, 0.4f, 90, 0.0f, 90, 7000, 0.08f, 0.0f, 0.6f, 0.0f, 0.18f));
    patches.push_back(mk("SFX Sweep", "FX", Model::Atmosphere, BusPad, 80.0f, 400, 0.5f, 600, 2000, 0.2f, 0.4f, 0.5f, 0.1f, 0.3f, 0.0f, 0.4f, 0.25f));
    patches.push_back(mk("Noise Hit", "FX", Model::Atmosphere, BusKeyboard, 0.4f, 80, 0.0f, 120, 6000, 0.1f, 0.0f, 0.8f, 0.0f, 0.1f));
}

}  // namespace pa
