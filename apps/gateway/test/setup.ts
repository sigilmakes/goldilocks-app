/**
 * Global test setup — creates an isolated data directory and sets env vars
 * before any test file runs.
 *
 * Each test file creates its own server instance (with its own SQLite DB)
 * via createTestServer(), so this setup only handles the shared config.
 */

import { mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

const testId = randomUUID().slice(0, 8);
const testDataDir = `${tmpdir()}/goldilocks-test-${testId}`;
const workspaceRoot = `${testDataDir}/workspaces`;

// Ensure directories exist
mkdirSync(workspaceRoot, { recursive: true });

// Set env vars before any module loads (CONFIG reads these at access time)
process.env.DATA_DIR = testDataDir;
process.env.WORKSPACE_ROOT = workspaceRoot;
process.env.JWT_SECRET = 'test-jwt-not-for-prod';
process.env.ENCRYPTION_KEY = 'test-encryption-key-32bytes!!';
process.env.AGENT_SERVICE_SHARED_SECRET = 'test-agent-shared-secret';
process.env.NODE_ENV = 'test';
process.env.FRONTEND_URL = 'http://localhost:5173';

afterAll(() => {
  try {
    rmSync(testDataDir, { recursive: true, force: true });
  } catch {
    // ignore — individual test servers clean their own dirs
  }
});