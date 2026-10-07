# @mpfrontend/ftg-core

Local development package. Runtime: universal. Public API is exported from src/index.ts and compiled
into dist. Nx owns build, typecheck, lint and test targets. Consumer applications install packed artifacts.
See ../../docs/IMPLEMENTATION-STATUS.md for observed evidence and remaining work.

Request selections are explicit: the default is a required finite closed JSON object. The opt-in
`body: "none"` profile only accepts operations with no own OpenAPI requestBody property; it produces
no schema or fields and means the consumer will send no payload. The distinct opt-in
`body: "optional-json"` profile requires a present, non-required JSON request body and produces a
schema value plus `undefined`; it supports a finite closed object or an exact null/object union.
Optional JSON, nullable JSON and an operation with no request body remain different contracts. Read
contracts still require an explicit JSON success schema.
See [request profiles](../../docs/R4-GENERATED-REQUESTS.md).
