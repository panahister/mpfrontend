export const catalogs = {
  en: { title:'MP Frontend', catalog:'Catalog', refresh:'Refresh', loading:'Loading', unavailable:'Backend is unavailable. Try again.', empty:'No records found.', previous:'Previous', next:'Next', page:'Page', language:'Language', brand:'Brand', mode:'Appearance', light:'Light', dark:'Dark', system:'System', docs:'API documentation', source:'Connected to MP Core', search:'Search', apply:'Apply', readOnly:'Read-only public catalog', fields:'Fields', true:'Yes', false:'No', detail:'Details', back:'Back', save:'Save', forbidden:'This operation is not permitted.', invalid:'Check the permitted fields.', remoteChange:'Data changed remotely. Your edits are preserved.', skipToContent:'Skip to content', navigation:'Main navigation' },
} as const;
export type MessageKey = keyof typeof catalogs.en;
const neutral = ['loading', 'unavailable', 'empty', 'previous', 'next', 'page', 'language', 'brand', 'mode', 'light', 'dark', 'system', 'search', 'apply', 'fields', 'true', 'false', 'detail', 'back', 'save', 'refresh', 'forbidden', 'invalid', 'remoteChange', 'skipToContent', 'navigation'] as const;
export type CoreMessageKey = (typeof neutral)[number];
/**
 * The neutral messages of MP Frontend, separate from any product text, in English: the only language that
 * MP Frontend ships. A product's catalog set overrides any of them by defining the same key. A translator
 * looks a message up in the requested locale and then in the set's default locale only, so a product whose
 * default locale is not English never shows this English text. `catalogs` keeps its earlier keys.
 */
export const coreMessages: Readonly<{ en: Readonly<Record<CoreMessageKey, string>> }> = {
  en: Object.fromEntries(neutral.map(key => [key, catalogs.en[key]])) as Record<CoreMessageKey, string>,
};
export { createMessages, defineMessages, checkCatalogs, messageArguments, MessageError, type Catalog, type Translation, type MessageArguments, type ArgumentList, type Translate, type Messages, type MessageValue, type ArgumentShape, type CatalogProblem } from './messages.js';

export type Direction = 'ltr' | 'rtl';
/** One locale of a registry: its writing direction and, optionally, the digits Intl uses for it. */
export type LocaleDefinition = Readonly<{ direction: Direction; numberingSystem?: string }>;
/**
 * The one locale MP Frontend ships: English, left to right. A product registers its own locales, left to
 * right or right to left, in its own repository with `createLocaleRegistry`, never by editing MP Frontend.
 */
export const builtInLocales = {
  en: { direction: 'ltr' },
} as const satisfies Readonly<Record<string, LocaleDefinition>>;
/**
 * A locale code (a BCP 47 language tag). MP Frontend enumerates no language: the set of locales is the
 * product's, and `LocaleOf<typeof registry>` is the type of one product registry's codes.
 */
export type Locale = string;
export type LocaleOf<R extends LocaleRegistry<string>> = R['locales'][number];

export type LocaleRegistry<L extends string = string> = Readonly<{
  locales: readonly L[];
  defaultLocale: L;
  /** The registered code itself, or the default for anything else. */
  locale: (value: unknown) => L;
  direction: (value: string) => Direction;
  numberingSystem: (value: string) => string | undefined;
  /** The best registered locale for an Accept-Language header, or the default. */
  negotiate: (header: string | null | undefined) => L;
}>;

const localeCode = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/;
const languageRange = /^(?:\*|[A-Za-z]{1,8}(?:-[A-Za-z0-9]{1,8}){0,4})$/;
const MAX_HEADER = 256, MAX_RANGES = 16;

/**
 * Picks the best of `supported` for an Accept-Language header (RFC 9110 section 12.5.4) by quality, then by
 * an exact range and then by the range's primary language. Malformed or oversized input yields the
 * default; the result is always a member of `supported`, never text taken from the header.
 */
export function negotiateLocale<const L extends string>(header: string | null | undefined, supported: readonly L[], defaultLocale: L): L {
  if (!supported.includes(defaultLocale)) throw new Error('INVALID_DEFAULT_LOCALE');
  if (typeof header !== 'string' || header.length > MAX_HEADER) return defaultLocale;
  const parts = header.split(',');
  if (parts.length > MAX_RANGES) return defaultLocale;
  const ranges: { range: string; quality: number; order: number }[] = [];
  for (const [order, part] of parts.entries()) {
    const [rawRange, ...parameters] = part.split(';').map(value => value.trim());
    if (!rawRange || !languageRange.test(rawRange)) continue;
    let quality = 1;
    for (const parameter of parameters) {
      const match = /^q=(0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.exec(parameter);
      if (!match) { quality = -1; break; }
      quality = Number(match[1]);
    }
    if (quality > 0) ranges.push({ range: rawRange.toLowerCase(), quality, order });
  }
  ranges.sort((left, right) => right.quality - left.quality || left.order - right.order);
  const lower = supported.map(code => code.toLowerCase());
  for (const { range } of ranges) {
    if (range === '*') return defaultLocale;
    const exact = lower.indexOf(range);
    if (exact >= 0) return supported[exact]!;
    const primary = lower.indexOf(range.split('-')[0]!);
    if (primary >= 0) return supported[primary]!;
  }
  return defaultLocale;
}

/**
 * A locale registry configured per app. The default is `defaultLocale`, or `en` when it is not set; a
 * registry without English names its own default, which may be its only locale.
 */
export function createLocaleRegistry<const L extends string>(options: Readonly<{
  locales: Readonly<Record<L, LocaleDefinition>>;
  defaultLocale?: NoInfer<L>;
}>): LocaleRegistry<L> {
  const codes = Object.keys(options.locales) as L[];
  if (!codes.length) throw new Error('EMPTY_LOCALE_REGISTRY');
  for (const code of codes) {
    const definition = options.locales[code];
    if (!localeCode.test(code) || (definition.direction !== 'ltr' && definition.direction !== 'rtl')) throw new Error('INVALID_LOCALE_DEFINITION');
    if (definition.numberingSystem !== undefined && !/^[a-z]{3,8}$/.test(definition.numberingSystem)) throw new Error('INVALID_LOCALE_DEFINITION');
  }
  const defaultLocale = options.defaultLocale ?? ('en' as L);
  if (!codes.includes(defaultLocale)) throw new Error('INVALID_DEFAULT_LOCALE');
  const known = (value: unknown): value is L => typeof value === 'string' && codes.includes(value as L);
  return Object.freeze({
    locales: Object.freeze([...codes]),
    defaultLocale,
    locale: (value: unknown) => known(value) ? value : defaultLocale,
    direction: (value: string) => (known(value) ? options.locales[value] : options.locales[defaultLocale]).direction,
    numberingSystem: (value: string) => (known(value) ? options.locales[value] : options.locales[defaultLocale]).numberingSystem,
    negotiate: (header: string | null | undefined) => negotiateLocale(header, codes, defaultLocale),
  });
}

/** The built-in registry: English only, and the default. A product passes its own registry instead. */
export const locales = createLocaleRegistry({ locales: builtInLocales });

export function locale(value: unknown): Locale { return locales.locale(value); }
export function direction(value: string): Direction { return locales.direction(value); }
/** The built-in English messages; any other locale falls back, key by key, to English. */
export function translator(value: string): (key: MessageKey) => string {
  const own = (catalogs as Readonly<Record<string, Partial<Record<MessageKey, string>>>>)[value];
  return key => own?.[key] ?? catalogs.en[key];
}
/** The text of `true` and `false` from a product's own catalog. */
export type BooleanLabels = Readonly<{ true: string; false: string }>;
/**
 * Numbers use the locale's own digits through Intl; strings are never reinterpreted. A boolean is shown
 * with `labels`, the product's own text, or with the built-in English text when no labels are given.
 */
export function formatValue(value: unknown, language: string, registry: LocaleRegistry = locales, labels?: BooleanLabels): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return labels ? (value ? labels.true : labels.false) : translator(language)(value ? 'true' : 'false');
  if (typeof value === 'number') return formatNumber(value, language, {}, registry);
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
export function formatNumber(value: number, language: string, options: Intl.NumberFormatOptions = {}, registry: LocaleRegistry = locales): string {
  const numberingSystem = registry.numberingSystem(language);
  return new Intl.NumberFormat(registry.locale(language), { maximumFractionDigits: 8, ...(numberingSystem ? { numberingSystem } : {}), ...options }).format(value);
}
export { createPreferenceCookie, type Preference, type PreferenceCookie, type PreferenceCookieContract } from './preferences.js';
