/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@idol/shared$': '<rootDir>/../../packages/shared/src',
    '^@idol/db$': '<rootDir>/../../packages/db/src',
  },
};
