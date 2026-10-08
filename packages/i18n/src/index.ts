export const catalogs = {
  en: { title:'MP Frontend', catalog:'Catalog', refresh:'Refresh', loading:'Loading', unavailable:'Backend is unavailable. Try again.', empty:'No records found.', previous:'Previous', next:'Next', page:'Page', language:'Language', brand:'Brand', mode:'Appearance', light:'Light', dark:'Dark', system:'System', docs:'API documentation', source:'Connected to MP Core', search:'Search', apply:'Apply', readOnly:'Read-only public catalog', fields:'Fields', true:'Yes', false:'No', detail:'Details', back:'Back', save:'Save', forbidden:'This operation is not permitted.', invalid:'Check the permitted fields.', remoteChange:'Data changed remotely. Your edits are preserved.', skipToContent:'Skip to content', navigation:'Main navigation' },
  ar: { title:'MP Frontend', catalog:'الكتالوج', refresh:'تحديث', loading:'جار التحميل', unavailable:'الخدمة غير متاحة. حاول مرة أخرى.', empty:'لا توجد سجلات.', previous:'السابق', next:'التالي', page:'الصفحة', language:'اللغة', brand:'العلامة', mode:'المظهر', light:'فاتح', dark:'داكن', system:'النظام', docs:'توثيق الواجهة', source:'متصل بـ MP Core', search:'بحث', apply:'تطبيق', readOnly:'كتالوج عام للقراءة فقط', fields:'الحقول', true:'نعم', false:'لا', detail:'التفاصيل', back:'رجوع', save:'حفظ', forbidden:'هذه العملية غير مسموحة.', invalid:'تحقق من الحقول المسموحة.', remoteChange:'تغيرت البيانات. تم الاحتفاظ بتعديلاتك.', skipToContent:'تخطَّ إلى المحتوى', navigation:'التنقل الرئيسي' }
} as const;
export type MessageKey = keyof typeof catalogs.en;

export type Direction = 'ltr' | 'rtl';
/** One locale of a registry: its writing direction and, optionally, the digits Intl uses for it. */
export type LocaleDefinition = Readonly<{ direction: Direction; numberingSystem?: string }>;
/** The locales MP Frontend ships. A consumer adds a locale by configuration, never by editing core. */
export const builtInLocales = {
  en: { direction: 'ltr' },
  ar: { direction: 'rtl' },
  fa: { direction: 'rtl' },
} as const satisfies Readonly<Record<string, LocaleDefinition>>;
export type Locale = keyof typeof builtInLocales;

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

/** A locale registry configured per app. The default is `en` when it is not set. */
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

/** The shipped registry: en, ar and fa, with en as the default. */
export const locales = createLocaleRegistry({ locales: builtInLocales });

export function locale(value: unknown): Locale { return locales.locale(value); }
export function direction(value: string): Direction { return locales.direction(value); }
/** Missing keys fall back, key by key, to the default locale's message. */
export function translator(value: string): (key: MessageKey) => string {
  const own = (catalogs as Readonly<Record<string, Partial<Record<MessageKey, string>>>>)[value];
  return key => own?.[key] ?? catalogs.en[key];
}
/** Numbers use the locale's own digits through Intl; strings and booleans are never reinterpreted. */
export function formatValue(value: unknown, language: string, registry: LocaleRegistry = locales): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return translator(language)(value ? 'true' : 'false');
  if (typeof value === 'number') return formatNumber(value, language, {}, registry);
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
export function formatNumber(value: number, language: string, options: Intl.NumberFormatOptions = {}, registry: LocaleRegistry = locales): string {
  const numberingSystem = registry.numberingSystem(language);
  return new Intl.NumberFormat(registry.locale(language), { maximumFractionDigits: 8, ...(numberingSystem ? { numberingSystem } : {}), ...options }).format(value);
}
