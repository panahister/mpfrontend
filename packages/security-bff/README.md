# Security BFF

Node HTTP handler for independently deployed, product-neutral OIDC mediation. Implements Authorization
Code with S256 PKCE, state and nonce, RS256 JWT/JWKS validation, opaque HttpOnly cookies, same-origin
and CSRF checks, endpoint/method/role allowlists, bounded request bodies and server-held token refresh.
The product supplies its API routes and identity-provider settings. Neither tokens nor upstream response
headers cross the presentation boundary. The browser calls Next.js; only its server calls this BFF.

An application can declare an allowlist with `supportedUiLocales`. A matching `ui_locales` value on
`/login`, or the matching value of an optional `uiLocaleCookie`, is forwarded through the standard OIDC
authorization request; unlisted values are ignored and an explicit query value wins over the cookie.
The identity provider remains responsible for translated login, registration and recovery messages.

`contextClaims` is an allowlist of claim names that `/context` returns under `claims`. The claims come from
the validated ID token at sign-in and from a refreshed ID token of the same subject at refresh
(`contextClaimSource: 'id'`, the default); `contextClaimSource: 'access'` takes them from the access token
instead. Only plain values are projected: a string of at most 512 characters, a finite number, a boolean
or a list of at most sixteen short strings. Objects, token-shaped strings and values beyond the 4 KiB
budget of the projection are left out, and a claim name that refers to a token (`*token*`, `at_hash`,
`c_hash`, `nonce`) is refused at startup. Tokens never reach `/context`, and no claim is written into a
cookie.

`preferenceCookie: {name, locales, themes}` names the preference cookie that an app shares with the
identity provider's pages (language and theme only, value `lang=<locale>&theme=<theme>`). On `/login`
the BFF takes `ui_locales` from an explicit query value first, then the cookie's language when it is
allowlisted, then the older whole-value `uiLocaleCookie`. An invalid value is ignored and never echoed;
the cookie never decides anything about authority.

`apiLocales: {supported, defaultLocale}` is the allowlist for the `Accept-Language` header the BFF sends
upstream. The browser's header is negotiated against it by quality, exact range and primary language;
only an allowlisted token is ever sent, and the default replaces anything else, including malformed or
crafted input. Without configuration only `en` or `ar` is sent, as before; a consumer whose backends
answer in Persian lists `fa`.

The default memory vault remains a single-process development profile; restart signs users out.
The `./session-store` export provides `SessionVault`, `createMemorySessionVault` and
`createRedisSessionVault`. Supply an initialized Redis vault through `createBff({sessionVault, ...})`.
The Redis adapter is a **validation profile**, not permission to deploy in production. The handler
still rejects `NODE_ENV=production`, including when a Redis vault is supplied.

Redis records use AES-256-GCM with random 96-bit IVs and record-address associated data. Raw session
IDs are hashed in keys; access/refresh tokens, CSRF, identity and PKCE data are encrypted. The active
32-byte key is supplied by the host, not generated/stored by this package. A key ID supports a read
keyring during rotation. Retain old keys until their records expire or are rewritten; no automated
key migration or key-management service is implemented. `close()` closes the owned Redis client.

`GETDEL` consumes login state once across replicas. Refresh uses a 30-second owner lease and an atomic
Lua CAS on both the original record and current lease. Losing a lease or racing logout cannot recreate
a revoked session. Session TTL is absolute (eight hours), not renewed on refresh. A bounded provider
transport/timeout or HTTP429/5xx failure denies the current request with generic503; only the unchanged
verified server record is retained until its existing absolute expiry. No cached identity/API authority
is served, no automatic retry occurs, and no unverified rotated token is saved. A later request may
recover with the same opaque cookie, but ambiguous token rotation can still require a new login.
Invalid grant/client, malformed response, invalid signature/claims and failed storage/CAS invalidate
the record; generic503 is not enough to qualify as a provider outage. Logout removes state without
refreshing even while the provider is unavailable. The readiness endpoint checks the store; storage failures return generic503
responses and never fall back to memory. Offline command queuing/reconnect is disabled, commands are
bounded to two seconds; replace the adapter/replica after disconnection. This behavior needs an
operational supervisor, not an unattended indefinitely reconnecting client.

The uncached `security-bff:test-redis` target creates its own Docker Redis 8.0 AOF instance, uses
ephemeral test keys/identities and removes only its test container/anonymous volume. It verifies
two BFFs, atomic callbacks, concurrent refresh, logout races, key rotation/AAD, expiry, a controlled
AOF restart, store outage and Redis-backed presentation admission. It does not prove Redis cluster
failover, disk/power-loss durability, TLS/ACL/key custody, central rate limits or full backend journeys.
Production remains blocked on these deployment policies and complete realtime/release acceptance.

Sources: [OIDC Core](https://openid.net/specs/openid-connect-core-1_0.html),
[PKCE RFC 7636](https://www.rfc-editor.org/rfc/rfc7636),
[Keycloak OIDC endpoints](https://www.keycloak.org/securing-apps/oidc-layers).

The refresh failure distinction is a local policy: [OAuth2 token errors, RFC6749 §5.2](https://www.rfc-editor.org/rfc/rfc6749#section-5.2)
defines invalid grants/client authentication; [HTTP503, RFC9110 §15.6.4](https://httpwg.org/specs/rfc9110.html#status.503)
describes service unavailability. Neither source guarantees recoverable refresh-token rotation after
a lost response. Synthetic OIDC and isolated Redis tests exercise this policy, not production HA.

Storage references: [node-redis](https://redis.io/docs/latest/develop/clients/nodejs/),
[atomic GETDEL](https://redis.io/docs/latest/commands/getdel/),
[Redis persistence tradeoffs](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/).
