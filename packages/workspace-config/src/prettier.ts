/**
 * The shared formatter profile. A workspace re-exports it from `prettier.config.mjs` and spreads it when
 * it needs an addition of its own.
 */
const config = {
  printWidth: 100,
  singleQuote: true,
  trailingComma: 'all',
  bracketSpacing: true,
  endOfLine: 'lf',
} as const;

export default config;
