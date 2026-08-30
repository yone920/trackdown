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
