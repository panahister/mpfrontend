# @mpfrontend/realtime-core

Part of [MP Frontend](https://github.com/panahister/mpfrontend), released to the public npm registry as one cohort: every `@mpfrontend`
package at the same exact version. Runtime: universal. Install it through a workspace that `mpfrontend init`
created, which pins the cohort and binds the scope to the registry in `.npmrc`. [Versioning](https://github.com/panahister/mpfrontend#versioning)
states the compatibility policy and [Implementation status](https://github.com/panahister/mpfrontend/blob/main/docs/IMPLEMENTATION-STATUS.md) the
evidence.

The React hook subscribes before awaiting protected snapshots, uses bounded retry/backoff, and
invalidates old work on cleanup/revocation. Failed snapshots close with application code4013 before
readmission; the server may send1013, but browser close() cannot send it. See the
[WHATWG client close contract](https://websockets.spec.whatwg.org/#dom-websocket-close).
The real-hook regression executes the actual source using finite effect/state and strict client-close
harnesses; it is not a React render test or a live HA/backend recovery acceptance.

An optional `onUnavailable` callback reports only ticket/transport/snapshot phase and, for an HTTP
ticket denial, its numeric status. It never receives tickets, user/tenant identity, cookies, payloads
or upstream messages. Notifications are frozen, once per failed attempt/socket, and observer exceptions
cannot disable retry/close. The core logs nothing automatically; a consumer chooses its own bounded
diagnostic sink. Revocation still closes/stops and invokes onRevoked, never grants fallback access.
