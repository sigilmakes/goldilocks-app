/**
 * Test server helper — spins up a real Express server with isolated config.
 *
 * Every test suite gets its own server instance with:
 *   - Fresh SQLite DB
 *   - Stubbed sessionManager (no k8s needed)
 *   - File operations use the local filesystem (no k8s exec)
 *   - Real Express, real routes, real DB writes
 *
 * Usage:
 *   const { baseUrl, stop, registerUser, authHeader } = await createTestServer();
 *   const res = await fetch(`${baseUrl}/api/auth/me`, { headers: authHeader(user) });
 *   await stop();
 */

import { createServer } from 'http';
import { AddressInfo } from 'net';
import { mkdirSync, rmSync, readFileSync, writeFileSync, readdirSync, statSync, renameSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';

export interface TestUser {
  token: string;
  userId: string;
  email: string;
}

export interface TestServer {
  baseUrl: string;
  workspaceRoot: string;
  stop: () => Promise<void>;
  registerUser: (overrides?: Partial<{ email: string; password: string; displayName: string }>) => Promise<TestUser>;
  authHeader: (user: TestUser) => string;
}

/** Derive the project root from this file's location (test/api/helpers/test-server.ts) */
function projectRoot(): string {
  return fileURLToPath(new URL('../../../', import.meta.url));
}

/**
 * Create a stream that emits `data` events with the given content (as Buffer),
 * then emits `end`. The route's `execCommand()` reads via:
 *   exec.stdout.on('data', chunk => chunks.push(chunk))
 *   exec.stdout.on('end', () => resolve(Buffer.concat(chunks).toString()))
 *
 * So we must emit actual Buffer data before 'end' for the route to see content.
 */
function makeStream(content: string | null): EventEmitter {
  const emitter = new EventEmitter();
  if (content !== null) {
    setImmediate(() => {
      emitter.emit('data', Buffer.from(content));
      emitter.emit('end');
    });
  } else {
    // null = error / missing — emit an error event so execInPod rejects
    setImmediate(() => {
      emitter.emit('error', new Error('No such file or directory'));
    });
  }
  return emitter;
}

/**
 * Recursively list files under a directory, returning paths relative to base.
 */
function listFiles(base: string, prefix: string = ''): string[] {
  const results: string[] = [];
  const dir = join(base, prefix);
  if (!existsSync(dir)) return results;

  for (const entry of readdirSync(dir)) {
    const rel = prefix ? `${prefix}/${entry}` : entry;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      results.push(rel + '/');
      results.push(...listFiles(base, rel));
    } else {
      results.push(rel);
    }
  }
  return results;
}

/**
 * Parse a shell command array and figure out what file operation it wants.
 * Returns a result object the stub can act on.
 */
function parseCommand(command: string[]): {
  op: 'cat' | 'echo' | 'rm' | 'mv' | 'mkdir' | 'find' | 'ls' | 'unknown';
  path?: string;
  path2?: string;
  content?: string;
} {
  const cmd = command.join(' ');

  // echo 'BASE64' | base64 -d > /home/node/PATH && echo OK
  const writeMatch = cmd.match(/echo ['"]([^'"]+)['"] \| base64 -d > \/home\/node\/(.+?)(?:[' ]|$)/);
  if (writeMatch) {
    return { op: 'echo', path: writeMatch[2], content: writeMatch[1] };
  }

  // cat /home/node/PATH
  const catMatch = cmd.match(/cat \/home\/node\/(.+?)(?:\s|$)/);
  if (catMatch) {
    return { op: 'cat', path: catMatch[1] };
  }

  // rm -rf /home/node/PATH
  const rmMatch = cmd.match(/rm (?:-rf )?\/home\/node\/(.+?)(?:\s|$)/);
  if (rmMatch) {
    return { op: 'rm', path: rmMatch[1] };
  }

  // mv /home/node/X /home/node/Y
  const mvMatch = cmd.match(/mv \/home\/node\/(.+?) \/home\/node\/(.+?)(?:\s|$)/);
  if (mvMatch) {
    return { op: 'mv', path: mvMatch[1], path2: mvMatch[2] };
  }

  // mkdir -p /home/node/PATH
  const mkdirMatch = cmd.match(/mkdir (?:-p )?\/home\/node\/(.+?)(?:\s|$)/);
  if (mkdirMatch) {
    return { op: 'mkdir', path: mkdirMatch[1] };
  }

  // find /home/node/...
  if (cmd.includes('find /home/node/')) {
    return { op: 'find' };
  }

  // ls -la /home/node/PATH (for GET /:path existence check)
  const lsMatch = cmd.match(/ls (?:-[a-z]+ )?\/home\/node\/(.+?)(?:\s|$)/);
  if (lsMatch) {
    return { op: 'ls', path: lsMatch[1] };
  }

  return { op: 'unknown' };
}

async function createTestServer(): Promise<TestServer> {
  const testId = randomUUID().slice(0, 8);
  const dataDir = `/tmp/goldilocks-test-${testId}`;
  const workspaceRoot = `${dataDir}/workspaces`;
  mkdirSync(workspaceRoot, { recursive: true });

  const root = projectRoot();

  // Set env vars BEFORE importing app — CONFIG reads them at access time
  process.env.DATA_DIR = dataDir;
  process.env.WORKSPACE_ROOT = workspaceRoot;
  process.env.JWT_SECRET = 'test-jwt-not-for-prod';
  process.env.ENCRYPTION_KEY = 'test-encryption-key-32bytes!!';
  process.env.NODE_ENV = 'test';

  // Stub sessionManager BEFORE routes are loaded
  const { sessionManager } = await import(`file://${root}server/src/agent/sessions.js`);

  const stubPodManager = {
    async ensurePod(_userId: string) { /* no-op */ },

    async execInPod(userId: string, command: string[]) {
      const parsed = parseCommand(command);

      switch (parsed.op) {
        case 'cat': {
          // Read a file from the local workspace
          const filePath = join(workspaceRoot, parsed.path!);
          if (!existsSync(filePath)) {
            return {
              stdout: makeStream(null),
              stderr: makeStream('No such file'),
              on(event: string, handler: (...args: unknown[]) => void) { return this; },
              close() {},
            };
          }
          const content = readFileSync(filePath, 'utf8');
          return {
            stdout: makeStream(content),
            stderr: makeStream(''),
            on(event: string, handler: (...args: unknown[]) => void) { return this; },
            close() {},
          };
        }

        case 'echo': {
          // Write a file to the local workspace
          const filePath = join(workspaceRoot, parsed.path!);
          const dir = resolve(filePath, '..');
          mkdirSync(dir, { recursive: true });
          const content = Buffer.from(parsed.content!, 'base64').toString('utf8');
          writeFileSync(filePath, content);
          return {
            stdout: makeStream('OK'),
            stderr: makeStream(''),
            on(event: string, handler: (...args: unknown[]) => void) { return this; },
            close() {},
          };
        }

        case 'rm': {
          const filePath = join(workspaceRoot, parsed.path!);
          if (existsSync(filePath)) {
            rmSync(filePath, { recursive: true, force: true });
          }
          return {
            stdout: makeStream(''),
            stderr: makeStream(''),
            on(event: string, handler: (...args: unknown[]) => void) { return this; },
            close() {},
          };
        }

        case 'mv': {
          const fromPath = join(workspaceRoot, parsed.path!);
          const toPath = join(workspaceRoot, parsed.path2!);
          if (existsSync(fromPath)) {
            mkdirSync(resolve(toPath, '..'), { recursive: true });
            renameSync(fromPath, toPath);
          }
          return {
            stdout: makeStream(''),
            stderr: makeStream(''),
            on(event: string, handler: (...args: unknown[]) => void) { return this; },
            close() {},
          };
        }

        case 'mkdir': {
          const dirPath = join(workspaceRoot, parsed.path!);
          mkdirSync(dirPath, { recursive: true });
          return {
            stdout: makeStream(''),
            stderr: makeStream(''),
            on(event: string, handler: (...args: unknown[]) => void) { return this; },
            close() {},
          };
        }

        case 'find': {
          // List all files under workspace, format like find output
          const files = listFiles(workspaceRoot);
          const output = files.map(f => join(workspaceRoot, f)).join('\n');
          return {
            stdout: makeStream(output),
            stderr: makeStream(''),
            on(event: string, handler: (...args: unknown[]) => void) { return this; },
            close() {},
          };
        }

        case 'ls': {
          const filePath = join(workspaceRoot, parsed.path!);
          if (!existsSync(filePath)) {
            return {
              stdout: makeStream(null),
              stderr: makeStream('No such file'),
              on(event: string, handler: (...args: unknown[]) => void) { return this; },
              close() {},
            };
          }
          return {
            stdout: makeStream(filePath),
            stderr: makeStream(''),
            on(event: string, handler: (...args: unknown[]) => void) { return this; },
            close() {},
          };
        }

        default:
          // Unknown command — return empty output
          return {
            stdout: makeStream(''),
            stderr: makeStream(''),
            on(event: string, handler: (...args: unknown[]) => void) { return this; },
            close() {},
          };
      }
    },

    async getAvailableModels() {
      return { models: [] };
    },

    async setModel(_userId: string, _modelId: string) { /* no-op */ },
  };

  Object.defineProperty(sessionManager, 'getPodManager', {
    value: () => stubPodManager,
    writable: true,
    configurable: true,
  });

  // Import createApp — routes now capture the stubbed sessionManager
  const { createApp } = await import(`file://${root}server/src/app.js`);
  const { runMigrations } = await import(`file://${root}server/src/db.js`);

  runMigrations();
  const app = createApp();

  return new Promise<TestServer>((resolve) => {
    const server = createServer(app);
    server.listen(0, () => {
      const addr = server.address() as AddressInfo;
      const baseUrl = `http://localhost:${addr.port}`;

      resolve({
        baseUrl,
        workspaceRoot,

        async stop() {
          return new Promise<void>((res) => {
            server.close(async () => {
              const { closeDb } = await import(`file://${root}server/src/db.js`);
              closeDb();
              try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ }
              res();
            });
          });
        },

        async registerUser(overrides = {}) {
          const email = overrides.email ?? `test-${randomUUID().slice(0, 8)}@example.com`;
          const password = overrides.password ?? 'TestPassword123!';
          const displayName = overrides.displayName ?? 'Test User';

          const res = await fetch(`${baseUrl}/api/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, displayName }),
          });

          if (!res.ok) {
            throw new Error(`Register failed: ${res.status} ${await res.text()}`);
          }

          const json = await res.json() as { token: string; user: { id: string } };
          return { token: json.token, userId: json.user.id, email };
        },

        authHeader(user: TestUser) {
          return `Bearer ${user.token}`;
        },
      });
    });
  });
}

export { createTestServer };