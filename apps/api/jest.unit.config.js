/** Unit tests (no database). */
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test/unit', '<rootDir>/src'],
  testMatch: ['**/*.spec.ts'],
  transform: { '^.+\\.ts$': ['@swc/jest', { jsc: { parser: { syntax: 'typescript', decorators: true }, transform: { legacyDecorator: true, decoratorMetadata: true }, target: 'es2022' } }] },
};
