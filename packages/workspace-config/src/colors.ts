/**
 * Raw colour detection shared by the TypeScript and CSS forms of the colour rule.
 * A raw colour is a literal value (hex, a colour function or a named colour) instead of a design token.
 */

/** The named colours of CSS Color Module Level 4. `transparent`, `currentcolor` and system colours are not raw. */
export const namedColors: ReadonlySet<string> = new Set([
  'aliceblue', 'antiquewhite', 'aqua', 'aquamarine', 'azure', 'beige', 'bisque', 'black', 'blanchedalmond', 'blue',
  'blueviolet', 'brown', 'burlywood', 'cadetblue', 'chartreuse', 'chocolate', 'coral', 'cornflowerblue', 'cornsilk',
  'crimson', 'cyan', 'darkblue', 'darkcyan', 'darkgoldenrod', 'darkgray', 'darkgreen', 'darkgrey', 'darkkhaki',
  'darkmagenta', 'darkolivegreen', 'darkorange', 'darkorchid', 'darkred', 'darksalmon', 'darkseagreen',
  'darkslateblue', 'darkslategray', 'darkslategrey', 'darkturquoise', 'darkviolet', 'deeppink', 'deepskyblue',
  'dimgray', 'dimgrey', 'dodgerblue', 'firebrick', 'floralwhite', 'forestgreen', 'fuchsia', 'gainsboro',
  'ghostwhite', 'gold', 'goldenrod', 'gray', 'green', 'greenyellow', 'grey', 'honeydew', 'hotpink', 'indianred',
  'indigo', 'ivory', 'khaki', 'lavender', 'lavenderblush', 'lawngreen', 'lemonchiffon', 'lightblue', 'lightcoral',
  'lightcyan', 'lightgoldenrodyellow', 'lightgray', 'lightgreen', 'lightgrey', 'lightpink', 'lightsalmon',
  'lightseagreen', 'lightskyblue', 'lightslategray', 'lightslategrey', 'lightsteelblue', 'lightyellow', 'lime',
  'limegreen', 'linen', 'magenta', 'maroon', 'mediumaquamarine', 'mediumblue', 'mediumorchid', 'mediumpurple',
  'mediumseagreen', 'mediumslateblue', 'mediumspringgreen', 'mediumturquoise', 'mediumvioletred', 'midnightblue',
  'mintcream', 'mistyrose', 'moccasin', 'navajowhite', 'navy', 'oldlace', 'olive', 'olivedrab', 'orange',
  'orangered', 'orchid', 'palegoldenrod', 'palegreen', 'paleturquoise', 'palevioletred', 'papayawhip', 'peachpuff',
  'peru', 'pink', 'plum', 'powderblue', 'purple', 'rebeccapurple', 'red', 'rosybrown', 'royalblue', 'saddlebrown',
  'salmon', 'sandybrown', 'seagreen', 'seashell', 'sienna', 'silver', 'skyblue', 'slateblue', 'slategray',
  'slategrey', 'snow', 'springgreen', 'steelblue', 'tan', 'teal', 'thistle', 'tomato', 'turquoise', 'violet',
  'wheat', 'white', 'whitesmoke', 'yellow', 'yellowgreen',
]);

/** Colour functions whose arguments are literal channel values. `var()` and `color-mix()` of tokens stay allowed. */
export const colorFunctions: ReadonlySet<string> = new Set([
  'rgb', 'rgba', 'hsl', 'hsla', 'hwb', 'lab', 'lch', 'oklab', 'oklch', 'color',
]);

const hexPattern = /(?:^|[^\w&/-])(#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4}))(?![\w-])/gi;
const functionPattern = /(?:^|[^\w-])((?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\()/gi;
const wordPattern = /[a-z]+/gi;

/** Tailwind's default palette names; a utility such as `bg-red-500` bypasses the design tokens. */
const palette = [
  'slate', 'gray', 'zinc', 'neutral', 'stone', 'red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal',
  'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose', 'mauve', 'olive', 'mist', 'taupe',
];
const colorUtilities = [
  'bg', 'text', 'border', 'border-[xytrblse]', 'ring', 'ring-offset', 'outline', 'fill', 'stroke', 'from', 'via', 'to',
  'decoration', 'accent', 'caret', 'shadow', 'inset-shadow', 'inset-ring', 'divide', 'placeholder', 'drop-shadow',
  'text-shadow',
].join('|');
const paletteUtility = new RegExp(
  `(?:^|[\\s"'\`:!])((?:${colorUtilities})-(?:(?:${palette.join('|')})-(?:50|[1-9]00|950)|black|white)(?:/\\d+)?)(?![\\w-])`,
  'g',
);
const arbitraryValue = /(?:^|[\s"'`:!])([a-z][a-z-]*-\[([^\]\s]+)\])/g;

export type ColorFinding = Readonly<{value: string; index: number}>;

function push(findings: ColorFinding[], value: string, index: number) {
  findings.push({value, index});
}

/** Hex values and colour functions anywhere in a text. */
export function literalColors(text: string): ColorFinding[] {
  const findings: ColorFinding[] = [];
  for (const match of text.matchAll(hexPattern)) push(findings, match[1]!, match.index + match[0].indexOf(match[1]!));
  for (const match of text.matchAll(functionPattern)) {
    const name = match[1]!.slice(0, -1).toLowerCase();
    if (colorFunctions.has(name)) push(findings, match[1]!, match.index + match[0].indexOf(match[1]!));
  }
  return findings;
}

/** Named colours used as whole words of a CSS value. */
export function namedColorWords(value: string): ColorFinding[] {
  const findings: ColorFinding[] = [];
  for (const match of value.matchAll(wordPattern)) {
    const before = value[match.index - 1] ?? ' ',after = value[match.index + match[0].length] ?? ' ';
    // A word inside an identifier, a custom property, a path or a file name is not a colour value.
    if (/[\w\-./$]/.test(before) || /[\w\-./(]/.test(after)) continue;
    if (namedColors.has(match[0].toLowerCase())) push(findings, match[0], match.index);
  }
  return findings;
}

/** Tailwind palette utilities and arbitrary colour values such as `bg-[#123456]` in a class string. */
export function utilityColors(text: string): ColorFinding[] {
  const findings: ColorFinding[] = [];
  for (const match of text.matchAll(paletteUtility)) push(findings, match[1]!, match.index + match[0].indexOf(match[1]!));
  for (const match of text.matchAll(arbitraryValue)) {
    const inner = match[2]!.replace(/^color:/i, '');
    const raw = inner.startsWith('#') || /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i.test(inner) ||
      namedColors.has(inner.toLowerCase());
    if (raw) push(findings, match[1]!, match.index + match[0].indexOf(match[1]!));
  }
  return findings;
}

/** CSS properties whose values hold colours; used to find named colours in TS style objects and CSS-in-strings. */
export const colorProperties: ReadonlySet<string> = new Set([
  'color', 'background', 'background-color', 'border', 'border-color', 'border-top', 'border-right',
  'border-bottom', 'border-left', 'border-block', 'border-inline', 'border-top-color', 'border-right-color',
  'border-bottom-color', 'border-left-color', 'border-block-color', 'border-inline-color',
  'border-block-start-color', 'border-block-end-color', 'border-inline-start-color', 'border-inline-end-color',
  'outline', 'outline-color', 'fill', 'stroke', 'stop-color', 'flood-color', 'lighting-color', 'caret-color',
  'accent-color', 'text-decoration', 'text-decoration-color', 'column-rule', 'column-rule-color', 'box-shadow',
  'text-shadow', 'scrollbar-color',
]);

/** `backgroundColor` -> `background-color`. */
export function kebab(name: string): string {
  return name.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase());
}

/** Declarations written inside a string, for example `"color: red"` in a style string. */
export function declarationColors(text: string): ColorFinding[] {
  const findings: ColorFinding[] = [];
  for (const match of text.matchAll(/(?:^|[;{\s])([a-z-]+)\s*:\s*([^;}]*)/gi)) {
    if (!colorProperties.has(match[1]!.toLowerCase())) continue;
    const start = match.index + match[0].length - match[2]!.length;
    for (const finding of namedColorWords(match[2]!)) push(findings, finding.value, start + finding.index);
  }
  return findings;
}
