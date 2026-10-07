# Contributing

Thank you for improving MP Frontend. Contributions should make the reusable foundation safer, clearer,
or more capable without pulling one product's domain model into the platform.

## Before opening a change

- Search existing issues and proposals.
- Explain which real consumer scenario requires the change.
- Keep product behavior, credentials, brand assets, and private design exports in consumer repositories.
- Preserve the browser, BFF, gateway, and backend trust boundaries.
- Add a failing regression before a defect repair when practical.

Use Node.js `24.19.0` and pnpm `11.25.0`. Then run:

```sh
pnpm install --frozen-lockfile
pnpm check --skip-nx-cache
pnpm pack:local
pnpm exec nx run distribution:consumer-check
```

Add a failing regression before a defect repair. Do not weaken refusal paths, production guards,
contract validation or evidence labels to make a test pass. Do not include generated dependency caches,
secrets, private Figma material or machine-local paths.

## Pull requests

A pull request must describe the problem, public API or ownership impact, migration behavior, evidence,
and explicit limits. Keep changes focused. Generated files must be reproducible from reviewed inputs.

Do not use a passing build as a production-readiness claim. If a scenario, platform, failure mode, or
deployment topology was not run, state that plainly.

## Compatibility and releases

The current packages are prerelease source artifacts. Any exported type, CLI flag, generated file, or
configuration key may become a compatibility boundary. Call out intentional breakage and provide a
migration path. Package registry publication and stable semantic-version guarantees are not active yet.

## Conduct and security

Follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Do not disclose vulnerabilities in a public issue;
use the private process in [SECURITY.md](SECURITY.md).
