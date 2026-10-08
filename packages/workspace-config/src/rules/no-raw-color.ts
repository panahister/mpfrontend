import type {Rule} from 'eslint';
import {
  colorFunctions, colorProperties, declarationColors, kebab, literalColors, namedColors, namedColorWords,
  utilityColors, type ColorFinding,
} from '../colors.js';

/** A loosely typed AST node: the rule serves both the JavaScript and the CSS language. */
type Node = {type: string; parent?: Node; [key: string]: unknown};

/** Attributes whose values are references, not colours: `href="#add"` is a fragment. */
const referenceAttributes = new Set([
  'href', 'id', 'htmlFor', 'for', 'to', 'src', 'srcSet', 'action', 'formAction', 'aria-controls',
  'aria-describedby', 'aria-labelledby', 'aria-owns', 'aria-activedescendant', 'xlinkHref',
]);
/** JSX attributes that take a colour directly, mostly on SVG elements. */
const colorAttributes = new Set(['color', 'fill', 'stroke', 'stopColor', 'floodColor', 'lightingColor', 'bgcolor']);
/** CSS properties whose identifiers are author-defined names, so a word such as `tan` there is not a colour. */
const identifierProperties = new Set([
  'animation', 'animation-name', 'font', 'font-family', 'font-palette', 'grid-area', 'grid-row', 'grid-column',
  'grid-template', 'grid-template-areas', 'counter-reset', 'counter-increment', 'counter-set', 'list-style',
  'list-style-type', 'transition', 'transition-property', 'will-change', 'container', 'container-name',
  'view-transition-name', 'anchor-name', 'position-anchor', 'timeline-scope', 'scroll-timeline-name',
  'view-timeline-name', 'src',
]);

function attributeName(node: Node | undefined): string | undefined {
  if (node?.type !== 'JSXAttribute') return undefined;
  const name = node.name as Node;
  if (name.type === 'JSXIdentifier') return String(name.name);
  if (name.type === 'JSXNamespacedName') return String((name.namespace as Node).name) + ':' + String((name.name as Node).name);
  return undefined;
}

function propertyKey(node: Node | undefined, value: Node): string | undefined {
  if (node?.type !== 'Property' || node.value !== value) return undefined;
  const key = node.key as Node;
  if (key.type === 'Identifier' && !node.computed) return kebab(String(key.name));
  if (key.type === 'Literal' && typeof key.value === 'string') return key.value.toLowerCase();
  return undefined;
}

/** Where a string sits decides how it is read: a module path, a reference, a colour slot or free text. */
function context(value: Node): 'skip' | 'color' | 'text' {
  let parent = value.parent;
  if (parent?.type === 'JSXExpressionContainer') parent = parent.parent;
  if (!parent) return 'text';
  if (['ImportDeclaration', 'ExportAllDeclaration', 'ExportNamedDeclaration', 'ImportExpression', 'TSExternalModuleReference',
    'TSImportType', 'TSLiteralType'].includes(parent.type)) return 'skip';
  if (parent.type === 'CallExpression' && (parent.callee as Node).type === 'Identifier' && (parent.callee as Node).name === 'require') return 'skip';
  const attribute = attributeName(parent);
  if (attribute !== undefined) {
    if (referenceAttributes.has(attribute)) return 'skip';
    if (colorAttributes.has(attribute)) return 'color';
  }
  const key = propertyKey(parent, value);
  if (key !== undefined && (colorProperties.has(key) || key.startsWith('--'))) return 'color';
  return 'text';
}

function stringFindings(text: string, slot: 'color' | 'text'): ColorFinding[] {
  const utilities = utilityColors(text);
  // A colour inside a reported utility, such as the hex of `bg-[#123456]`, is reported once, as the utility.
  const inside = (finding: ColorFinding) =>
    utilities.some(utility => finding.index >= utility.index && finding.index < utility.index + utility.value.length);
  const findings = [...literalColors(text).filter(finding => !inside(finding)), ...utilities, ...declarationColors(text)];
  if (slot === 'color') findings.push(...namedColorWords(text).filter(finding => !inside(finding)));
  return findings;
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {description: 'Disallow raw colour values outside the token and theme files'},
    schema: [],
    messages: {
      rawColor: "Raw colour '{{value}}': use a design token (a CSS variable such as var(--mp-surface-panel)) " +
        'or move the value into a theme file.',
    },
  },
  create(context_) {
    const report = (node: Node, findings: readonly ColorFinding[]) => {
      const seen = new Set<string>();
      for (const finding of findings) {
        if (seen.has(finding.value)) continue;
        seen.add(finding.value);
        context_.report({node: node as never, messageId: 'rawColor', data: {value: finding.value}});
      }
    };
    if ((context_.sourceCode.ast as unknown as Node).type === 'StyleSheet') {
      const walk = (node: Node, property: string, findings: ColorFinding[]) => {
        if (node.type === 'Hash') findings.push({value: '#' + String(node.value), index: 0});
        if (node.type === 'Function' && colorFunctions.has(String(node.name).toLowerCase())) {
          findings.push({value: String(node.name) + '()', index: 0});
        }
        if (node.type === 'Identifier' && namedColors.has(String(node.name).toLowerCase()) && !identifierProperties.has(property)) {
          findings.push({value: String(node.name), index: 0});
        }
        if (node.type === 'Raw') {
          const text = String(node.value);
          findings.push(...literalColors(text), ...namedColorWords(text));
        }
        for (const child of (node.children as Node[] | undefined) ?? []) walk(child, property, findings);
      };
      return {
        Declaration(node: Node) {
          const findings: ColorFinding[] = [];
          walk(node.value as Node, String(node.property).toLowerCase(), findings);
          report(node, findings);
        },
        Atrule(node: Node) {
          if (String(node.name).toLowerCase() !== 'apply' || !node.prelude) return;
          report(node, utilityColors(context_.sourceCode.getText(node.prelude as never)));
        },
      } as unknown as Rule.RuleListener;
    }
    return {
      Literal(node) {
        const value = node as unknown as Node;
        if (typeof value.value !== 'string') return;
        const slot = context(value);
        if (slot !== 'skip') report(value, stringFindings(value.value, slot));
      },
      TemplateLiteral(node) {
        const value = node as unknown as Node;
        const slot = context(value);
        if (slot === 'skip') return;
        for (const quasi of value.quasis as Node[]) {
          const cooked = (quasi.value as {cooked?: string | null}).cooked;
          if (cooked) report(quasi, stringFindings(cooked, slot));
        }
      },
    };
  },
};
export default rule;
