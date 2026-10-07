export type Mode = 'light' | 'dark' | 'system';

/** The consumer owns its brand registry; core ships no product brand IDs. */
export function validBrand<const T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  if (!allowed.includes(fallback)) throw new Error('INVALID_BRAND_FALLBACK');
  return typeof value === 'string' && allowed.includes(value as T) ? value as T : fallback;
}
export function validMode(value: unknown): Mode {
  return value === 'light' || value === 'dark' ? value : 'system';
}
export function appearance(mode: Mode, systemDark: boolean): 'light' | 'dark' {
  return mode === 'system' ? (systemDark ? 'dark' : 'light') : mode;
}
