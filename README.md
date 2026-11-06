# ArrangerBox

Cross-platform portable arranger. TypeScript / React Native / Expo for the UI, C++ for the shared audio engine, Kotlin for Android MIDI/audio I/O, Swift for iOS MIDI/audio I/O.

This app **does not run in Expo Go**. MIDI, Oboe, CoreMIDI, and the C++ engine require an Expo development build.

**MIDI and audio have not been verified on physical hardware in this migration.** Treat USB-MIDI, Oboe, and Core Audio as compiled architecture until they are tested on a real Android tablet and iPhone/iPad with a USB-MIDI keyboard.

## Architecture

```
TypeScript UI  ──►  Expo modules (typed APIs)
                      ├── modules/midi     USB-MIDI in/out (Kotlin MidiManager / Swift CoreMIDI)
                      ├── modules/audio    C++ engine + Oboe (Android) / RemoteIO (iOS)
                      └── modules/device   USB host / capability reporting
```

Real-time MIDI is parsed on the native side and pushed into a lock-free C++ queue. JavaScript never renders audio and is not on the MIDI timing path.

`react-native-midi-api` was evaluated: it is a maintained Expo module with USB-MIDI on Android 7+ and iOS 14+, but it delivers messages to JavaScript. That is not acceptable for arranger timing, so ArrangerBox uses custom native modules and feeds the C++ engine directly.

## Project layout

- `app/` — Expo Router screens
- `components/`, `hooks/`, `lib/`, `constants/` — TypeScript UI (same shape as the Epohk mobile app)
- `modules/audio|midi|device` — local Expo modules
- `legacy-android/` — original Kotlin/Compose/NDK app, preserved for Play Internal scripts and reference

## Development builds

Install Node 20+, JDK 17, Android SDK / NDK, and Xcode (for iOS).

```bash
npm install
npx expo prebuild
```

### Android (physical device or emulator)

```bash
npx expo run:android
# or
eas build --profile development --platform android
```

Install the APK, connect the device to the same network as Metro, then:

```bash
npx expo start --dev-client
```

Native Kotlin / C++ / Oboe changes require a native rebuild (`expo run:android` or a new EAS build). JavaScript-only changes can use Metro or EAS Update.

### iOS (physical iPhone / iPad)

A Mac with Xcode is required to compile.

```bash
npx expo run:ios --device
# or
eas build --profile development --platform ios
```

Then install via USB / Apple Developer, and start Metro with `npx expo start --dev-client`.

USB-MIDI on iOS needs a Camera Adapter / USB-C host cable. Bluetooth MIDI is not a V1 requirement.

### Production

```bash
eas build --profile production --platform android
eas build --profile production --platform ios
```

`eas.json` also defines `preview` (internal APK) and `development-simulator` (iOS simulator, no USB-MIDI).

### EAS Update (JS only)

```bash
eas update --channel development --message "ui tweak"
```

Do **not** ship Oboe, CoreMIDI, Kotlin, Swift, or C++ changes through EAS Update. Rebuild natively.

## PA4X SET folders

Tap **LOAD SET** and pick the `.SET` folder (or the USB folder that contains it).

- Android uses the system folder picker (`ACTION_OPEN_DOCUMENT_TREE`), including USB-C sticks and hubs.
- iOS/iPad uses the Files folder picker, including USB-C storage on supported iPads.
The whole `.SET` folder is copied into the app. Names are read from PCG/STY/PRF/PAD. Uncompressed WAV, KSF, and PCM sample data is loaded into the engine.

This is **not** a full PA4X SET player. PCG programs are not rebuilt as PA programs, STY files are not turned into playable arranger patterns, KMP keymaps are not applied, and compressed Korg samples are skipped. Confirm with a real SET on hardware.

## Remaining work

- Play Internal / Gradle Play Publisher scripts remain in `legacy-android/scripts/`
- Hardware verification: USB-MIDI keyboard, USB hub, speaker output, long sessions, SET import

## Package

`com.arrangerbox.internal` on Android and iOS.
