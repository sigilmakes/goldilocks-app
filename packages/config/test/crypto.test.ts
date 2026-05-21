import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';

const originalEnv = { ...process.env };

// Set up env for config to load
beforeEach(() => {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test-jwt-not-for-prod';
  process.env.ENCRYPTION_KEY = 'test-encryption-key-32bytes!!';
  process.env.AGENT_SERVICE_SHARED_SECRET = 'test-agent-shared-secret';
});

afterEach(() => {
  process.env = { ...originalEnv };
  delete process.env.ENCRYPTION_KEY_V1;
});

describe('P8: Crypto key derivation', () => {
  it('deriveUserKey produces different keys for different salts', async () => {
    const { deriveUserKey, generateKeySalt } = await import('../src/crypto.js');
    const salt1 = generateKeySalt();
    const salt2 = generateKeySalt();
    const key1 = deriveUserKey(salt1);
    const key2 = deriveUserKey(salt2);
    expect(key1.equals(key2)).toBe(false);
  });

  it('deriveUserKey produces the same key for the same salt', async () => {
    const { deriveUserKey, generateKeySalt } = await import('../src/crypto.js');
    const salt = generateKeySalt();
    const key1 = deriveUserKey(salt);
    const key2 = deriveUserKey(salt);
    expect(key1.equals(key2)).toBe(true);
  });

  it('generateKeySalt returns 32-byte hex strings', async () => {
    const { generateKeySalt } = await import('../src/crypto.js');
    const salt = generateKeySalt();
    expect(salt).toMatch(/^[0-9a-f]{64}$/);
    expect(Buffer.from(salt, 'hex').length).toBe(32);
  });

  it('encrypt returns V2 encrypted value with keyVersion 2', async () => {
    const { encrypt, generateKeySalt } = await import('../src/crypto.js');
    const salt = generateKeySalt();
    const result = encrypt('secret-api-key', salt);
    expect(result.keyVersion).toBe(2);
    expect(result.encrypted).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
  });

  it('decrypt can roundtrip V2 encrypted values', async () => {
    const { encrypt, decrypt, generateKeySalt } = await import('../src/crypto.js');
    const salt = generateKeySalt();
    const plaintext = 'sk-test-roundtrip-key-12345';
    const { encrypted } = encrypt(plaintext, salt);
    const { plaintext: decrypted } = decrypt(encrypted, { keyVersion: 2, keySalt: salt });
    expect(decrypted).toBe(plaintext);
  });

  it('decrypt rejects cross-salt decryption (user isolation)', async () => {
    const { encrypt, decrypt, generateKeySalt } = await import('../src/crypto.js');
    const salt1 = generateKeySalt();
    const salt2 = generateKeySalt();
    const { encrypted } = encrypt('secret', salt1);

    expect(() => decrypt(encrypted, { keyVersion: 2, keySalt: salt2 })).toThrow();
  });

  it('decrypt supports V1 fallback without ENCRYPTION_KEY_V1', async () => {
    const { decrypt } = await import('../src/crypto.js');
    // V1 encryption uses global SHA-256 of ENCRYPTION_KEY
    const masterKey = crypto.createHash('sha256').update(process.env.ENCRYPTION_KEY!).digest();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv, { authTagLength: 16 });
    let ct = cipher.update('v1-secret', 'utf8', 'hex');
    ct += cipher.final('hex');
    const tag = cipher.getAuthTag().toString('hex');
    const v1Encrypted = `${iv.toString('hex')}:${tag}:${ct}`;

    const { plaintext } = decrypt(v1Encrypted, { keyVersion: 1 });
    expect(plaintext).toBe('v1-secret');
  });

  it('decrypt eagerly re-encrypts V1 keys as V2 when keySalt is provided', async () => {
    const { decrypt, generateKeySalt } = await import('../src/crypto.js');
    // Create a V1 encrypted value
    const masterKey = crypto.createHash('sha256').update(process.env.ENCRYPTION_KEY!).digest();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv, { authTagLength: 16 });
    let ct = cipher.update('v1-to-v2-key', 'utf8', 'hex');
    ct += cipher.final('hex');
    const tag = cipher.getAuthTag().toString('hex');
    const v1Encrypted = `${iv.toString('hex')}:${tag}:${ct}`;

    const salt = generateKeySalt();
    const { plaintext, reEncrypt } = decrypt(v1Encrypted, { keyVersion: 1, keySalt: salt });

    expect(plaintext).toBe('v1-to-v2-key');
    expect(reEncrypt).toBeTruthy();
    expect(reEncrypt!.keyVersion).toBe(2);
    expect(reEncrypt!.encrypted).toBeTruthy();

    // Verify the re-encrypted value can be decrypted as V2
    const { plaintext: decrypted2 } = decrypt(reEncrypt!.encrypted, { keyVersion: 2, keySalt: salt });
    expect(decrypted2).toBe('v1-to-v2-key');
  });

  it('supports ENCRYPTION_KEY_V1 for key rotation fallback', async () => {
    const { decrypt, generateKeySalt } = await import('../src/crypto.js');
    // Encrypt with a different key (simulating the old master key)
    const oldKey = 'old-master-key-for-rotation-test!';
    process.env.ENCRYPTION_KEY_V1 = oldKey;
    const v1MasterKey = crypto.createHash('sha256').update(oldKey).digest();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', v1MasterKey, iv, { authTagLength: 16 });
    let ct = cipher.update('rotated-secret', 'utf8', 'hex');
    ct += cipher.final('hex');
    const tag = cipher.getAuthTag().toString('hex');
    const v1Encrypted = `${iv.toString('hex')}:${tag}:${ct}`;

    // Decrypt with V1 using ENCRYPTION_KEY_V1 as the fallback
    const { plaintext } = decrypt(v1Encrypted, { keyVersion: 1 });
    expect(plaintext).toBe('rotated-secret');
  });
});