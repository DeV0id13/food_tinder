import js from '@eslint/js';
import globals from 'globals';

export default [
  {ignores: ['dist/**', 'node_modules/**']},
  js.configs.recommended,
  {
    files: ['src/**/*.{js,mjs}'],
    languageOptions: {globals: globals.browser},
  },
  {
    files: ['**/*.{js,mjs}'],
    ignores: ['src/**'],
    languageOptions: {globals: globals.nodeBuiltin},
  },
];
