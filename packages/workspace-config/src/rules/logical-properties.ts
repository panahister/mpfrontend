import type {Rule} from 'eslint';

/** A loosely typed AST node: the rule serves both the JavaScript and the CSS language. */
type Node = {type: string; parent?: Node; [key: string]: unknown};
/** One allowed physical value and why it is needed; a value without a reason is refused by the schema. */
export type PhysicalAllowance = Readonly<{value: string; reason: string}>;

/** A spacing or inset value of a utility: a number, a fraction, px, auto, full or an arbitrary value. */
const amount = String.raw`(?:\d+(?:\.\d+)?(?:\/\d+)?|px|auto|full|\[[^\]\s]+\]|\([^)\s]+\))`;
/**
 * Utilities of a physical side. The logical forms (ms, me, ps, pe, start, end, border-s, border-e,
 * rounded-s, rounded-e, text-start, text-end, float-start, float-end) never match.
 */
const physicalUtility = new RegExp(String.raw`^-?(?:(?:scroll-)?[mp][lr]-${amount}|(?:left|right)-${amount}|border-[lr](?:-.+)?|rounded-(?:l|r|tl|tr|bl|br)(?:-.+)?|text-(?:left|right)|float-(?:left|right)|clear-(?:left|right))$`);
const logicalHint: ReadonlyArray<readonly [RegExp, string]> = [
  [/^-?(?:scroll-)?m[lr]-/, 'ms-* or me-*'], [/^-?(?:scroll-)?p[lr]-/, 'ps-* or pe-*'], [/^-?(?:left|right)-/, 'start-* or end-*'],
  [/^border-[lr]/, 'border-s or border-e'], [/^rounded-/, 'rounded-s, rounded-e, rounded-ss, rounded-se, rounded-es or rounded-ee'],
  [/^text-/, 'text-start or text-end'], [/^float-/, 'float-start or float-end'], [/^clear-/, 'clear-start or clear-end'],
];
/** CSS properties of a physical side, and their logical forms. */
const physicalProperties: ReadonlyMap<string, string> = new Map([
  ['margin-left', 'margin-inline-start'], ['margin-right', 'margin-inline-end'], ['padding-left', 'padding-inline-start'],
  ['padding-right', 'padding-inline-end'], ['left', 'inset-inline-start'], ['right', 'inset-inline-end'],
  ['border-left', 'border-inline-start'], ['border-right', 'border-inline-end'], ['border-left-width', 'border-inline-start-width'],
  ['border-right-width', 'border-inline-end-width'], ['border-left-color', 'border-inline-start-color'],
  ['border-right-color', 'border-inline-end-color'], ['border-left-style', 'border-inline-start-style'],
  ['border-right-style', 'border-inline-end-style'], ['border-top-left-radius', 'border-start-start-radius'],
  ['border-top-right-radius', 'border-start-end-radius'], ['border-bottom-left-radius', 'border-end-start-radius'],
  ['border-bottom-right-radius', 'border-end-end-radius'], ['scroll-margin-left', 'scroll-margin-inline-start'],
  ['scroll-margin-right', 'scroll-margin-inline-end'], ['scroll-padding-left', 'scroll-padding-inline-start'],
  ['scroll-padding-right', 'scroll-padding-inline-end'],
]);
/** Properties whose keyword value `left` or `right` is physical. */
const sideValueProperties = new Set(['text-align', 'float', 'clear']);
const kebab = (name: string) => name.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase());

/** The physical utilities of a class string: each token without its variants (`md:`, `rtl:`) and `!`. */
function physicalTokens(text: string): string[] {
  const found: string[] = [];
  for (const token of text.split(/\s+/)) {
    const utility = token.slice(token.lastIndexOf(':') + 1).replace(/^!|!$/g, '');
    if (physicalUtility.test(utility)) found.push(utility);
  }
  return found;
}
function hint(utility: string): string {
  return logicalHint.find(([pattern]) => pattern.test(utility))?.[1] ?? 'the inline-start or inline-end form';
}

/** A module path or a type is never a class string. */
function skipped(value: Node): boolean {
  let parent = value.parent;
  if (parent?.type === 'JSXExpressionContainer') parent = parent.parent;
  if (!parent) return false;
  if (['ImportDeclaration', 'ExportAllDeclaration', 'ExportNamedDeclaration', 'ImportExpression', 'TSExternalModuleReference',
    'TSImportType', 'TSLiteralType'].includes(parent.type)) return true;
  return parent.type === 'CallExpression' && (parent.callee as Node).type === 'Identifier' && (parent.callee as Node).name === 'require';
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {description: 'Disallow physical left and right in class names, inline styles and CSS; use logical properties'},
    schema: [{
      type: 'object',
      properties: {
        allow: {
          type: 'array',
          items: {
            type: 'object',
            properties: {value: {type: 'string', minLength: 1}, reason: {type: 'string', minLength: 10}},
            required: ['value', 'reason'],
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    }],
    messages: {
      physical: "Physical '{{value}}': use {{logical}} so that the layout follows the text direction, or allow it " +
        'with a reason in the workspace configuration.',
    },
  },
  create(context) {
    const allowed = new Set(((context.options[0] as {allow?: PhysicalAllowance[]} | undefined)?.allow ?? []).map(entry => entry.value));
    const report = (node: Node, value: string, logical: string) => {
      if (!allowed.has(value)) context.report({node: node as never, messageId: 'physical', data: {value, logical}});
    };
    const strings = (node: Node, text: string) => {
      for (const utility of new Set(physicalTokens(text))) report(node, utility, hint(utility));
    };
    if ((context.sourceCode.ast as unknown as Node).type === 'StyleSheet') {
      return {
        Declaration(node: Node) {
          const property = String(node.property).toLowerCase();
          const logical = physicalProperties.get(property);
          if (logical) {report(node, property, logical); return;}
          if (!sideValueProperties.has(property)) return;
          const value = context.sourceCode.getText(node.value as never).trim().toLowerCase();
          if (value === 'left' || value === 'right') report(node, property + ': ' + value, property + ': ' + (value === 'left' ? 'start' : 'end'));
        },
        Atrule(node: Node) {
          if (String(node.name).toLowerCase() === 'apply' && node.prelude) strings(node, context.sourceCode.getText(node.prelude as never));
        },
      } as unknown as Rule.RuleListener;
    }
    return {
      Literal(node) {
        const value = node as unknown as Node;
        if (typeof value.value === 'string' && !skipped(value)) strings(value, value.value);
      },
      TemplateLiteral(node) {
        const value = node as unknown as Node;
        if (skipped(value)) return;
        for (const quasi of value.quasis as Node[]) {
          const cooked = (quasi.value as {cooked?: string | null}).cooked;
          if (cooked) strings(quasi, cooked);
        }
      },
      // An inline style object: a physical property name, or a left or right keyword of a side property.
      Property(node) {
        const property = node as unknown as Node;
        const object = property.parent;
        const container = object?.parent?.type === 'JSXExpressionContainer' ? object.parent.parent : undefined;
        if (object?.type !== 'ObjectExpression' || container?.type !== 'JSXAttribute') return;
        const attribute = (container.name as Node).name;
        if (attribute !== 'style') return;
        const key = property.key as Node;
        const name = key.type === 'Identifier' && !property.computed ? kebab(String(key.name))
          : key.type === 'Literal' && typeof key.value === 'string' ? key.value.toLowerCase() : undefined;
        if (name === undefined) return;
        const logical = physicalProperties.get(name);
        if (logical) {report(property, String(key.type === 'Identifier' ? key.name : key.value), logical); return;}
        const value = property.value as Node;
        if (sideValueProperties.has(name) && value.type === 'Literal' && (value.value === 'left' || value.value === 'right')) {
          report(property, name + ': ' + String(value.value), name + ': ' + (value.value === 'left' ? 'start' : 'end'));
        }
      },
    };
  },
};
export default rule;
