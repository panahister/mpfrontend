# Shared security and realtime runtime

This document defines the runtime boundary implemented by `@mpfrontend/security-bff`,
`@mpfrontend/presentation-server`, and `@mpfrontend/realtime-core`.

## Security BFF contract

The browser holds an opaque, secure application cookie. Provider access and refresh tokens are stored in
an encrypted server-side session record. The presentation application calls the BFF over a trusted
server-to-server boundary; browser JavaScript never receives provider tokens or internal service origins.

Redis is the shared authority for multiple BFF instances. Session operations use:

- AES-256-GCM records with key identifiers and authenticated context;
- atomic one-time login consumption;
- bounded refresh leases;
- compare-and-swap publication of refreshed authority;
- revocation that wins against an in-flight refresh;
- explicit expiry and repository-defined quotas;
- fail-closed behavior when shared authority cannot be established.

Provider logout is attempted after local revocation. A provider outage cannot restore a locally revoked
session.

## Streamed bodies

A route of the BFF allowlist may declare a streamed body for files that pass between the browser and a
backend. Every property of the BFF holds for such a transfer: the provider tokens stay in the BFF, Origin
and the CSRF token are checked for every method other than GET, only allowlisted routes and the fixed
request headers go upstream, and no upstream header crosses that the route does not name. Every check of
an ordinary route runs, in the same order, before the first byte of the body is read.

- The consumer declares the accepted request media types, the maximum request size, the response media
  types, the response headers to pass (from Content-Type, Content-Length, Content-Disposition and
  Content-Security-Policy), an idle timeout, a total timeout and a session check interval. Nothing has a
  default; a route without a stream keeps the 64 KiB JSON contract.
- The size is known before forwarding: a body without Content-Length is refused with 411, a larger one
  with 413, another media type with 415, each before any upstream call.
- Bodies stream in both directions with backpressure. The BFF holds a bounded window of a body (its
  inbound socket and request buffers, the chunk being forwarded and the outbound socket buffer, at most
  about 256 KiB per transfer); the presentation relay holds none beyond the stream it passes.
- The session record is read again at the route's interval and once when the request body ends, before
  its last chunk goes upstream; an ended session aborts the upstream call and no success reaches the
  client.
- The presentation application relays a streamed route with `@mpfrontend/presentation-server/relay`,
  which forwards only the session cookie, Origin, the CSRF token, the idempotency key, Accept-Language and
  the content headers.

The BFF never parses, inspects, stores or logs a streamed body; content checks belong to the backend.

## Realtime contract

Realtime access is admitted with a short-lived, single-purpose ticket issued by the server. The runtime
limits outstanding tickets, binds a connection to current session authority, and coordinates:

- reconnect with bounded backoff;
- event replay from a known cursor;
- snapshot recovery when replay is incomplete;
- publication only after the awaited snapshot is current;
- lease release on close;
- revocation and stale-authority shutdown.

A snapshot failure uses an application close code valid for browser WebSocket clients. Ticket admission
uses a non-zero jitter floor so a client cannot exhaust a fixed quota at the start of a time window.

## Failure behavior

| Failure | Required behavior |
|---|---|
| Redis unavailable | Deny new authority-dependent work; do not fall back to process memory |
| Refresh owner stops | Lease expires and another instance may retry |
| Revocation races refresh | Revocation wins; stale refresh cannot publish |
| Replay gap cannot be closed | Request a snapshot before exposing resumed state |
| Snapshot fails | Close the connection with a recoverable application error |
| Ticket quota exhausted | Refuse admission until the bounded window permits another ticket |
| Streamed body without Content-Length, too large or of another type | Refuse with 411, 413 or 415 before any upstream call |
| Streamed answer of a media type the route does not list | Refuse with 502; read none of its body |
| Session ends during a transfer | Abort the upstream call; answer 401, or cut a started answer |
| Transfer idle or over its total time | Abort the upstream call; answer 504, or cut a started answer |
| Client cancels a transfer | Abort the upstream call |

## Evidence

The source gate includes isolated Redis-backed multi-replica, restart, refresh, revocation, quota,
snapshot, and outage scenarios. Deliberate negative controls remove required guards and must observe the
expected failures. The packed independent consumer also runs twelve security and five realtime assertions
against installed exports.

This is local integration evidence. Production Redis topology, TLS, key custody, load, regional failover,
monitoring, and incident recovery are deployment responsibilities and remain separate acceptance gates.
