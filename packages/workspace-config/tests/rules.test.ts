import {describe, it} from 'node:test';
import {RuleTester} from 'eslint';
import css from '@eslint/css';
import tseslint from 'typescript-eslint';
import noRawColor from '../src/rules/no-raw-color.js';
import noHandwrittenCss from '../src/rules/no-handwritten-css.js';
import publicEntry from '../src/rules/public-entry.js';
import noLiteralText from '../src/rules/no-literal-text.js';
import logicalProperties from '../src/rules/logical-properties.js';

RuleTester.describe = describe;
RuleTester.it = it;

const code = new RuleTester({
  languageOptions: {parser: tseslint.parser, parserOptions: {ecmaFeatures: {jsx: true}}},
});
const styles = new RuleTester({plugins: {css}, language: 'css/css', languageOptions: {tolerant: true}});
const raw = (value: string) => ({messageId: 'rawColor', data: {value}});

// Each raw-colour case has a failing and a passing form in TS/TSX and in CSS.
code.run('no-raw-color in TS and TSX', noRawColor, {
  valid: [
    {name: 'hex: a token variable instead', code: "const surface = 'var(--mp-surface-panel)';"},
    {name: 'hex: an in-page fragment is a reference', code: 'const link = <a href="#add">Add</a>;'},
    {name: 'hex: a module path is not a colour', code: "import theme from './#fff';"},
    {name: 'rgb(): color-mix of tokens', code: "const mix = 'color-mix(in srgb, var(--mp-a) 40%, var(--mp-b))';"},
    {name: 'rgba(): a token for a translucent surface', code: "const overlay = {background: 'var(--mp-overlay)'};"},
    {name: 'hsl(): a CSS function that is not a colour', code: "const size = 'calc(100% - 2rem)';"},
    {name: 'hsla(): a word that only contains the name', code: "const label = 'hslaNotAColour';"},
    {name: 'named: a status value outside a colour slot', code: "const status = 'red';"},
    {name: 'named: a token in a colour property', code: "const style = {color: 'var(--mp-foreground-primary)'};"},
    {name: 'named: currentColor and transparent are not raw', code: "const style = {fill: 'currentColor', background: 'transparent'};"},
    {name: 'named: a type literal', code: "type Tone = 'red' | 'blue';"},
    {name: 'arbitrary: a token in an arbitrary value', code: 'const card = <div className="bg-[var(--mp-surface-panel)] p-6" />;'},
    {name: 'arbitrary: a non-colour arbitrary value', code: 'const grid = <div className="w-[42rem] grid-cols-[1fr_2fr] h-[calc(100%-2rem)]" />;'},
    {name: 'palette: a token-based utility', code: 'const text = <p className="text-[var(--mp-foreground-secondary)]" />;'},
  ],
  invalid: [
    {name: 'hex in a string', code: "const brand = '#123456';", errors: [raw('#123456')]},
    {name: 'short hex in a template literal', code: 'const brand = `border: 1px solid #abc`;', errors: [raw('#abc')]},
    {name: 'rgb() in a string', code: "const brand = 'rgb(1, 2, 3)';", errors: [raw('rgb(')]},
    {name: 'rgba() in a style object', code: "const overlay = {background: 'rgba(0, 0, 0, 0.4)'};", errors: [raw('rgba(')]},
    {name: 'hsl() in a string', code: "const accent = 'hsl(210 40% 50%)';", errors: [raw('hsl(')]},
    {name: 'hsla() in a string', code: "const accent = 'hsla(210, 40%, 50%, 0.5)';", errors: [raw('hsla(')]},
    {name: 'named colour in a colour property', code: "const style = {backgroundColor: 'rebeccapurple'};", errors: [raw('rebeccapurple')]},
    {name: 'named colour in an SVG attribute', code: 'const icon = <circle fill="red" />;', errors: [raw('red')]},
    {name: 'named colour in a declaration string', code: "const rule = 'color: navy; padding: 0';", errors: [raw('navy')]},
    {name: 'Tailwind arbitrary hex', code: 'const panel = <div className="bg-[#123456]" />;', errors: [raw('bg-[#123456]')]},
    {name: 'Tailwind arbitrary rgb()', code: "const panel = 'text-[rgb(1,2,3)]';", errors: [raw('text-[rgb(1,2,3)]')]},
    {name: 'Tailwind arbitrary named colour with a type hint', code: "const panel = 'border-[color:red]';", errors: [raw('border-[color:red]')]},
    {name: 'Tailwind palette utility', code: 'const text = <p className="p-4 text-red-500 hover:bg-white" />;', errors: [raw('text-red-500'), raw('bg-white')]},
  ],
});

styles.run('no-raw-color in CSS', noRawColor, {
  valid: [
    {name: 'hex: a token variable', code: 'a { color: var(--mp-foreground-primary); }'},
    {name: 'rgb(): color-mix of tokens', code: 'a { background: color-mix(in srgb, var(--mp-a), var(--mp-b)); }'},
    {name: 'rgba(): currentColor and transparent', code: 'a { border-color: currentColor; background: transparent; }'},
    {name: 'hsl(): a non-colour function', code: 'a { inline-size: calc(100% - 2rem); }'},
    {name: 'hsla(): a custom property of tokens', code: ':root { --mp-alias: var(--mp-surface-panel); }'},
    {name: 'named: an animation name that spells a colour', code: 'a { animation-name: tan; font-family: system-ui; }'},
    {name: 'named: an id selector is not a value', code: '#main { margin: 0; }'},
    {name: 'arbitrary: a token utility in @apply', code: 'a { @apply bg-[var(--mp-surface-panel)] p-4; }'},
  ],
  invalid: [
    {name: 'hex', code: 'a { color: #123456; }', errors: [raw('#123456')]},
    {name: 'rgb()', code: 'a { color: rgb(1 2 3); }', errors: [raw('rgb()')]},
    {name: 'rgba()', code: 'a { background: rgba(0, 0, 0, 0.5); }', errors: [raw('rgba()')]},
    {name: 'hsl()', code: 'a { color: hsl(210 40% 50%); }', errors: [raw('hsl()')]},
    {name: 'hsla()', code: 'a { color: hsla(210, 40%, 50%, 0.5); }', errors: [raw('hsla()')]},
    {name: 'named', code: 'a { border: 1px solid red; }', errors: [raw('red')]},
    {name: 'named inside color-mix', code: 'a { color: color-mix(in srgb, white, var(--mp-a)); }', errors: [raw('white')]},
    {name: 'hex in a custom property', code: ':root { --mp-surface-panel: #ffffff; }', errors: [raw('#ffffff')]},
    {name: 'arbitrary colour in @apply', code: 'a { @apply bg-[#123456]; }', errors: [raw('bg-[#123456]')]},
  ],
});

styles.run('no-handwritten-css in CSS', noHandwrittenCss, {
  valid: [
    {name: 'forbid: an empty file', code: '', options: [{css: 'forbid'}]},
    {name: 'forbid: comments only', code: '/* layout comes from utility classes */', options: [{css: 'forbid'}]},
    {
      name: 'global entry: imports and base element rules',
      code: '@import "tailwindcss";\n@import "./theme.css";\n* { box-sizing: border-box; }\nbody { margin: 0; }\n' +
        'a:hover { text-underline-offset: 3px; }\n:focus-visible { outline: 2px solid var(--mp-focus-ring); }\n' +
        '@media (prefers-reduced-motion: reduce) { * { animation-duration: 0s; } }',
      options: [{css: 'global-entry'}],
    },
  ],
  invalid: [
    {name: 'forbid: a feature stylesheet', code: '.toolbar { display: flex; }', options: [{css: 'forbid'}], errors: [{messageId: 'cssFile'}]},
    {name: 'forbid: imports outside the layer', code: '@import "./other.css";', options: [{css: 'forbid'}], errors: [{messageId: 'cssFile'}]},
    {name: 'global entry: a layout class', code: '.mp-shell { max-width: 1200px; }', options: [{css: 'global-entry'}], errors: [{messageId: 'globalSelector'}]},
    {name: 'global entry: an id rule', code: '#root main { padding: 0; }', options: [{css: 'global-entry'}], errors: [{messageId: 'globalSelector'}]},
    {name: 'global entry: a class inside media', code: '@media (min-width: 40rem) { .wide { padding: 2rem; } }', options: [{css: 'global-entry'}], errors: [{messageId: 'globalSelector'}]},
    {name: 'global entry: keyframes', code: '@keyframes spin { to { rotate: 1turn; } }', options: [{css: 'global-entry'}], errors: [{messageId: 'globalAtRule'}]},
  ],
});

code.run('no-handwritten-css in TSX', noHandwrittenCss, {
  valid: [
    {name: 'utility classes', code: 'const view = <div className="flex gap-4" />;'},
    {name: 'a CSS custom property set inline', code: "const view = <div style={{'--mp-progress': value}} />;"},
  ],
  invalid: [
    {name: 'an inline style object', code: "const view = <div style={{display: 'flex'}} />;", errors: [{messageId: 'inlineStyle'}]},
    {name: 'a custom property when inline styles are forbidden', code: "const view = <div style={{'--mp-progress': value}} />;", options: [{inlineStyle: 'forbid'}], errors: [{messageId: 'inlineStyle'}]},
    {name: 'a style element', code: "const view = <style>{'.x { color: var(--a) }'}</style>;", errors: [{messageId: 'styleElement'}]},
  ],
});

const app = '/workspace/apps/web/src';
code.run('public-entry', publicEntry, {
  valid: [
    {name: 'a route imports the feature entry', filename: app + '/app/orders/page.tsx', code: "export { OrdersScreen as default } from '../../features/orders';"},
    {name: 'the explicit index module', filename: app + '/app/orders/page.tsx', code: "import { OrdersScreen } from '../../features/orders/index';"},
    {name: 'a feature imports its own internals', filename: app + '/features/orders/ui/orders-view.tsx', code: "import { useOrders } from '../hooks/use-orders';"},
    {name: 'a feature imports an entity entry', filename: app + '/features/orders/api/orders.ts', code: "import type { Order } from '../../../entities/order';"},
    {name: 'a package import is not a unit path', filename: app + '/features/orders/ui/orders-view.tsx', code: "import { Button } from '@mpfrontend/ui';"},
    {name: 'generated contracts are not a feature', filename: app + '/features/orders/api/orders.ts', code: "import { parseRead } from '../../../api/generated/orders/read-models.gen';"},
  ],
  invalid: [
    {name: 'a route reaches into a feature', filename: app + '/app/orders/page.tsx', code: "import { OrdersView } from '../../features/orders/ui/orders-view';", errors: [{messageId: 'privateImport'}]},
    {name: 'one feature reaches into another', filename: app + '/features/billing/ui/billing.tsx', code: "import { useOrders } from '../../orders/hooks/use-orders';", errors: [{messageId: 'privateImport'}]},
    {name: 'a re-export from inside a feature', filename: app + '/app/layout.tsx', code: "export * from '../features/orders/model/orders';", errors: [{messageId: 'privateImport'}]},
    {name: 'a feature reaches into an entity', filename: app + '/features/orders/api/orders.ts', code: "import { rule } from '../../../entities/order/model/order';", errors: [{messageId: 'privateImport'}]},
    {name: 'a dynamic import inside a feature', filename: app + '/app/page.tsx', code: "const view = import('../features/orders/ui/orders-view');", errors: [{messageId: 'privateImport'}]},
  ],
});

code.run('no-literal-text', noLiteralText, {
  valid: [
    {name: 'a catalog message', code: "const view = <h1>{t('title')}</h1>;"},
    {name: 'a message with parameters placed by the message', code: "const view = <span>{t('pageOf', {page, count})}</span>;"},
    {name: 'a separator without letters', code: 'const view = <span> · </span>;'},
    {name: 'a value that is not text', code: 'const view = <td>{row.total}</td>;'},
    {name: 'machine attributes', code: 'const view = <a href="/list" className="flex" id="main" data-state="open" />;'},
    {name: 'a translated attribute', code: "const view = <input aria-label={t('search')} />;"},
    {name: 'an allowlisted literal', code: 'const view = <code>JSON</code>;', options: [{allow: ['^JSON$']}]},
    {name: 'a translation beside an element', code: "const view = <p>{t('intro')}<a href='/more'>{t('more')}</a></p>;"},
  ],
  invalid: [
    {name: 'literal text in JSX', code: 'const view = <h1>Orders</h1>;', errors: [{messageId: 'literalText'}]},
    {name: 'a literal string child', code: "const view = <p>{'Orders'}</p>;", errors: [{messageId: 'literalText'}]},
    {name: 'a literal visible attribute', code: 'const view = <Field label="Name" placeholder="Enter a name" />;', errors: [{messageId: 'literalText'}, {messageId: 'literalText'}]},
    {name: 'concatenation', code: "const text = t('page') + ' ' + page;", errors: [{messageId: 'joinedTranslation'}]},
    {name: 'a template literal', code: "const text = `${t('page')} ${page}`;", errors: [{messageId: 'joinedTranslation'}]},
    {name: 'adjacent JSX', code: "const view = <span>{t('page')} {data.number} / {data.pageCount}</span>;", errors: [{messageId: 'joinedTranslation'}]},
    {name: 'a translator under another name', code: "const view = <span>{messages.say('page')} {n}</span>;", options: [{translators: ['say']}], errors: [{messageId: 'joinedTranslation'}]},
  ],
});

const physical = (value: string, logical: string) => ({messageId: 'physical', data: {value, logical}});
const reasoned = [{allow: [{value: 'left-1/2', reason: 'Centred with -translate-x-1/2, which does not depend on the direction'}]}];

code.run('logical-properties in TS and TSX', logicalProperties, {
  valid: [
    {name: 'logical spacing, inset, border, radius and alignment', code: 'const a = <div className="ms-2 me-4 ps-3 pe-1 start-0 end-4 border-s border-e-2 rounded-s-md rounded-ee-lg text-start text-end float-start" />;'},
    {name: 'words that only contain a side', code: "const a = { key: 'ArrowLeft', label: 'right-aligned', tone: 'border-red-500 rounded-lg border-lime-400' };"},
    {name: 'a logical inline style', code: 'const a = <p style={{marginInlineStart: 4, paddingInlineEnd: 2, insetInlineStart: 0, textAlign: \'start\'}} />;'},
    {name: 'a direction-independent physical value with its reason', code: 'const a = <span className="absolute left-1/2 -translate-x-1/2" />;', options: reasoned},
    {name: 'a module path', code: "import x from './ml-2';"},
  ],
  invalid: [
    {name: 'physical margin and padding', code: 'const a = <div className="ml-2 pr-4" />;', errors: [physical('ml-2', 'ms-* or me-*'), physical('pr-4', 'ps-* or pe-*')]},
    {name: 'a physical inset behind variants', code: 'const a = <div className="md:hover:left-0 -right-[3px]" />;', errors: [physical('left-0', 'start-* or end-*'), physical('-right-[3px]', 'start-* or end-*')]},
    {name: 'a physical border, radius and alignment in a template literal', code: 'const a = `border-l-2 rounded-tr-md text-right ${x}`;', errors: [physical('border-l-2', 'border-s or border-e'), physical('rounded-tr-md', 'rounded-s, rounded-e, rounded-ss, rounded-se, rounded-es or rounded-ee'), physical('text-right', 'text-start or text-end')]},
    {name: 'a physical class in a class list', code: "const classes = ['mp-card', 'float-left'].join(' ');", errors: [physical('float-left', 'float-start or float-end')]},
    {name: 'a physical inline style', code: 'const a = <p style={{marginLeft: 4, textAlign: \'right\'}} />;', errors: [physical('marginLeft', 'margin-inline-start'), physical('text-align: right', 'text-align: end')]},
    {name: 'an allowance covers only its own value', code: 'const a = <span className="left-1/2 left-0" />;', options: reasoned, errors: [physical('left-0', 'start-* or end-*')]},
  ],
});

styles.run('logical-properties in CSS', logicalProperties, {
  valid: [
    {name: 'logical properties', code: '.a { margin-inline-start: 1rem; padding-inline-end: 2px; inset-inline-start: 0; border-inline-start: 1px solid; text-align: start; }'},
    {name: 'a logical utility in @apply', code: '.a { @apply ms-2 text-end; }'},
  ],
  invalid: [
    {name: 'physical properties', code: '.a { margin-left: 1rem; right: 0; border-top-left-radius: 2px; }', errors: [physical('margin-left', 'margin-inline-start'), physical('right', 'inset-inline-end'), physical('border-top-left-radius', 'border-start-start-radius')]},
    {name: 'a side keyword', code: '.a { text-align: left; float: right; }', errors: [physical('text-align: left', 'text-align: start'), physical('float: right', 'float: end')]},
    {name: 'a physical utility in @apply', code: '.a { @apply pl-2; }', errors: [physical('pl-2', 'ps-* or pe-*')]},
  ],
});
