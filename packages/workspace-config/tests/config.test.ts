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

test('an allowed physical value needs its reason, and the profile passes the allowances to the rule', async () => {
  const {Linter: Engine} = await import('eslint');
  const config = (allowedPhysical: unknown) => workspaceConfig({allowedPhysical: allowedPhysical as never}).map(entry => ({...entry}));
  const verify = (allowedPhysical: unknown) => new Engine({configType: 'flat'}).verify('export const a = "left-0";', [...config(allowedPhysical), withoutGraph], 'apps/sample/src/a.ts');
  assert.deepEqual(verify([]).map(message => message.ruleId), ['mpfrontend/logical-properties']);
  assert.deepEqual(verify([{value: 'left-0', reason: 'Pinned to the physical edge of a print layout'}]), []);
  assert.throws(() => verify([{value: 'left-0'}]), /logical-properties/);
  assert.throws(() => verify([{value: 'left-0', reason: ''}]), /logical-properties/);
});

test('a physical side planted in a stylesheet fails the lint as one planted in a class name does, and the allowances reach both', async () => {
  // Every stylesheet kind a generated app has: the theme layer (no other rule applies there), the one global
  // entry (base element rules are allowed there) and a plain stylesheet, next to a class name in a component.
  const files = {
    'apps/web/src/theme/side.css': ':root { margin-left: 1rem; }\n',
    'apps/web/src/app/globals.css': '@import "tailwindcss";\nbody { text-align: left; }\n',
    'apps/web/src/features/list/ui/side.css': '.row { float: right; }\n',
    'apps/web/src/features/list/ui/side.tsx': 'export const Side = () => <ul className="ml-2" />;\n',
    'apps/web/src/theme/logical.css': ':root { margin-inline-start: 1rem; text-align: start; }\n',
    'apps/web/src/features/list/ui/logical.tsx': 'export const Logical = () => <ul className="ms-2" />;\n',
  };
  const results = await lint(files, workspaceConfig());
  const rule = ['mpfrontend/logical-properties'];
  assert.deepEqual(results['apps/web/src/theme/side.css'], rule, 'margin-left in a theme stylesheet');
  assert.deepEqual(results['apps/web/src/app/globals.css'], rule, 'text-align: left in the global entry');
  assert.ok(results['apps/web/src/features/list/ui/side.css']!.includes(rule[0]!), 'float: right in a plain stylesheet');
  assert.deepEqual(results['apps/web/src/features/list/ui/side.tsx'], rule, 'ml-2 in a class name');
  assert.deepEqual(results['apps/web/src/theme/logical.css'], [], 'logical properties in a stylesheet');
  assert.deepEqual(results['apps/web/src/features/list/ui/logical.tsx'], [], 'ms-2 in a class name');
  // The same allowance, with its reason, reaches the stylesheet rule and the class-name rule.
  const allowed = await lint(files, workspaceConfig({allowedPhysical: [
    {value: 'margin-left', reason: 'Pinned to the physical edge of a print layout'}, {value: 'ml-2', reason: 'Pinned to the physical edge of a print layout'}]}));
  assert.deepEqual(allowed['apps/web/src/theme/side.css'], [], 'an allowed margin-left in a stylesheet');
  assert.deepEqual(allowed['apps/web/src/features/list/ui/side.tsx'], [], 'an allowed ml-2 in a class name');
  assert.deepEqual(allowed['apps/web/src/app/globals.css'], rule, 'an allowance covers only its own value');
});

test('the sources and templates of MP Frontend use logical properties only', async () => {
  // Every UI source, every template and every stylesheet of the packages, read as the profile reads them.
  const {readdir} = await import('node:fs/promises');
  const {fileURLToPath} = await import('node:url');
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const files: string[] = [];
  const walk = async (directory: string) => {
    for (const entry of await readdir(directory, {withFileTypes: true})) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {if (!['node_modules', 'dist', 'tests', '.cache'].includes(entry.name)) await walk(path);}
      else if (/\.(?:tsx?|css)(?:\.template)?$/.test(entry.name)) files.push(path);
    }
  };
  for (const name of await readdir(root)) await walk(join(root, name));
  const eslint = new ESLint({cwd: root, overrideConfigFile: true, overrideConfig: [...workspaceConfig(), withoutGraph,
    {rules: {'@typescript-eslint/no-unused-vars': 'off', 'mpfrontend/no-raw-color': 'off', 'mpfrontend/no-handwritten-css': 'off', 'mpfrontend/public-entry': 'off', 'mpfrontend/no-literal-text': 'off'}}]});
  const findings: string[] = [];
  for (const path of files) {
    const filePath = path.replace(/\.template$/, '').replace(/__[A-Za-z]+__/g, 'name');
    for (const result of await eslint.lintText(await readFile(path, 'utf8'), {filePath}))
      for (const message of result.messages) if (message.ruleId === 'mpfrontend/logical-properties' || message.fatal) findings.push(path.slice(root.length) + ': ' + message.message);
  }
  assert.ok(files.length > 50, 'read ' + files.length + ' files');
  assert.deepEqual(findings, []);
});
