import type {ESLint, Linter} from 'eslint';
import css from '@eslint/css';
import nx from '@nx/eslint-plugin';
import tseslint from 'typescript-eslint';
import noHandwrittenCss from './rules/no-handwritten-css.js';
import noRawColor from './rules/no-raw-color.js';
import publicEntry from './rules/public-entry.js';

export {globalEntryAtRules} from './rules/no-handwritten-css.js';

/** One constraint of `@nx/enforce-module-boundaries`, keyed by the project tags the generators write. */
export type DepConstraint = Readonly<{
  sourceTag: string;
  onlyDependOnLibsWithTags?: readonly string[];
  notDependOnLibsWithTags?: readonly string[];
}>;

/**
 * Boundaries over the tags that `mpfrontend create app` and the package generator write:
 * `type:app` or `type:package`, `scope:<app>` or `scope:shared`, and a `runtime:*` tag.
 * An app never depends on another app; a shared package never depends on an app.
 */
export const defaultDepConstraints: readonly DepConstraint[] = [
  {sourceTag: 'type:app', onlyDependOnLibsWithTags: ['type:package']},
  {sourceTag: 'type:package', onlyDependOnLibsWithTags: ['type:package']},
  {sourceTag: 'scope:shared', onlyDependOnLibsWithTags: ['scope:shared']},
  {sourceTag: 'runtime:universal', onlyDependOnLibsWithTags: ['runtime:universal']},
  {sourceTag: 'runtime:client', notDependOnLibsWithTags: ['runtime:server']},
  {sourceTag: 'runtime:server', notDependOnLibsWithTags: ['runtime:client']},
];

/** Token and theme files: the only files that may hold raw colour values and token CSS. */
export const defaultThemeFiles: readonly string[] = ['**/src/theme/**', '**/themes/**'];
/** The one global style entry of an app: imports and base element rules only. */
export const defaultGlobalStyleEntries: readonly string[] = ['**/src/app/globals.css'];
/** Build output, dependencies and generated contracts are never linted by hand-written rules. */
export const defaultIgnores: readonly string[] = [
  '**/node_modules/**', '**/dist/**', '**/.next/**', '**/.nx/**', '**/runtime-assets/**', '**/coverage/**',
  '**/generated/**', '**/*.gen.ts', '**/next-env.d.ts',
];

export const codeFiles: readonly string[] = ['**/*.{js,mjs,cjs,jsx,ts,mts,cts,tsx}'];
export const styleFiles: readonly string[] = ['**/*.css'];

export type WorkspaceConfigOptions = Readonly<{
  /** Replaces the default constraints; spread `defaultDepConstraints` to extend them. */
  depConstraints?: readonly DepConstraint[];
  /** Replaces the default theme and token file globs. */
  themeFiles?: readonly string[];
  /** Replaces the default global style entry globs. */
  globalStyleEntries?: readonly string[];
  /** Added to the default ignores. */
  ignores?: readonly string[];
}>;

/** The MP Frontend rules, for consumers that compose their own configuration. */
export const plugin: ESLint.Plugin = {
  meta: {name: '@mpfrontend/workspace-config'},
  rules: {'no-raw-color': noRawColor, 'no-handwritten-css': noHandwrittenCss, 'public-entry': publicEntry},
};

/**
 * The shared ESLint flat configuration of an MP Frontend workspace. A workspace exports it from its root
 * `eslint.config.mjs`; an app or a package spreads the root array and appends only its own additions.
 */
export function workspaceConfig(options: WorkspaceConfigOptions = {}): Linter.Config[] {
  const themeFiles = [...(options.themeFiles ?? defaultThemeFiles)];
  const globalStyleEntries = [...(options.globalStyleEntries ?? defaultGlobalStyleEntries)];
  const typescript = (tseslint.configs.recommended as unknown as Linter.Config[])
    .map(config => ({...config, files: config.files ?? [...codeFiles]}));
  return [
    {name: 'mpfrontend/ignores', ignores: [...defaultIgnores, ...(options.ignores ?? [])]},
    ...typescript,
    {
      name: 'mpfrontend/code',
      files: [...codeFiles],
      plugins: {'@nx': nx as unknown as ESLint.Plugin, mpfrontend: plugin},
      rules: {
        '@nx/enforce-module-boundaries': ['error', {
          enforceBuildableLibDependency: true,
          allow: [],
          depConstraints: (options.depConstraints ?? defaultDepConstraints).map(constraint => ({...constraint})),
        }],
        '@typescript-eslint/no-explicit-any': 'error',
        // A leading underscore marks a parameter that a framework passes but the code does not read.
        '@typescript-eslint/no-unused-vars': ['error', {argsIgnorePattern: '^_'}],
        'mpfrontend/no-raw-color': 'error',
        'mpfrontend/no-handwritten-css': ['error', {inlineStyle: 'custom-properties'}],
        'mpfrontend/public-entry': 'error',
      },
    },
    {
      // Configuration files are tooling glue: an app configuration imports the workspace configuration.
      name: 'mpfrontend/configuration-files',
      files: ['**/*.config.{js,mjs,cjs,ts,mts}'],
      rules: {'@nx/enforce-module-boundaries': 'off'},
    },
    {
      name: 'mpfrontend/styles',
      files: [...styleFiles],
      language: 'css/css',
      languageOptions: {tolerant: true},
      plugins: {css: css as unknown as ESLint.Plugin, mpfrontend: plugin},
      rules: {
        'mpfrontend/no-raw-color': 'error',
        'mpfrontend/no-handwritten-css': ['error', {css: 'forbid'}],
      },
    },
    {
      name: 'mpfrontend/global-style-entry',
      files: globalStyleEntries,
      rules: {'mpfrontend/no-handwritten-css': ['error', {css: 'global-entry'}]},
    },
    {
      name: 'mpfrontend/theme-layer',
      files: themeFiles,
      rules: {'mpfrontend/no-raw-color': 'off', 'mpfrontend/no-handwritten-css': 'off'},
    },
  ];
}

export default workspaceConfig;
