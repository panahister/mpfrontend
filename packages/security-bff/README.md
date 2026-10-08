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
The `./session-store` export provides `SessionVault`, `createMemorySessionVault`, `createRedisSessionVault`,
`redisVaultSecurity` and `createVaultTicketStore`. A development configuration (`development: true`)
behaves as before and is still refused when `NODE_ENV=production`.

## Client authentication

`clientAuthentication` configures how the BFF authenticates to the token endpoint, per BFF:

- `{method: 'private_key_jwt', key}` (RFC 7523): each token and revocation request carries a client
  assertion signed with the host's private key, with `iss` and `sub` the client id, `aud` the issuer's
  token endpoint, a unique `jti` and a lifetime of `CLIENT_ASSERTION_LIFETIME_SECONDS` (60 seconds). `key`
  is `{keyId, privateKey, algorithm?}` (RS256, PS256 or ES256) or a function that returns the current one,
  so that the provider can rotate keys by key id. No shared secret goes over the wire.
- `{method: 'client_secret_basic', secret}`: the secret, or a function that returns it, goes only into the
  `Authorization: Basic` header of provider requests (RFC 6749 section 2.3.1).
- `{method: 'none', publicClient: true}`: a public client, sent with its client id only.

The key or secret is supplied by the host and only referenced: the package never stores it in a session,
logs it, returns it in an error or a response, or puts it in `/context`. The PKCE, state and nonce checks
are unchanged.

## Session cookie and lifetimes

`session: {sameSite, idleTimeoutSeconds, absoluteLifetimeSeconds, authorizationClaims}` sets the session
policy:

- The session cookie may carry the `__Host-` prefix (Secure, `Path=/`, no `Domain`); the production
  profile adds it by default (`production.hostPrefix: false` opts out), and the prefix requires an https
  public origin. The cookie holds only the opaque session id, never a token or a claim.
- `sameSite` applies to the session cookie: `Strict` is recommended and is the production default; the
  development default stays `Lax`. The login transaction cookie is always `Lax`, so that the provider's
  redirect back carries it. With `Strict`, the callback answers with a small same-origin page that moves on
  to `/`, because a browser does not send a Strict cookie on the next hop of a cross-site redirect chain.
- `idleTimeoutSeconds` (default 1800, 60 to 86400) and `absoluteLifetimeSeconds` (default 28800, 300 to
  604800, at least the idle timeout): a value outside its bounds refuses startup rather than being
  shortened. An idle or expired session fails closed with 401 and is removed. Activity is recorded under
  the session lease at most once a minute.
- The session id is new after every sign-in (an earlier id in the request is removed), and it rotates at
  refresh when an authorization claim changes (`realm_access`, `resource_access`, `groups`, `scope`,
  `tenant_id` by default); the response sets the new cookie and the old id stops working. A change of
  subject or tenant still ends the session.

## Re-authentication and step-up

A route may require a recent sign-in and, optionally, an authentication context class:
`authentication: {maxAge, acr}` on the route, where `acr` lists the values that count and must come from
the BFF's `acrValues` allowlist; `maxAge` alone needs no acr levels. When the session's `auth_time` is
older than `maxAge` or its `acr` is not listed, the BFF answers 401 with a typed body,
`{title: 'STEP_UP_REQUIRED', stepUp: {maxAge, acrValues, login, resubmit}}`, without calling the API.
An upstream 401 with an RFC 9470 challenge (`error="insufficient_user_authentication"`, `max_age`,
`acr_values`) becomes the same typed answer; its body and other headers stay behind, and the answer never
names the provider's origin. `login` is the BFF's own relative login path.

`/login` accepts `max_age`, `acr_values` (allowlisted values only) and `return_to`. The callback accepts the
new session only when the new ID token's `auth_time` is within `max_age` and its `acr` is one of the
requested values; otherwise it answers 401 `STEP_UP_FAILED`, creates nothing and leaves the earlier session
as it was. A successful step-up replaces the weaker session: its id and tokens are removed. `return_to` must
be a same-origin path that matches `returnPaths` (default `/`); another origin, a protocol-relative or
backslash path, or an unlisted path is refused with 400 before the provider is asked.

The BFF never holds or replays a write. `resubmit` is `idempotent` for a safe request or a write that
carries an `Idempotency-Key`, and `manual` otherwise: the presentation server resubmits an idempotent
request with the same key after the step-up, and asks the person again for any other write.

## Back-channel logout

`backChannelLogout: true` enables `POST /backchannel-logout` (OpenID Connect Back-Channel Logout 1.0). The
body is the form `logout_token=<JWT>`. The token must be signed with the issuer's keys, carry the issuer as
`iss`, the client id in `aud`, `iat`, `exp` and a `jti`, contain the back-channel logout event, name a
`sid`, a `sub` or both, and contain no `nonce`; it is accepted for five minutes after `iat`. A valid token
removes every session of its `sid`, or of its subject when it has no `sid`, and the next request of that
browser gets 401. The answer is an empty 200; no session list or count is ever returned. A replayed `jti`
or any invalid token is answered 400 and changes nothing. While the session vault is unavailable the
endpoint answers 503 without recording the token, so that the provider's retry succeeds, and no session is
served meanwhile.

The vault indexes each session by the provider's session id (from the ID token's `sid`) and by subject;
the Redis index holds hashed session addresses only. A vault without `indexSession` and `revokeIndexed`
refuses the option at startup. The endpoint carries no browser session or CSRF token: route it only from
the identity provider's network path, for example a separate internal listener or an ingress rule that
admits the provider alone, and never expose it to browsers.

## Production profile

A production configuration replaces `development: true` with a typed profile:
`production: {sessionVault, clientAuthentication, secureCookies: true}`. `createBff` starts only when every
condition holds, and otherwise refuses with `PRODUCTION_PROFILE_REFUSED:` followed by the names of the
unmet conditions (`productionRefusals(config)` lists them without starting):

| Condition | Refusal name |
|---|---|
| The public origin is `https` | `HTTPS_PUBLIC_ORIGIN_REQUIRED` |
| The issuer and provider origin are `https` | `HTTPS_IDENTITY_PROVIDER_REQUIRED` |
| The session vault is durable (never the memory vault) | `DURABLE_SESSION_VAULT_REQUIRED` |
| The vault is reached over TLS | `SESSION_VAULT_TLS_REQUIRED` |
| The vault connection is authenticated | `SESSION_VAULT_AUTHENTICATION_REQUIRED` |
| The vault's key ring is supplied by the host | `HOST_KEY_RING_REQUIRED` |
| Client authentication is configured: a confidential method, or a public client declared explicitly with `publicClient: true` | `CLIENT_AUTHENTICATION_REQUIRED` |
| Session cookies are `Secure` | `SECURE_COOKIES_REQUIRED` |

A vault describes itself through `security` (`durable`, `tls`, `authenticated`, `hostKeyRing`); a vault
without it is treated as unknown and refused. A Redis vault is durable with a host key ring, uses TLS for a
`rediss:` URL and is authenticated by `password` (or URL credentials). The production profile has no
memory fallback: `/health` answers 503 and every request fails with 503 while the vault is unavailable.
Errors carry codes only; no secret is logged. The negative controls remove each condition and observe the
production tests fail. The profile does not by itself prove HA, durability policy, key custody or a
reviewed deployment.

Redis records use AES-256-GCM with random 96-bit IVs and record-address associated data. Raw session
IDs are hashed in keys; access/refresh tokens, CSRF, identity and PKCE data are encrypted. The active
32-byte key is supplied by the host, not generated/stored by this package. A key ID supports a read
keyring during rotation. Retain old keys until their records expire or are rewritten; no automated
key migration or key-management service is implemented. `close()` closes the owned Redis client.

`GETDEL` consumes login state once across replicas. Refresh uses a 30-second owner lease and an atomic
Lua CAS on both the original record and current lease. Losing a lease or racing logout cannot recreate
a revoked session. The absolute session lifetime is not renewed on refresh. A bounded provider
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
