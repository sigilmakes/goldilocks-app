import crypto from 'crypto';
import { CONFIG } from './config.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const HKDF_INFO = 'goldilocks-api-keys';
const HKDF_KEY_LENGTH = 32;

/**
 * Derive the global V1 key from the config encryption key using SHA-256.
 * Used as fallback when decrypting keys encrypted before per-user derivation.
 */
function getV1Key(): Buffer {
  return crypto.createHash('sha256').update(CONFIG.encryptionKey).digest();
}

/**
 * Derive a per-user encryption subkey from the master key + user salt via HKDF.
 */
export function deriveUserKey(keySalt: string): Buffer {
  return Buffer.from(crypto.hkdfSync(
    'sha256',
    CONFIG.encryptionKey,
    Buffer.from(keySalt, 'hex'),
    HKDF_INFO,
    HKDF_KEY_LENGTH,
  ));
}

/**
 * Derive a per-user key from the V1 (legacy) master key + user salt.
 * Used when re-encrypting V1 keys that were originally encrypted with global key.
 */
function deriveV1UserKey(keySalt: string): Buffer {
  const v1MasterKey = getV1Key();
  return Buffer.from(crypto.hkdfSync(
    'sha256',
    v1MasterKey,
    Buffer.from(keySalt, 'hex'),
    HKDF_INFO,
    HKDF_KEY_LENGTH,
  ));
}

/**
 * Get the appropriate decryption key based on the key version.
 * - V1 (key_version = 1): Global SHA-256 derived key (legacy, no per-user isolation)
 * - V2 (key_version = 2): Per-user HKDF-derived key
 *
 * When an optional ENCRYPTION_KEY_V1 is set and key_version is 1, the V1 fallback
 * key is derived from ENCRYPTION_KEY_V1 instead of ENCRYPTION_KEY. This supports
 * rotation: the current ENCRYPTION_KEY is V2, ENCRYPTION_KEY_V1 is the previous key.
 */
function getDecryptKey(keyVersion: number, keySalt?: string): Buffer {
  if (keyVersion >= 2 && keySalt) {
    // V2 or later: per-user derived key
    return deriveUserKey(keySalt);
  }

  // V1: global key. If ENCRYPTION_KEY_V1 is set (rotation in progress),
  // derive from the previous master key. Otherwise derive from current.
  if (process.env.ENCRYPTION_KEY_V1) {
    return crypto.createHash('sha256').update(process.env.ENCRYPTION_KEY_V1).digest();
  }

  return getV1Key();
}

export interface EncryptedValue {
  encrypted: string;
  keyVersion: number;
}

/**
 * Encrypt a plaintext string using AES-256-GCM with a per-user derived key.
 * @returns iv:authTag:ciphertext (all hex encoded), always at key_version 2.
 */
export function encrypt(plaintext: string, keySalt: string): EncryptedValue {
  const key = deriveUserKey(keySalt);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
  ciphertext += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return {
    encrypted: `${iv.toString('hex')}:${authTag}:${ciphertext}`,
    keyVersion: 2,
  };
}

/**
 * Decrypt an encrypted string (iv:authTag:ciphertext, all hex encoded).
 * Supports both V1 (global key) and V2 (per-user derived key) decryption.
 *
 * If decrypting a V1 key and keySalt is provided, the key is automatically
 * re-encrypted with the per-user V2 key and the new EncryptedValue is returned
 * alongside the plaintext for eager rotation.
 */
export function decrypt(
  encrypted: string,
  options: { keyVersion: number; keySalt?: string },
): { plaintext: string; reEncrypt?: EncryptedValue } {
  const parts = encrypted.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted format: expected iv:authTag:ciphertext');
  }

  const [ivHex, authTagHex, ciphertext] = parts;
  const key = getDecryptKey(options.keyVersion, options.keySalt);
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(authTag);

  let plaintext = decipher.update(ciphertext, 'hex', 'utf8');
  plaintext += decipher.final('utf8');

  // Eager rotation: if we decrypted a V1 key and have a key_salt, re-encrypt as V2
  if (options.keyVersion < 2 && options.keySalt) {
    const reEncrypted = encrypt(plaintext, options.keySalt);
    return { plaintext, reEncrypt: reEncrypted };
  }

  return { plaintext };
}

/**
 * Generate a 32-byte random salt for a user's key derivation.
 * Returns a hex string suitable for storage in the key_salt column.
 */
export function generateKeySalt(): string {
  return crypto.randomBytes(32).toString('hex');
}