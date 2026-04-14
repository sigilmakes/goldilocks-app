import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestServer, type TestUser } from './helpers/test-server.js';

describe('Settings', () => {
  let server: Awaited<ReturnType<typeof createTestServer>>;
  let user: TestUser;

  beforeAll(async () => {
    server = await createTestServer();
    user = await server.registerUser();
  });

  afterAll(async () => {
    await server.stop();
  });

  // ── GET /settings ─────────────────────────────────────────────────────────

  it('returns the user settings', async () => {
    const res = await fetch(`${server.baseUrl}/api/settings`, {
      headers: { authorization: server.authHeader(user) },
    });

    expect(res.status).toBe(200);
    const json = await res.json() as { settings: Record<string, unknown> };
    expect(json.settings).toBeTruthy();
    expect(typeof json.settings).toBe('object');
  });

  it('returns settings as { settings: {...} } not top-level props', async () => {
    const res = await fetch(`${server.baseUrl}/api/settings`, {
      headers: { authorization: server.authHeader(user) },
    });

    const json = await res.json() as { settings: unknown };
    expect('settings' in json).toBe(true);
    expect('defaultFunctional' in json).toBe(false);
  });

  it('rejects unauthenticated requests', async () => {
    const res = await fetch(`${server.baseUrl}/api/settings`);
    expect(res.status).toBe(401);
  });

  // ── PATCH /settings ───────────────────────────────────────────────────────

  it('updates a setting', async () => {
    const res = await fetch(`${server.baseUrl}/api/settings`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        authorization: server.authHeader(user),
      },
      body: JSON.stringify({ defaultModel: 'claude-sonnet-4-20250514' }),
    });

    expect(res.status).toBe(200);
    const json = await res.json() as { settings: { defaultModel: string } };
    expect(json.settings.defaultModel).toBe('claude-sonnet-4-20250514');
  });

  it('merges settings without overwriting unrelated fields', async () => {
    // Set a known value first
    await fetch(`${server.baseUrl}/api/settings`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        authorization: server.authHeader(user),
      },
      body: JSON.stringify({ workspaceViewer: { monacoExtensions: ['ts'] } }),
    });

    // PATCH just the model — workspaceViewer should survive
    const res = await fetch(`${server.baseUrl}/api/settings`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        authorization: server.authHeader(user),
      },
      body: JSON.stringify({ defaultModel: 'claude-sonnet-4-20250514' }),
    });

    const json = await res.json() as { settings: { defaultModel: string; workspaceViewer: { monacoExtensions: string[] } } };
    expect(json.settings.defaultModel).toBe('claude-sonnet-4-20250514');
    expect(json.settings.workspaceViewer.monacoExtensions).toContain('ts');
  });

  it('rejects unknown settings keys', async () => {
    const res = await fetch(`${server.baseUrl}/api/settings`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        authorization: server.authHeader(user),
      },
      body: JSON.stringify({ isAdmin: true }),
    });

    expect(res.status).toBe(400);
    const json = await res.json() as { error: string };
    expect(json.error).toContain('Unknown setting: isAdmin');
  });

  it('rejects invalid workspaceViewer payloads', async () => {
    const res = await fetch(`${server.baseUrl}/api/settings`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        authorization: server.authHeader(user),
      },
      body: JSON.stringify({ workspaceViewer: { monacoTabSize: 3 } }),
    });

    expect(res.status).toBe(400);
    const json = await res.json() as { error: string };
    expect(json.error).toMatch(/monacoTabSize/i);
  });

  it('rejects unauthenticated PATCH', async () => {
    const res = await fetch(`${server.baseUrl}/api/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultModel: 'claude-sonnet-4-20250514' }),
    });
    expect(res.status).toBe(401);
  });

  // ── GET /settings/api-keys ────────────────────────────────────────────────

  it('returns empty API key list for new user', async () => {
    const res = await fetch(`${server.baseUrl}/api/settings/api-keys`, {
      headers: { authorization: server.authHeader(user) },
    });

    expect(res.status).toBe(200);
    const json = await res.json() as { apiKeys: { provider: string; hasKey: boolean; createdAt: number | null }[] };
    // No keys stored yet — list should be empty
    expect(json.apiKeys.length).toBe(0);
  });

  it('rejects unauthenticated api-keys request', async () => {
    const res = await fetch(`${server.baseUrl}/api/settings/api-keys`);
    expect(res.status).toBe(401);
  });

  // ── PUT /settings/api-key ─────────────────────────────────────────────────

  it('stores an API key and marks hasKey=true', async () => {
    const res = await fetch(`${server.baseUrl}/api/settings/api-key`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        authorization: server.authHeader(user),
      },
      body: JSON.stringify({ provider: 'anthropic', key: 'sk-test-secret-key-12345' }),
    });

    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean; provider: string; createdAt: number };
    expect(json.ok).toBe(true);
    expect(json.provider).toBe('anthropic');

    // Verify the secret is not exposed — only provider + hasKey + createdAt
    const list = await fetch(`${server.baseUrl}/api/settings/api-keys`, {
      headers: { authorization: server.authHeader(user) },
    });
    const { apiKeys } = await list.json() as { apiKeys: { provider: string; hasKey: boolean; createdAt: number | null }[] };
    const anthropic = apiKeys.find((k) => k.provider === 'anthropic');
    expect(anthropic?.hasKey).toBe(true);
    expect(anthropic?.createdAt).toBeTypeOf('number');
    // The actual key string never appears in the response
    const raw = JSON.stringify(apiKeys);
    expect(raw).not.toContain('sk-test-secret-key-12345');
  });

  it('rejects an unsupported provider', async () => {
    const res = await fetch(`${server.baseUrl}/api/settings/api-key`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        authorization: server.authHeader(user),
      },
      body: JSON.stringify({ provider: 'unsupported', key: 'sk-12345' }),
    });

    expect(res.status).toBe(400);
  });

  it('rejects storing a key without a provider', async () => {
    const res = await fetch(`${server.baseUrl}/api/settings/api-key`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        authorization: server.authHeader(user),
      },
      body: JSON.stringify({ key: 'sk-12345' }),
    });
    expect(res.status).toBe(400);
  });

  // ── DELETE /settings/api-key/:provider ───────────────────────────────────

  it('deletes an API key', async () => {
    // Store a key first
    await fetch(`${server.baseUrl}/api/settings/api-key`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        authorization: server.authHeader(user),
      },
      body: JSON.stringify({ provider: 'openai', key: 'sk-openai-test' }),
    });

    const res = await fetch(`${server.baseUrl}/api/settings/api-key/openai`, {
      method: 'DELETE',
      headers: { authorization: server.authHeader(user) },
    });

    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean };
    expect(json.ok).toBe(true);
  });

  it('returns 404 when deleting a valid provider with no key stored', async () => {
    // 'google' is a supported provider but we never set a key for it
    const res = await fetch(`${server.baseUrl}/api/settings/api-key/google`, {
      method: 'DELETE',
      headers: { authorization: server.authHeader(user) },
    });
    expect(res.status).toBe(404);
  });

  it('returns 400 when deleting an unsupported provider', async () => {
    const res = await fetch(`${server.baseUrl}/api/settings/api-key/nonexistent`, {
      method: 'DELETE',
      headers: { authorization: server.authHeader(user) },
    });
    expect(res.status).toBe(400);
  });

  // ── GET /settings/providers ──────────────────────────────────────────────

  it('returns the full provider list with metadata', async () => {
    const res = await fetch(`${server.baseUrl}/api/settings/providers`, {
      headers: { authorization: server.authHeader(user) },
    });

    expect(res.status).toBe(200);
    const json = await res.json() as { providers: { id: string; name: string; group: string; modelCount: number }[]; groups: Record<string, string> };
    expect(json.providers.length).toBeGreaterThanOrEqual(20);
    // Sorted by model count descending
    for (let i = 1; i < json.providers.length; i++) {
      expect(json.providers[i - 1].modelCount).toBeGreaterThanOrEqual(json.providers[i].modelCount);
    }
    // Has expected fields
    expect(json.providers[0].id).toBeTruthy();
    expect(json.providers[0].name).toBeTruthy();
    expect(json.providers[0].group).toBeTruthy();
    expect(json.providers[0].modelCount).toBeGreaterThan(0);
    // Has group labels
    expect(Object.keys(json.groups).length).toBeGreaterThanOrEqual(5);
  });

  it('rejects unauthenticated providers request', async () => {
    const res = await fetch(`${server.baseUrl}/api/settings/providers`);
    expect(res.status).toBe(401);
  });

  it('accepts keys for any built-in provider', async () => {
    // mistral is a valid built-in provider, not one of the original 3
    const res = await fetch(`${server.baseUrl}/api/settings/api-key`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        authorization: server.authHeader(user),
      },
      body: JSON.stringify({ provider: 'mistral', key: 'mistral-test-key' }),
    });
    expect(res.status).toBe(200);
  });

  it('rejects unauthenticated DELETE', async () => {
    const res = await fetch(`${server.baseUrl}/api/settings/api-key/anthropic`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(401);
  });
});