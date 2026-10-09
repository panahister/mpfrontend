# @mpfrontend/workspace-config

Local development package. Runtime: tooling. The shared quality profile of a consumer workspace: one
ESLint flat configuration, one Prettier profile and the TypeScript presets that every generated app and
package extends. It is versioned with the rest of the MP Frontend cohort, so a workspace upgrades its
rules by upgrading the cohort, never by copying configuration.

## What a workspace gets

`mpfrontend init` writes a root `eslint.config.mjs` and `prettier.config.mjs` that re-export this
profile, and `mpfrontend create app` writes an app `eslint.config.mjs` that spreads the root array and
a `tsconfig.json` that extends `@mpfrontend/workspace-config/tsconfig/next.json`. An app or a package adds
only its own additions after the shared part.

| Export | Contents |
|---|---|
| `@mpfrontend/workspace-config/eslint` | `workspaceConfig(options)`, `defaultDepConstraints`, `defaultThemeFiles`, `defaultGlobalStyleEntries`, `defaultIgnores` and the `plugin` with the rules below |
| `@mpfrontend/workspace-config/prettier` | The formatter profile: print width 100, single quotes, trailing commas, LF line endings |
| `@mpfrontend/workspace-config/tsconfig/base.json` | Strict TypeScript options shared by every project |
| `@mpfrontend/workspace-config/tsconfig/next.json` | The base plus the Next.js application options |
| `@mpfrontend/workspace-config/tsconfig/library.json` | The base plus the options of a shared package |

## Rules

| Rule | Fails on |
|---|---|
| `@nx/enforce-module-boundaries` | An import that crosses the tag constraints: an app importing another app, a shared package importing an app, a universal project importing a runtime-specific one |
| `mpfrontend/no-raw-color` | Hex values, `rgb()`, `rgba()`, `hsl()`, `hsla()` (and the other colour functions) and named colours in TS, TSX and CSS; Tailwind palette utilities such as `text-red-500`; Tailwind arbitrary colour values such as `bg-[#123456]` |
| `mpfrontend/no-handwritten-css` | Any CSS file outside the theme layer and the global entry; class and id rules, keyframes, font faces and `@theme` in the global entry; inline `style` objects other than CSS custom properties; `<style>` elements |
| `mpfrontend/logical-properties` | Physical left and right in TS, TSX and CSS: utilities such as `ml-2`, `pr-4`, `left-0`, `border-l`, `rounded-tr-md`, `text-right` and `float-left` (also behind variants), inline style keys such as `marginLeft`, CSS properties such as `margin-left`, `right` and `border-top-left-radius`, and `left` or `right` for `text-align`, `float` and `clear`. Logical forms (`ms-*`, `pe-*`, `start-*`, `border-s`, `text-end`, `margin-inline-start`) pass |
| `@typescript-eslint/no-explicit-any` | `any` in hand-written code |

CSS variables such as `var(--mp-surface-panel)`, `currentColor`, `transparent` and Tailwind arbitrary
values that are not colours (`w-[42rem]`, `grid-cols-[1fr_2fr]`) stay allowed. Generated contracts
(`**/generated/**`, `*.gen.ts`) and build output are not linted as hand-written code; `generated-check`
owns them.

## Configuration

The allowed paths are options, not edits to the profile:

```js
import {defaultDepConstraints, workspaceConfig} from '@mpfrontend/workspace-config/eslint';

export default [
  ...workspaceConfig({
    themeFiles: ['**/src/theme/**', '**/themes/**'],
    globalStyleEntries: ['**/src/app/globals.css'],
    depConstraints: [
      ...defaultDepConstraints,
      {sourceTag: 'scope:billing', onlyDependOnLibsWithTags: ['scope:billing', 'scope:shared']},
    ],
    allowedPhysical: [
      {value: 'left-1/2', reason: 'Centred with -translate-x-1/2, which does not depend on the direction'},
    ],
  }),
];
```

`allowedPhysical` lists the physical values a workspace keeps, each with the reason it does not depend on
the text direction; an entry without a reason of at least ten characters is a configuration error. It is
empty by default, and the sources and templates of MP Frontend need no entry (a test lints them all).

The tags come from the generators: an app carries `type:app`, `scope:<app>` and `runtime:mixed`; a shared
package carries `type:package`, `scope:shared` and a `runtime:*` tag. A rule can be extended or switched
off by a later configuration object in the consumer, as with any flat configuration; this package never
weakens the rules of the MP Frontend repository itself.

## Limits

The colour rule reads string literals, template literals, style objects, SVG colour attributes and CSS
values. A colour computed at run time from numbers is not detected. A string such as `'#add'` outside a
reference attribute (`href`, `id`, `htmlFor`) is read as a colour; disable the rule for that line with a
reason. Module boundaries need the Nx project graph, so they run through the workspace `lint` targets.

## Text

`mpfrontend/no-literal-text` fails on literal user-visible text in JSX (text children, string children and
the attributes `alt`, `title`, `placeholder`, `aria-label`, `label`, `helper`, `caption` and the other
visible-text attributes), and on a translated message joined to other text or a value by `+`, a template
literal or adjacent JSX text and expressions. Text comes from catalog messages with named parameters. The
documented allowlist for strings that are not user-visible text is the `allowedText` option of
`workspaceConfig` (regular expressions); strings without letters, such as a separator, are always allowed.
The translator names default to `t` (`translators` option).
