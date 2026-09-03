import { getSpeech, resetSpeechForTests } from '@/lib/ports/speech';

// Whether this build can hear you, and how that question is answered.
//
// Field report 2026-09-03, from the first TestFlight build: the Log sheet said "Speaking
// needs the dev build" on a production app where the module was configured correctly —
// dependency (not dev), config plugin with both permission strings, both usage strings in
// the plist, and `expo-modules-autolinking` resolving it locally. The dev build heard fine.
//
// The port had one registry probe and treated a null answer as final. A probe is evidence,
// not proof: it is one lookup, and in a release build it can answer before the thing it is
// looking for has registered. So outside development the REQUIRE decides — if the module is
// genuinely absent the require throws and the null port stands, exactly as before.

const REGISTRY = 'expo-modules-core';
const ADAPTER = '@/lib/ports/speech.expo';

/** A speech port that is plainly the real one. */
const realPort = {
  available: true,
  requestPermission: jest.fn(),
  start: jest.fn(),
  stop: jest.fn(),
};

/** Jest runs with `__DEV__` true; production is the case this bug lived in. */
const asProduction = (): void => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = false;
};
const asDevelopment = (): void => {
  (globalThis as { __DEV__?: boolean }).__DEV__ = true;
};

beforeEach(() => {
  resetSpeechForTests(null);
  jest.resetModules();
  asProduction();
});

afterAll(() => {
  asDevelopment();
});

afterEach(() => {
  resetSpeechForTests(null);
});

describe('finding the speech module', () => {
  it('loads the adapter when the module is there', () => {
    jest.doMock(REGISTRY, () => ({ requireOptionalNativeModule: () => ({}) }), { virtual: true });
    jest.doMock(ADAPTER, () => ({ createSpeech: () => realPort }), { virtual: true });

    const speech = jest.requireActual<typeof import('@/lib/ports/speech')>('@/lib/ports/speech');
    expect(speech.getSpeech().available).toBe(true);
  });

  // The whole bug, in one test: the registry says no, and the module is there anyway.
  it('still loads it when the probe says no but the adapter is present', () => {
    jest.doMock(REGISTRY, () => ({ requireOptionalNativeModule: () => null }), { virtual: true });
    jest.doMock(ADAPTER, () => ({ createSpeech: () => realPort }), { virtual: true });

    const speech = jest.requireActual<typeof import('@/lib/ports/speech')>('@/lib/ports/speech');
    expect(speech.getSpeech().available).toBe(true);
  });

  // And the honest negative: nothing to load, so the sheet hides the control rather than
  // offering something that cannot work.
  it('falls back to the null port when the adapter cannot be loaded', () => {
    jest.doMock(REGISTRY, () => ({ requireOptionalNativeModule: () => null }), { virtual: true });
    jest.doMock(ADAPTER, () => {
      throw new Error('Cannot find native module ExpoSpeechRecognition');
    }, { virtual: true });

    const speech = jest.requireActual<typeof import('@/lib/ports/speech')>('@/lib/ports/speech');
    expect(speech.getSpeech().available).toBe(false);
  });

  it('never throws out of the question — a missing module is an answer, not a crash', () => {
    jest.doMock(REGISTRY, () => {
      throw new Error('no registry here');
    }, { virtual: true });
    jest.doMock(ADAPTER, () => {
      throw new Error('no module either');
    }, { virtual: true });

    const speech = jest.requireActual<typeof import('@/lib/ports/speech')>('@/lib/ports/speech');
    expect(() => speech.getSpeech()).not.toThrow();
    expect(speech.getSpeech().available).toBe(false);
  });

  // In development the probe still short-circuits, and it has to: requiring the adapter in
  // Expo Go throws while the module is being evaluated, and the dev overlay redboxes that
  // even when it is caught. That is the one place a null probe is allowed the last word.
  it('trusts the probe in development, where a redbox is the alternative', () => {
    asDevelopment();
    const createSpeech = jest.fn(() => realPort);
    jest.doMock(REGISTRY, () => ({ requireOptionalNativeModule: () => null }), { virtual: true });
    jest.doMock(ADAPTER, () => ({ createSpeech }), { virtual: true });

    const speech = jest.requireActual<typeof import('@/lib/ports/speech')>('@/lib/ports/speech');
    expect(speech.getSpeech().available).toBe(false);
    expect(createSpeech).not.toHaveBeenCalled();
  });

  it('answers the same way twice without asking twice', () => {
    jest.doMock(REGISTRY, () => ({ requireOptionalNativeModule: () => ({}) }), { virtual: true });
    const createSpeech = jest.fn(() => realPort);
    jest.doMock(ADAPTER, () => ({ createSpeech }), { virtual: true });

    const speech = jest.requireActual<typeof import('@/lib/ports/speech')>('@/lib/ports/speech');
    speech.getSpeech();
    speech.getSpeech();
    expect(createSpeech).toHaveBeenCalledTimes(1);
  });
});

describe('the null port', () => {
  it('says no to permission and refuses to pretend it can listen', async () => {
    resetSpeechForTests(null);
    jest.doMock(REGISTRY, () => ({ requireOptionalNativeModule: () => null }), { virtual: true });
    jest.doMock(ADAPTER, () => {
      throw new Error('absent');
    }, { virtual: true });

    const speech = jest.requireActual<typeof import('@/lib/ports/speech')>('@/lib/ports/speech');
    const port = speech.getSpeech();
    await expect(port.requestPermission()).resolves.toBe(false);
    await expect(port.start({ onResult: () => {} })).rejects.toThrow(/not available/i);
    expect(() => port.stop()).not.toThrow();
  });
});

/** The real port is unused here beyond identity; referenced so the fixture cannot drift. */
it('has a port shape the screens can rely on', () => {
  expect(typeof getSpeech().available).toBe('boolean');
});
