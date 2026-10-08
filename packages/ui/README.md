# @mpfrontend/ui

Local development package. Runtime: client. Public API is exported from src/index.ts and compiled
into dist. Nx owns build, typecheck, lint and test targets. Consumer applications install packed artifacts.
See ../../docs/IMPLEMENTATION-STATUS.md for observed evidence and remaining work.

Import `@mpfrontend/ui/tailwind.css` from the consumer's Tailwind v4 entry so its compiler scans the
published JavaScript for structural utility classes. Import `@mpfrontend/ui/styles.css` for semantic
token-driven state and color rules. Product values, icons, typography and DLS composition remain in the
consumer adapter/theme. The application frame (skip link, header, navigation, page frame) is the separate
package `@mpfrontend/app-layout`.
