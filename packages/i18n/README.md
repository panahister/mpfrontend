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

