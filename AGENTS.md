This is ArrangerBox, an Expo SDK 58 / React Native development-build app with local native modules.

- UI lives in `app/`, `components/`, `hooks/`, `lib/`, `constants/` (TypeScript).
- Real-time audio is C++ in `modules/audio/cpp`. Do not implement audio in JavaScript.
- USB-MIDI is native (`modules/midi`). Do not route timing-sensitive MIDI through JS.
- The original Android app is preserved in `legacy-android/`. Do not delete it to “clean up” the repo.
- The app does not run in Expo Go. Use `npx expo run:android` / `npx expo run:ios` or EAS development builds.
- Do not claim MIDI or audio works until it has been tested on physical hardware.
- Fetch current Expo docs for SDK 58 before using Expo APIs from memory: https://docs.expo.dev/versions/v58.0.0/
