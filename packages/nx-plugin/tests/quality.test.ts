import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises';
import {join, dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {ESLint} from 'eslint';
import * as prettier from 'prettier';
import {workspaceConfig} from '@mpfrontend/workspace-config/eslint';
import formatter from '@mpfrontend/workspace-config/prettier';
import {applicationFiles, workspaceFiles} from '../src/index.js';

const shortName = 'ab', longName = 'a' + 'b'.repeat(48);
/** Files that the generated .prettierignore leaves to the tool that writes them. */
const toolOwned = (path: string) => path.startsWith('.mpfrontend/') || path === 'pnpm-workspace.yaml' || path.endsWith('next-env.d.ts');

async function unformatted(files: Record<string, string>): Promise<string[]> {
  const failures: string[] = [];
  for (const [path, content] of Object.entries(files)) {
    if (toolOwned(path)) continue;
    const info = await prettier.getFileInfo(path);
    if (!info.inferredParser) continue;
    if (!await prettier.check(content, {...formatter, filepath: path})) failures.push(path);
  }
  return failures;
}

test('init writes the quality profile, the check and a CI-neutral gate', () => {
  const files = workspaceFiles('consumer');
  const manifest = JSON.parse(files['package.json']!);
  assert.equal(manifest.scripts.check, 'prettier --check . && nx run-many -t lint typecheck test build generated-check');
  assert.equal(manifest.scripts['format:check'], 'prettier --check .');
  assert.equal(manifest.scripts.format, 'prettier --write .');
  for (const dependency of ['@mpfrontend/workspace-config', 'eslint', 'prettier', 'tsx', 'nx', 'typescript']) {
    assert.ok(manifest.devDependencies[dependency], dependency + ' is pinned by init');
  }
  const nx = JSON.parse(files['nx.json']!);
  for (const target of ['build', 'typecheck', 'lint', 'test', 'format:check']) {
    assert.equal(nx.targetDefaults[target].cache, true, target + ' is cached');
    assert.deepEqual(nx.targetDefaults[target].inputs, ['default', 'sharedGlobals']);
  }
  assert.ok(nx.namedInputs.sharedGlobals.includes('{workspaceRoot}/eslint.config.mjs'));
  assert.match(files['eslint.config.mjs']!, /workspaceConfig\(\)/);
  assert.match(files['prettier.config.mjs']!, /@mpfrontend\/workspace-config\/prettier/);
  assert.match(files['.prettierignore']!, /contracts\/openapi\//);
  assert.match(files['.github/workflows/check.yml']!, /run: sh tools\/ci\/check\.sh/);
  assert.match(files['tools/ci/check.sh']!, /pnpm install --frozen-lockfile\npnpm check --skip-nx-cache\n$/);
  assert.match(files['AGENTS.md']!, /pnpm check/);
});

test('create app writes format, format:check, lint and test targets and extends the shared configuration', async () => {
  const files = await applicationFiles('sample');
  const project = JSON.parse(files['project.json']!);
  assert.equal(project.targets.format.options.command, 'pnpm exec prettier --write apps/sample');
  assert.equal(project.targets['format:check'].options.command, 'pnpm exec prettier --check apps/sample');
  assert.equal(project.targets.lint.options.command, 'pnpm exec eslint apps/sample');
  assert.match(project.targets.test.options.command, /^node --import tsx --test "apps\/sample\/src\/\*\*\/\*\.test\.ts"/);
  assert.deepEqual(project.tags, ['scope:sample', 'runtime:mixed', 'type:app']);
  assert.equal(JSON.parse(files['tsconfig.json']!).extends, '@mpfrontend/workspace-config/tsconfig/next.json');
  assert.match(files['eslint.config.mjs']!, /from '\.\.\/\.\.\/eslint\.config\.mjs'/);
  assert.ok(Object.keys(files).some(path => path.endsWith('.test.ts')), 'the template ships a test for its test target');
});

test('every generated file passes the shared formatter for the shortest and the longest names', async () => {
  for (const name of [shortName, longName]) {
    assert.deepEqual(await unformatted(workspaceFiles(name)), [], 'workspace ' + name);
    assert.deepEqual(await unformatted(await applicationFiles(name)), [], 'app ' + name);
  }
});

test('the global style entry holds only imports and base element rules', async () => {
  const css = (await applicationFiles('sample'))['src/app/globals.css']!;
  assert.doesNotMatch(css, /\.mp-(shell|controls|status|alert)/);
  assert.match(css, /@import 'tailwindcss';/);
  assert.match(css, /@import '@mpfrontend\/ui\/tailwind\.css';/);
});

test('the generated application passes the shared lint rules', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mpfrontend-quality-'));
  try {
    for (const [path, content] of Object.entries(await applicationFiles('sample'))) {
      const target = join(directory, 'apps/sample', path);
      await mkdir(dirname(target), {recursive: true});
      await writeFile(target, content);
    }
    // Module boundaries need the Nx project graph; the packed consumer check runs them in a real workspace.
    const eslint = new ESLint({cwd: directory, overrideConfigFile: true,
      overrideConfig: [...workspaceConfig(), {rules: {'@nx/enforce-module-boundaries': 'off'}}]});
    const results = await eslint.lintFiles(['apps']);
    const problems = results.flatMap(result => result.messages.map(message =>
      result.filePath.slice(directory.length + 1) + ':' + message.line + ' ' + (message.ruleId ?? 'fatal') + ' ' + message.message));
    assert.deepEqual(problems, []);
    assert.ok(results.some(result => result.filePath.endsWith('globals.css')), 'CSS is linted');
    assert.ok(results.some(result => result.filePath.endsWith('catalog.tsx')), 'TSX is linted');
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});
