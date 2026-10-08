/**
 * The preference cookie: one readable cookie that carries a person's language and theme, shared between an
 * app and the identity provider's pages. Its value is `lang=<locale>&theme=<theme>`; each value must be in
 * the configured allowlist, and anything else is ignored, never echoed. It never carries identity or
 * authority: a server reads it only to choose a presentation.
 */
export type PreferenceCookieContract = Readonly<{ name: string; locales: readonly string[]; themes: readonly string[] }>;
export type Preference = Readonly<{ lang?: string; theme?: string }>;
export type PreferenceCookie = Readonly<{
  name: string;
  /** The allowlisted preferences of a raw cookie value; an invalid part is dropped. */
  parse: (value: string | null | undefined) => Preference;
  /** The allowlisted preferences of a Cookie request header. */
  read: (header: string | null | undefined) => Preference;
  /** The cookie value for allowlisted preferences; a value outside the allowlist is refused. */
  value: (preference: Preference) => string;
}>;

const cookieName = /^(?:__Secure-)?[A-Za-z0-9!#$%&'*+.^_`|~-]{1,64}$/;
const token = /^[A-Za-z0-9-]{1,32}$/;
const MAX_VALUE = 256;

export function createPreferenceCookie(contract: PreferenceCookieContract): PreferenceCookie {
  if (!cookieName.test(contract.name) || contract.name.startsWith('__Host-')) throw new Error('INVALID_PREFERENCE_COOKIE_NAME');
  for (const value of [...contract.locales, ...contract.themes]) if (!token.test(value)) throw new Error('INVALID_PREFERENCE_VALUE');
  const allowed: Readonly<Record<'lang' | 'theme', readonly string[]>> = { lang: contract.locales, theme: contract.themes };
  const parse = (value: string | null | undefined): Preference => {
    if (typeof value !== 'string' || value.length > MAX_VALUE) return {};
    const found: { lang?: string; theme?: string } = {};
    for (const part of value.split('&')) {
      const separator = part.indexOf('=');
      if (separator < 0) continue;
      const key = part.slice(0, separator), entry = part.slice(separator + 1);
      if ((key === 'lang' || key === 'theme') && found[key] === undefined && allowed[key].includes(entry)) found[key] = entry;
    }
    return found;
  };
  return Object.freeze({
    name: contract.name,
    parse,
    read: (header: string | null | undefined) => {
      if (typeof header !== 'string') return {};
      const pair = header.split(';').map(part => part.trim()).find(part => part.startsWith(contract.name + '='));
      return pair ? parse(pair.slice(contract.name.length + 1)) : {};
    },
    value: (preference: Preference) => {
      const parts: string[] = [];
      for (const key of ['lang', 'theme'] as const) {
        const entry = preference[key];
        if (entry === undefined) continue;
        if (!allowed[key].includes(entry)) throw new Error('INVALID_PREFERENCE_VALUE');
        parts.push(key + '=' + entry);
      }
      return parts.join('&');
    },
  });
}
