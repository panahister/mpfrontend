---
name: mpfrontend-configure-i18n
description: Configure the MP Frontend locale registry (English, Arabic and Persian ship; a consumer adds others by configuration), consumer-owned translations, right-to-left behavior, locale-aware digits and the locale the BFF sends upstream. Not automatic backend content translation.
---

# Configure locales

Read the consumer's locale policy, instructions and installed `@mpfrontend/i18n` exports. The registry
ships `en` (left to right), `ar` and `fa` (right to left). `createLocaleRegistry({locales, defaultLocale})`
configures the app's own set: each entry names its direction and, optionally, a `numberingSystem` for
Intl digits. The default locale is configured per app and is `en` when unset. Direction always comes from
the registry; never derive it from a list of codes in feature code. `locale`, `direction`, `translator`,
`formatValue`, `formatNumber`, `negotiateLocale`, Locale and MessageKey remain the public helpers.

Keep the app's registry in `src/config/app.ts`. Validate a persisted or requested locale with the
registry's `locale`; an unknown value is the default. Set document `lang` and `dir` together from the
registry, and use logical CSS start/end rather than left/right. Preserve the existing persistence and
avoid SSR/hydration disagreement. Changing locale must not reset auth, cart or an editing draft.

Upstream language is an allowlist in the Security BFF: `apiLocales: {supported, defaultLocale}`. The BFF
negotiates the browser's Accept-Language against it and sends only an allowlisted token, the default
otherwise; without configuration it sends only `en` or `ar`, as before. A consumer whose backends answer
in Persian lists `fa` there. The login `ui_locales` allowlist (`supportedUiLocales`) is separate.

Write every visible text as a catalog message. The app-wide set is `src/i18n/messages/<locale>.ts` and each
feature has `model/messages/<locale>.ts`: the default locale's file uses `defineMessages` and defines the
keys and their parameters; every other locale is typed `Translation<typeof base>`. Build translators with
`createMessages` (core messages are a separate set the catalog may override). Use ICU MessageFormat with
named parameters, `plural` and `select`; never join a translated message to other text or a value. Run the
app's `catalog-check` target: it fails on a key missing in a locale, an unused key or differing parameters.
A key missing in a locale falls back, key by key, to the default locale at run time, but the check still
fails on it. Translate the files that a generator reports as `untranslated`. Numbers use the locale's digits through Intl
(`formatNumber`, `formatValue`); a `numberingSystem` in the registry overrides them. Preserve identifiers
and machine payload values; never translate free text that users wrote. Fonts with Arabic and Persian
glyph coverage, and their licences, are consumer-owned.

Test supported and unknown locales, matching lang/dir, catalog key parity, digits and the forwarded
Accept-Language for a crafted header. In the browser verify locale switching and reload, right-to-left
forms, tables and logical layout, and mixed-direction identifiers. Run actual Nx gates uncached and report
exactly which locales and surfaces passed.
