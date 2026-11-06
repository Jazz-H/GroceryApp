// Flat config. Added 2026-11-06, once TypeScript was pinned to 6.0.x:
// typescript-eslint has peer `typescript >=4.8.4 <6.1.0`, so nothing could be
// installed while this repo was on TypeScript 7. See CODE-REVIEW-BACKLOG.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist', 'dev-dist', 'node_modules', 'docs', 'coverage'] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.serviceworker },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      // The two classic hook rules — the pair that the existing inline
      // suppression comments in this repo already name. (Careful wording: a
      // comment line starting with the directive keyword is parsed by ESLint
      // as a real directive, which is exactly what happened on first run.)
      //
      // eslint-plugin-react-hooks v7 also ships the React Compiler ruleset
      // (set-state-in-effect, purity, immutability, ~30 rules). Deliberately
      // not enabled: turning that on across an existing codebase is its own
      // piece of work, not a side effect of getting linting running at all.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // Firestore converters and a few event handlers legitimately take an
      // unused leading argument; the underscore prefix is the signal.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  // A service worker, not a page script.
  {
    files: ['public/push-sw.js'],
    languageOptions: { globals: { ...globals.serviceworker, ...globals.browser } },
  },

  // Build/ops scripts run under Node.
  {
    files: ['scripts/**/*.mjs', '*.config.{js,ts}', 'vitest*.ts'],
    languageOptions: { globals: { ...globals.node } },
  },

  // The Cloudflare Worker runs on workerd, not in a browser.
  {
    files: ['worker/**/*.ts'],
    languageOptions: { globals: { ...globals.worker } },
  },

  // Vitest globals are enabled in vitest.config.ts.
  {
    files: ['**/*.test.{ts,tsx}', 'tests/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
);
