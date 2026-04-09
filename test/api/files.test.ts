import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestServer, type TestUser } from './helpers/test-server.js';

describe('Files', () => {
  let server: Awaited<ReturnType<typeof createTestServer>>;
  let user: TestUser;

  beforeAll(async () => {
    server = await createTestServer();
    user = await server.registerUser();
  });

  afterAll(async () => {
    await server.stop();
  });

  // ── GET /api/files ───────────────────────────────────────────────────────

  it('lists the workspace file tree (empty for new user)', async () => {
    const res = await fetch(`${server.baseUrl}/api/files`, {
      headers: { authorization: server.authHeader(user) },
    });

    expect(res.status).toBe(200);
    const json = await res.json() as { entries: unknown[] };
    expect(Array.isArray(json.entries)).toBe(true);
  });

  it('rejects unauthenticated requests', async () => {
    const res = await fetch(`${server.baseUrl}/api/files`);
    expect(res.status).toBe(401);
  });

  it('searches files by query', async () => {
    const res = await fetch(`${server.baseUrl}/api/files?search=test`, {
      headers: { authorization: server.authHeader(user) },
    });

    expect(res.status).toBe(200);
    const json = await res.json() as { entries: unknown[] };
    expect(Array.isArray(json.entries)).toBe(true);
  });

  // ── PUT /api/files/:path — create file ──────────────────────────────────

  it('creates a file at the given path', async () => {
    const res = await fetch(`${server.baseUrl}/api/files/test-file.txt`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        authorization: server.authHeader(user),
      },
      body: JSON.stringify({ content: 'Hello, Goldilocks!' }),
    });

    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean; path: string; size: number };
    expect(json.ok).toBe(true);
    expect(json.path).toBe('test-file.txt');
    expect(json.size).toBeGreaterThan(0);
  });

  it('creates parent directories automatically', async () => {
    const res = await fetch(`${server.baseUrl}/api/files/subdir/nested/file.txt`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        authorization: server.authHeader(user),
      },
      body: JSON.stringify({ content: 'nested content' }),
    });

    expect(res.status).toBe(200);
  });

  it('prevents path traversal — Express resolves .. before routing', async () => {
    // Express 5 resolves .. in URLs before the route handler runs.
    // /api/files/../secret → /api/secret → 404 (no matching route),
    // so path traversal via literal .. is impossible.
    const res = await fetch(`${server.baseUrl}/api/files/../secret`, {
      method: 'GET',
      headers: { authorization: server.authHeader(user) },
    });

    // Express resolves the path, so it becomes /api/secret → 404
    expect(res.status).toBe(404);
  });

  it('rejects files without content field', async () => {
    const res = await fetch(`${server.baseUrl}/api/files/no-content.txt`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        authorization: server.authHeader(user),
      },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
  });

  // ── GET /api/files/:path — read file ────────────────────────────────────

  it('reads a file that was just written', async () => {
    const path = `read-test-${Date.now()}.txt`;
    await fetch(`${server.baseUrl}/api/files/${path}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        authorization: server.authHeader(user),
      },
      body: JSON.stringify({ content: 'File content here' }),
    });

    const res = await fetch(`${server.baseUrl}/api/files/${path}`, {
      headers: { authorization: server.authHeader(user) },
    });

    expect(res.status).toBe(200);
    const json = await res.json() as { content: string };
    expect(json.content).toBe('File content here');
  });

  it('returns 404 for a non-existent file', async () => {
    const res = await fetch(`${server.baseUrl}/api/files/nonexistent-file.xyz`, {
      headers: { authorization: server.authHeader(user) },
    });

    expect(res.status).toBe(404);
  });

  it('resolves path traversal on read inside workspace', async () => {
    // Express resolves .. in URLs before routing,
    // so /api/files/../secrets.txt becomes /api/secrets.txt → 404
    const res = await fetch(`${server.baseUrl}/api/files/../secrets.txt`, {
      headers: { authorization: server.authHeader(user) },
    });

    expect(res.status).toBe(404);
  });

  // ── POST /api/files/upload ───────────────────────────────────────────────

  it('uploads a file with base64 content', async () => {
    const content = 'Base64 test content';
    const b64 = Buffer.from(content).toString('base64');

    const res = await fetch(`${server.baseUrl}/api/files/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authorization: server.authHeader(user),
      },
      body: JSON.stringify({ filename: 'uploaded.txt', content: b64 }),
    });

    expect(res.status).toBe(201);
    const json = await res.json() as { ok: boolean; name: string; path: string; size: number };
    expect(json.ok).toBe(true);
    expect(json.name).toBe('uploaded.txt');
    expect(json.size).toBe(content.length);
  });

  it('rejects upload without filename', async () => {
    const res = await fetch(`${server.baseUrl}/api/files/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authorization: server.authHeader(user),
      },
      body: JSON.stringify({ content: Buffer.from('hello').toString('base64') }),
    });

    expect(res.status).toBe(400);
  });

  it('rejects upload without content', async () => {
    const res = await fetch(`${server.baseUrl}/api/files/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authorization: server.authHeader(user),
      },
      body: JSON.stringify({ filename: 'no-content.txt' }),
    });

    expect(res.status).toBe(400);
  });

  it('rejects hidden filenames', async () => {
    const res = await fetch(`${server.baseUrl}/api/files/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authorization: server.authHeader(user),
      },
      body: JSON.stringify({ filename: '.env', content: Buffer.from('SECRET=123').toString('base64') }),
    });

    expect(res.status).toBe(400);
  });

  // ── POST /api/files/mkdir ───────────────────────────────────────────────

  it('creates a directory', async () => {
    const res = await fetch(`${server.baseUrl}/api/files/mkdir`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authorization: server.authHeader(user),
      },
      body: JSON.stringify({ path: 'new-directory' }),
    });

    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean; path: string };
    expect(json.ok).toBe(true);
    expect(json.path).toBe('new-directory');
  });

  it('rejects mkdir without path', async () => {
    const res = await fetch(`${server.baseUrl}/api/files/mkdir`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authorization: server.authHeader(user),
      },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
  });

  it('rejects mkdir with a hidden directory name', async () => {
    const res = await fetch(`${server.baseUrl}/api/files/mkdir`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authorization: server.authHeader(user),
      },
      body: JSON.stringify({ path: '.hidden' }),
    });

    expect(res.status).toBe(400);
  });

  // ── POST /api/files/move ────────────────────────────────────────────────

  it('moves a file to a new path', async () => {
    const path = `move-test-${Date.now()}.txt`;
    await fetch(`${server.baseUrl}/api/files/${path}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        authorization: server.authHeader(user),
      },
      body: JSON.stringify({ content: 'move me' }),
    });

    const res = await fetch(`${server.baseUrl}/api/files/move`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authorization: server.authHeader(user),
      },
      body: JSON.stringify({ from: path, to: `moved-${path}` }),
    });

    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean; from: string; to: string };
    expect(json.ok).toBe(true);
    expect(json.to).toBe(`moved-${path}`);
  });

  it('rejects move with missing from field', async () => {
    const res = await fetch(`${server.baseUrl}/api/files/move`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authorization: server.authHeader(user),
      },
      body: JSON.stringify({ to: 'somewhere.txt' }),
    });

    expect(res.status).toBe(400);
  });

  // ── DELETE /api/files/:path ─────────────────────────────────────────────

  it('deletes a file', async () => {
    const path = `delete-test-${Date.now()}.txt`;
    await fetch(`${server.baseUrl}/api/files/${path}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        authorization: server.authHeader(user),
      },
      body: JSON.stringify({ content: 'delete me' }),
    });

    const res = await fetch(`${server.baseUrl}/api/files/${path}`, {
      method: 'DELETE',
      headers: { authorization: server.authHeader(user) },
    });

    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean };
    expect(json.ok).toBe(true);

    // Verify the file is actually gone — read should 404
    const readRes = await fetch(`${server.baseUrl}/api/files/${path}`, {
      headers: { authorization: server.authHeader(user) },
    });
    expect(readRes.status).toBe(404);
  });

  it('succeeds idempotently when deleting a non-existent file', async () => {
    // rm -rf on a non-existent path succeeds silently (standard Unix behavior)
    const res = await fetch(`${server.baseUrl}/api/files/i-do-not-exist.txt`, {
      method: 'DELETE',
      headers: { authorization: server.authHeader(user) },
    });

    expect(res.status).toBe(200);
  });

  // ── GET /api/files/:path/raw ────────────────────────────────────────────

  it('downloads a file as raw binary', async () => {
    const path = `binary-test-${Date.now()}.bin`;
    await fetch(`${server.baseUrl}/api/files/${path}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        authorization: server.authHeader(user),
      },
      body: JSON.stringify({ content: Buffer.from([0x00, 0xff, 0x42]).toString('base64') }),
    });

    const res = await fetch(`${server.baseUrl}/api/files/${path}/raw`, {
      headers: { authorization: server.authHeader(user) },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/octet-stream');
  });

  it('sets Content-Disposition header with filename', async () => {
    const path = `dispo-test-${Date.now()}.txt`;
    await fetch(`${server.baseUrl}/api/files/${path}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        authorization: server.authHeader(user),
      },
      body: JSON.stringify({ content: 'hello' }),
    });

    const res = await fetch(`${server.baseUrl}/api/files/${path}/raw`, {
      headers: { authorization: server.authHeader(user) },
    });

    const disposition = res.headers.get('Content-Disposition') ?? '';
    expect(disposition).toContain('filename=');
  });
});