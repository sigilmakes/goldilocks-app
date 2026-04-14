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

  const authHeaders = (u: TestUser) => ({
    'Content-Type': 'application/json',
    authorization: server.authHeader(u),
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

  it('searches files by query — only matching files appear', async () => {
    await fetch(`${server.baseUrl}/api/files/searchable-foo.txt`, {
      method: 'PUT', headers: authHeaders(user),
      body: JSON.stringify({ content: 'foo content' }),
    });
    await fetch(`${server.baseUrl}/api/files/searchable-bar.txt`, {
      method: 'PUT', headers: authHeaders(user),
      body: JSON.stringify({ content: 'bar content' }),
    });

    const res = await fetch(`${server.baseUrl}/api/files?search=foo`, {
      headers: { authorization: server.authHeader(user) },
    });

    expect(res.status).toBe(200);
    const json = await res.json() as { entries: { name: string; path: string }[] };
    const paths = json.entries.map(e => e.path ?? e.name);
    const hasFoo = paths.some(p => p.includes('foo'));
    const hasBar = paths.some(p => p.includes('bar'));
    expect(hasFoo).toBe(true);
    expect(hasBar).toBe(false);
  });

  it('treats shell metacharacters in search literally', async () => {
    await fetch(`${server.baseUrl}/api/files/literal-$(whoami).txt`, {
      method: 'PUT', headers: authHeaders(user),
      body: JSON.stringify({ content: 'literal search target' }),
    });

    const res = await fetch(`${server.baseUrl}/api/files?search=$(whoami)`, {
      headers: { authorization: server.authHeader(user) },
    });

    expect(res.status).toBe(200);
    const json = await res.json() as { entries: { path: string }[] };
    const paths = json.entries.map((entry) => entry.path);
    expect(paths).toContain('literal-$(whoami).txt');
  });

  // ── PUT /api/files/:path — create file ──────────────────────────────────

  it('creates a file at the given path', async () => {
    const res = await fetch(`${server.baseUrl}/api/files/test-file.txt`, {
      method: 'PUT',
      headers: authHeaders(user),
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
      method: 'PUT', headers: authHeaders(user),
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

    expect(res.status).toBe(404);
  });

  it('rejects files without content field', async () => {
    const res = await fetch(`${server.baseUrl}/api/files/no-content.txt`, {
      method: 'PUT', headers: authHeaders(user),
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
  });

  // ── GET /api/files/:path — read file ────────────────────────────────────

  it('reads a file that was just written — content roundtrips', async () => {
    const path = `read-test-${Date.now()}.txt`;
    await fetch(`${server.baseUrl}/api/files/${path}`, {
      method: 'PUT', headers: authHeaders(user),
      body: JSON.stringify({ content: 'File content here' }),
    });

    const res = await fetch(`${server.baseUrl}/api/files/${path}`, {
      headers: { authorization: server.authHeader(user) },
    });

    expect(res.status).toBe(200);
    const json = await res.json() as { content: string };
    expect(json.content).toBe('File content here');
  });

  it('writes shell metacharacters literally via PUT', async () => {
    const path = `literal-put-${Date.now()}.txt`;
    const content = '$(whoami); `uname -a` | cat && echo haunted';

    const writeRes = await fetch(`${server.baseUrl}/api/files/${path}`, {
      method: 'PUT', headers: authHeaders(user),
      body: JSON.stringify({ content }),
    });
    expect(writeRes.status).toBe(200);

    const readRes = await fetch(`${server.baseUrl}/api/files/${path}`, {
      headers: { authorization: server.authHeader(user) },
    });
    expect(readRes.status).toBe(200);
    const json = await readRes.json() as { content: string };
    expect(json.content).toBe(content);
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

  it('isolates files between users', async () => {
    // User A writes a file
    const path = `isolation-test-${Date.now()}.txt`;
    await fetch(`${server.baseUrl}/api/files/${path}`, {
      method: 'PUT', headers: authHeaders(user),
      body: JSON.stringify({ content: 'private data' }),
    });

    // User B cannot see User A's file
    const user2 = await server.registerUser({ email: `other-${Date.now()}@example.com` });
    const res = await fetch(`${server.baseUrl}/api/files/${path}`, {
      headers: { authorization: server.authHeader(user2) },
    });

    expect(res.status).toBe(404);
  });

  // ── POST /api/files/upload ───────────────────────────────────────────────

  it('uploads a file with base64 content', async () => {
    const content = 'Base64 test content';
    const b64 = Buffer.from(content).toString('base64');

    const res = await fetch(`${server.baseUrl}/api/files/upload`, {
      method: 'POST', headers: authHeaders(user),
      body: JSON.stringify({ filename: 'uploaded.txt', content: b64, contentType: 'text/plain' }),
    });

    expect(res.status).toBe(201);
    const json = await res.json() as { ok: boolean; name: string; path: string; size: number };
    expect(json.ok).toBe(true);
    expect(json.name).toBe('uploaded.txt');
    expect(json.size).toBe(content.length);
  });

  it('uploads shell metacharacters literally', async () => {
    const filename = 'uploaded-literal.txt';
    const content = '$(whoami) ; `pwd` | cat';

    const uploadRes = await fetch(`${server.baseUrl}/api/files/upload`, {
      method: 'POST', headers: authHeaders(user),
      body: JSON.stringify({ filename, content: Buffer.from(content).toString('base64'), contentType: 'text/plain' }),
    });
    expect(uploadRes.status).toBe(201);

    const readRes = await fetch(`${server.baseUrl}/api/files/${filename}`, {
      headers: { authorization: server.authHeader(user) },
    });
    expect(readRes.status).toBe(200);
    const json = await readRes.json() as { content: string };
    expect(json.content).toBe(content);
  });

  it('rejects upload without filename', async () => {
    const res = await fetch(`${server.baseUrl}/api/files/upload`, {
      method: 'POST', headers: authHeaders(user),
      body: JSON.stringify({ content: Buffer.from('hello').toString('base64'), contentType: 'text/plain' }),
    });

    expect(res.status).toBe(400);
  });

  it('rejects upload without content', async () => {
    const res = await fetch(`${server.baseUrl}/api/files/upload`, {
      method: 'POST', headers: authHeaders(user),
      body: JSON.stringify({ filename: 'no-content.txt' }),
    });

    expect(res.status).toBe(400);
  });

  it('rejects upload without contentType', async () => {
    const res = await fetch(`${server.baseUrl}/api/files/upload`, {
      method: 'POST', headers: authHeaders(user),
      body: JSON.stringify({ filename: 'no-type.txt', content: Buffer.from('hello').toString('base64') }),
    });

    expect(res.status).toBe(400);
  });

  it('rejects upload with a disallowed content type', async () => {
    const res = await fetch(`${server.baseUrl}/api/files/upload`, {
      method: 'POST', headers: authHeaders(user),
      body: JSON.stringify({
        filename: 'malware.exe',
        content: Buffer.from('definitely-not-safe').toString('base64'),
        contentType: 'application/x-msdownload',
      }),
    });

    expect(res.status).toBe(400);
    const json = await res.json() as { error: string };
    expect(json.error).toMatch(/unsupported content type/i);
  });

  it('rejects oversized file payloads with 413', async () => {
    const tinyLimitServer = await createTestServer({ env: { FILE_UPLOAD_MAX_BYTES: '64' } });
    const limitedUser = await tinyLimitServer.registerUser();

    try {
      const res = await fetch(`${tinyLimitServer.baseUrl}/api/files/upload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          authorization: tinyLimitServer.authHeader(limitedUser),
        },
        body: JSON.stringify({
          filename: 'too-large.txt',
          content: Buffer.from('x'.repeat(256)).toString('base64'),
          contentType: 'text/plain',
        }),
      });

      expect(res.status).toBe(413);
      const json = await res.json() as { error: string };
      expect(json.error).toMatch(/exceeds limit/i);
    } finally {
      await tinyLimitServer.stop();
    }
  });

  it('rejects hidden filenames', async () => {
    const res = await fetch(`${server.baseUrl}/api/files/upload`, {
      method: 'POST', headers: authHeaders(user),
      body: JSON.stringify({ filename: '.env', content: Buffer.from('SECRET=123').toString('base64'), contentType: 'text/plain' }),
    });

    expect(res.status).toBe(400);
  });

  // ── POST /api/files/mkdir ───────────────────────────────────────────────

  it('creates a directory that appears in tree listings', async () => {
    const dirName = `listing-dir-${Date.now()}`;
    const res = await fetch(`${server.baseUrl}/api/files/mkdir`, {
      method: 'POST', headers: authHeaders(user),
      body: JSON.stringify({ path: dirName }),
    });

    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean; path: string };
    expect(json.ok).toBe(true);

    // Verify the directory appears in the tree listing
    const tree = await fetch(`${server.baseUrl}/api/files`, {
      headers: { authorization: server.authHeader(user) },
    });
    const treeJson = await tree.json() as { entries: { name: string; type: string }[] };
    const dirEntry = treeJson.entries.find(e => e.name === dirName);
    expect(dirEntry).toBeTruthy();
    expect(dirEntry!.type).toBe('dir');
  });

  it('rejects mkdir without path', async () => {
    const res = await fetch(`${server.baseUrl}/api/files/mkdir`, {
      method: 'POST', headers: authHeaders(user),
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
  });

  it('rejects mkdir with a hidden directory name', async () => {
    const res = await fetch(`${server.baseUrl}/api/files/mkdir`, {
      method: 'POST', headers: authHeaders(user),
      body: JSON.stringify({ path: '.hidden' }),
    });

    expect(res.status).toBe(400);
  });

  // ── POST /api/files/move ────────────────────────────────────────────────

  it('moves a file — old path 404s, new path reads back', async () => {
    const originalPath = `move-src-${Date.now()}.txt`;
    const newPath = `move-dst-${Date.now()}.txt`;
    await fetch(`${server.baseUrl}/api/files/${originalPath}`, {
      method: 'PUT', headers: authHeaders(user),
      body: JSON.stringify({ content: 'move me' }),
    });

    const res = await fetch(`${server.baseUrl}/api/files/move`, {
      method: 'POST', headers: authHeaders(user),
      body: JSON.stringify({ from: originalPath, to: newPath }),
    });

    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean; from: string; to: string };
    expect(json.ok).toBe(true);

    // Old path should 404
    const oldRes = await fetch(`${server.baseUrl}/api/files/${originalPath}`, {
      headers: { authorization: server.authHeader(user) },
    });
    expect(oldRes.status).toBe(404);

    // New path should read back correctly
    const newRes = await fetch(`${server.baseUrl}/api/files/${newPath}`, {
      headers: { authorization: server.authHeader(user) },
    });
    expect(newRes.status).toBe(200);
    const newJson = await newRes.json() as { content: string };
    expect(newJson.content).toBe('move me');
  });

  it('rejects move with missing from field', async () => {
    const res = await fetch(`${server.baseUrl}/api/files/move`, {
      method: 'POST', headers: authHeaders(user),
      body: JSON.stringify({ to: 'somewhere.txt' }),
    });

    expect(res.status).toBe(400);
  });

  // ── DELETE /api/files/:path ─────────────────────────────────────────────

  it('deletes a file — subsequent read returns 404', async () => {
    const path = `delete-test-${Date.now()}.txt`;
    await fetch(`${server.baseUrl}/api/files/${path}`, {
      method: 'PUT', headers: authHeaders(user),
      body: JSON.stringify({ content: 'delete me' }),
    });

    const res = await fetch(`${server.baseUrl}/api/files/${path}`, {
      method: 'DELETE',
      headers: { authorization: server.authHeader(user) },
    });

    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean };
    expect(json.ok).toBe(true);

    // Verify the file is actually gone
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

  it('downloads a file as raw binary — bytes roundtrip', async () => {
    const path = `binary-test-${Date.now()}.bin`;
    const originalBytes = Buffer.from([0x00, 0xff, 0x42, 0x80, 0x01]);

    // Upload via the upload route (base64, preserves raw bytes)
    await fetch(`${server.baseUrl}/api/files/upload`, {
      method: 'POST', headers: authHeaders(user),
      body: JSON.stringify({ filename: path, content: originalBytes.toString('base64'), contentType: 'application/octet-stream' }),
    });

    const res = await fetch(`${server.baseUrl}/api/files/${path}/raw`, {
      headers: { authorization: server.authHeader(user) },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/octet-stream');

    // Verify the actual bytes match
    const body = Buffer.from(await res.arrayBuffer());
    expect(body).toEqual(originalBytes);
  });

  it('sets Content-Disposition header with filename', async () => {
    const path = `dispo-test-${Date.now()}.txt`;
    await fetch(`${server.baseUrl}/api/files/${path}`, {
      method: 'PUT', headers: authHeaders(user),
      body: JSON.stringify({ content: 'hello' }),
    });

    const res = await fetch(`${server.baseUrl}/api/files/${path}/raw`, {
      headers: { authorization: server.authHeader(user) },
    });

    const disposition = res.headers.get('Content-Disposition') ?? '';
    expect(disposition).toContain('filename=');
  });
});