# ArrangerBox style format (`.abstyle`)

Factory styles and user styles use the same `Arranger::Style` object in C++. `.abstyle` is the documented on-disk form.

```
ABSTYLE1
name=8 Beat Pop
category=Pop
tempo=112
section=var1
length=1536
0,0,36,110,24,abs
96,1,0,100,48,bass
48,2,0,80,24,comp
section=fill1
length=384
0,0,47,100,16,abs
```

## Header

- `ABSTYLE1` — required first line
- `name=` — display name
- `category=` — Pop, Rock, Ballad, Dance, …
- `tempo=` — default BPM

Time signature is implied by `length` in PPQ ticks (`kPpq = 96`). 4/4 bar = 384 ticks. 3/4 bar = 288 ticks. 9/8 example: `length` of `(96*9)/2`.

## Sections

`intro1` `intro2` `intro3` `var1` `var2` `var3` `var4` (`main_a`…`main_d` aliases) `fill1`…`fill4` `break` `end1` `end2` `end3`

## Events

`tick,track,note,velocity,duration,flags`

Flags:

- `abs` — absolute GM drum note (not transposed)
- `bass` — `note` is a chord degree (0 root, 1 third, 2 fifth, 3 seventh, 7 fifth, 10 sixth), transposed from the recognized chord
- `comp` — accompaniment voicing index 0–3
- `trans` — imported SMF note, shifted by chord root

Tracks 0 drums, 1 bass, 2–4 accompaniment. The engine assigns actual factory or imported instrument IDs when the style is loaded.

## Runtime behaviour

- Chord recognition from notes at or below the split point
- Variation change can insert the matching fill when Auto Fill is on
- Intros and fills return to the booked or current variation
- Endings stop the arranger
- Sync Start starts on the first left-hand chord

Factory `.abstyle` content is original ArrangerBox arrangements.

## PA4X interchange (this is what ArrangerBox is built for)

Import a **Pa4X SET folder** (`NAME.SET` with `STYLE` / `SOUND` / `PCM`) when you have samples. Import **Style Record SMF** when you want the arrangement.

Korg’s documented, playable style format is a **Standard MIDI File separated by markers** (Pa4X User Manual, Style Record > Import/Export SMF). ArrangerBox is a PA4X SET/SMF reader. That SMF is the path Korg published; native `.STY` bytes are not.

### MIDI channels (Korg’s table, 1-based)

| Style track | MIDI channel |
| --- | --- |
| Bass | 9 |
| Drum | 10 |
| Percussion | 11 |
| Acc 1–5 | 12–16 |

Other channels are ignored. Sounds are Program Change + Bank Select at tick 0 of each Chord Variation.

### Markers (`EnCVn`, lowercase only)

Examples: `v1cv1` Variation 1 Chord Variation 1, `i1cv2` Intro 1 CV2, `f4cv1` Fill 4 CV1, `e1cv1` Ending 1 CV1. CV1 is the C-major take; CV2–CV6 are other chord types and must not be mixed into CV1.

Pa Style Edit also writes those names into Korg SysEx (`F0 42 … v1cv1 … F7`). The loader reads both meta markers and SysEx.

### `.STY` on disk (Pa80–Pa4X)

A `.STY` file is a **style bank**, not one style (USER01.STY holds many). RicFreak’s Pa80 map still matches Pa4X banks:

- File tag `KORF` near the start
- Index length at offset 32; each index row is 24 bytes (16-byte name, type 2 = style, type 7 = performance)
- Style payloads follow the index; each chunk size is at bytes 5–8 plus 8
- The MIDI inside each style is **OC31-compressed**. Korg has not published OC31. ArrangerBox walks the KORF chunks and unpacks OC31 with zlib, LZSS, and LZW, then looks for `MThd` / `v1cv1`.

If unpacking fails, export the style from the Pa: **Style Record > Import/Export > Export SMF** (hold Shift + Execute), then import that `.MID`.

Korg NTT / Guitar Mode / Chord Table are not reconstructed. CV1 notes are transposed from C by the recognized chord root (`trans` events). Program Change at tick 0 of each CV maps onto factory GeneralUser GM, or onto sampled SET instruments when those loaded.
