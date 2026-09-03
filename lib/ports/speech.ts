// The speech port (docs/build-plan.md §Architecture, app side). On-device transcription
// is a native module, and the morning test runs in **Expo Go**, which has no native
// modules beyond the ones Expo ships. So the app never imports `expo-speech-recognition`
// at the top level: it asks for an adapter, gets a null one when the module is not there,
// and the Log screen hides the Speak control instead of crashing.
//
// The dev build (eas.json, profile `development`) is where the real adapter loads.

export type SpeechEvents = {
  /** Interim text, replaced on every event; the Log screen shows it live. */
  onPartial?: (text: string) => void;
  /** The transcript the user will edit and send. */
  onResult: (text: string) => void;
  onError?: (message: string) => void;
  onEnd?: () => void;
};

export interface SpeechPort {
  /** False in Expo Go, on web, and anywhere the native module is missing. */
  readonly available: boolean;
  requestPermission(): Promise<boolean>;
  start(events: SpeechEvents): Promise<void>;
  stop(): void;
}

export const nullSpeech: SpeechPort = {
  available: false,
  async requestPermission() {
    return false;
  },
  async start() {
    throw new Error('Speech recognition is not available in this build.');
  },
  stop() {},
};

let cached: SpeechPort | null = null;

/**
 * The adapter, or the null one. Loaded with `require` inside a try so that a missing
 * native module is a capability answer rather than a red screen — `requireNativeModule`
 * throws while the module is being evaluated, which is exactly what Expo Go does.
 */
export function getSpeech(): SpeechPort {
  if (cached) return cached;
  // Ask the native registry BEFORE evaluating the adapter file: in Expo Go the module is
  // absent and merely importing 'expo-speech-recognition' throws during module evaluation —
  // caught or not, the dev overlay turns that into a full-screen redbox.
  //
  // **The probe is advisory, and only in development** (field report 2026-09-03: the first
  // TestFlight build showed "Speaking needs the dev build" with the module configured
  // correctly — dependency, config plugin, both usage strings, and autolinking resolving it
  // locally). A probe that returns null is not proof the module is absent: it is one
  // registry lookup, and in a release build it can answer before the thing it is looking
  // for has registered. Treating that answer as final is what turned a maybe into a
  // capability the user did not have.
  //
  // So the short-circuit stays where it earns its keep — Expo Go, in development, where
  // requiring the adapter throws during evaluation and the dev overlay redboxes even when
  // the throw is caught — and everywhere else the REQUIRE decides. If the module is really
  // absent the require throws and we land on `nullSpeech` exactly as before; if it is
  // present and the probe was merely early, Speak works.
  if (__DEV__) {
    try {
      const core = require('expo-modules-core') as {
        requireOptionalNativeModule?: (name: string) => unknown;
      };
      if (core.requireOptionalNativeModule && !core.requireOptionalNativeModule('ExpoSpeechRecognition')) {
        cached = nullSpeech;
        return cached;
      }
    } catch {
      // fall through to the guarded require below
    }
  }
  try {
     
    const adapter = require('./speech.expo') as { createSpeech: () => SpeechPort };
    cached = adapter.createSpeech();
  } catch {
    cached = nullSpeech;
  }
  return cached;
}

/** Tests need a clean slate; nothing else should call this. */
export function resetSpeechForTests(port: SpeechPort | null = null): void {
  cached = port;
}
