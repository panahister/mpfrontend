import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createElement, type ReactNode} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {AppFrame, AppHeader, Navigation, PageFrame, type NavigationItem} from '../src/index.js';

const items: NavigationItem[] = [{href: '/list', label: 'List', current: true}, {href: '/other', label: 'Other'}];
function frame(direction: 'ltr' | 'rtl', main: ReactNode = 'Content') {
  return renderToStaticMarkup(createElement('html', {dir: direction}, createElement('body', null, createElement(AppFrame, {
    skipLinkLabel: 'Skip to content',
    header: createElement(AppHeader, {brand: createElement('a', {href: '/'}, 'Home'),
      navigation: createElement(Navigation, {label: 'Main', items}), actions: createElement('button', null, 'Action')}),
  }, main))));
}
/** Focusable elements in document order: the order of the Tab key. */
function focusOrder(html: string): string[] {
  return [...html.matchAll(/<(a|button|input|select|textarea)\b[^>]*>/g)]
    .filter(match => !/tabindex="-1"/.test(match[0]))
    .map(match => (match[0].match(/href="([^"]*)"/)?.[1] ?? match[1])!);
}

test('the frame has the landmarks and the skip link is the first Tab stop, targeting the focusable main', () => {
  const html = frame('ltr');
  assert.deepEqual(focusOrder(html), ['#mp-main', '/', '/list', '/other', 'button']);
  assert.match(html, /<header class="mp-app-header">/);
  assert.match(html, /<nav aria-label="Main"/);
  assert.match(html, /<main id="mp-main" tabindex="-1"/);
  assert.doesNotMatch(html, /tabindex="[1-9]/, 'no positive tabindex reorders the keyboard path');
});

test('the skip link stays hidden until it receives keyboard focus, then appears at the inline start', () => {
  const link = frame('ltr').match(/<a href="#mp-main" class="([^"]*)"/)![1]!;
  for (const token of ['sr-only', 'focus:not-sr-only', 'focus:absolute', 'focus:start-4']) assert.ok(link.split(' ').includes(token), token);
});

test('LTR and RTL render the same direction-neutral markup with logical properties only', async () => {
  const ltr = frame('ltr'), rtl = frame('rtl');
  assert.equal(rtl.replace('dir="rtl"', 'dir="ltr"'), ltr, 'the shell sets no direction of its own');
  const physical = /\b(?:m[lr]|p[lr]|left|right|text-left|text-right|border-[lr]|rounded-[lr])-[\w[]/;
  assert.doesNotMatch(ltr, physical);
  const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /(?:^|[^-])(?:left|right)\s*:|margin-(?:left|right)|padding-(?:left|right)|border-(?:left|right)/);
});

test('navigation shows exactly the items the app passes and marks the current page', () => {
  const html = renderToStaticMarkup(createElement(Navigation, {label: 'Main', items}));
  assert.equal([...html.matchAll(/<li>/g)].length, 2);
  assert.match(html, /<a href="\/list" class="mp-nav-link" aria-current="page">List<\/a>/);
  assert.match(html, /<a href="\/other" class="mp-nav-link">Other<\/a>/);
  assert.equal(renderToStaticMarkup(createElement(Navigation, {label: 'Main', items: []})).includes('<li>'), false);
});

test('a page frame labels its section with its title and keeps actions beside it', () => {
  const html = renderToStaticMarkup(createElement(PageFrame, {title: 'Orders', titleId: 'orders-title', actions: createElement('button', null, 'New')}, 'Body'));
  assert.match(html, /<section aria-labelledby="orders-title"/);
  assert.match(html, /<h1 id="orders-title"[^>]*>Orders<\/h1>/);
  assert.match(html, /<div class="mp-page-actions[^"]*"><button>New<\/button><\/div>/);
  const generated = renderToStaticMarkup(createElement(PageFrame, {title: 'Orders'}, 'Body'));
  const id = generated.match(/aria-labelledby="([^"]+)"/)![1]!;
  assert.ok(generated.includes('<h1 id="' + id + '"'));
});

test('the structural classes are Tailwind utilities that the consumer compiles from the published output', async () => {
  assert.match(await readFile(new URL('../src/tailwind.css', import.meta.url), 'utf8'), /@source "\.\.\/dist\/\*\*\/\*\.js";/);
  assert.match(frame('ltr'), /max-w-\[var\(--mp-shell-content-max\)\]/);
});
