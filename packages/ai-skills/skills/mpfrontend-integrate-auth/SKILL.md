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
`ui_locales`; the identity provider remains responsible for translating its own forms.

Use the in-memory session store only for local development. The package refuses it under production;
do not bypass that guard or describe the current Redis proof as a production HA claim. Never log tokens,
authorization codes, cookies, client secrets or personal data.

Add focused tests for login/callback, state replay, nonce/issuer/audience/expiry rejection, logout,
refresh rotation/outage, CSRF/origin rejection, locale propagation and absence of browser token
exposure. Verify an actual browser sign-in and return URL without collecting real credentials. Record
the approved cookie/session settings and remaining HA/TLS/key-rotation work.

Do not create or mutate Keycloak realms, clients, users, roles, resources or grants through this skill.
Do not replace an existing auth architecture, weaken production guards, deploy or publish without a
separate explicit request.
