# @mpfrontend/app-layout

Local development package. Runtime: universal (server-safe React components). Public API is exported from
src/index.tsx and compiled into dist. Nx owns build, typecheck, lint and test targets. Consumer applications
install packed artifacts. See ../../docs/IMPLEMENTATION-STATUS.md for observed evidence and remaining work.

The shared application frame: `AppFrame` (a skip link and the focusable `main` landmark), `AppHeader` (a
brand, a navigation slot and an actions slot), `Navigation` (a labelled list of links) and `PageFrame` (a
section labelled by its title, with an actions slot). The components hold no client state, use logical
properties only, and render the same markup in both directions. They decide nothing about access: an app
passes exactly the navigation items that it may show, and every visible text is a prop.

Import `@mpfrontend/app-layout/tailwind.css` from the app's Tailwind v4 entry so that the compiler scans the
published JavaScript for the structural utility classes, and `@mpfrontend/app-layout/styles.css` for the
neutral layout tokens (`--mp-shell-content-max`, `--mp-shell-gutter`) and the semantic colours of the
header, the links and the skip link. An app theme overrides the variables.
