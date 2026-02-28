/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/src/**/*.test.ts'],
  moduleNameMapper: {
    // Evite les conflits avec les modules Electron
    electron: '<rootDir>/src/__mocks__/electron.ts',
  },
};
