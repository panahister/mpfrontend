import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, rm, writeFile, readFile} from 'node:fs/promises';
import {join, dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {ESLint, type Linter} from 'eslint';
import * as prettier from 'prettier';
import {workspaceConfig, defaultDepConstraints, defaultThemeFiles, defaultGlobalStyleEntries} from '../src/eslint.js';
import formatter from '../src/prettier.js';

/** Module boundaries need an Nx project graph; the consumer check proves them in a real workspace. */
const withoutGraph: Linter.Config = {rules: {'@nx/enforce-module-boundaries': 'off'}};

async function lint(files: Record<string, string>, config: Linter.Config[]) {
  const directory = await mkdtemp(join(tmpdir(), 'mpfrontend-workspace-config-'));
  try {
    for (const [path, content] of Object.entries(files)) {
      await mkdir(dirname(join(directory, path)), {recursive: true});
      await writeFile(join(directory, path), content);
    }
    const eslint = new ESLint({cwd: directory, overrideConfigFile: true, overrideConfig: [...config, withoutGraph]});
    const results = await eslint.lintFiles(['apps']);
    return Object.fromEntries(results.map(result => [
      result.filePath.slice(directory.length + 1),
      result.messages.map(message => message.ruleId ?? 'fatal:' + message.message),
    ]));
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
}

test('the default profile wires boundaries, colours and CSS to the paths the generators write', () => {
  const config = workspaceConfig();
  const code = config.find(entry => entry.name === 'mpfrontend/code')!;
  const boundaries = code.rules!['@nx/enforce-module-boundaries'] as [string, {depConstraints: unknown[]}];
  assert.equal(boundaries[0], 'error');
  assert.deepEqual(boundaries[1].depConstraints, defaultDepConstraints);
  assert.ok(defaultDepConstraints.some(c => c.sourceTag === 'type:app' && c.onlyDependOnLibsWithTags?.join() === 'type:package'));
  assert.equal(config.find(entry => entry.name === 'mpfrontend/styles')!.language, 'css/css');
  assert.deepEqual(config.find(entry => entry.name === 'mpfrontend/theme-layer')!.files, defaultThemeFiles);
  assert.deepEqual(config.find(entry => entry.name === 'mpfrontend/global-style-entry')!.files, defaultGlobalStyleEntries);
  const configuration = config.find(entry => entry.name === 'mpfrontend/configuration-files')!;
  assert.deepEqual(configuration.rules, {'@nx/enforce-module-boundaries': 'off'});
  assert.ok(config.indexOf(configuration) > config.indexOf(code), 'the exception follows the rule it narrows');
});

test('allowed paths are configuration and a consumer extends the constraints instead of replacing the profile', () => {
  const config = workspaceConfig({
    themeFiles: ['brand/**'],
    globalStyleEntries: ['src/styles/entry.css'],
    depConstraints: [...defaultDepConstraints, {sourceTag: 'scope:billing', onlyDependOnLibsWithTags: ['scope:billing', 'scope:shared']}],
    ignores: ['legacy/**'],
  });
  assert.deepEqual(config.find(entry => entry.name === 'mpfrontend/theme-layer')!.files, ['brand/**']);
  assert.deepEqual(config.find(entry => entry.name === 'mpfrontend/global-style-entry')!.files, ['src/styles/entry.css']);
  assert.ok(config[0]!.ignores!.includes('legacy/**'));
  const boundaries = config.find(entry => entry.name === 'mpfrontend/code')!.rules!['@nx/enforce-module-boundaries'] as [string, {depConstraints: unknown[]}];
  assert.equal(boundaries[1].depConstraints.length, defaultDepConstraints.length + 1);
});

test('real ESLint applies the theme layer, the global entry and the code rules by path', async () => {
  const results = await lint({
    'apps/web/src/theme/theme.css': ':root { --mp-surface-panel: #ffffff; }\n',
    'apps/web/src/theme/config.ts': "export const accent = '#123456';\n",
    'apps/web/src/app/globals.css': '@import "tailwindcss";\nbody { margin: 0; }\n',
    'apps/web/src/app/layout-classes.css': '.shell { max-width: 75rem; }\n',
    'apps/web/src/features/list/ui/list.tsx': 'export const List = () => <ul className="bg-[#123456] p-6" />;\n',
    'apps/web/src/features/list/ui/clean.tsx': 'export const Clean = () => <ul className="bg-[var(--mp-surface-panel)] p-6" />;\n',
  }, workspaceConfig());
  assert.deepEqual(results['apps/web/src/theme/theme.css'], []);
  assert.deepEqual(results['apps/web/src/theme/config.ts'], []);
  assert.deepEqual(results['apps/web/src/app/globals.css'], []);
  assert.deepEqual(results['apps/web/src/app/layout-classes.css'], ['mpfrontend/no-handwritten-css']);
  assert.deepEqual(results['apps/web/src/features/list/ui/list.tsx'], ['mpfrontend/no-raw-color']);
  assert.deepEqual(results['apps/web/src/features/list/ui/clean.tsx'], []);
});

test('generated contract output and build output are not linted as hand-written code', async () => {
  const results = await lint({
    'apps/web/src/api/generated/catalog/read-models.gen.ts': "export const x: any = '#123456';\n",
    'apps/web/src/ok.ts': 'export const ok = 1;\n',
  }, workspaceConfig());
  assert.deepEqual(Object.keys(results), ['apps/web/src/ok.ts']);
});

test('the formatter profile is a plain Prettier options object that Prettier accepts', async () => {
  assert.equal(formatter.printWidth, 100);
  assert.equal(formatter.singleQuote, true);
  const formatted = await prettier.format('const a = {b: "c"}', {...formatter, parser: 'typescript'});
  assert.equal(formatted, "const a = { b: 'c' };\n");
});

test('the TypeScript presets are complete JSON files that extend the shared base', async () => {
  const read = async (name: string) => JSON.parse(await readFile(new URL('../tsconfig/' + name, import.meta.url), 'utf8'));
  const base = await read('base.json'),next = await read('next.json'),library = await read('library.json');
  assert.equal(base.compilerOptions.strict, true);
  assert.equal(next.extends, './base.json');
  assert.equal(next.compilerOptions.moduleResolution, 'bundler');
  assert.deepEqual(next.compilerOptions.plugins, [{name: 'next'}]);
  assert.equal(library.extends, './base.json');
  assert.equal(library.compilerOptions.declaration, true);
});
