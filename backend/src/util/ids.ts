import { createHash, createHmac, randomUUID } from 'node:crypto';

export function newId(): string {
  return randomUUID();
}

export function sha256(input: Buffer | string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Stable, non-reversible key for a person's name, computed under the user's own
 * DEK. Lets the pipeline recognise that "Ankit" today is the same person as
 * "Ankit" last week without ever storing the name in a queryable plaintext
 * field. Two users who both know an Ankit produce different keys.
 */
export function nameKey(dek: Buffer, name: string): string {
  return createHmac('sha256', dek).update(normalizeName(name)).digest('hex');
}

export function normalizeName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function topicKey(topic: string): string {
  return normalizeName(topic).replace(/\s+/g, '-').slice(0, 60);
}

/** Fingerprint of a request body, used to detect Idempotency-Key reuse. */
export function fingerprint(value: unknown): string {
  return sha256(typeof value === 'string' ? value : JSON.stringify(value ?? null));
}

/** Local calendar day for a timestamp in an IANA zone, as YYYY-MM-DD. */
export function localDay(iso: string, timezone: string): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(new Date(iso));
  } catch {
    return new Date(iso).toISOString().slice(0, 10);
  }
}
