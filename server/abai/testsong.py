"""Original test songs with known ground truth, rendered with GeneralUser GS via FluidSynth.

Used by the pipeline tests and as the app's demo songs. Every note here is written
for ArrangerBox; nothing is taken from a recording.
"""

from __future__ import annotations

import os
import random
import subprocess

import mido

SF2 = "/assets/GeneralUser-GS.sf2"
TPB = 480

KICK, SNARE, HAT, OPEN_HAT, CRASH, TOM_LO, TOM_MID = 36, 38, 42, 46, 49, 45, 47

CHORDS = {"C": [48, 52, 55], "Am": [45, 48, 52], "F": [41, 45, 48], "G": [43, 47, 50], "Dm": [50, 53, 57], "Em": [52, 55, 59]}


def _pattern(kind: str, meter: int) -> dict[int, list[tuple[int, int]]]:
    """step -> [(note, vel)] for one bar (4 steps per beat)."""
    steps = meter * 4
    p: dict[int, list[tuple[int, int]]] = {i: [] for i in range(steps)}

    def add(step, note, vel):
        p[step].append((note, vel))

    if meter == 4:
        if kind == "intro":
            for s in (0, 8):
                add(s, KICK, 100)
            add(12, SNARE, 80)
            for s in range(0, 16, 4):
                add(s, HAT, 70)
        elif kind == "A":
            for s in (0, 8, 10):
                add(s, KICK, 108)
            for s in (4, 12):
                add(s, SNARE, 105)
            for s in range(0, 16, 2):
                add(s, HAT, 88 if s % 4 == 0 else 64)
        elif kind == "B":
            for s in (0, 3, 6, 8, 11):
                add(s, KICK, 115)
            for s in (4, 12):
                add(s, SNARE, 118)
            for s in range(16):
                add(s, HAT, 95 if s % 4 == 0 else (75 if s % 2 == 0 else 55))
        elif kind == "fill":
            add(0, KICK, 110)
            add(4, SNARE, 105)
            for s in (0, 2, 4, 6):
                add(s, HAT, 80)
            add(8, KICK, 105)
            for s in (8, 9, 10, 11):
                add(s, SNARE, 90 + 5 * (s - 8))
            for s in (12, 13):
                add(s, TOM_MID, 110)
            for s in (14, 15):
                add(s, TOM_LO, 115)
        elif kind == "end":
            add(0, KICK, 120)
            add(0, CRASH, 120)
    else:  # 3/4 waltz
        if kind == "intro":
            add(0, KICK, 100)
            for s in (4, 8):
                add(s, HAT, 70)
        elif kind == "A":
            add(0, KICK, 108)
            for s in (4, 8):
                add(s, SNARE, 90)
            for s in range(0, 12, 2):
                add(s, HAT, 85 if s % 4 == 0 else 60)
        elif kind == "B":
            for s in (0, 6):
                add(s, KICK, 115)
            for s in (4, 8):
                add(s, SNARE, 112)
            for s in range(12):
                add(s, HAT, 92 if s % 4 == 0 else 58)
        elif kind == "fill":
            add(0, KICK, 110)
            for s in (4, 5, 6, 7):
                add(s, SNARE, 95)
            for s in (8, 9):
                add(s, TOM_MID, 110)
            for s in (10, 11):
                add(s, TOM_LO, 115)
        elif kind == "end":
            add(0, KICK, 120)
            add(0, CRASH, 120)
    return p


def _song_plan(kind: str):
    if kind == "waltz":
        meter, bpm = 3, 96.0
        plan = [("intro", 4, "intro", None), ("A", 8, "A", 7), ("B", 8, "B", 7), ("A", 8, "A", 7), ("B", 6, "B", None), ("end", 2, "B", None)]
        prog = ["C", "G", "Am", "F"]
    else:
        meter, bpm = 4, 112.0
        plan = [("intro", 4, "intro", None), ("A", 8, "A", 7), ("B", 8, "B", 7), ("A", 8, "A", 7), ("B", 8, "B", None), ("end", 2, "B", None)]
        prog = ["C", "Am", "F", "G"]
    return meter, bpm, plan, prog


def render(mid_path: str, wav_path: str) -> None:
    subprocess.run(["fluidsynth", "-ni", "-q", "-g", "0.5", "-r", "44100", "-F", wav_path, SF2, mid_path], check=True, capture_output=True)


def to_mp3(wav_path: str, mp3_path: str) -> None:
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", wav_path, "-b:a", "192k", mp3_path], check=True)


def make_groove_song(kind: str, outdir: str, seed: int = 1) -> dict:
    """A drums + bass + piano + strings song. Returns the ground truth."""
    rng = random.Random(seed)
    meter, bpm, plan, prog = _song_plan(kind)
    lead_in = 0.37
    beat_s = 60.0 / bpm
    mid = mido.MidiFile(ticks_per_beat=TPB)
    tracks = {name: mido.MidiTrack() for name in ("meta", "drums", "bass", "piano", "strings")}
    for t in tracks.values():
        mid.tracks.append(t)
    tracks["meta"].append(mido.MetaMessage("set_tempo", tempo=mido.bpm2tempo(bpm), time=0))
    tracks["meta"].append(mido.MetaMessage("time_signature", numerator=meter, denominator=4, time=0))
    tracks["bass"].append(mido.Message("program_change", channel=1, program=33, time=0))
    tracks["piano"].append(mido.Message("program_change", channel=2, program=0, time=0))
    tracks["strings"].append(mido.Message("program_change", channel=3, program=48, time=0))
    events: dict[str, list[tuple[float, mido.Message]]] = {k: [] for k in tracks if k != "meta"}

    def at(sec: float) -> float:
        return sec

    truth_hits = []
    downbeats = []
    sections = []
    fills = []
    bar = 0
    for label, nbars, groove, fill_at in plan:
        sections.append({"label": label, "bar0": bar, "bar1": bar + nbars})
        for k in range(nbars):
            t_bar = lead_in + bar * meter * beat_s
            downbeats.append(t_bar)
            if label == "end" and k == nbars - 1:
                pat_kind = "end"
            elif fill_at is not None and k == fill_at:
                pat_kind = "fill"
                fills.append(bar)
            else:
                pat_kind = groove
            pat = _pattern(pat_kind, meter)
            if label == "B" and k == 0:
                pat[0].append((CRASH, 115))
            for step, hits in pat.items():
                for note, vel in hits:
                    jitter = rng.uniform(-0.004, 0.004)
                    t = t_bar + step * beat_s / 4 + jitter
                    v = max(1, min(127, vel + rng.randint(-6, 6)))
                    events["drums"].append((t, mido.Message("note_on", channel=9, note=note, velocity=v)))
                    events["drums"].append((t + 0.08, mido.Message("note_off", channel=9, note=note, velocity=0)))
                    truth_hits.append((round(t, 4), note))
            chord = CHORDS[prog[bar % len(prog)]]
            final = label == "end" and k == nbars - 1
            # Bass: root in 8ths (once on the final bar).
            root = chord[0] - 12
            for e8 in range(1 if final else meter * 2):
                t = t_bar + e8 * beat_s / 2
                events["bass"].append((t, mido.Message("note_on", channel=1, note=root, velocity=95)))
                events["bass"].append((t + beat_s * (1.6 if final else 0.45), mido.Message("note_off", channel=1, note=root, velocity=0)))
            # Piano: chord stabs on each beat.
            for b in range(1 if final else meter):
                t = t_bar + b * beat_s
                for n in chord:
                    events["piano"].append((t, mido.Message("note_on", channel=2, note=n + 12, velocity=70)))
                    events["piano"].append((t + beat_s * 0.8, mido.Message("note_off", channel=2, note=n + 12, velocity=0)))
            if label == "B":
                for n in chord:
                    events["strings"].append((t_bar, mido.Message("note_on", channel=3, note=n + 12, velocity=60)))
                    events["strings"].append((t_bar + meter * beat_s - 0.02, mido.Message("note_off", channel=3, note=n + 12, velocity=0)))
            bar += 1
    _flush(tracks, events, bpm)
    base = os.path.join(outdir, f"test_{kind}")
    mid.save(base + ".mid")
    render(base + ".mid", base + ".wav")
    to_mp3(base + ".wav", base + ".mp3")
    return {
        "file": base + ".mp3",
        "bpm": bpm,
        "meter": meter,
        "lead_in": lead_in,
        "downbeats": downbeats,
        "sections": sections,
        "fills": fills,
        "hits": truth_hits,
        "bars": bar,
    }


def make_keys_song(outdir: str, seed: int = 2) -> dict:
    """Solo piano, then solo strings, then solo organ melodies over drums and bass."""
    rng = random.Random(seed)
    bpm, meter = 90.0, 4
    beat_s = 60.0 / bpm
    lead_in = 0.5
    mid = mido.MidiFile(ticks_per_beat=TPB)
    tracks = {name: mido.MidiTrack() for name in ("meta", "drums", "bass", "lead")}
    for t in tracks.values():
        mid.tracks.append(t)
    tracks["meta"].append(mido.MetaMessage("set_tempo", tempo=mido.bpm2tempo(bpm), time=0))
    tracks["bass"].append(mido.Message("program_change", channel=1, program=33, time=0))
    events: dict[str, list[tuple[float, mido.Message]]] = {k: [] for k in tracks if k != "meta"}
    parts = [
        ("Piano", 0, [48, 52, 55, 60, 62, 64, 67, 69, 72, 76, 79, 84], 2.0, 0.7),
        ("Strings", 48, [55, 60, 62, 64, 67, 69, 72, 74, 76, 79], 4.0, 1.0),
        ("Organ", 16, [48, 53, 57, 60, 65, 67, 69, 72, 77], 4.0, 1.0),
    ]
    sections = []
    t = lead_in
    bar = 0
    for fam, program, pitches, note_beats, legato in parts:
        events["lead"].append((t - 0.01, mido.Message("program_change", channel=2, program=program)))
        t0 = t
        played = []
        order = pitches * 2
        rng.shuffle(order)
        nbars = int(len(order) * note_beats / meter + 0.999)
        for i, p in enumerate(order):
            on = t + i * note_beats * beat_s
            off = on + note_beats * beat_s * legato - (0.25 if legato >= 1.0 else 0.0)
            events["lead"].append((on, mido.Message("note_on", channel=2, note=p, velocity=92)))
            events["lead"].append((off, mido.Message("note_off", channel=2, note=p, velocity=0)))
            played.append(p)
        for k in range(nbars):
            tb = t + k * meter * beat_s
            for s in range(0, 16, 2):
                note = KICK if s in (0, 8) else (SNARE if s in (4, 12) else HAT)
                ts = tb + s * beat_s / 4
                events["drums"].append((ts, mido.Message("note_on", channel=9, note=note, velocity=70 if note == HAT else 85)))
                events["drums"].append((ts + 0.05, mido.Message("note_off", channel=9, note=note, velocity=0)))
            events["bass"].append((tb, mido.Message("note_on", channel=1, note=36, velocity=80)))
            events["bass"].append((tb + meter * beat_s * 0.9, mido.Message("note_off", channel=1, note=36, velocity=0)))
        t += nbars * meter * beat_s
        sections.append({"family": fam, "start": round(t0, 2), "end": round(t, 2), "pitches": sorted(set(played))})
        bar += nbars
    _flush(tracks, events, bpm)
    base = os.path.join(outdir, "test_keys")
    mid.save(base + ".mid")
    render(base + ".mid", base + ".wav")
    to_mp3(base + ".wav", base + ".mp3")
    return {"file": base + ".mp3", "bpm": bpm, "sections": sections}


def _flush(tracks, events, bpm: float) -> None:
    sec_per_tick = 60.0 / bpm / TPB
    for name, evs in events.items():
        evs.sort(key=lambda e: (e[0], 0 if e[1].type == "note_off" else 1))
        last = 0
        for sec, msg in evs:
            tick = max(last, int(round(sec / sec_per_tick)))
            tracks[name].append(msg.copy(time=tick - last))
            last = tick
