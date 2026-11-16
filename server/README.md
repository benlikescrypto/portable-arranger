# ArrangerBox AI server (Modal)

GPU jobs behind the app's **AI LAB** page.

- **Song → Drum Style** (`abai/drums.py`)
  1. Demucs `htdemucs` separates the drums.
  2. beat_this finds the beats, downbeats and meter. The grid is smoothed and the tempo is a least-squares fit.
  3. Bar-level analysis finds the sections from three things: drum-pattern self-similarity, chroma/MFCC of the mix, and how busy each bar is. Sections that play the same groove are clustered together.
  4. The sections become Pa elements:
     - Intro 1/2;
     - Variation 1–4, ordered from quiet to busy;
     - Fill 1–4 (Fill *k* is a fill bar that led into the section that became Variation *k*, as Pa auto fill expects);
     - Break;
     - Ending 1–3, with the last hit ringing out.
  5. Each element is cut at its drum onsets into an SFZ slice kit. The `.abstyle` triggers slice *k* at the beat position where it was played, so the style follows any tempo without time-stretching.
  6. A second style transcribes the same groove onto the factory GM kit. Kicks come from low-band peaks; snares and cymbals come from a prior-anchored NMF.
- **Song → Sounds** (`abai/sounds.py`)
  1. Demucs `htdemucs_6s` separates the instruments.
  2. PANNs CNN14 tags the instrument family per 6 s window, smoothed, which gives the sound changes over time.
  3. Basic Pitch (ONNX) finds the note events.
  4. Clean notes are kept: isolated, in the part's own register, not bass bleed, and voiced in pYIN.
  5. Each kept note is trimmed, tuned (`tune=`), level-matched and, for sustained families, looped with a baked equal-power crossfade.
  6. The notes are mapped across the keyboard as an SFZ.

The engine side is `kit=` / `meter=` in `.abstyle` and the `ab_kit` / `ab_category` SFZ opcodes; see `docs/STYLE_FORMAT.md`.

## Deploy

```sh
cd server
modal secret create arrangerbox-ai AB_TOKEN=<random>   # once; keep the same value in server/.env.local
modal deploy modal_app.py                              # API + GPU worker + hourly cleanup
modal run modal_app.py::make_demo                      # demo songs for the app's "Try demo song"
node scripts/write-app-config.mjs https://<workspace>--arrangerbox-ai-api.us-east.modal.run
```

The script writes the URL to `lib/ai/server.generated.ts` (committed) and the token to the gitignored root `.env` as `EXPO_PUBLIC_AI_TOKEN`. `.easignore` uploads `.env` to EAS, so builds carry the token while the public repo does not. It is still an app key: every build contains it.

## Tests

| Command | What it checks |
| --- | --- |
| `modal run modal_app.py::tests` | Renders original test songs (pop 4/4 at 112 BPM, waltz 3/4 at 96 BPM, keys solos) through GeneralUser GS, runs both pipelines on GPU and scores them against the ground truth (`abai/evaluate.py`). |
| `node tests/e2e.mjs <api url>` | The deployed HTTP API, with the same calls the app makes. |
| `AB_AI_STYLE=… AB_AI_SFZ=… modules/audio/cpp/tests/build/test_engine` | The C++ engine loads and plays the downloaded results. |

## Privacy and limits

- Uploads are deleted when a job ends. Results expire after 24 h; the app keeps its own copy.
- The maximum upload is 80 MB, and only the first 12 minutes are processed.
- GPUs: L4, with A10G, L40S and T4 as fallbacks. A warm job takes about 40–50 s; the first job after a quiet period also waits for a cold start.
