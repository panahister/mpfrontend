# @mpfrontend/ui

Local development package. Runtime: client. Public API is exported from src/index.ts and compiled
into dist. Nx owns build, typecheck, lint and test targets. Consumer applications install packed artifacts.
See ../../docs/IMPLEMENTATION-STATUS.md for observed evidence and remaining work.

Import `@mpfrontend/ui/tailwind.css` from the consumer's Tailwind v4 entry so its compiler scans the
published JavaScript for structural utility classes. Import `@mpfrontend/ui/styles.css` for semantic
token-driven state and color rules. Product values, icons, typography and DLS composition remain in the
consumer adapter/theme. The application frame (skip link, header, navigation, page frame) is the separate
package `@mpfrontend/app-layout`.

## Dialog and one-time code

`Dialog` is a modal dialog on the native `dialog` element: `aria-modal`, labelled by its `title` and described
by its `description`, Escape and the browser's cancel call `onClose`, a focus guard keeps Tab and Shift+Tab
inside it, and focus returns to the element that opened it. Every text is a prop (`closeLabel` names the
close button), and it uses logical properties only.

`OneTimeCodeField` accepts digits only, up to a configured `length` (4 to 10, 6 by default), with
`autocomplete="one-time-code"` and a numeric keyboard; a pasted code keeps its digits and drops spaces,
dashes and other characters, and a decimal digit of any script becomes its ASCII digit (`codeDigits`). It
has an error state and never logs or stores the value.

`ConfirmWithCode` confirms a sensitive action in a `Dialog`: `onConfirm(code, signal)` sends the code to
the server through the BFF (a same-origin request with the CSRF token and an idempotency key), the browser
never checks the code, and the code is cleared on close and on failure and never written to browser
storage, a URL or a log. DOM behaviour (keyboard, focus, names, clearing) is tested with happy-dom 20.14.5,
a test-only dependency chosen because the tests need focus and keyboard events without a browser.

## Tree

`Tree` is a controlled tree view on the WAI-ARIA tree pattern; with `columns` it is a tree table
(`treegrid`). The consumer owns `expanded` (`onExpandedChange`) and the per-node `states`, a set it defines,
with `stateLabels` for their visible text. Arrows move, open and close (the horizontal arrows swap in a
right-to-left context), Home and End jump, and Enter and Space call `onActivate`, where the consumer's own
rule decides what changes; `descendantIds(node)` helps a rule over the current children. The component has
no access decision and no inheritance between states, and never changes the nodes it receives. Rows are
virtualized at a fixed `rowHeight` inside a `height` viewport: ten thousand nodes render only the rows in
view, and the focused row stays rendered. Each item carries `aria-level`, `aria-setsize`, `aria-posinset`
and `aria-expanded`, and its accessible name includes its state label.

