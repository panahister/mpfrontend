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

## Evidence

The source gate includes isolated Redis-backed multi-replica, restart, refresh, revocation, quota,
snapshot, and outage scenarios. Deliberate negative controls remove required guards and must observe the
expected failures. The packed independent consumer also runs twelve security and five realtime assertions
against installed exports.

This is local integration evidence. Production Redis topology, TLS, key custody, load, regional failover,
monitoring, and incident recovery are deployment responsibilities and remain separate acceptance gates.
