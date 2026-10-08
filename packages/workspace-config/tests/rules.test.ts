import {describe, it} from 'node:test';
import {RuleTester} from 'eslint';
import css from '@eslint/css';
import tseslint from 'typescript-eslint';
import noRawColor from '../src/rules/no-raw-color.js';
import noHandwrittenCss from '../src/rules/no-handwritten-css.js';
import publicEntry from '../src/rules/public-entry.js';

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
