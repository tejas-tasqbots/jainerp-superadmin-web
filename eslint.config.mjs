import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

/**
 * Deliberately a baseline, not an opinion engine.
 *
 * This app went years without a linter (there was no `lint` script and ESLint
 * was never installed), so the point is to catch real defects — unused
 * bindings, broken hook dependencies, accidental globals — without flagging
 * thousands of stylistic choices that would make `npm run lint` noise everyone
 * learns to ignore. Type-aware rules are off: `tsc -b` already runs on every
 * build and in CI.
 *
 * react-hooks matters most here: a wrong dependency array is a real bug class
 * that typechecking cannot see.
 */
export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'e2e/**', 'public/**', '*.config.*'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      // Reported, but not blocking. There are ~140 pre-existing hook findings in
      // this app, and the dominant one (exhaustive-deps) cannot be auto-applied
      // safely: adding a missing dependency changes when an effect re-runs and
      // can turn a working screen into an infinite render loop. They are worth
      // fixing deliberately, screen by screen, with something to test against —
      // not in one sweep. Errors below are reserved for defects that are safe to
      // fix mechanically, so `npm run lint` stays meaningful instead of being
      // permanently red and ignored.
      ...Object.fromEntries(
        Object.keys(reactHooks.configs.recommended.rules).map((rule) => [rule, 'warn']),
      ),
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // API payloads and receipt templates are genuinely dynamic; `any` there is
      // a considered choice. tsc still checks everything that is typed.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      // Empty catch blocks are intentional for best-effort work (clipboard,
      // share sheet, localStorage in privacy mode) that must not break the UI.
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
);
