import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {applicationFiles, packageFiles, workspaceFiles} from '../src/index.js';

/** The backticked names in the sentences that speak of Nx or of targets, such as "Run the `lint` target". */
function namedTargets(text: string): string[] {
  const names: string[] = [];
  for (const sentence of text.replace(/\n/g, ' ').split(/(?<=[.;])\s+/)) {
    if (!/\b(?:Nx|targets?)\b/.test(sentence)) continue;
    for (const match of sentence.matchAll(/`([a-z][a-z0-9]*(?:[-:][a-z0-9]+)*)`/g)) names.push(match[1]!);
  }
  return names;
}

test('every target that a generated skill or document names exists in a generated workspace', async () => {
  // The skills a workspace installs come from the ai-skills package; the documents come from init and create app.
  const skills = fileURLToPath(new URL('../../ai-skills/skills/', import.meta.url));
  const texts: Array<[string, string]> = [];
  for (const name of await readdir(skills)) texts.push([name, await readFile(join(skills, name, 'SKILL.md'), 'utf8')]);
  const workspace = workspaceFiles('consumer'), app = await applicationFiles('sample');
  const library = await packageFiles('shared-format', 'consumer', 'packages/shared-format');
  for (const [path, content] of Object.entries({...workspace, ...app})) if (path.endsWith('.md')) texts.push([path, content]);
  const defined = new Set([
    ...Object.keys((JSON.parse(app['project.json']!) as {targets: object}).targets),
    ...Object.keys((JSON.parse(library['packages/shared-format/project.json']!) as {targets: object}).targets),
    ...Object.keys((JSON.parse(workspace['package.json']!) as {scripts: object}).scripts),
  ]);
  const missing = texts.flatMap(([source, text]) => namedTargets(text).filter(name => !defined.has(name)).map(name => source + ': ' + name));
  assert.ok(texts.length > 18, 'read ' + texts.length + ' skills and documents');
  assert.deepEqual([...new Set(missing)], []);
});
