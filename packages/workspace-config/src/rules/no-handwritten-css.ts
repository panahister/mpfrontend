import type {Rule} from 'eslint';

type Node = {type: string; [key: string]: unknown};
type Options = {css?: 'forbid' | 'global-entry'; inlineStyle?: 'custom-properties' | 'forbid'};

/**
 * At-rules a global entry may hold: imports, Tailwind source registration, layers and conditional base rules.
 * Keyframes, font faces, `@theme` and `@utility` belong in a theme file or a framework component.
 */
export const globalEntryAtRules: ReadonlySet<string> = new Set([
  'import', 'source', 'reference', 'plugin', 'config', 'layer', 'media', 'supports', 'container', 'charset',
  'namespace', 'custom-variant', 'variant',
]);

function selectorFindings(node: Node, found: Node[]) {
  if (node.type === 'ClassSelector' || node.type === 'IdSelector') found.push(node);
  for (const child of (node.children as Node[] | undefined) ?? []) selectorFindings(child, found);
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {description: 'Allow CSS only in the theme layer and one global entry of imports and base element rules'},
    schema: [{
      type: 'object',
      properties: {
        css: {enum: ['forbid', 'global-entry']},
        inlineStyle: {enum: ['custom-properties', 'forbid']},
      },
      additionalProperties: false,
    }],
    messages: {
      cssFile: 'Hand-written CSS outside the theme layer: take layout from framework components and utility ' +
        'classes, and put token values in the theme file.',
      globalSelector: "The global entry holds only imports and base element rules; '{{selector}}' is a component " +
        'or layout rule. Use framework components and utility classes instead.',
      globalAtRule: "The global entry holds only imports and base element rules; '@{{name}}' belongs in a theme file.",
      inlineStyle: 'Inline styles are hand-written CSS; use utility classes. Only CSS custom properties may be set inline.',
      styleElement: 'A <style> element is hand-written CSS; use utility classes or the theme file.',
    },
  },
  create(context) {
    const options = (context.options[0] ?? {}) as Options;
    if ((context.sourceCode.ast as unknown as Node).type === 'StyleSheet') {
      const mode = options.css ?? 'forbid';
      if (mode === 'forbid') {
        return {
          StyleSheet(node: Node) {
            const first = (node.children as Node[])[0];
            if (first) context.report({node: first as never, messageId: 'cssFile'});
          },
        } as unknown as Rule.RuleListener;
      }
      return {
        Rule(node: Node) {
          const found: Node[] = [];
          selectorFindings(node.prelude as Node, found);
          for (const selector of found) {
            context.report({node: selector as never, messageId: 'globalSelector', data: {selector: context.sourceCode.getText(selector as never)}});
          }
        },
        Atrule(node: Node) {
          const name = String(node.name).toLowerCase();
          if (!globalEntryAtRules.has(name)) context.report({node: node as never, messageId: 'globalAtRule', data: {name}});
        },
      } as unknown as Rule.RuleListener;
    }
    const inline = options.inlineStyle ?? 'custom-properties';
    return {
      JSXAttribute(node: Rule.Node) {
        const attribute = node as unknown as Node;
        const name = attribute.name as Node;
        if (name.type !== 'JSXIdentifier' || name.name !== 'style') return;
        const container = attribute.value as Node | null;
        const expression = container?.type === 'JSXExpressionContainer' ? container.expression as Node : undefined;
        const onlyCustomProperties = inline === 'custom-properties' && expression?.type === 'ObjectExpression' &&
          (expression.properties as Node[]).every(property => {
            const key = property.key as Node | undefined;
            return property.type === 'Property' && key?.type === 'Literal' && typeof key.value === 'string' && key.value.startsWith('--');
          });
        if (!onlyCustomProperties) context.report({node, messageId: 'inlineStyle'});
      },
      JSXOpeningElement(node: Rule.Node) {
        const name = (node as unknown as Node).name as Node;
        if (name.type === 'JSXIdentifier' && name.name === 'style') context.report({node, messageId: 'styleElement'});
      },
    } as unknown as Rule.RuleListener;
  },
};
export default rule;
