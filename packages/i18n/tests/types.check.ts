// Compiled by the typecheck target, never run: each @ts-expect-error must be a real type error.
import { createMessages, defineMessages, type MessageArguments } from '../src/index.js';

const en = defineMessages({
  plain: 'Saved',
  greeting: 'Hello {name}',
  pageOf: 'Page {page, number} of {count, number}',
  items: '{count, plural, one {# item in {store}} other {# items in {store}}}',
  role: '{kind, select, owner {Owner} other {Member}}',
  since: 'Since {day, date, medium}',
});
const messages = createMessages({ defaultLocale: 'en', base: en, translations: { fa: { ...en } } });
const t = messages.translator('fa');

t('plain');
t('greeting', { name: 'Ada' });
t('pageOf', { page: 1, count: 3 });
t('items', { count: 2, store: 'North' });
t('role', { kind: 'owner' });
t('since', { day: new Date() });

// @ts-expect-error a message without parameters takes no values
t('plain', { extra: 1 });
// @ts-expect-error a missing parameter
t('greeting');
// @ts-expect-error a missing parameter inside a plural branch
t('items', { count: 2 });
// @ts-expect-error an extra parameter
t('greeting', { name: 'Ada', extra: 'x' });
// @ts-expect-error a number parameter takes a number
t('pageOf', { page: 'one', count: 3 });
// @ts-expect-error an unknown key
t('missing');
// @ts-expect-error another locale must have every key of the base catalog
createMessages({ defaultLocale: 'en', base: en, translations: { ar: { plain: 'x' } } });

type Expect<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
export type Checks = [
  Expect<Equal<keyof MessageArguments<'Saved'>, never>>,
  Expect<Equal<MessageArguments<'{count, plural, one {# of {total, number}} other {#}}'>, { count: number; total: number }>>,
];
