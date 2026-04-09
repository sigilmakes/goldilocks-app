import { beforeEach, describe, expect, it, vi } from 'vitest';

const createdSessions: Array<{
  id: string;
  prompt: ReturnType<typeof vi.fn>;
  abort: ReturnType<typeof vi.fn>;
  setModel: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  emit: (event: unknown) => void;
  listeners: Set<(event: unknown) => void>;
}> = [];

vi.mock('@mariozechner/pi-coding-agent', () => {
  return {
    AuthStorage: {
      inMemory: () => ({ setRuntimeApiKey: vi.fn(), removeRuntimeApiKey: vi.fn() }),
    },
    ModelRegistry: {
      inMemory: () => ({ getAvailable: vi.fn(async () => []) }),
    },
    SessionManager: {
      create: (_cwd: string, sessionDir: string) => ({ sessionFile: `${sessionDir}/new-${createdSessions.length + 1}.jsonl` }),
      open: (sessionPath: string) => ({ sessionFile: sessionPath }),
    },
    getAgentDir: () => '/tmp/.pi/agent',
    createAgentSession: vi.fn(async ({ sessionManager }: { sessionManager: { sessionFile: string } }) => {
      const listeners = new Set<(event: unknown) => void>();
      const session = {
        id: sessionManager.sessionFile,
        prompt: vi.fn(async () => {}),
        abort: vi.fn(async () => {}),
        setModel: vi.fn(async () => {}),
        dispose: vi.fn(),
        subscribe: vi.fn((listener: (event: unknown) => void) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        }),
        emit: (event: unknown) => {
          for (const listener of listeners) listener(event);
        },
        listeners,
      };
      createdSessions.push(session);
      return {
        session: {
          sessionFile: sessionManager.sessionFile,
          prompt: session.prompt,
          abort: session.abort,
          setModel: session.setModel,
          subscribe: session.subscribe,
          dispose: session.dispose,
          messages: [],
          thinkingLevel: 'medium',
          model: null,
        },
      };
    }),
    createReadTool: vi.fn(() => ({})),
    createBashTool: vi.fn(() => ({})),
    createEditTool: vi.fn(() => ({})),
    createWriteTool: vi.fn(() => ({})),
    createGrepTool: vi.fn(() => ({})),
    createFindTool: vi.fn(() => ({})),
    createLsTool: vi.fn(() => ({})),
  };
});

vi.mock('../../server/src/db.ts', () => ({
  getDb: () => ({
    prepare: () => ({
      all: () => [],
    }),
  }),
}));

vi.mock('../../server/src/crypto.ts', () => ({ decrypt: (value: string) => value }));
vi.mock('../../server/src/agent/pod-manager.ts', () => ({
  PodManager: class PodManager {
    ensurePod = vi.fn(async () => {});
    touch = vi.fn();
    deletePod = vi.fn(async () => {});
    shutdown = vi.fn(async () => {});
  },
}));
vi.mock('../../server/src/agent/pod-tool-operations.ts', () => ({
  createPodToolOperations: () => ({
    read: {},
    bash: {},
    edit: {},
    write: {},
    grep: {},
    find: {},
    ls: {},
  }),
  deleteSessionFile: vi.fn(async () => {}),
  ensureSessionDir: vi.fn(async () => {}),
  getRemoteWorkspaceCwd: () => '/home/node',
  isSessionPathInside: () => true,
}));

describe('sessionManager conversation isolation', () => {
  beforeEach(() => {
    createdSessions.length = 0;
  });

  it('keeps separate session instances per conversation', async () => {
    const { sessionManager } = await import('../../server/src/agent/sessions');

    await sessionManager.switchSession('user-1', 'conv-a', null);
    const eventsA: unknown[] = [];
    await sessionManager.subscribe('user-1', 'conv-a', (event) => eventsA.push(event));

    await sessionManager.switchSession('user-1', 'conv-b', null);
    const eventsB: unknown[] = [];
    await sessionManager.subscribe('user-1', 'conv-b', (event) => eventsB.push(event));

    expect(createdSessions).toHaveLength(2);

    await sessionManager.prompt('user-1', 'conv-a', 'alpha');
    await sessionManager.prompt('user-1', 'conv-b', 'beta');

    expect(createdSessions[0].prompt).toHaveBeenCalledWith('alpha');
    expect(createdSessions[1].prompt).toHaveBeenCalledWith('beta');

    createdSessions[0].emit({ type: 'message_end', source: 'a' });
    createdSessions[1].emit({ type: 'message_end', source: 'b' });

    expect(eventsA).toEqual([{ type: 'message_end', source: 'a' }]);
    expect(eventsB).toEqual([{ type: 'message_end', source: 'b' }]);
  });
});
