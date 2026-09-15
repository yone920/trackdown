import {
  ExpoSpeechRecognitionModule,
  type ExpoSpeechRecognitionResultEvent,
} from 'expo-speech-recognition';

import type { SpeechEvents, SpeechPort } from './speech';

// The `expo-speech-recognition` adapter. This file is only ever reached through
// `getSpeech()` in ./speech.ts, inside a try — importing it evaluates the native module,
// which throws in Expo Go. Nothing else may import it.

type Subscription = { remove: () => void };

export function createSpeech(): SpeechPort {
  let subscriptions: Subscription[] = [];

  const clear = () => {
    for (const subscription of subscriptions) subscription.remove();
    subscriptions = [];
  };

  return {
    available: true,

    async requestPermission() {
      const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      return result.granted;
    },

    async start(events: SpeechEvents) {
      clear();
      subscriptions.push(
        ExpoSpeechRecognitionModule.addListener('result', (event: ExpoSpeechRecognitionResultEvent) => {
          const transcript = event.results?.[0]?.transcript ?? '';
          if (event.isFinal) events.onResult(transcript);
          else events.onPartial?.(transcript);
        }),
        ExpoSpeechRecognitionModule.addListener('error', (event) => {
          events.onError?.(event.message ?? event.error ?? 'Could not hear that.');
        }),
        ExpoSpeechRecognitionModule.addListener('end', () => {
          clear();
          events.onEnd?.();
        })
      );

      // Interim results so the sheet fills in while the user is still talking; the
      // audio itself never leaves the phone (concept-v2 §Logging).
      ExpoSpeechRecognitionModule.start({
        lang: 'en-US',
        interimResults: true,
        continuous: false,
      });
    },

    stop() {
      ExpoSpeechRecognitionModule.stop();
      clear();
    },
  };
}
