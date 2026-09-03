import { getSpeech, resetSpeechForTests } from '@/lib/ports/speech';

// Whether this build can hear you, and how that question is answered.
//
// Two field reports, one day apart, settled this contract. 2026-09-03 morning: the first
// TestFlight build hid Speak although the module was configured correctly, and a fix made
// "the require decide" past a null probe answer. 2026-09-03 evening: that fix CRASHED the
// log sheet — evaluating the adapter against a binary that truly lacks the module aborts
// below JS, where no try/catch reaches. The registry's no is final in every build: a
// binary that ships the module registers it before any JS runs. If Speak is missing where
// the module genuinely exists, the diagnosis is the binary or the registry — never this
// gate.

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

  // The crash, in one test: overriding the registry's no is how the log sheet took the
  // whole app down. The no is final, even when an adapter file is sitting right there.
  it('honors the probe when it says no, even if an adapter file is present', () => {
    jest.doMock(REGISTRY, () => ({ requireOptionalNativeModule: () => null }), { virtual: true });
    jest.doMock(ADAPTER, () => ({ createSpeech: () => realPort }), { virtual: true });

    const speech = jest.requireActual<typeof import('@/lib/ports/speech')>('@/lib/ports/speech');
    expect(speech.getSpeech().available).toBe(false);
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
