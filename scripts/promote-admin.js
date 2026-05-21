#!/usr/bin/env node
/**
 * Promote or demote a user's admin role.
 *
 * Usage:
 *   node scripts/promote-admin.js admin@example.com        # promote to admin
 *   node scripts/promote-admin.js admin@example.com --user   # demote to user
 *
 * Requires DATA_DIR (or GOLDILOCKS_STATE_DIR) and ENCRYPTION_KEY env vars to
 * load the database config. JWT_SECRET and AGENT_SERVICE_SHARED_SECRET are
 * also required by config validation but not used by this script.
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import Database from 'better-sqlite3';

config();

// Load the same config resolution as the app (needed for db path)
const dataDir = process.env.DATA_DIR ?? (process.env.GOLDILOCKS_STATE_DIR ? resolve(process.env.GOLDILOCKS_STATE_DIR) : resolve(process.cwd(), '.dev'));

// Ensure required secrets exist so config doesn't throw
for (const key of ['JWT_SECRET', 'ENCRYPTION_KEY', 'AGENT_SERVICE_SHARED_SECRET']) {
  if (!process.env[key]) {
    process.env[key] = 'placeholder-for-promote-script';
  }
}

const dbPath = resolve(dataDir, 'goldilocks.db');

const email = process.argv[2];
const targetRole = process.argv.includes('--user') ? 'user' : 'admin';

if (!email) {
  console.error('Usage: node scripts/promote-admin.js <email> [--user]');
  console.error('  Promotes to admin by default. Use --user to demote back to regular user.');
  process.exit(1);
}

try {
  const db = new Database(dbPath);

  const user = db.prepare('SELECT id, email, role FROM users WHERE email = ?').get(email) as
    | { id: string; email: string; role: string }
    | undefined;

  if (!user) {
    console.error(`No user found with email: ${email}`);
    process.exit(1);
  }

  if (user.role === targetRole) {
    console.log(`User ${email} is already '${targetRole}'. No change needed.`);
    process.exit(0);
  }

  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(targetRole, user.id);
  console.log(`User ${email} role changed: '${user.role}' → '${targetRole}'`);
  console.log('Note: The user must log in again to get a JWT with the updated role.');

  db.close();
} catch (err) {
  console.error('Failed to update role:', err);
  process.exit(1);
}