---
name: mpfrontend-use-ui
description: Compose the existing neutral MP Frontend Button, Field, Select, Card, ResourceTable and ResourceForm with consumer-owned DLS styling. Not a complete Figma component library or design-sync workflow.
---

# Use the neutral component boundary

Read the consumer instructions and installed `@mpfrontend/ui` types before implementation. The
current public kit has six components: Button, Field, Select, Card, ResourceTable and ResourceForm.
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

If a missing reusable component is requested, record its neutral behavioral contract and test it
before extending core; do not label an invented component as a verified Figma implementation.
Never alter Figma, publish a package or perform a live business mutation without that authority.
