/* eslint-env jest */
// Native pieces the screens mount that have no place in a unit test. Each factory only
// touches `require`: nativewind's babel plugin rewrites JSX (and `createElement`) in this
// file, and jest refuses a mock factory that closes over the helper it injects.

jest.mock('react-native-safe-area-context', () =>
  require('react-native-safe-area-context/jest/mock').default,
);

jest.mock('expo-secure-store', () => ({
  getItem: () => null,
  setItem: () => {},
  deleteItemAsync: async () => {},
}));

jest.mock('expo-crypto', () => ({
  randomUUID: () => '00000000-0000-4000-8000-000000000000',
}));

jest.mock('expo-image', () => {
  const { View } = require('react-native');
  return { Image: View };
});

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
  useLocalSearchParams: () => ({}),
}));
