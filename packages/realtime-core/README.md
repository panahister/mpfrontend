# @mpfrontend/realtime-core

Local development package. Runtime: universal. Public API is exported from src/index.ts and compiled
into dist. Nx owns build, typecheck, lint and test targets. Consumer applications install packed artifacts.
See ../../docs/IMPLEMENTATION-STATUS.md for observed evidence and remaining work.

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
