---
name: mpfrontend-use-ui
description: Compose the existing neutral MP Frontend components (Button, Field, Select, Card, ResourceTable, ResourceForm, Dialog, OneTimeCodeField, ConfirmWithCode, Tree) with consumer-owned DLS styling. Not a complete Figma component library or design-sync workflow.
---

# Use the neutral component boundary

Read the consumer instructions and installed `@mpfrontend/ui` types before implementation. The
current public kit has Button, Field, Select, Card, ResourceTable, ResourceForm, Dialog,
OneTimeCodeField, ConfirmWithCode and Tree.
Use those exports rather than private package internals or copying core into the product. Read and
request forms have different metadata; route to the installed table/form procedures when applicable.

The kit owns semantic markup and supported interaction states; the consumer owns product names,
assets, fonts, icons, CSS/token values and composed screens. Existing mp-* classes and variable-based
Tailwind hooks are styling interfaces, not evidence of a complete unstyled/headless widget system.
Do not add a product's brand/token registry to neutral core. Verify local font/asset rights before
public redistribution; missing proprietary fonts may use a licensed consumer fallback.

Use accessible labels and native semantics. Preserve Button loading/restricted/disabled states;
Field helper/error associations; Select's logical icon placement; and table captions/column scopes.
Set product-specific loading/error copy explicitly. Inspect actual types before assuming unsupported
slots, variants, modal behavior, widget registration or controlled-null semantics.

Verify real keyboard interaction, focus visibility, disabled submissions, error announcements,
long text and mobile overflow. Exercise English/Arabic with logical spacing and light/dark tokens.
For API controls prove the consumer adapters and request/read guards, not only static rendering.
Run relevant UI and consumer lint/typecheck/test/build targets; save native browser evidence when
visual acceptance is required. A screenshot alone does not prove interaction or accessibility.

Frame every app with `@mpfrontend/app-layout`: `AppFrame` (skip link and focusable `main`), `AppHeader`
(brand, navigation slot, actions slot), `Navigation` and `PageFrame` (a section labelled by its title,
with an actions slot). Pass only the navigation items that the server allows; the shell decides nothing
about access, and every text is a prop. Import `@mpfrontend/ui/tailwind.css` and
`@mpfrontend/app-layout/tailwind.css` from the app's global stylesheet so that Tailwind v4 compiles the
structural classes, and verify a built rule such as `p-6` of Card. Take spacing and layout from the
components and utility classes; never add a layout stylesheet, a class rule to the global entry or a raw
colour, which the shared lint rules refuse.

For a sensitive action confirmed by a code sent to the person, use `ConfirmWithCode` (built on `Dialog` and
`OneTimeCodeField`): its `onConfirm` posts the code through the BFF with the CSRF token and an idempotency
key, and the server alone checks it. Never check a code in the browser, keep it in storage or put it in a
URL. Pass every label from the catalog; verify Tab, Shift+Tab, Escape and focus return in both directions.

For a hierarchy (menus and the elements under them, for example), use the controlled `Tree`, with
`columns` for a tree table. Keep `expanded` and the node states in the feature's state; write the state
rule (including any change over the current children) in the feature model and call it from
`onActivate`. The tree decides no access; the server's projection decides which nodes and states exist.

If a missing reusable component is requested, record its neutral behavioral contract and test it
before extending core; do not label an invented component as a verified Figma implementation.
Never alter Figma, publish a package or perform a live business mutation without that authority.
