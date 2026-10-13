// @ts-check
/** Shared lint and security rules for every workspace (PRD 15.1: packages/configuration). */
import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', 'playwright-report/**', 'test-results/**', '.storage*/**', '**/*.js', '**/*.cjs', '**/*.mjs'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      // API payloads and Prisma JSON columns are typed at the edges with zod; `any` is tolerated in view code.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      '@typescript-eslint/no-namespace': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Security-relevant rules
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
    },
  },
  {
    files: ['apps/api/src/**/*.ts', 'apps/worker/src/**/*.ts'],
    // Server code logs through the Nest Logger; direct console use must be deliberate.
    rules: { 'no-console': 'warn' },
  },
  {
    files: ['apps/hrms-web/**/*.{ts,tsx}', 'apps/license-admin-web/**/*.{ts,tsx}', 'packages/ui/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Rendering raw HTML from data is never needed in these apps.
      'no-restricted-syntax': ['error', { selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']", message: 'Do not render raw HTML.' }],
    },
  },
);
