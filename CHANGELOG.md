# Changelog

The change of each package, newest cohort first. A package's version moves when anything it packs changes,
so one file name never stands for two different archives. The SHA-256 of each archive of a cohort is in its
release notes under `docs/releases/`.

## 2026-10-12

Release notes: [docs/releases/2026-10-12-package-cohort.md](docs/releases/2026-10-12-package-cohort.md).
Compared with the archives packed before the hardening round. Not published to a registry.

| Package | Version | Change |
|---|---|---|
| `@mpfrontend/access-core` | `0.1.0-dev.1` to `0.1.0-dev.2` | No source change. The archive now carries the `LICENSE` file |
| `@mpfrontend/ai-skills` | `0.1.0-dev.11` to `0.1.0-dev.12` | The procedures teach what this cohort adds: the workspace quality profile, the feature, route and shared-package generators, the shared application frame, typed message catalogs and their check, English as the only built-in language with the upgrade path for a product that kept another default, the production profiles, confidential client authentication, session hardening, back-channel logout, re-authentication and step-up, the dialog, one-time-code field and tree selector, the logical-properties rule, and streamed request and response bodies. They require CLI `0.1.0-dev.19` |
| `@mpfrontend/app-layout` | new, `0.1.0-dev.0` | A shared application frame that a generated app is styled through |
| `@mpfrontend/ftg-cli` | `0.1.0-dev.18` to `0.1.0-dev.19` | Generates English-only applications; feature, route and shared-package generators; a catalog check of typed message catalogs that also reports a translated key the code uses and the base catalog does not define |
| `@mpfrontend/ftg-core` | `0.1.0-dev.5` to `0.1.0-dev.6` | No source change. The archive now carries the `LICENSE` file |
| `@mpfrontend/i18n` | `0.1.0-dev.0` to `0.1.0-dev.1` | English is the only built-in locale. A configurable locale registry with a direction per locale, typed message catalogs and their check, the registry's digits applied to messages in any locale, and a locale preference read by the security BFF |
| `@mpfrontend/nx-plugin` | `0.1.0-dev.17` to `0.1.0-dev.18` | The shared workspace quality profile in generated workspaces; feature, route and shared-package generators; the application template styled through the shared frame, English only, with its catalog check, a `design-verify` target and the streamed-transfer route; app folders created only when needed |
| `@mpfrontend/presentation-server` | `0.1.0-dev.3` to `0.1.0-dev.4` | A production profile. In production it refuses a ticket store over a vault without TLS or authentication, and a shared ticket store that does not declare its security (`TICKET_STORE_SECURITY_REQUIRED`). A relay that streams request and response bodies |
| `@mpfrontend/primitives` | `0.1.0-dev.0` to `0.1.0-dev.1` | No source change. The archive now carries the `LICENSE` file |
| `@mpfrontend/realtime-core` | `0.1.0-dev.5` to `0.1.0-dev.6` | No source change. The archive now carries the `LICENSE` file |
| `@mpfrontend/security-bff` | `0.1.0-dev.6` to `0.1.0-dev.7` | A production profile that refuses, among others, a provider origin that is not HTTPS. Confidential client authentication. A hardened session cookie, a default lifetime of 30 minutes idle and 8 hours absolute, and session id rotation, a rotated session indexed before it is stored. OpenID Connect back-channel logout. Re-authentication and step-up. Allowlisted claims projected into the session context, and a locale preference. Upstream locales default to English only. Request and response bodies streamed per route |
| `@mpfrontend/tokens` | `0.1.0-dev.0` to `0.1.0-dev.1` | No source change. The archive now carries the `LICENSE` file and the current README |
| `@mpfrontend/ui` | `0.1.0-dev.4` to `0.1.0-dev.5` | An accessible dialog, a one-time-code field that accepts a decimal digit of any script, and a controlled hierarchical tree selector |
| `@mpfrontend/workspace-config` | new, `0.1.0-dev.0` | The shared quality profile of a generated workspace: TypeScript, Prettier and ESLint, with rules for module boundaries, raw colours, hand-written CSS, a feature's public entry, literal text and logical properties in class names, inline styles and stylesheets |

What a product notices when it upgrades: a shared ticket store without a `security` declaration stops a
production start; sessions end after 30 minutes idle or 8 hours by default; the production profile refuses a
non-HTTPS identity-provider origin; English is the only built-in locale.
