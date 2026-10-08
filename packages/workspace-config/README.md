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
  }),
];
```

The tags come from the generators: an app carries `type:app`, `scope:<app>` and `runtime:mixed`; a shared
package carries `type:package`, `scope:shared` and a `runtime:*` tag. A rule can be extended or switched
off by a later configuration object in the consumer, as with any flat configuration; this package never
weakens the rules of the MP Frontend repository itself.

## Limits

The colour rule reads string literals, template literals, style objects, SVG colour attributes and CSS
values. A colour computed at run time from numbers is not detected. A string such as `'#add'` outside a
reference attribute (`href`, `id`, `htmlFor`) is read as a colour; disable the rule for that line with a
reason. Module boundaries need the Nx project graph, so they run through the workspace `lint` targets.
