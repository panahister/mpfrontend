# Authenticated presentation sockets

Development polling-to-WebSocket invalidation adapter for a self-hosted Next custom server.
It is not a backend event stream, durable replay log or multi-replica relay.

The browser first obtains a single-use 20-second ticket through a same-origin CSRF-protected POST.
The upgrade requires the exact Origin and a valid opaque BFF session. The first frame redeems the
ticket bound to that cookie and authority revision. Resources resolve only through product-owned
allowlists and authenticated BFF reads. No access token, cookie, resource data or tenant is sent in frames.

Admission and every polling tick recheck session and authority. Losing authorization closes the socket.
Reconnect always requests fresh authoritative snapshots; this profile does not resume missed events.
Limits: 32 connections/process, 2/session, 6 subscriptions, 4 KiB incoming frames, 64 KiB outgoing
buffer, 5-second admission timeout, 3-second minimum polling and 30-second ping/pong.
Network/backend uncertainty sends a resync-required frame, never a fabricated event. Editors keep
drafts and show a refresh notice; readonly consumers may refetch. Production startup is refused.

Sources: [Next custom servers](https://nextjs.org/docs/app/guides/custom-server),
[ws authentication and upgrades](https://github.com/websockets/ws#client-authentication),
[WebSocket protocol](https://www.rfc-editor.org/rfc/rfc6455).
## Shared admission validation

`SocketConfig.ticketStore` accepts an asynchronous `AdmissionTicketStore` with atomic `consume`.
The default stays bounded process memory. Consumers can bind Redis-vault issue/consume operations;
all replicas must use the same app-scoped namespace/keyring. Tickets remain cookie/authority-bound
and expire after 20 seconds. First-frame authority is checked again before ready/invalidation.
Storage errors close admission; no local fallback is used. Concurrent subscribe frames are rejected.

Shared tickets do **not** provide global connection/issuance quotas, retained event replay or a
production profile. Connection counts and polling cursors remain process-local. Production startup
is still rejected, even with a shared ticket store. See the core shared-runtime acceptance document.
