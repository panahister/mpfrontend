# Security policy

## Reporting a vulnerability

Report suspected vulnerabilities privately through
[GitHub Security Advisories](https://github.com/panahister/mpfrontend/security/advisories/new). Do not
open a public issue, discussion, or pull request for an undisclosed vulnerability.

Include the affected package and version, prerequisites, impact, a minimal reproduction, and any known
mitigation. Remove credentials, access tokens, session cookies, private URLs, personal data, and private
design material from the report.

The maintainer will acknowledge a complete report, investigate it, and coordinate disclosure after a
fix or mitigation is available. No fixed response time is promised.

## Supported versions

| Version | Security fixes |
|---|---|
| 1.x | Yes: a fix ships in a new 1.x version of the whole cohort |
| 0.x (0.1.0) | Security fixes and fixes of defects that lose data or break security, for 12 months from the release of 1.0.0, as below; upgrade to 1.x as README "Upgrading from 0.1.0" describes |

When a new major version is released, the previous major version receives security fixes and fixes of defects that
lose data or break security for 12 months, never past the end of support of the Node version it targets, as README
"Versioning" says. A fix is never published again under an existing version: it takes the next version, and an
affected version is deprecated on npm with a message.

## Security model

The Security BFF, presentation server, realtime admission, and generated validators are defense layers;
they do not replace deployment-specific threat modeling. Consumers remain responsible for identity-
provider policy, backend authorization, TLS, secret and key custody, Redis hardening, gateway policy,
dependency maintenance, monitoring, incident response, and data-protection obligations.

Local and CI gates are development evidence only. A passing source suite does not establish production
readiness, deployment approval, or the security of a particular consumer.
