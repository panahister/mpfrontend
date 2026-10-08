# Frontend engineering conventions

This document is the default decision contract for product developers, reviewers, and coding agents that
use MP Frontend. It answers two recurring questions:

1. where a change belongs; and
2. how an API-backed feature moves from contract to verified product behavior.

These are defaults, not permission to invent a missing product decision. Record an approved exception in
the consumer repository before implementing it.

## The placement decision

```mermaid
flowchart TD
  CHANGE[New frontend change] --> GENERATED{Generated from an approved contract?}
  GENERATED -->|Yes| GEN[Generated output<br/>Never edit by hand]
  GENERATED -->|No| SURFACES{Used by which product surfaces?}
  SURFACES -->|Customer only| CUSTOMER[Customer feature]
  SURFACES -->|Admin or operations only| ADMIN[Admin feature]
  SURFACES -->|Two surfaces in one product| SHARED[Product-shared package]
  SURFACES -->|Only maps product design semantics| DLS[DLS adapter]
  SHARED --> NEUTRAL{Domain-neutral and proven by another product?}
  DLS --> NEUTRAL
  NEUTRAL -->|No| PRODUCT[Keep it in the product]
  NEUTRAL -->|Yes, with a stable public contract| FOUNDATION[Propose it to MP Frontend foundation]
```

| Destination | Put it here when | Never put here |
|---|---|---|
| Customer application | The route, copy, workflow, state, or composition exists only for an end-customer journey | Admin policy, reusable foundation behavior, provider credentials |
| Admin application | The behavior exists only for an operator, manager, courier, support, or governance journey | Customer presentation, cross-product primitives |
| Product-shared package | At least two product surfaces use the same product concept and the shared API is smaller than the duplicated implementation | A single caller, route composition, framework candidates, unrelated helpers |
| DLS adapter | Product tokens, typography, assets, direction, or component semantics are mapped onto foundation primitives | API calls, authorization policy, workflows, business state |
| BFF or presentation server | Session, token, trusted upstream, response validation, or server-only composition crosses a trust boundary | Visual state, browser-owned interaction, business authority |
| Generated output | The checked-in contract and finite generator configuration own the file | Handwritten fixes, product copy, UI state, credentials |
| MP Frontend foundation | The capability is domain-neutral, has a stable contract, and is demonstrated by at least two independent product shapes or an explicit platform requirement | Product vocabulary, brand, routes, roles, endpoint choices, one-product convenience |

The default is to keep a capability in the product. Promotion into foundation is a compatibility and
maintenance commitment, not a refactoring shortcut.

## Separation of concerns

Use four collaborating parts for an API-backed feature. A small feature may keep them in one feature
folder, but it must preserve the responsibilities.

| Part | Owns | Must not own |
|---|---|---|
| View | Rendering, accessibility semantics, local input state, and emitting user intent | Fetching, token access, response parsing, authorization decisions, business invariants |
| Feature model or controller | Workflow state, use-case orchestration, optimistic presentation, and mapping technical outcomes to product states | Provider credentials, raw transport policy, reusable visual primitives |
| Contract boundary | Generated request/response types and validators plus a small handwritten adapter | Product copy, navigation, component state |
| Server adapter | Session lookup, CSRF/idempotency forwarding, trusted upstream selection, timeouts, and response validation | UI behavior or pretending that frontend visibility is backend authorization |

### When logic leaves a component

Extract logic when any answer below is yes:

| Question | Destination |
|---|---|
| Can the rule be tested without rendering? | A pure function in the feature model |
| Does it coordinate more than one request or state transition? | A feature controller or use-case function |
| Does it parse or validate an external payload? | The contract boundary, preferably generated |
| Does it touch a token, trusted URL, cookie, or service credential? | A server-only adapter or BFF |
| Is it only formatting a product value for display? | A pure product presentation function |
| Is it only visual behavior with no product vocabulary? | A foundation primitive only after the promotion test above |

Do not extract a one-line expression merely to reduce component line count. Extract because ownership,
testability, trust, or reuse becomes clearer.

### Preferred shape

```tsx
function OrderActions({order, onCancel}: Props) {
  const canCancel = cancellationPresentation(order.status);
  return canCancel.visible
    ? <Button disabled={canCancel.disabled} onClick={() => onCancel(order.id)}>Cancel order</Button>
    : null;
}
```

The view renders product state and emits intent. A feature controller performs the request, validates the
response, refreshes dependent reads, and maps expected failures to localized feedback. The backend still
owns the real cancellation rule and authorization.

Avoid a component that reads provider tokens, constructs an internal service URL, calls `fetch`, accepts
any successful JSON shape, decides whether the actor is authorized, and renders the result. That combines
five owners and makes both security and testing ambiguous.

## State, effects, and data access

- Derive values during render when they follow from props or state; do not synchronize derived values with
  an effect. This follows React's guidance in *You Might Not Need an Effect*.
- Keep state at the lowest common owner of the views that coordinate it. Do not create a global store to
  avoid passing a small, stable feature value.
- Use an effect only to synchronize with an external system. Event-driven work belongs in the event path,
  not in an effect that watches a flag.
- Keep server data authoritative. Optimistic UI is a reversible presentation choice and must reconcile
  with a validated server result.
- Never infer authorization from a hidden control. The server decides; capability-driven UI only explains
  and presents that decision.
- Preserve cancellation through every asynchronous layer and place explicit time bounds at network
  boundaries.
- Treat external data as `unknown` until the generated or approved handwritten boundary validates it.

## Standard API-backed feature path

```mermaid
flowchart LR
  CONTRACT[Approved backend contract] --> CAPTURE[Checked-in OpenAPI input]
  CAPTURE --> SELECT[App ftg.config.json]
  SELECT --> GENERATE[Generated models and validators]
  GENERATE --> BOUNDARY[Handwritten contract boundary]
  BOUNDARY --> FEATURE[Feature model and UI]
  FEATURE --> TARGETED[Focused tests and Nx targets]
  TARGETED --> DRIFT[Generated check]
  DRIFT --> PRODUCT[Selected live product mode]
  PRODUCT --> REVIEW[Evidence and human review]
```

1. **Start with an approved API contract.** Confirm operation id, method, path, request-body profile,
   success status, response schema, failure identities, authorization, and idempotency behavior.
2. **Update the captured contract.** The consumer repository owns an immutable, reviewable OpenAPI input.
   Do not generate from an unpinned live endpoint during a normal feature change.
3. **Select only the operations the app uses.** Add the read or request to that app's `ftg.config.json`.
   Choose required JSON, optional JSON, or bodyless behavior explicitly.
4. **Generate; never hand-edit output.** Run the app's `ftg-generate` target and inspect both the generated
   manifest and diff. A generator defect is repaired in the generator.
5. **Bind at the trusted boundary.** The handwritten boundary selects the generated contract, validates
   requests before forwarding and validates successful status plus response before returning it.
6. **Implement product behavior.** Put orchestration and product state in the correct feature; keep the
   view focused on rendering and intent.
7. **Test the contract and the experience.** Cover valid and invalid payloads, expected failures,
   cancellation, accessibility, localization, and the state transition the user sees.
8. **Run focused targets first.** Use the app's lint, typecheck, test, and build targets for fast feedback.
9. **Run the drift gate.** `generated-check` must prove that checked-in output matches the contract and
   configuration.
10. **Run the repository gate and a real mode.** Complete the uncached gate, then exercise the feature in
    the consumer's documented local workflow. Report exactly what ran.

Typical commands in a consumer Nx workspace are:

```bash
pnpm exec nx run <app>:ftg-generate
pnpm exec nx run <app>:test --skip-nx-cache
pnpm exec nx run <app>:lint --skip-nx-cache
pnpm exec nx run <app>:typecheck --skip-nx-cache
pnpm exec nx run <app>:build --skip-nx-cache
pnpm exec nx run <app>:generated-check --skip-nx-cache
pnpm check --skip-nx-cache
```

Use the consumer repository's exact project names and live workflow. A passing generation command alone
does not prove the feature.

## Generated and handwritten ownership

| Change needed | Edit | Then |
|---|---|---|
| API shape changed | Captured OpenAPI contract | Regenerate and review compatibility |
| App starts using an existing operation | App `ftg.config.json` | Regenerate and add boundary tests |
| Generated output is wrong for every consumer | Generator source in MP Frontend | Add a failing generator regression and prove an independent consumer |
| Product flow or copy changed | Product feature or adapter | Run focused product tests; do not regenerate unrelated files |
| Design semantics changed | Consumer DLS adapter or reviewed token source | Run theme/design verification; do not add business logic to the adapter |

Generated files are checked in so drift and review are possible. They are output, not an extension point.

## Review checklist for developers and agents

- [ ] The product owner and surface are named.
- [ ] The placement decision follows the table, or an approved exception is recorded.
- [ ] UI renders state and emits intent; testable workflow logic is outside the component.
- [ ] Trusted session and upstream behavior stays server-side.
- [ ] No generated file was edited by hand.
- [ ] Contract method, path, body profile, success status, and response are validated.
- [ ] Backend authorization is not replaced by UI visibility.
- [ ] Expected failure, loading, empty, success, and retry states are deliberate.
- [ ] Accessibility, localization, direction, and cancellation are covered where applicable.
- [ ] Focused targets, generated drift, the uncached repository gate, and a real local mode are reported.
- [ ] A product-specific workaround was not placed in foundation.

An agent must stop and ask when the business owner, API contract, permission model, or target surface is
ambiguous. It must not choose a business rule merely because one implementation is convenient.

## Sources and why they apply

| Source | Convention used here |
|---|---|
| React, [Thinking in React](https://react.dev/learn/thinking-in-react) and [You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect) | Component decomposition, one-way data flow, derived state, and effect discipline |
| Next.js, [Server and Client Components](https://nextjs.org/docs/app/getting-started/server-and-client-components) | Explicit server/client and trust boundaries |
| Nx, [Enforce Module Boundaries](https://nx.dev/features/enforce-module-boundaries) | Dependency direction and tag-enforced repository boundaries |
| Testing Library, [Guiding Principles](https://testing-library.com/docs/guiding-principles) | Tests emphasize observable behavior over implementation detail |
| OpenAPI Initiative, [Specification](https://spec.openapis.org/oas/latest.html) | The captured API description is a reviewed contract input |
| Robert C. Martin, *Clean Architecture* (2017) | Dependencies point toward stable policy rather than transport and frameworks |
| MP Frontend [Architecture](ARCHITECTURE.md) | Product/foundation ownership, browser/BFF trust, generation, and failure model |

