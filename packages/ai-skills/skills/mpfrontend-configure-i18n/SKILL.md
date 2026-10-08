---
name: mpfrontend-configure-i18n
description: Configure the MP Frontend locale registry (English ships; a product adds its own locales, left to right or right to left, or replaces English, in its own repository), product-owned translations, right-to-left behavior, locale-aware digits and the locale the BFF sends upstream. Not automatic backend content translation.
---

# Configure locales

Read the consumer's locale policy, instructions and installed `@mpfrontend/i18n` exports. MP Frontend
ships English (`en`, left to right) only; every other language is the product's and lives in the product's
repository. `createLocaleRegistry({locales, defaultLocale})` configures the app's own set: each entry names
its direction (`ltr` or `rtl`) and, optionally, a `numberingSystem` for Intl digits. The default locale is
configured per app and is `en` when unset; a product may register only its own locale and make it the
default, and a registry without `en` names its default. Direction always comes from the registry; never
derive it from a list of codes in feature code. `Locale` is a plain locale code and
`LocaleOf<typeof registry>` types one registry's codes. `locale`, `direction`, `translator`, `formatValue`,
`formatNumber`, `negotiateLocale` and MessageKey remain the public helpers; the built-in registry behind
`locale` and `direction` knows English only, so pass the app's registry.

Keep the app's registry in `src/config/app.ts`, with the shared preference cookie
(`createPreferenceCookie({name, locales, themes})`) that carries the language and theme for the first paint
and for the identity provider's `ui_locales`. Validate a persisted or requested locale with the
registry's `locale`; an unknown value is the default. Set document `lang` and `dir` together from the
registry, and use logical CSS start/end rather than left/right. Preserve the existing persistence and
avoid SSR/hydration disagreement. Changing locale must not reset auth, cart or an editing draft.

Upstream language is an allowlist in the Security BFF: `apiLocales: {supported, defaultLocale}`. The BFF
negotiates the browser's Accept-Language against it and sends only an allowlisted token, the default
otherwise; without configuration it sends only `en`. A product lists the locales its backends answer in,
which may exclude English. The login `ui_locales` allowlist (`supportedUiLocales`) is separate.

Write every visible text as a catalog message. The app-wide set is `src/i18n/messages/<locale>.ts` and each
feature has `model/messages/<locale>.ts`: the default locale's file uses `defineMessages` and defines the
keys and their parameters; every other locale is typed `Translation<typeof base>`. Build translators with
`createMessages` (core messages are a separate set the catalog may override). Use ICU MessageFormat with
named parameters, `plural` and `select`; never join a translated message to other text or a value. Run the
app's `catalog-check` target: it fails on a key missing in a locale, an unused key or differing parameters.
A key missing in a locale falls back, key by key, to the default locale at run time, but the check still
fails on it. Translate the files that a generator reports as `untranslated`. To add a locale, register it
and add `messages/<code>.ts` to every set, listed in the set's `translations`; to replace English, rename
every base catalog to the product's locale and set each set's `defaultLocale`. A product whose default is
not English never sees the English core text, so its catalogs define every key they use. Numbers use the
locale's digits through Intl (`formatNumber`, `formatValue`); a `numberingSystem` in the registry
overrides them, and `formatValue` takes the product's `labels` for booleans. Preserve identifiers and
machine payload values; never translate free text that users wrote. Fonts with glyph coverage for the
product's scripts, and their licences, are product-owned.

Test supported and unknown locales, matching lang/dir, catalog key parity, digits and the forwarded
Accept-Language for a crafted header. In the browser verify locale switching and reload, right-to-left
forms, tables and logical layout, and mixed-direction identifiers. Run actual Nx gates uncached and report
exactly which locales and surfaces passed.
