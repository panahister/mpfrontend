# Security policy

## Reporting a vulnerability

Report suspected vulnerabilities privately through
[GitHub Security Advisories](https://github.com/panahister/mpfrontend/security/advisories/new). Do not
open a public issue, discussion, or pull request for an undisclosed vulnerability.

Include the affected package and version, prerequisites, impact, a minimal reproduction, and any known
mitigation. Remove credentials, access tokens, session cookies, private URLs, personal data, and private
design material from the report.

The maintainer will acknowledge a complete report, investigate it, and coordinate disclosure after a
fix or mitigation is available. No fixed response time is promised for this proof-of-concept project.

## Supported versions

MP Frontend is currently a prerelease source project. Only the latest commit on `main` is evaluated for
security fixes. No older prerelease line receives backports unless a release note says otherwise.

## Security model

The Security BFF, presentation server, realtime admission, and generated validators are defense layers;
they do not replace deployment-specific threat modeling. Consumers remain responsible for identity-
provider policy, backend authorization, TLS, secret and key custody, Redis hardening, gateway policy,
dependency maintenance, monitoring, incident response, and data-protection obligations.

Local and CI gates are development evidence only. A passing source suite does not establish production
readiness, deployment approval, or the security of a particular consumer.
