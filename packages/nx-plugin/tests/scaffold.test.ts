import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {join, relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ESLint} from 'eslint';
import * as prettier from 'prettier';
import {createTreeWithEmptyWorkspace} from '@nx/devkit/testing';
import {workspaceConfig} from '@mpfrontend/workspace-config/eslint';
import formatter from '@mpfrontend/workspace-config/prettier';
import {applicationFiles, createApplication, createFeature, createPackage, createRoute, featureFiles, routeFiles} from '../src/index.js';
import featureGenerator from '../src/feature-generator.js';
import routeGenerator from '../src/route-generator.js';
import packageGenerator from '../src/package-generator.js';
import applicationGenerator from '../src/generator.js';

// Temporary workspaces live under the repository's ignored dependency cache, so that the workspace
// formatter (Prettier) resolves as it does in a consumer workspace.
const cache = fileURLToPath(new URL('../../../node_modules/.cache/', import.meta.url));

async function workspace(): Promise<string> {
  await mkdir(cache, {recursive: true});
  const root = await mkdtemp(join(cache, 'mpfrontend-scaffold-'));
  try {
    await writeFile(join(root, 'package.json'), JSON.stringify({name: 'acme', private: true}) + '\n');
    await writeFile(join(root, 'prettier.config.mjs'), 'export default ' + JSON.stringify(formatter) + ';\n');
    await mkdir(join(root, 'apps'));
    await createApplication({name: 'web', directory: join(root, 'apps/web')});
    return root;
  } catch (error) {
    await rm(root, {recursive: true, force: true});
    throw error;
  }
}
async function files(root: string, directory = ''): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(join(root, directory), {withFileTypes: true})) {
    const path = directory ? directory + '/' + entry.name : entry.name;
    if (entry.isDirectory()) result.push(...await files(root, path));
    else result.push(path);
  }
  return result.sort();
}

test('the template catalog example is the output of the feature and route generators', async () => {
  const app = await applicationFiles('web');
  const feature = await featureFiles('catalog', {resource: 'catalog', generatedOutput: 'src/api/generated/catalog'});
  // The template translates its example's catalogs; every other generated file is used as generated.
  const translated = ['src/features/catalog/model/messages/ar.ts', 'src/features/catalog/model/messages/fa.ts'];
  for (const [path, content] of Object.entries(feature)) if (!translated.includes(path)) assert.equal(app[path], content, path);
  for (const path of translated) assert.notEqual(app[path], feature[path], path + ' is translated');
  for (const [path, content] of Object.entries({...routeFiles('catalog', 'catalog', 'CatalogScreen'),
    ...routeFiles('catalog/[position]', 'catalog', 'CatalogDetailScreen')})) assert.equal(app[path], content, path);
  for (const folder of ['ui', 'model', 'hooks', 'api', 'utils']) {
    assert.ok(Object.keys(feature).some(path => path.startsWith('src/features/catalog/' + folder + '/')), folder);
  }
  assert.ok(feature['src/features/catalog/index.ts']);
  assert.ok(feature['src/entities/catalog/index.ts'], 'a shared entity place');
  assert.match(feature['src/api/server/catalog.ts']!, /from '\.\.\/generated\/catalog\/read-models\.gen'/);
  assert.equal(JSON.parse(app['ftg.config.json']!).output, 'src/api/generated/catalog');
  // The view renders and emits intent; fetching and persistence are outside it.
  const list = feature['src/features/catalog/ui/catalog-list.tsx']!;
  assert.doesNotMatch(list, /\bfetch\(|document\.cookie|useState/);
  assert.match(app['src/features/preferences/api/preference-cookie.ts']!, /document\.cookie/);
});

test('create app writes the repository files of the layout standard without values', async () => {
  const app = await applicationFiles('web');
  assert.equal(app['.env.example'], '# Environment variables this app reads. Supply values from the deployment, never from this file.\nBFF_ORIGIN=\nENABLE_API_DOCS=\n');
  for (const line of app['.env.example']!.split('\n')) assert.ok(line === '' || line.startsWith('#') || line.endsWith('='), line);
  assert.ok(app['docs/overview.md']?.includes('/catalog/[position]'));
  assert.ok(app['docs/api-contracts.md']?.includes('src/api/generated/catalog/'));
});

test('a screen feature has the five folders and an entry; dry-run writes nothing; an existing feature is refused', async () => {
  const root = await workspace();
  try {
    const before = await files(root);
    const preview = await createFeature({app: 'apps/web', name: 'order-review', root, dryRun: true});
    assert.deepEqual(await files(root), before);
    assert.equal(preview.kind, 'screen');
    const created = await createFeature({app: 'apps/web', name: 'order-review', root});
    assert.deepEqual(created.files, preview.files);
    assert.equal(created.formatted, true);
    const feature = created.files.map(path => relative('apps/web/src/features/order-review', path));
    for (const folder of ['ui', 'model', 'hooks', 'api', 'utils']) assert.ok(feature.some(path => path.startsWith(folder + '/')), folder);
    assert.ok(feature.includes('index.ts'));
    // A catalog per app locale; the base text is the starting point of every translation.
    for (const code of ['en', 'ar', 'fa']) assert.ok(feature.includes('model/messages/' + code + '.ts'), code);
    assert.ok(feature.includes('model/messages.ts'));
    assert.deepEqual(created.untranslated, ['apps/web/src/features/order-review/model/messages/ar.ts', 'apps/web/src/features/order-review/model/messages/fa.ts']);
    assert.match(await readFile(join(root, 'apps/web/src/features/order-review/model/messages/en.ts'), 'utf8'), /title: 'Order review'/);
    for (const path of created.files) {
      const content = await readFile(join(root, path), 'utf8');
      if ((await prettier.getFileInfo(path)).inferredParser) assert.ok(await prettier.check(content, {...formatter, filepath: path}), path);
    }
    await assert.rejects(createFeature({app: 'apps/web', name: 'order-review', root}), /DESTINATION_EXISTS/);
    await assert.rejects(createFeature({app: 'apps/web', name: 'Order', root}), /INVALID_FEATURE_NAME/);
    await assert.rejects(createFeature({app: '../web', name: 'other', root}), /INVALID_APP_DIRECTORY/);
    await assert.rejects(createFeature({app: 'apps/none', name: 'other', root}), /APP_NOT_FOUND/);
    const manifestPath = join(root, 'apps/web/package.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    delete manifest.dependencies['@mpfrontend/app-layout'];
    await writeFile(manifestPath, JSON.stringify(manifest));
    await assert.rejects(createFeature({app: 'apps/web', name: 'other', root}), /APP_PREREQUISITE_MISSING:@mpfrontend\/app-layout/);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test('a list feature binds a selected read of ftg.config.json and keeps an existing entity and boundary', async () => {
  const root = await workspace();
  try {
    await assert.rejects(createFeature({app: 'apps/web', name: 'archive', resource: 'unknown', root}), /UNKNOWN_RESOURCE/);
    const created = await createFeature({app: 'apps/web', name: 'archive', resource: 'catalog', root});
    assert.equal(created.kind, 'list');
    assert.deepEqual(created.kept, ['apps/web/src/api/server/catalog.ts', 'apps/web/src/entities/catalog/index.ts',
      'apps/web/src/entities/catalog/model/catalog.test.ts', 'apps/web/src/entities/catalog/model/catalog.ts']);
    assert.ok(created.files.every(path => path.startsWith('apps/web/src/features/archive/')));
    assert.match(await readFile(join(root, 'apps/web/src/features/archive/model/archive-fields.ts'), 'utf8'),
      /from '\.\.\/\.\.\/\.\.\/api\/generated\/catalog\/resources\.gen'/);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test('a route renders one feature screen through its public entry, and refuses unknown or occupied targets', async () => {
  const root = await workspace();
  try {
    await createFeature({app: 'apps/web', name: 'archive', resource: 'catalog', root});
    const detail = await createRoute({app: 'apps/web', path: 'archive/[position]', feature: 'archive', screen: 'ArchiveDetailScreen', root});
    const page = await readFile(join(root, detail.files[0]!), 'utf8');
    assert.match(page, /from '\.\.\/\.\.\/\.\.\/features\/archive';/);
    assert.match(page, /type Params = Promise<\{ position: string \}>;/);
    assert.match(page, /basePath="\/archive"/);
    await createRoute({app: 'apps/web', path: 'archive', feature: 'archive', root});
    await assert.rejects(createRoute({app: 'apps/web', path: 'archive', feature: 'archive', root}), /DESTINATION_EXISTS/);
    await assert.rejects(createRoute({app: 'apps/web', path: 'other', feature: 'missing', root}), /UNKNOWN_FEATURE/);
    await assert.rejects(createRoute({app: 'apps/web', path: 'other', feature: 'archive', screen: 'NoScreen', root}), /UNKNOWN_FEATURE_SCREEN/);
    for (const path of ['../x', 'api/x', 'Upper', 'a//b', '[a]/[a]']) {
      await assert.rejects(createRoute({app: 'apps/web', path, feature: 'archive', root}), /INVALID_ROUTE_PATH/, path);
    }
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test('a shared package carries the boundary tags, a public entry and the quality targets', async () => {
  const root = await workspace();
  try {
    const created = await createPackage({name: 'formatting', runtime: 'universal', root});
    const manifest = JSON.parse(await readFile(join(root, 'packages/formatting/package.json'), 'utf8'));
    assert.equal(manifest.name, '@acme/formatting');
    assert.deepEqual(manifest.exports['.'], {types: './dist/index.d.ts', import: './dist/index.js'});
    const project = JSON.parse(await readFile(join(root, 'packages/formatting/project.json'), 'utf8'));
    assert.deepEqual(project.tags, ['type:package', 'scope:shared', 'runtime:universal']);
    for (const target of ['build', 'typecheck', 'format', 'format:check', 'lint', 'test']) assert.ok(project.targets[target], target);
    assert.ok(created.files.includes('packages/formatting/src/index.ts'));
    await assert.rejects(createPackage({name: 'formatting', root}), /DESTINATION_EXISTS/);
    await assert.rejects(createPackage({name: 'other', directory: 'apps/other', root}), /INVALID_PACKAGE_DIRECTORY/);
    await assert.rejects(createPackage({name: 'other', runtime: 'edge' as never, root}), /INVALID_PACKAGE_RUNTIME/);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test('generated features, routes and packages pass the shared lint rules', async () => {
  const root = await workspace();
  try {
    await createFeature({app: 'apps/web', name: 'order-review', root});
    await createRoute({app: 'apps/web', path: 'order-review', feature: 'order-review', root});
    await createPackage({name: 'formatting', root});
    const eslint = new ESLint({cwd: root, overrideConfigFile: true,
      overrideConfig: [...workspaceConfig(), {rules: {'@nx/enforce-module-boundaries': 'off'}}]});
    const results = await eslint.lintFiles(['apps', 'packages']);
    const problems = results.flatMap(result => result.messages.map(message =>
      relative(root, result.filePath) + ':' + message.line + ' ' + (message.ruleId ?? 'fatal') + ' ' + message.message));
    assert.deepEqual(problems, []);
    assert.ok(results.length > 40);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test('the Nx generators write the same files and refuse an existing destination', async () => {
  const tree = createTreeWithEmptyWorkspace();
  tree.write('package.json', JSON.stringify({name: 'acme', private: true}));
  tree.write('.prettierrc', JSON.stringify(formatter));
  // The empty test workspace also configures another formatter; a consumer workspace configures Prettier only.
  for (const name of tree.children('')) if (/^\.?oxfmt/.test(name)) tree.delete(name);
  for (const [path, content] of Object.entries(await applicationFiles('web'))) tree.write('apps/web/' + path, content);
  await featureGenerator(tree, {app: 'apps/web', name: 'order-review'});
  assert.ok(tree.exists('apps/web/src/features/order-review/index.ts'));
  assert.ok(tree.exists('apps/web/src/features/order-review/hooks/use-order-review.ts'));
  await assert.rejects(featureGenerator(tree, {app: 'apps/web', name: 'order-review'}), /DESTINATION_EXISTS/);
  await routeGenerator(tree, {app: 'apps/web', path: 'order-review', feature: 'order-review'});
  const page = tree.read('apps/web/src/app/order-review/page.tsx', 'utf-8')!;
  assert.match(page, /OrderReviewScreen/);
  assert.ok(await prettier.check(page, {...formatter, filepath: 'page.tsx'}), 'formatted by the workspace formatter');
  await assert.rejects(routeGenerator(tree, {app: 'apps/web', path: 'order-review', feature: 'order-review'}), /DESTINATION_EXISTS/);
  await packageGenerator(tree, {name: 'formatting'});
  assert.equal(JSON.parse(tree.read('packages/formatting/package.json', 'utf-8')!).name, '@acme/formatting');
  await assert.rejects(packageGenerator(tree, {name: 'formatting'}), /DESTINATION_EXISTS/);
  await applicationGenerator(tree, {name: 'admin', directory: 'apps/admin'});
  assert.ok(tree.exists('apps/admin/src/features/catalog/index.ts'));
  await assert.rejects(applicationGenerator(tree, {name: 'admin', directory: 'apps/admin'}), /DESTINATION_EXISTS/);
});
