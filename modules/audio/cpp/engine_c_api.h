#pragma once

#include <stdint.h>

#ifdef __cplusplus
namespace pa {
class Engine;
}
pa::Engine* arrangerbox_live_engine();

extern "C" {
#endif

void* arrangerbox_engine_create(void);
void arrangerbox_engine_destroy(void* handle);
void arrangerbox_engine_prepare(void* handle, float sampleRate);
void arrangerbox_engine_render(void* handle, float* out, int frames);
void arrangerbox_engine_set_latency_ms(void* handle, float ms);

int arrangerbox_audio_start(void);
void arrangerbox_audio_stop(void);

void arrangerbox_note_on(int ch, int note, int vel);
void arrangerbox_note_off(int ch, int note);
void arrangerbox_cc(int ch, int ctl, int val);
void arrangerbox_pitch_bend(int ch, int lsb, int msb);
void arrangerbox_program_change(int ch, int program);
void arrangerbox_midi_clock(void);
void arrangerbox_midi_start(void);
void arrangerbox_midi_stop(void);
void arrangerbox_midi_continue(void);

void arrangerbox_set_part_program(int part, int inst);
void arrangerbox_set_part_enable(int part, int on);
void arrangerbox_set_split(int note);
void arrangerbox_set_tempo(float bpm);
void arrangerbox_set_mixer(int bus, float gain);
void arrangerbox_arranger_toggle(void);
void arrangerbox_arranger_start(void);
void arrangerbox_arranger_stop(void);
void arrangerbox_book_section(int section);
void arrangerbox_set_style(int id);
void arrangerbox_set_synchro(int on);
void arrangerbox_set_auto_fill(int on);
void arrangerbox_set_transpose(int semis);
void arrangerbox_set_octave(int oct);
void arrangerbox_set_fx(int which, float mix);

int arrangerbox_sound_count(void);
void arrangerbox_sound_name(int id, char* out, int maxLen);
void arrangerbox_sound_category(int id, char* out, int maxLen);
void arrangerbox_sound_source(int id, char* out, int maxLen);
int arrangerbox_style_count(void);
void arrangerbox_style_name(int id, char* out, int maxLen);
void arrangerbox_style_category(int id, char* out, int maxLen);
float arrangerbox_style_tempo(int id);
float arrangerbox_latency_ms(void);
int arrangerbox_chord_root(void);
int arrangerbox_chord_type(void);
int arrangerbox_section(void);
int arrangerbox_is_playing(void);
float arrangerbox_tempo(void);
uint32_t arrangerbox_midi_clock_count(void);

int arrangerbox_load_wav(const char* path, const char* name, const char* category);
int arrangerbox_load_ksf(const char* path, const char* name, const char* category);
int arrangerbox_scan_pcm_bank(const char* path);
int arrangerbox_load_pa4x_set(const char* folder, char* report, int reportLen);
int arrangerbox_load_sfz(const char* path, char* report, int reportLen);
int arrangerbox_load_abstyle(const char* path, char* report, int reportLen);

#ifdef __cplusplus
}
#endif
