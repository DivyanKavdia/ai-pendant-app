/**
 * Per-user key lifecycle.
 *
 * Each Synap user owns one data encryption key (DEK). The DEK is generated on
 * the server, immediately wrapped by a Cloud KMS customer-managed key (the
 * KEK), and only the wrapped form is persisted on the user document. Plaintext
 * DEKs exist solely in process memory, for at most `dekCacheTtlMs`.
 *
 * What this buys, concretely:
 *
 *  - Google Cloud storage-level compromise (a leaked Firestore export, a
 *    mis-scoped bucket read) yields ciphertext plus a wrapped key that cannot
 *    be unwrapped without KMS permission on the KEK.
 *  - Revoking a user is a single KMS-level action plus dropping the wrapped
 *    DEK: every derived record becomes permanently unreadable, including
 *    anything already replicated into backups.
 *  - Key rotation is a KEK rotation. Because the KEK only ever wraps 32-byte
 *    DEKs, rewrapping is cheap and never touches user payloads.
 *
 * What it does not buy: this is not end-to-end encryption. The backend
 * necessarily sees plaintext while Gemini transcribes and extracts memory.
 * That tradeoff is what makes server-side retrieval, the daily brief and Ask
 * Synap possible at all. See docs/ENCRYPTION.md.
 */

import { KeyManagementServiceClient } from '@google-cloud/kms';
import { config } from '../config.js';
import { DEK_BYTES, generateDek, wipe } from './envelope.js';

export interface WrappedKey {
  /** Base64 KMS ciphertext of the raw DEK. */
  wrappedDek: string;
  /** KMS key version that performed the wrap, for rotation bookkeeping. */
  keyVersion: string;
  createdAt: string;
}

interface CacheEntry {
  dek: Buffer;
  expiresAt: number;
}

let kmsClient: KeyManagementServiceClient | null = null;

function client(): KeyManagementServiceClient {
  kmsClient ??= new KeyManagementServiceClient();
  return kmsClient;
}

export function kekName(): string {
  return client().cryptoKeyPath(
    config.projectId,
    config.kms.location,
    config.kms.keyRing,
    config.kms.keyId,
  );
}

/**
 * The KEK is asked to protect a 32-byte secret, so we hand KMS the DEK as
 * additional authenticated data context too: a wrapped DEK lifted from user A's
 * document cannot be unwrapped in user B's context.
 */
function aad(uid: string): Buffer {
  return Buffer.from(`synap:dek:v1:${uid}`, 'utf8');
}

export class Keyring {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  /** Create a fresh wrapped DEK for a new user. */
  async create(uid: string): Promise<{ wrapped: WrappedKey; dek: Buffer }> {
    const dek = generateDek();
    const [response] = await client().encrypt({
      name: kekName(),
      plaintext: dek,
      additionalAuthenticatedData: aad(uid),
    });
    if (!response.ciphertext) throw new Error('Cloud KMS returned no ciphertext when wrapping DEK');

    const wrapped: WrappedKey = {
      wrappedDek: Buffer.from(response.ciphertext).toString('base64'),
      keyVersion: response.name ?? kekName(),
      createdAt: new Date(this.now()).toISOString(),
    };
    this.remember(uid, dek);
    return { wrapped, dek };
  }

  /** Unwrap a stored DEK, using the in-process cache when it is still warm. */
  async unwrap(uid: string, wrapped: WrappedKey): Promise<Buffer> {
    const hit = this.cache.get(uid);
    if (hit && hit.expiresAt > this.now()) return hit.dek;

    const [response] = await client().decrypt({
      name: kekName(),
      ciphertext: Buffer.from(wrapped.wrappedDek, 'base64'),
      additionalAuthenticatedData: aad(uid),
    });
    const plaintext = response.plaintext;
    if (!plaintext) throw new Error('Cloud KMS returned no plaintext when unwrapping DEK');

    const dek = Buffer.from(plaintext);
    if (dek.length !== DEK_BYTES) {
      wipe(dek);
      throw new Error('Unwrapped DEK has an unexpected length');
    }
    this.remember(uid, dek);
    return dek;
  }

  /**
   * Rewrap an existing DEK under the KEK's current primary version. Used by the
   * rotation job; user payloads are untouched.
   */
  async rewrap(uid: string, wrapped: WrappedKey): Promise<WrappedKey> {
    const dek = await this.unwrap(uid, wrapped);
    const [response] = await client().encrypt({
      name: kekName(),
      plaintext: dek,
      additionalAuthenticatedData: aad(uid),
    });
    if (!response.ciphertext) throw new Error('Cloud KMS returned no ciphertext when rewrapping DEK');
    return {
      wrappedDek: Buffer.from(response.ciphertext).toString('base64'),
      keyVersion: response.name ?? kekName(),
      createdAt: new Date(this.now()).toISOString(),
    };
  }

  /** Drop a user's key from memory — called on sign-out and account deletion. */
  forget(uid: string): void {
    const entry = this.cache.get(uid);
    if (entry) {
      wipe(entry.dek);
      this.cache.delete(uid);
    }
  }

  /** Drop everything. Registered on SIGTERM so a draining revision leaks nothing. */
  forgetAll(): void {
    for (const uid of [...this.cache.keys()]) this.forget(uid);
  }

  private remember(uid: string, dek: Buffer): void {
    this.sweep();
    const existing = this.cache.get(uid);
    if (existing && existing.dek !== dek) wipe(existing.dek);
    this.cache.set(uid, { dek, expiresAt: this.now() + config.kms.dekCacheTtlMs });
  }

  private sweep(): void {
    const now = this.now();
    for (const [uid, entry] of this.cache) {
      if (entry.expiresAt <= now) {
        wipe(entry.dek);
        this.cache.delete(uid);
      }
    }
  }
}

export const keyring = new Keyring();
