---
name: mpfrontend-configure-i18n
description: Configure the existing English and Arabic MP Frontend locale helpers and consumer-owned translations with RTL behavior. Not an arbitrary-locale generator or automatic backend content translation.
---

# Configure the finite English/Arabic profile

Read the consumer's locale policy, instructions and installed `@mpfrontend/i18n` exports. The current
registry supports en/ar: `locale`, `direction`, `translator`, `formatValue`, Locale and MessageKey.
Unknown locale input falls back to English; do not claim another locale is registered by adding a
dropdown item. Product labels and domain catalogs stay in the consumer; core copy stays neutral.

Validate persisted/requested locale with `locale`, set document lang and dir together, and use
logical CSS start/end rather than hard-coded left/right. Preserve the existing persistence mechanism
and avoid SSR/hydration disagreement or browser globals during server rendering. Changing locale
must not reset auth, cart or an editing draft. Pass the selected locale through the approved API
language boundary; do not expand it to unsupported backend locales silently.

Use `translator` for existing core MessageKey values and a typed consumer catalog for product copy.
Use Intl with the selected locale for domain prices, currencies and dates; `formatValue` is a basic
display helper, not a domain money/date serializer. Preserve identifiers and machine payload values.
Backend localized resources need backend-owned changes; unknown free-text notes are not translated
or reinterpreted by replacing strings. Keep Arabic glyph coverage in a licensed consumer font, with
fonts and their distribution notices outside core. Do not change a Figma file to solve a font gap.

Test supported and unknown locales, matching lang/dir, catalog key parity and number formatting.
In the browser verify locale switching and reload, Arabic form labels/errors/tables, logical layout,
mixed-direction identifiers, mobile overflow and protected reads without identity changes. Distinguish
translated UI/backend resources from user-authored free text. Run actual Nx gates uncached.

Report exactly which locales and surfaces passed. Adding a third locale requires a separate scoped
registry/catalog/API compatibility change; this finite skill does not implement that capability.
