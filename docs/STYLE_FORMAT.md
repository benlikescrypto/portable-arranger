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

Factory `.abstyle` content is original ArrangerBox arrangements. Korg STY files are imported through the SMF/marker path, not converted losslessly to every PA4X CAS element.
