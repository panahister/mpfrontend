---
name: mpfrontend-configure-theme
description: Bind consumer-owned light and dark CSS tokens to the MP Frontend light/dark/system mode helpers. Not a Figma importer, token compiler or automatic design synchronization.
---

# Bind consumer themes

Read the consumer instructions, its reviewed DLS tokens and installed `@mpfrontend/tokens` exports.
Core offers `validBrand`, `validMode`, `appearance` and Mode; it ships no product brand registry or
token values. Put product CSS, fonts, icons and assets in the consumer theme package. Keep a reviewed
snapshot identity/provenance when tokens originate in Figma; never modify Figma through this workflow.

Inspect the workspace design-source contract. An attached source and binding govern generated token
ownership. Pending source state must be resolved before claiming DLS parity; `none` permits an authored
code-first theme but not a claim that it implements either a private or public design system.

Provide an explicit consumer brand allowlist/fallback to `validBrand`. Parse user mode through
`validMode`; resolve system preference with `appearance`. Apply resolved light/dark selectors and
semantic CSS variables consistently to document and components. Use the existing persistence and
SSR initialization paths; clean up media-query listeners and avoid hydration disagreement. Explicit
light/dark must not change with OS preference; system mode must. Theme switching must preserve
locale, identity and active drafts.

The theme (light, dark or system) and the language travel in one shared preference cookie
(`createPreferenceCookie` of `@mpfrontend/i18n`, value `lang=<locale>&theme=<theme>`), which the identity
provider's pages may read on a common parent domain. The app's server reads it for the first paint and sets
`data-mode`, `lang` and `dir` before any script runs, so the page does not flash; an invalid value is
ignored. The brand stays an app cookie. Never put an identity claim in that cookie.

Each app has one theme file, `src/theme/theme.css`, that the global stylesheet imports after the neutral
fallback of `@mpfrontend/tokens` and the component styles. Set token values there, scoped to a brand of
`src/theme/config.ts` (for example `:root[data-brand='product'] { --mp-surface-canvas: ... }`), or import
the generated `tokens.gen.css` of an attached design source from it. Raw colours are allowed only in the
theme layer; lint refuses them elsewhere. `config.ts` keeps the brand registry.

Map surface, text, border, focus, disabled and feedback colors from reviewed consumer tokens;
include the mp-* CSS-variable interface used by the actual UI exports. Do not substitute a product
palette into neutral core or hard-code a separate color in every component. Asset/font rights and
readable contrast remain consumer acceptance work. Missing or unresolved tokens need an explicit
reviewed mapping/fallback, not a claim of automatic design fidelity.

Test mode parsing, allowed/rejected brands and system-dark transitions. In the actual browser check
switching, reload, long text, focus/errors/disabled/loading states, tables/forms and right to left in both
themes. Inspect resolved styles/contrast when visual acceptance is required; save native screenshots
alongside interaction evidence. Run consumer lint/typecheck/test/build targets uncached.

Report observed modes/surfaces and remaining visual gaps. This procedure does not import Figma,
diff semantic revisions, advance a design baseline, publish packages or certify a complete DLS.
