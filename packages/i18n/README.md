# @mpfrontend/i18n

Local development package. Runtime: universal. Public API is exported from src/index.ts and compiled
into dist. Nx owns build, typecheck, lint and test targets. Consumer applications install packed artifacts.
See ../../docs/IMPLEMENTATION-STATUS.md for observed evidence and remaining work.

## Locales

The registry ships `en` (left to right), `ar` and `fa` (right to left), with `en` as the default.
`createLocaleRegistry({locales, defaultLocale})` configures an app's own set: each entry names its
`direction` and, optionally, a `numberingSystem` for Intl digits; the default is `en` when it is not set.
A consumer adds a locale by configuration; core needs no change. `locale(value)` returns a registered code
or the default (`locale('ar')` is still `ar`), and `direction` comes from the registry.

`negotiateLocale(header, supported, defaultLocale)` picks the best allowlisted locale for an
Accept-Language header by quality, exact range and primary language; malformed or oversized input yields
the default, and the result is always a member of the allowlist, never text from the header. The Security
BFF uses it for the language it sends upstream.

`formatNumber` and `formatValue` format numbers with the locale's own digits through Intl (Persian digits
for `fa`); strings and booleans are never reinterpreted. `translator(locale)(key)` falls back, key by key,
to the default locale for a key that a locale's catalog lacks; the core catalogs hold `en` and `ar` text,
and `fa` text belongs to the consumer's catalog.

## Message catalogs

A consumer owns its catalogs. The catalog of the default locale defines the keys:
`defineMessages({...})` keeps their literal types, and every other locale is typed
`Translation<typeof base>`, so a key missing in a locale is a type error. `createMessages({defaultLocale,
base, translations, core, numberingSystem})` builds one translator per locale; `core` is the separate set of
neutral MP Frontend messages (`coreMessages`) that the catalog may override by defining the same key.

Messages use ICU MessageFormat: named parameters placed by the message (`Page {page, number} of {count,
number}`), `plural`, `selectordinal` and `select` by locale, and `number`, `date` and `time` arguments
formatted through Intl. The parameters of a message are part of its type: `t('pageOf', {page, count})`
compiles, while a missing or extra parameter, or a text where a number is expected, is a type error. A
missing message falls back, key by key, to the default locale; a formatting failure names the key, never a
parameter value.

Formatting uses FormatJS `intl-messageformat` 11.2.15 with its parser `@formatjs/icu-messageformat-parser`
3.5.18. The reason: ICU plural and select rules and the grammar are easy to get wrong, and this is the
established ICU implementation for JavaScript, built on Intl.PluralRules, Intl.NumberFormat and
Intl.DateTimeFormat. `checkCatalogs` and `messageArguments` are the check behind
`mpfrontend catalog check`: a key missing in a locale or extra, an unused key, a message that does not parse
and a parameter that differs between locales each fail it.

`translator(locale)(key)` and `catalogs` keep working for their existing keys.

## Preference cookie

`createPreferenceCookie({name, locales, themes})` is the contract of the one readable cookie that carries a
person's language and theme and that an app shares with the identity provider's pages on a common parent
domain. Its value is `lang=<locale>&theme=<theme>` (cookie values cannot hold `;`), each value must be in
the allowlist, and `parse`/`read` drop anything else; an invalid value is ignored and never echoed. The
Security BFF reads it for `ui_locales`, and an app's server reads it for the first paint, setting `lang`,
`dir` and the theme on the document before any script runs. It never carries an identity claim and never
decides anything about authority.
