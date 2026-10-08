import { IntlMessageFormat, type Formatters } from 'intl-messageformat';
import { parse, TYPE, type MessageFormatElement } from '@formatjs/icu-messageformat-parser';

/**
 * Typed ICU MessageFormat catalogs. A consumer's base-locale catalog defines the keys and, through its
 * literal types, the named parameters of every message; every other locale has the same keys. Formatting
 * uses FormatJS intl-messageformat, which applies Intl.PluralRules, Intl.NumberFormat and
 * Intl.DateTimeFormat for the locale.
 */
export type Catalog = Readonly<Record<string, string>>;
/** Another locale of a base catalog: the same keys, any text. */
export type Translation<Base extends Catalog> = Readonly<{ [K in keyof Base]: string }>;

// ------------------------------------------------------------------------------------------- argument types
type Trim<S extends string> = S extends ` ${infer R}` | `\n${infer R}` ? Trim<R> : S extends `${infer R} ` | `${infer R}\n` ? Trim<R> : S;
/** The top-level `{...}` bodies of a message, with nested braces kept inside each body. */
type Bodies<S extends string, Depth extends 0[] = [], Current extends string = '', Found extends string = never> =
  S extends `${infer C}${infer R}`
    ? C extends '{'
      ? Depth extends [] ? Bodies<R, [0], '', Found> : Bodies<R, [...Depth, 0], `${Current}{`, Found>
      : C extends '}'
        ? Depth extends [0] ? Bodies<R, [], '', Found | Current>
          : Depth extends [0, ...infer Rest extends 0[]] ? Bodies<R, Rest, `${Current}}`, Found> : Bodies<R, Depth, Current, Found>
        : Depth extends [] ? Bodies<R, Depth, Current, Found> : Bodies<R, Depth, `${Current}${C}`, Found>
    : Found;
type Kind<Body extends string> = Body extends `${string},${infer Rest}` ? Trim<Rest extends `${infer K},${string}` ? K : Rest> : '';
type ArgumentName<Body extends string> = Trim<Body extends `${infer N},${string}` ? N : Body>;
type Options<Body extends string> = Body extends `${string},${string},${infer Rest}` ? Rest : '';
type ValueOf<K extends string> =
  K extends 'plural' | 'selectordinal' | 'number' ? number :
  K extends 'date' | 'time' ? Date | number :
  K extends 'select' ? string :
  string | number;
type IsName<N extends string> = N extends '' | `${string} ${string}` | `${string}#${string}` ? false : true;
type ArgumentsOf<Body extends string> =
  IsName<ArgumentName<Body>> extends true
    ? { [P in ArgumentName<Body>]: ValueOf<Kind<Body>> } & (Kind<Body> extends 'plural' | 'select' | 'selectordinal' ? NestedArguments<Bodies<Options<Body>>> : unknown)
    : unknown;
type UnionToIntersection<U> = (U extends unknown ? (value: U) => void : never) extends (value: infer I) => void ? I : never;
type NestedArguments<Messages extends string> = UnionToIntersection<Messages extends string ? MessageArguments<Messages> : never>;
type Flatten<T> = { [K in keyof T]: T[K] };
/** The named parameters of an ICU message; `{}` when it has none. */
export type MessageArguments<S extends string> = Flatten<UnionToIntersection<Bodies<S> extends infer B ? B extends string ? ArgumentsOf<B> : never : never>>;
/** The arguments a translator call takes for one message: none, or exactly its named parameters. */
export type ArgumentList<S extends string> = keyof MessageArguments<S> extends never ? [] : [values: MessageArguments<S>];

/** Keeps the literal types of a base catalog, so that keys and parameters are checked by TypeScript. */
export function defineMessages<const M extends Catalog>(messages: M): M {
  return messages;
}

// ------------------------------------------------------------------------------------------------- runtime
export type MessageValue = string | number | boolean | Date | null | undefined;
export type Translate<M extends Catalog> = <K extends keyof M & string>(key: K, ...values: ArgumentList<M[K]>) => string;
export type Messages<M extends Catalog, L extends string = string> = Readonly<{
  locales: readonly L[];
  defaultLocale: L;
  /** A translator for one locale. A missing message falls back, key by key, to the default locale. */
  translator: (locale: string) => Translate<M>;
}>;

export class MessageError extends Error {}

/**
 * Intl formatters that pass the registry's digits as an option. A Unicode extension in the locale tag
 * (`-u-nu-`) is dropped when the runtime's Intl data does not know the locale, so a product's own locale
 * would lose its digits; an option applies to whatever locale Intl resolves.
 */
const digitFormatters = new Map<string, Formatters>();
function formattersWith(numberingSystem: string): Formatters {
  let formatters = digitFormatters.get(numberingSystem);
  if (!formatters) {
    formatters = {
      getNumberFormat: (locales, options) => new Intl.NumberFormat(locales, { ...(options as Intl.NumberFormatOptions | undefined), numberingSystem }),
      getDateTimeFormat: (locales, options) => new Intl.DateTimeFormat(locales, { ...options, numberingSystem }),
      getPluralRules: (locales, options) => new Intl.PluralRules(locales, options),
    };
    digitFormatters.set(numberingSystem, formatters);
  }
  return formatters;
}

/**
 * Builds the translators of one catalog set: the base catalog of the default locale, which defines the
 * keys and parameters, and its translations. `core` holds messages that the set may override, such as the
 * neutral MP Frontend messages; the set's own keys win. `numberingSystem` returns the Intl digits of a
 * locale when the app's registry configures them.
 */
export function createMessages<const M extends Catalog, const L extends string>(options: Readonly<{
  defaultLocale: L;
  base: M;
  translations: Readonly<Record<string, Translation<M>>>;
  core?: Readonly<Record<string, Catalog>>;
  numberingSystem?: (locale: string) => string | undefined;
}>): Messages<M, L> {
  const catalogs: Readonly<Record<string, Catalog>> = { ...options.translations, [options.defaultLocale]: options.base };
  const locales = [options.defaultLocale, ...Object.keys(options.translations).filter(code => code !== options.defaultLocale)] as L[];
  const formatters = new Map<string, IntlMessageFormat>();
  const lookup = (locale: string, key: string): [string, string] | undefined => {
    for (const candidate of [locale, options.defaultLocale]) {
      const own = catalogs[candidate]?.[key];
      if (own !== undefined) return [candidate, own];
      const core = options.core?.[candidate]?.[key];
      if (core !== undefined) return [candidate, core];
    }
    return undefined;
  };
  return Object.freeze({
    locales: Object.freeze([...locales]),
    defaultLocale: options.defaultLocale,
    translator: (requested: string) => {
      const locale = locales.includes(requested as L) ? requested : options.defaultLocale;
      return ((key: string, values?: Readonly<Record<string, MessageValue>>) => {
        const found = lookup(locale, key);
        if (!found) throw new MessageError('UNKNOWN_MESSAGE:' + key);
        const [source, message] = found;
        const numbering = options.numberingSystem?.(source);
        const cacheKey = source + '\u0000' + (numbering ?? '') + '\u0000' + key + '\u0000' + message;
        let formatter = formatters.get(cacheKey);
        if (!formatter) {
          formatter = new IntlMessageFormat(message, source, undefined, { ignoreTag: true, ...(numbering ? { formatters: formattersWith(numbering) } : {}) });
          formatters.set(cacheKey, formatter);
        }
        try {
          return String(formatter.format(values as Record<string, string | number | boolean | Date | null | undefined> | undefined));
        } catch {
          // The values are never part of the error: a parameter may hold personal data.
          throw new MessageError('MESSAGE_ARGUMENTS_INVALID:' + key);
        }
      }) as Translate<M>;
    },
  });
}

// ------------------------------------------------------------------------------------------------ the check
export type ArgumentShape = Readonly<Record<string, 'text' | 'number' | 'date' | 'time' | 'select' | 'plural'>>;
/** The named parameters of a message and their kinds, from the ICU parser. */
export function messageArguments(message: string): ArgumentShape {
  const found: Record<string, ArgumentShape[string]> = {};
  const visit = (elements: readonly MessageFormatElement[]) => {
    for (const element of elements) {
      if (element.type === TYPE.argument) found[element.value] = 'text';
      else if (element.type === TYPE.number) found[element.value] = 'number';
      else if (element.type === TYPE.date) found[element.value] = 'date';
      else if (element.type === TYPE.time) found[element.value] = 'time';
      else if (element.type === TYPE.select || element.type === TYPE.plural) {
        found[element.value] = element.type === TYPE.select ? 'select' : 'plural';
        for (const option of Object.values(element.options)) visit(option.value);
      } else if (element.type === TYPE.tag) visit(element.children);
    }
  };
  visit(parse(message, { ignoreTag: true }));
  return found;
}

export type CatalogProblem = Readonly<{
  code: 'MISSING_LOCALE' | 'UNKNOWN_LOCALE' | 'MISSING_KEY' | 'EXTRA_KEY' | 'UNUSED_KEY' | 'PARAMETER_MISMATCH' | 'INVALID_MESSAGE';
  locale?: string;
  key?: string;
}>;
/**
 * Checks one catalog set: every locale has exactly the base keys, every message parses, every locale
 * takes the same parameters as the base message, and every key is used by code.
 */
export function checkCatalogs(input: Readonly<{
  defaultLocale: string;
  locales: readonly string[];
  catalogs: Readonly<Record<string, Catalog | undefined>>;
  isUsed: (key: string) => boolean;
}>): CatalogProblem[] {
  const problems: CatalogProblem[] = [];
  const base = input.catalogs[input.defaultLocale];
  if (!base) return [{ code: 'MISSING_LOCALE', locale: input.defaultLocale }];
  const shapes = new Map<string, string>();
  for (const [key, message] of Object.entries(base)) {
    try { shapes.set(key, JSON.stringify(Object.entries(messageArguments(message)).sort())); }
    catch { problems.push({ code: 'INVALID_MESSAGE', locale: input.defaultLocale, key }); }
    if (!input.isUsed(key)) problems.push({ code: 'UNUSED_KEY', key });
  }
  for (const locale of input.locales) {
    if (locale === input.defaultLocale) continue;
    const catalog = input.catalogs[locale];
    if (!catalog) { problems.push({ code: 'MISSING_LOCALE', locale }); continue; }
    for (const key of Object.keys(base)) if (!(key in catalog)) problems.push({ code: 'MISSING_KEY', locale, key });
    for (const [key, message] of Object.entries(catalog)) {
      if (!(key in base)) { problems.push({ code: 'EXTRA_KEY', locale, key }); continue; }
      let shape: string;
      try { shape = JSON.stringify(Object.entries(messageArguments(message)).sort()); }
      catch { problems.push({ code: 'INVALID_MESSAGE', locale, key }); continue; }
      if (shapes.has(key) && shapes.get(key) !== shape) problems.push({ code: 'PARAMETER_MISMATCH', locale, key });
    }
  }
  return problems;
}
