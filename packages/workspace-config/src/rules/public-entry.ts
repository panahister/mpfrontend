import type {Rule} from 'eslint';
import {dirname, posix, resolve, sep} from 'node:path';

type Node = {type: string; source?: {type: string; value?: unknown} | null; [key: string]: unknown};

/** Folders whose units are imported from outside only through their `index.ts`. */
const unitFolders = ['features', 'entities'] as const;

/** `/x/src/features/orders/ui/view.tsx` -> `{kind: 'features', unit: '/x/src/features/orders', rest: 'ui/view.tsx'}`. */
export function unitOf(path: string): {kind: string; unit: string; rest: string} | undefined {
  const parts = path.split('/');
  for (let index = parts.length - 3; index >= 0; index--) {
    if (parts[index] !== 'src' || !unitFolders.includes(parts[index + 1] as never) || !parts[index + 2]) continue;
    return {kind: parts[index + 1]!, unit: parts.slice(0, index + 3).join('/'), rest: parts.slice(index + 3).join('/')};
  }
  return undefined;
}

/** The public entry is the unit folder itself or its index module, with or without an extension. */
function isEntry(rest: string): boolean {
  return rest === '' || /^index(?:\.(?:ts|tsx|js|mjs))?$/.test(rest);
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {description: 'Import a feature or an entity from outside only through its index.ts public entry'},
    schema: [],
    messages: {
      privateImport: "'{{source}}' reaches inside the {{kind}} unit '{{unit}}'; import its public entry " +
        "'{{entry}}' instead, and export what you need from its index.ts.",
    },
  },
  create(context) {
    const filename = context.filename.split(sep).join('/');
    const importer = unitOf(filename);
    const check = (node: Node, source: unknown) => {
      if (typeof source !== 'string' || !source.startsWith('.')) return;
      const target = posix.normalize(resolve(dirname(filename), source).split(sep).join('/'));
      const unit = unitOf(target);
      if (!unit || isEntry(unit.rest) || importer?.unit === unit.unit) return;
      const entry = posix.relative(posix.dirname(filename), unit.unit) || '.';
      context.report({
        node: node as never,
        messageId: 'privateImport',
        data: {source, kind: unit.kind === 'features' ? 'feature' : 'entity', unit: posix.basename(unit.unit), entry: entry.startsWith('.') ? entry : './' + entry},
      });
    };
    return {
      ImportDeclaration(node) { check(node as unknown as Node, (node as unknown as Node).source?.value); },
      ExportNamedDeclaration(node) { check(node as unknown as Node, (node as unknown as Node).source?.value); },
      ExportAllDeclaration(node) { check(node as unknown as Node, (node as unknown as Node).source?.value); },
      ImportExpression(node) {
        const source = (node as unknown as Node).source;
        if (source?.type === 'Literal') check(node as unknown as Node, source.value);
      },
    };
  },
};
export default rule;
