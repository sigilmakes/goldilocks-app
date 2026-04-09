import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestServer, type TestUser } from './helpers/test-server.js';

describe('Conversations', () => {
  let server: Awaited<ReturnType<typeof createTestServer>>;
  let user: TestUser;

  beforeAll(async () => {
    server = await createTestServer();
    user = await server.registerUser();
  });

  afterAll(async () => {
    await server.stop();
  });

  // ── Create ─────────────────────────────────────────────────────────────────

  it('creates a conversation and returns the conversation object', async () => {
    const res = await fetch(`${server.baseUrl}/api/conversations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authorization: server.authHeader(user),
      },
      body: JSON.stringify({ title: 'My Calculation' }),
    });

    expect(res.status).toBe(201);
    const json = await res.json() as { conversation: { id: string; title: string; piSessionId: string | null } };
    expect(json.conversation.id).toBeTruthy();
    expect(json.conversation.title).toBe('My Calculation');
    expect(json.conversation.piSessionId).toBeNull();
  });

  it('creates a conversation with a default title if none provided', async () => {
    const res = await fetch(`${server.baseUrl}/api/conversations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authorization: server.authHeader(user),
      },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(201);
    const json = await res.json() as { conversation: { title: string } };
    expect(json.conversation.title).toBeTruthy();
  });

  it('rejects conversation creation without auth', async () => {
    const res = await fetch(`${server.baseUrl}/api/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Should Fail' }),
    });
    expect(res.status).toBe(401);
  });

  // ── List ───────────────────────────────────────────────────────────────────

  it('lists all conversations for the user', async () => {
    const res = await fetch(`${server.baseUrl}/api/conversations`, {
      headers: { authorization: server.authHeader(user) },
    });

    expect(res.status).toBe(200);
    const json = await res.json() as { conversations: unknown[] };
    expect(json.conversations.length).toBeGreaterThanOrEqual(2);
  });

  it('returns only the authenticated user\'s conversations', async () => {
    // Register a second user
    const user2 = await server.registerUser({ email: `user2-${Date.now()}@example.com` });

    const res = await fetch(`${server.baseUrl}/api/conversations`, {
      headers: { authorization: server.authHeader(user2) },
    });

    const json = await res.json() as { conversations: unknown[] };
    // user2 just registered and hasn't created any conversations
    expect(json.conversations.length).toBe(0);
  });

  // ── Rename ─────────────────────────────────────────────────────────────────

  it('renames a conversation', async () => {
    // Create a conversation to rename
    const create = await fetch(`${server.baseUrl}/api/conversations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authorization: server.authHeader(user),
      },
      body: JSON.stringify({ title: 'Original Title' }),
    });
    const { conversation } = await create.json() as { conversation: { id: string } };

    const res = await fetch(`${server.baseUrl}/api/conversations/${conversation.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        authorization: server.authHeader(user),
      },
      body: JSON.stringify({ title: 'Renamed Title' }),
    });

    expect(res.status).toBe(200);
    const json = await res.json() as { conversation: { id: string; title: string } };
    expect(json.conversation.title).toBe('Renamed Title');
  });

  it('returns 404 when renaming a non-existent conversation', async () => {
    const res = await fetch(`${server.baseUrl}/api/conversations/nonexistent-id`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        authorization: server.authHeader(user),
      },
      body: JSON.stringify({ title: 'New Title' }),
    });
    expect(res.status).toBe(404);
  });

  it('rejects rename from a different user', async () => {
    const user2 = await server.registerUser({ email: `other-${Date.now()}@example.com` });

    // Create a conversation as user 1
    const create = await fetch(`${server.baseUrl}/api/conversations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authorization: server.authHeader(user),
      },
      body: JSON.stringify({ title: 'User 1 Conv' }),
    });
    const { conversation } = await create.json() as { conversation: { id: string } };

    // Try to rename it as user 2
    const res = await fetch(`${server.baseUrl}/api/conversations/${conversation.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        authorization: server.authHeader(user2),
      },
      body: JSON.stringify({ title: 'Hijacked' }),
    });
    expect(res.status).toBe(404);
  });

  // ── Delete ─────────────────────────────────────────────────────────────────

  it('deletes a conversation', async () => {
    const create = await fetch(`${server.baseUrl}/api/conversations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authorization: server.authHeader(user),
      },
      body: JSON.stringify({ title: 'To Delete' }),
    });
    const { conversation } = await create.json() as { conversation: { id: string } };

    const res = await fetch(`${server.baseUrl}/api/conversations/${conversation.id}`, {
      method: 'DELETE',
      headers: { authorization: server.authHeader(user) },
    });

    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean };
    expect(json.ok).toBe(true);
  });

  it('returns 404 when deleting a non-existent conversation', async () => {
    const res = await fetch(`${server.baseUrl}/api/conversations/nonexistent-id`, {
      method: 'DELETE',
      headers: { authorization: server.authHeader(user) },
    });
    expect(res.status).toBe(404);
  });

  it('deleted conversation no longer appears in list', async () => {
    const create = await fetch(`${server.baseUrl}/api/conversations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authorization: server.authHeader(user),
      },
      body: JSON.stringify({ title: 'Temp Conv' }),
    });
    const { conversation } = await create.json() as { conversation: { id: string } };

    await fetch(`${server.baseUrl}/api/conversations/${conversation.id}`, {
      method: 'DELETE',
      headers: { authorization: server.authHeader(user) },
    });

    const list = await fetch(`${server.baseUrl}/api/conversations`, {
      headers: { authorization: server.authHeader(user) },
    });
    const { conversations } = await list.json() as { conversations: { id: string }[] };
    expect(conversations.some((c) => c.id === conversation.id)).toBe(false);
  });

  // ── Messages ────────────────────────────────────────────────────────────────
  // Conversation messages are managed via pi's session system on the PVC,
  // not through a REST endpoint. There is no GET /:id/messages route.
});
