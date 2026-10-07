import nx from '@nx/eslint-plugin';
import tseslint from 'typescript-eslint';
export default [
  { ignores: ['**/dist/**', '**/node_modules/**', '**/templates/**', '**/*.gen.ts', '.nx/**'] },
  ...tseslint.configs.recommended,
  { files: ['**/*.ts', '**/*.tsx'], plugins: { '@nx': nx }, rules: {
    '@nx/enforce-module-boundaries': ['error', { enforceBuildableLibDependency: true,
      depConstraints: [
        { sourceTag: 'scope:platform', onlyDependOnLibsWithTags: ['scope:platform'] },
        { sourceTag: 'runtime:universal', onlyDependOnLibsWithTags: ['runtime:universal'] },
        { sourceTag: 'runtime:client', notDependOnLibsWithTags: ['runtime:server', 'runtime:tooling'] }
      ] }],
    '@typescript-eslint/no-explicit-any': 'error'
  } }
];
