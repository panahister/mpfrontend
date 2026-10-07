export {AuthorityFence} from './authority-fence.js';
export type FieldAccess = Readonly<{ view: boolean; edit: boolean }>;
export type PageAccess = Readonly<{
  contextRef: string; revision: string; expiresAt: number;
  capabilities: Readonly<Record<string, boolean>>;
  fields: Readonly<Record<string, FieldAccess>>;
}>;
export const DENIED: FieldAccess = Object.freeze({ view: false, edit: false });
export function fieldAccess(access: PageAccess | undefined, key: string, now = Date.now()): FieldAccess {
  if (!access || access.expiresAt <= now) return DENIED;
  const field = access.fields[key];
  return field?.view ? { view: true, edit: field.edit === true } : DENIED;
}
export function can(access: PageAccess | undefined, capability: string, now = Date.now()): boolean {
  return !!access && access.expiresAt > now && access.capabilities[capability] === true;
}
export function projectFields(data: Readonly<Record<string, unknown>>, access: PageAccess, now = Date.now()): Record<string, unknown> {
  return Object.fromEntries(Object.entries(data).filter(([key]) => fieldAccess(access, key, now).view));
}
export function dirtyPatch(original: Readonly<Record<string, unknown>>, draft: Readonly<Record<string, unknown>>, access: PageAccess, now = Date.now()): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(draft)) {
    if (Object.is(original[key], value)) continue;
    if (!fieldAccess(access, key, now).edit) throw new Error('FORBIDDEN_FIELD');
    patch[key] = value;
  }
  return patch;
}
