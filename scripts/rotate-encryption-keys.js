#!/usr/bin/env node
/**
 * Eagerly rotate all API key encryption from V1 (global key) to V2 (per-user derived keys).
 *
 * This script is idempotent — keys already at V2 are skipped.
 *
 * Prerequisites:
 *   - ENCRYPTION_KEY set to the NEW (V2) master key
 *   - ENCRYPTION_KEY_V1 set to the OLD (V1) master key (if a rotation happened)
 *   - If no master key rotation happened, set ENCRYPTION_KEY_V1 = ENCRYPTION_KEY
 *   - DATA_DIR or GOLDILOCKS_STATE_DIR pointing to the data directory
 *   - JWT_SECRET and AGENT_SERVICE_SHARED_SECRET set (config validation)
 *
 * Usage:
 *   ENCRYPTION_KEY=new_key ENCRYPTION_KEY_V1=old_key node scripts/rotate-encryption-keys.js
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import crypto from 'crypto';
import Database from 'better-sqlite3';

config();

const dataDir = process.env.DATA_DIR ?? (process.env.GOLDILOCKS_STATE_DIR ? resolve(process.env.GOLDILOCKS_STATE_DIR) : resolve(process.cwd(), '.dev'));

// Ensure required secrets exist so config doesn't throw
for (const key of ['JWT_SECRET', 'AGENT_SERVICE_SHARED_SECRET']) {
  if (!process.env[key]) {
    process.env[key] = 'placeholder-for-rotation-script';
  }
}

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const HKDF_INFO = 'goldilocks-api-keys';
const HKDF_KEY_LENGTH = 32;

function getV1Key(): Buffer {
  const v1EnvKey = process.env.ENCRYPTION_KEY_V1;
  const masterKey = v1EnvKey || process.env.ENCRYPTION_KEY;
  if (!masterKey) {
    throw new Error('ENCRYPTION_KEY (and optionally ENCRYPTION_KEY_V1) must be set');
  }
  return crypto.createHash('sha256').update(masterKey).digest();
}

function getV2Key(): Buffer {
  if (!process.env.ENCRYPTION_KEY) {
    throw new Error('ENCRYPTION_KEY must be set');
  }
  return crypto.createHash('sha256').update(process.env.ENCRYPTION_KEY).digest();
}

function deriveV2UserKey(keySalt: string): Buffer {
  const v2MasterKey = getV2Key();
  return crypto.hkdfSync('sha256', v2MasterKey, Buffer.from(keySalt, 'hex'), HKDF_INFO, HKDF_KEY_LENGTH);
}

function decryptV1(encrypted: string): string {
  const parts = encrypted.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted format');

  const [ivHex, authTagHex, ciphertext] = parts;
  const key = getV1Key();
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);

  let plaintext = decipher.update(ciphertext, 'hex', 'utf8');
  plaintext += decipher.final('utf8');
  return plaintext;
}

function encryptV2(plaintext: string, keySalt: string): string {
  const key = deriveV2UserKey(keySalt);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
  ciphertext += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return `${iv.toString('hex')}:${authTag}:${ciphertext}`;
}

function generateKeySalt(): string {
  return crypto.randomBytes(32).toString('hex');
}

// Main
try {
  if (!process.env.ENCRYPTION_KEY) {
    console.error('ERROR: ENCRYPTION_KEY must be set (the current/new master key)');
    process.exit(1);
  }

  const dbPath = resolve(dataDir, 'goldilocks.db');
  const db = new Database(dbPath);

  // Find all V1 keys
  const v1Keys = db.prepare(
    `SELECT ak.user_id, ak.provider, ak.encrypted_key, u.key_salt
     FROM api_keys ak
     JOIN users u ON ak.user_id = u.id
     WHERE ak.key_version = 1`
  ).all() as { user_id: string; provider: string; encrypted_key: string; key_salt: string | null }[];

  if (v1Keys.length === 0) {
    console.log('No V1 keys found. All keys are already at V2 or the table is empty.');
    db.close();
    process.exit(0);
  }

  console.log(`Found ${v1Keys.length} V1 key(s) to rotate.`);

  let rotated = 0;
  let failed = 0;
  const ensureSalt = db.prepare('UPDATE users SET key_salt = ? WHERE id = ? AND key_salt IS NULL');
  const rotateKey = db.prepare(
    'UPDATE api_keys SET encrypted_key = ?, key_version = 2 WHERE user_id = ? AND provider = ?'
  );

  const tx = db.transaction(() => {
    for (const row of v1Keys) {
      try {
        // Ensure user has a key_salt
        let keySalt = row.key_salt;
        if (!keySalt) {
          keySalt = generateKeySalt();
          ensureSalt.run(keySalt, row.user_id);
        }

        const plaintext = decryptV1(row.encrypted_key);
        const newEncrypted = encryptV2(plaintext, keySalt);
        rotateKey.run(newEncrypted, row.user_id, row.provider);
        rotated++;
        console.log(`  ✓ Rotated ${row.provider} for user ${row.user_id.slice(0, 8)}...`);
      } catch (err) {
        failed++;
        console.error(`  ✗ Failed to rotate ${row.provider} for user ${row.user_id.slice(0, 8)}...:`, err);
      }
    }
  });

  tx();

  console.log(`\nRotation complete: ${rotated} rotated, ${failed} failed.`);

  if (failed > 0) {
    console.error('\nWARNING: Some keys failed to rotate. Ensure ENCRYPTION_KEY_V1 is set correctly.');
  }

  // Verify no V1 keys remain
  const remaining = db.prepare('SELECT COUNT(*) as count FROM api_keys WHERE key_version = 1').get() as { count: number };
  if (remaining.count > 0) {
    console.error(`\nWARNING: ${remaining.count} V1 key(s) still remain in the database.`);
  } else {
    console.log('All keys are now at V2. You may remove ENCRYPTION_KEY_V1 from the environment.');
  }

  db.close();
} catch (err) {
  console.error('Rotation failed:', err);
  process.exit(1);
}