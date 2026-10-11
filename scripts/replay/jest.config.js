// Not part of the normal `npx jest` run (package.json testMatch only looks in __tests__). Run:
//   REPLAY_JSON=<file>.json npx jest -c scripts/replay/jest.config.js
module.exports = {
  preset: 'jest-expo',
  rootDir: '../..',
  testMatch: ['<rootDir>/scripts/replay/replay.test.ts'],
};
