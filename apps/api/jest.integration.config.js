/** Integration tests against a real MySQL database (TEST_DATABASE_URL), reset by globalSetup. */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test/integration'],
  testMatch: ['**/*.int-spec.ts'],
  globalSetup: '<rootDir>/test/integration/global-setup.js',
  setupFiles: ['<rootDir>/test/integration/env.js'],
  testTimeout: 120000,
  maxWorkers: 1,
  transform: { '^.+\\.ts$': ['@swc/jest', { jsc: { parser: { syntax: 'typescript', decorators: true }, transform: { legacyDecorator: true, decoratorMetadata: true }, target: 'es2022' } }] },
};
