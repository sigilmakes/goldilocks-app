/**
 * Test server helper — spins up a real Express server with isolated config.
 *
 * Every test suite gets its own server instance with:
 *   - Fresh SQLite DB
 *   - Stubbed sessionManager (no k8s needed)
 *   - File operations use the local filesystem with per-user isolation
 *   - Real Express, real routes, real DB writes
 *
 * Fidelity goals:
 *   - Per-user file isolation (each user gets a subdirectory, like a pod/PVC)
 *   - `find` output matches production format (tab-separated path/size/mtime/type)
 *   - Binary-safe reads/writes (Buffer roundtrips, not UTF-8 force-cast)
 *   - Search filtering works via the same command-argument parsing
 */

import { createServer } from 'http';
import { AddressInfo } from 'net';
import {
  mkdirSync, rmSync, readFileSync, writeFileSync,
  readdirSync, statSync, renameSync, existsSync,
} from 'fs';
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

function projectRoot(): string {
  return fileURLToPath(new URL('../../../', import.meta.url));
}

/**
 * Create a stream that emits `data` events with Buffer content, then `end`.
 * If content is null, emits an `error` event instead (simulates command failure
 * like cat on a non-existent file).
 */
function makeStream(content: Buffer | null): EventEmitter {
  const emitter = new EventEmitter();
  if (content !== null) {
    setImmediate(() => {
      emitter.emit('data', content);
      emitter.emit('end');
    });
  } else {
    setImmediate(() => {
      emitter.emit('error', new Error('No such file or directory'));
    });
  }
  return emitter;
}

/** Helper to create a stream from a UTF-8 string */
function makeStringStream(content: string): EventEmitter {
  return makeStream(Buffer.from(content, 'utf8'));
}

/**
 * Per-user directory under workspaceRoot.
 * Mirrors the real app where each user gets their own pod with a PVC.
 */
function userDir(workspaceRoot: string, userId: string): string {
  return join(workspaceRoot, userId);
}

/**
 * List files under a directory, returning paths relative to base.
 * Skips hidden files/dirs (starting with .) — matches the production
 * find command's `-not -path "/home/node/.*" -not -name ".*"`.
 *
 * If searchTerm is provided, only includes:
 *   - Files whose filename contains the search term
 *   - Directories that contain (recursively) at least one matching file
 * This mirrors production's `find -name "*TERM*"` which only returns
 * matching entries, not every directory on the path to a match.
 *
 * If maxDepth is provided, limits recursion depth (production uses -maxdepth 2
 * for search, no limit for general listing).
 */
function listFiles(base: string, prefix: string = '', searchTerm?: string, maxDepth?: number): string[] {
  const results: string[] = [];
  const dir = join(base, prefix);
  if (!existsSync(dir)) return results;

  const currentDepth = prefix ? prefix.split('/').filter(Boolean).length : 0;
  if (maxDepth !== undefined && currentDepth >= maxDepth) return results;

  for (const entry of readdirSync(dir)) {
    // Skip hidden files/dirs — production find excludes them
    if (entry.startsWith('.')) continue;

    const rel = prefix ? `${prefix}/${entry}` : entry;
    const full = join(dir, entry);
    const stat = statSync(full);

    if (stat.isDirectory()) {
      // Recurse to find matching descendants
      const descendants = listFiles(base, rel, searchTerm, maxDepth);
      // Include directory only if:
      //   - No search term (list all) OR
      //   - Directory name matches the search term OR
      //   - Directory contains matching descendants
      if (!searchTerm || entry.toLowerCase().includes(searchTerm.toLowerCase()) || descendants.length > 0) {
        results.push(rel);
        results.push(...descendants);
      }
    } else {
      // If there's a search term, only include matching files
      if (searchTerm && !entry.toLowerCase().includes(searchTerm.toLowerCase())) continue;
      results.push(rel);
    }
  }
  return results;
}

/**
 * Produce find output in production format: tab-separated
 * `fullPath\tsize\tmtime\ttype`
 *
 * Matches the route's parsing:
 *   path: fullPath.replace('/home/node/', '')
 *   type: 'directory' → 'dir', else 'file'
 *   size: parseInt(size) || 0
 *   modified: (parseInt(mtime) || 0) * 1000
 */
function formatFindOutput(userBase: string, searchTerm?: string, maxDepth?: number): string {
  const files = listFiles(userBase, '', searchTerm, maxDepth);
  return files.map(rel => {
    const full = join(userBase, rel);
    const statPath = full;  // no trailing slash — real find doesn't add one
    let size = 0;
    let mtime = 0;
    let type = 'regular file';

    try {
      if (existsSync(statPath)) {
        const s = statSync(statPath);
        size = s.size;
        mtime = Math.floor(s.mtimeMs / 1000);
        type = s.isDirectory() ? 'directory' : 'regular file';
      }
    } catch { /* ignore */ }

    return `/home/node/${rel}\t${size}\t${mtime}\t${type}`;
  }).join('\n');
}

/**
 * Parse a shell command array and figure out what file operation it wants.
 */
function parseCommand(command: string[]): {
  op: 'cat' | 'echo' | 'rm' | 'mv' | 'mkdir' | 'find' | 'ls' | 'unknown';
  path?: string;
  path2?: string;
  content?: string;
  searchTerm?: string;
  maxDepth?: number;
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

  if (cmd.includes('find /home/node')) {
    // Parse -name "*SEARCH*" or -name *SEARCH* pattern from the find command.
    // The route template: -name "*${search}*"
    // The search term is between the asterisks.
    const searchMatch = cmd.match(/-name\s+["']?\*([^*]+)\*["']?/);
    // Parse -maxdepth N (present in search queries, absent in general listing)
    const maxDepthMatch = cmd.match(/-maxdepth\s+(\d+)/);
    return {
      op: 'find',
      searchTerm: searchMatch ? searchMatch[1] : undefined,
      maxDepth: maxDepthMatch ? parseInt(maxDepthMatch[1]) : undefined,
    };
  }

  // ls -la /home/node/PATH
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

  process.env.DATA_DIR = dataDir;
  process.env.WORKSPACE_ROOT = workspaceRoot;
  process.env.JWT_SECRET = 'test-jwt-not-for-prod';
  process.env.ENCRYPTION_KEY = 'test-encryption-key-32bytes!!';
  process.env.NODE_ENV = 'test';

  const { sessionManager } = await import(`file://${root}server/src/agent/sessions.js`);

  const stubPodManager = {
    async ensurePod(_userId: string) { /* no-op */ },

    async execInPod(userId: string, command: string[]) {
      const parsed = parseCommand(command);
      const userBase = userDir(workspaceRoot, userId);

      switch (parsed.op) {
        case 'cat': {
          const filePath = join(userBase, parsed.path!);
          if (!existsSync(filePath)) {
            return {
              stdout: makeStream(null),
              stderr: makeStringStream('No such file'),
              on(event: string, handler: (...args: unknown[]) => void) { return this; },
              close() {},
            };
          }
          // Binary-safe read — preserve raw bytes for raw download route
          const content = readFileSync(filePath);
          return {
            stdout: makeStream(content),
            stderr: makeStringStream(''),
            on(event: string, handler: (...args: unknown[]) => void) { return this; },
            close() {},
          };
        }

        case 'echo': {
          // Binary-safe write — decode base64 to raw Buffer
          const filePath = join(userBase, parsed.path!);
          const dir = resolve(filePath, '..');
          mkdirSync(dir, { recursive: true });
          const content = Buffer.from(parsed.content!, 'base64');
          writeFileSync(filePath, content);
          return {
            stdout: makeStringStream('OK'),
            stderr: makeStringStream(''),
            on(event: string, handler: (...args: unknown[]) => void) { return this; },
            close() {},
          };
        }

        case 'rm': {
          const filePath = join(userBase, parsed.path!);
          if (existsSync(filePath)) {
            rmSync(filePath, { recursive: true, force: true });
          }
          return {
            stdout: makeStringStream(''),
            stderr: makeStringStream(''),
            on(event: string, handler: (...args: unknown[]) => void) { return this; },
            close() {},
          };
        }

        case 'mv': {
          const fromPath = join(userBase, parsed.path!);
          const toPath = join(userBase, parsed.path2!);
          if (existsSync(fromPath)) {
            mkdirSync(resolve(toPath, '..'), { recursive: true });
            renameSync(fromPath, toPath);
          }
          return {
            stdout: makeStringStream(''),
            stderr: makeStringStream(''),
            on(event: string, handler: (...args: unknown[]) => void) { return this; },
            close() {},
          };
        }

        case 'mkdir': {
          const dirPath = join(userBase, parsed.path!);
          mkdirSync(dirPath, { recursive: true });
          return {
            stdout: makeStringStream(''),
            stderr: makeStringStream(''),
            on(event: string, handler: (...args: unknown[]) => void) { return this; },
            close() {},
          };
        }

        case 'find': {
          // Ensure the user directory exists even if no files written yet
          mkdirSync(userBase, { recursive: true });
          const output = formatFindOutput(userBase, parsed.searchTerm, parsed.maxDepth);
          return {
            stdout: makeStringStream(output),
            stderr: makeStringStream(''),
            on(event: string, handler: (...args: unknown[]) => void) { return this; },
            close() {},
          };
        }

        case 'ls': {
          const filePath = join(userBase, parsed.path!);
          if (!existsSync(filePath)) {
            return {
              stdout: makeStream(null),
              stderr: makeStringStream('No such file'),
              on(event: string, handler: (...args: unknown[]) => void) { return this; },
              close() {},
            };
          }
          return {
            stdout: makeStringStream(filePath),
            stderr: makeStringStream(''),
            on(event: string, handler: (...args: unknown[]) => void) { return this; },
            close() {},
          };
        }

        default:
          return {
            stdout: makeStringStream(''),
            stderr: makeStringStream(''),
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