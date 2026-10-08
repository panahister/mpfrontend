---
name: mpfrontend-integrate-auth
description: Integrate an existing consumer with the MP Frontend server-side OIDC BFF, opaque cookie session and explicit route policy. Use for approved identity-provider settings, not for creating realms, users, roles or credentials.
---

# Integrate server-side authentication

Requires the reviewed MP Frontend CLI `0.1.0-dev.18` cohort and `@mpfrontend/security-bff`. Read the
consumer instructions and obtain approved issuer, client, callback/logout URLs, audiences, route policy,
cookie domain and supported UI locales. Missing provider metadata or secret ownership is a prerequisite,
not permission to create identity data.

Configure authorization code plus PKCE through the server BFF. Keep access, refresh and ID tokens on
the server; the browser receives only the bounded opaque `HttpOnly`, `Secure` production cookie. Apply
same-origin and CSRF controls to state-changing BFF routes, validate state/nonce/issuer/audience/time,
and use explicit route/method/role allowlists. Forward only an allowlisted locale through standard
`ui_locales`; the identity provider remains responsible for translating its own forms. Configure
`apiLocales: {supported, defaultLocale}` for the Accept-Language that the BFF sends upstream (for example
`fa` and `en` for a backend that answers in Persian); the BFF negotiates the browser's header against it
and never forwards the header as given. Project only the claims the UI needs into `/context` with
`contextClaims` (an allowlist; ID token by default, refreshed ID token at refresh); never project a token,
never write a claim into a cookie and never treat a projected claim as authorization. Configure
`preferenceCookie` with the shared language and theme cookie so that login pages receive `ui_locales`.

Use the in-memory session store only for local development. Beyond developer machines configure the
production profile, `production: {sessionVault, clientAuthentication, secureCookies: true}`, with a Redis
vault over `rediss:` with host-supplied credentials and key ring; the package refuses any unmet condition
by name (`PRODUCTION_PROFILE_REFUSED:...`). Resolve the named condition in the deployment; never bypass a
refusal or describe the profile as a production HA claim. Each front end is the confidential client of its
issuer: configure `clientAuthentication` with `private_key_jwt` (the host's private key and key id, or a
function returning the current one for rotation) or `client_secret_basic`; a public client must be declared
with `publicClient: true`. Keep the key or secret in the host's secret store; never put it in a file of the
repository, a log or an error. Set the session policy for the product's risk: a
`__Host-` session cookie (default in production), `sameSite: 'Strict'`, an idle timeout (default 30
minutes) and an absolute lifetime within their bounds; never shorten a lifetime the product owner set, and
expect 401 on an idle or expired session and a rotated session cookie after a role change. Never log tokens,
authorization codes, cookies, client secrets or personal data.

Add focused tests for login/callback, state replay, nonce/issuer/audience/expiry rejection, logout,
refresh rotation/outage, CSRF/origin rejection, locale propagation and absence of browser token
exposure. Verify an actual browser sign-in and return URL without collecting real credentials. Record
the approved cookie/session settings and remaining HA/TLS/key-rotation work.

Do not create or mutate Keycloak realms, clients, users, roles, resources or grants through this skill.
Do not replace an existing auth architecture, weaken production guards, deploy or publish without a
separate explicit request.
