## Problem

Describe the concrete consumer problem and why the change belongs in the reusable foundation.

## Change

Describe the public API, ownership boundary, migration impact, and refusal behavior.

## Evidence

- [ ] A failing regression was observed before the fix, when applicable.
- [ ] `pnpm check --skip-nx-cache`
- [ ] `pnpm pack:local`
- [ ] `pnpm exec nx run distribution:consumer-check`
- [ ] Documentation and compatibility notes are updated.
- [ ] No credentials, personal data, private design material, or generated caches are included.

## Limits

State what this change does not prove or support.
