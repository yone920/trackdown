// jest-expo runs the tests through the same transformer Metro uses, so a test imports the
// screens exactly as the app does. Only `*.test.ts(x)` are tests: the fixtures sitting
// beside them are not.
module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testMatch: ['<rootDir>/__tests__/**/*.test.ts', '<rootDir>/__tests__/**/*.test.tsx'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/$1' },
};
