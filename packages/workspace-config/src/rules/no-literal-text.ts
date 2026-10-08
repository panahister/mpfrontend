import type {Rule} from 'eslint';

type Node = {type: string; parent?: Node; [key: string]: unknown};
type Options = {translators?: string[]; attributes?: string[]; allow?: string[]};

/** Attributes whose values a person reads or hears. */
export const visibleTextAttributes: readonly string[] = [
  'alt', 'title', 'placeholder', 'aria-label', 'aria-description', 'aria-placeholder', 'aria-roledescription',
  'aria-valuetext', 'label', 'helper', 'error', 'caption', 'loadingLabel', 'saveLabel', 'skipLinkLabel',
];
const letters = /\p{L}/u;

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {description: 'Require catalog messages for user-visible text and forbid composing translated text'},
    schema: [{
      type: 'object',
      properties: {
        translators: {type: 'array', items: {type: 'string'}},
        attributes: {type: 'array', items: {type: 'string'}},
        allow: {type: 'array', items: {type: 'string'}},
      },
      additionalProperties: false,
    }],
    messages: {
      literalText: "'{{text}}' is user-visible text written in code; take it from a catalog message.",
      joinedTranslation: 'A translated message is joined to other text or a value; write one message with named ' +
        'parameters so that each locale places them.',
    },
  },
  create(context) {
    const options = (context.options[0] ?? {}) as Options;
    const translators = new Set(options.translators ?? ['t']);
    const attributes = new Set(options.attributes ?? visibleTextAttributes);
    // The documented allowlist: patterns of strings that are not user-visible text, such as a separator.
    const allow = (options.allow ?? []).map(pattern => new RegExp(pattern, 'u'));
    const visible = (text: string) => letters.test(text) && !allow.some(pattern => pattern.test(text.trim()));
    const isTranslation = (node: Node | undefined): boolean => {
      if (node?.type !== 'CallExpression') return false;
      const callee = node.callee as Node;
      if (callee.type === 'Identifier') return translators.has(String(callee.name));
      return callee.type === 'MemberExpression' && (callee.property as Node).type === 'Identifier' && translators.has(String((callee.property as Node).name));
    };
    const operands = (node: Node): Node[] =>
      node.type === 'BinaryExpression' && node.operator === '+' ? [...operands(node.left as Node), ...operands(node.right as Node)] : [node];
    const report = (node: Node, messageId: string, text?: string) =>
      context.report({node: node as never, messageId, ...(text === undefined ? {} : {data: {text: text.trim().slice(0, 40)}})});
    return {
      JSXText(node: Rule.Node) {
        const value = String((node as unknown as Node).value);
        if (visible(value)) report(node as unknown as Node, 'literalText', value);
      },
      JSXAttribute(node: Rule.Node) {
        const attribute = node as unknown as Node;
        const name = attribute.name as Node;
        if (name.type !== 'JSXIdentifier' || !attributes.has(String(name.name))) return;
        let value = attribute.value as Node | null;
        if (value?.type === 'JSXExpressionContainer') value = value.expression as Node;
        if (value?.type === 'Literal' && typeof value.value === 'string' && visible(value.value)) report(value, 'literalText', value.value);
        if (value?.type === 'TemplateLiteral' && (value.quasis as Node[]).some(quasi => visible(String((quasi.value as {cooked?: string}).cooked ?? '')))) {
          report(value, 'literalText', String(((value.quasis as Node[])[0]!.value as {cooked?: string}).cooked ?? ''));
        }
      },
      JSXExpressionContainer(node: Rule.Node) {
        const container = node as unknown as Node, expression = container.expression as Node;
        const inChildren = container.parent?.type === 'JSXElement' || container.parent?.type === 'JSXFragment';
        if (inChildren && expression.type === 'Literal' && typeof expression.value === 'string' && visible(expression.value)) {
          report(expression, 'literalText', expression.value);
        }
      },
      'JSXElement, JSXFragment'(node: Rule.Node) {
        const children = ((node as unknown as Node).children as Node[]).filter(child =>
          !(child.type === 'JSXText' && String(child.value).trim() === '') &&
          !(child.type === 'JSXExpressionContainer' && (child.expression as Node).type === 'JSXEmptyExpression'));
        if (children.length < 2) return;
        const textual = (child: Node) => child.type === 'JSXText' ||
          (child.type === 'JSXExpressionContainer' && !['JSXElement', 'JSXFragment'].includes((child.expression as Node).type));
        if (!children.every(textual)) return;
        const translated = children.find(child => child.type === 'JSXExpressionContainer' && isTranslation(child.expression as Node));
        if (translated) report(translated, 'joinedTranslation');
      },
      BinaryExpression(node: Rule.Node) {
        const binary = node as unknown as Node;
        if (binary.operator !== '+' || (binary.parent?.type === 'BinaryExpression' && binary.parent.operator === '+')) return;
        const parts = operands(binary);
        if (parts.length > 1 && parts.some(isTranslation)) report(binary, 'joinedTranslation');
      },
      TemplateLiteral(node: Rule.Node) {
        const template = node as unknown as Node;
        const expressions = template.expressions as Node[];
        if (!expressions.some(isTranslation)) return;
        const text = (template.quasis as Node[]).some(quasi => String((quasi.value as {cooked?: string}).cooked ?? '') !== '');
        if (text || expressions.length > 1) report(template, 'joinedTranslation');
      },
    } as unknown as Rule.RuleListener;
  },
};
export default rule;
