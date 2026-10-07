# Design synchronization contract

MP Frontend treats design input as a reviewed, consumer-owned build artifact. It does not connect to or
write to Figma, and it does not ship a public design library.

## Supported source modes

| Mode | Use case | Initial state |
|---|---|---|
| `none` | Code-first product | Ready without an external design binding |
| `existing` | Product owns an approved Figma/DLS export | Waiting for an explicit local attachment |

The legacy `mpfrontend` public-template mode is refused. Shipping a CLI option without a corresponding
public, licensed, versioned design source would create a false contract.

## Attachment

`design attach` validates a finite binding and normalized local export, then records a canonical content
hash. It rejects:

- path escape and symlink traversal;
- unknown or mismatched source identity;
- concurrent writers;
- incomplete or malformed bindings;
- replacement of an immutable attachment without explicit review.

`design status` rechecks the attachment and reports drift without rewriting source or generated output.

## Lifecycle

The CLI provides `design import`, `validate`, `diff`, `plan`, `apply`, `accept`, and `check` for reviewed
local exports. A candidate may be generated and applied without becoming an accepted baseline. Acceptance
requires explicit evidence and review; it is never implied by a successful build.

Generated files have declared ownership. Product typography, composition, accessibility adaptations,
assets, and component behavior remain handwritten consumer responsibilities unless a reviewed mapping
explicitly says otherwise.

## Rights and privacy

An attachment proves local byte identity, not redistribution rights. Consumers must keep private file
keys, raw exports, licensed assets, confidential metadata, and machine paths out of public repositories.
MP Frontend neither grants rights nor sanitizes a private design system for publication.

## Evidence

CLI dev.18 passes twenty-eight focused checks, including both supported modes, legacy-mode refusal,
attachment/status, drift, path/symlink boundaries, writer locking, lifecycle commands, and isolated guard
removals. The independent packed consumer repeats the supported-mode and lifecycle paths from installed
archives. Visual quality and source-design rights remain human review gates.
