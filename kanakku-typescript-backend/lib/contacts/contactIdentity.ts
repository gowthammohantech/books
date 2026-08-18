export interface ContactIdentity {
  firstName?: string | null;
  lastName?: string | null;
  organisation?: string | null;
}

const has = (v?: string | null): boolean => !!v && v.trim().length > 0;

export function resolveDisplayName(c: ContactIdentity): string {
  if (has(c.organisation)) return c.organisation!.trim();
  const person = [c.firstName, c.lastName].filter(has).map((s) => s!.trim()).join(' ');
  return person;
}

export function validateContactIdentity(c: ContactIdentity): { ok: true } | { ok: false; error: string } {
  if (has(c.organisation) || (has(c.firstName) && has(c.lastName))) return { ok: true };
  return { ok: false, error: 'A contact needs an organisation, or both a first and last name.' };
}
