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
  _baseToolsOverride?: Record<string, unknown>;
  _buildRuntime: ReturnType<typeof vi.fn>;
}> = [];

const createAgentSessionMock = vi.fn(async ({ sessionManager }: { sessionManager: { sessionFile: string } }) => {
  const listeners = new Set<(event: unknown) => void>();
  const session = {
    id: sessionManager.sessionFile,
    sessionFile: sessionManager.sessionFile,
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
    messages: [],
    thinkingLevel: 'medium',
    model: null,
    _buildRuntime: vi.fn(),
    _baseToolsOverride: undefined as Record<string, unknown> | undefined,
  };
  createdSessions.push(session);
  return { session };
});

const createReadToolMock = vi.fn(() => ({ name: 'read' }));
const createBashToolMock = vi.fn(() => ({ name: 'bash' }));
const createEditToolMock = vi.fn(() => ({ name: 'edit' }));
const createWriteToolMock = vi.fn(() => ({ name: 'write' }));
const createPodToolOperationsMock = vi.fn(() => ({
  read: { transport: 'read' },
  bash: { transport: 'bash' },
  edit: { transport: 'edit' },
  write: { transport: 'write' },
}));

vi.mock('@mariozechner/pi-coding-agent', () => {
  return {
    AuthStorage: {
      inMemory: () => ({ setRuntimeApiKey: vi.fn(), removeRuntimeApiKey: vi.fn(), list: () => [] }),
    },
    ModelRegistry: {
      inMemory: () => ({ getAvailable: vi.fn(async () => []) }),
    },
    SessionManager: {
      create: (_cwd: string, sessionDir: string) => ({ sessionFile: `${sessionDir}/new-${createdSessions.length + 1}.jsonl` }),
      open: (sessionPath: string) => ({ sessionFile: sessionPath }),
    },
    getAgentDir: () => '/tmp/.pi/agent',
    createAgentSession: createAgentSessionMock,
    createReadTool: createReadToolMock,
    createBashTool: createBashToolMock,
    createEditTool: createEditToolMock,
    createWriteTool: createWriteToolMock,
  };
});

vi.mock('@goldilocks/data', () => ({
  getDb: () => ({
    prepare: () => ({
      all: () => [],
    }),
  }),
}));

vi.mock('@goldilocks/config', () => ({
  CONFIG: { dataDir: '/tmp/goldilocks-test' },
  decrypt: (value: string) => value,
}));
vi.mock('../src/pod-manager.js', () => ({
  PodManager: class PodManager {
    ensurePod = vi.fn(async () => {});
    touch = vi.fn();
    deletePod = vi.fn(async () => {});
    shutdown = vi.fn(async () => {});
  },
}));
vi.mock('../src/pod-tool-operations.js', () => ({
  createPodToolOperations: createPodToolOperationsMock,
  deleteSessionFile: vi.fn(async () => {}),
  ensureSessionDir: vi.fn(async () => {}),
  getRemoteWorkspaceCwd: () => '/home/node',
  isSessionPathInside: () => true,
}));

describe('sessionManager', () => {
  beforeEach(() => {
    createdSessions.length = 0;
    createAgentSessionMock.mockClear();
    createReadToolMock.mockClear();
    createBashToolMock.mockClear();
    createEditToolMock.mockClear();
    createWriteToolMock.mockClear();
    createPodToolOperationsMock.mockClear();
    vi.resetModules();
  });

  it('keeps separate session instances per conversation', async () => {
    const { sessionManager } = await import('../src/session-manager');

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

    await sessionManager.shutdown();
  });

  it('limits the runtime tool surface to read, bash, edit, and write', async () => {
    const { sessionManager } = await import('../src/session-manager');

    await sessionManager.switchSession('user-1', 'conv-a', null);

    expect(createPodToolOperationsMock).toHaveBeenCalledWith({
      podManager: expect.any(Object),
      userId: 'user-1',
    });
    expect(createReadToolMock).toHaveBeenCalledWith('/home/node', { operations: { transport: 'read' } });
    expect(createBashToolMock).toHaveBeenCalledWith('/home/node', { operations: { transport: 'bash' } });
    expect(createEditToolMock).toHaveBeenCalledWith('/home/node', { operations: { transport: 'edit' } });
    expect(createWriteToolMock).toHaveBeenCalledWith('/home/node', { operations: { transport: 'write' } });

    expect(createAgentSessionMock).toHaveBeenCalledTimes(1);
    expect(createAgentSessionMock.mock.calls[0]?.[0]?.tools).toEqual([
      { name: 'read' },
      { name: 'bash' },
      { name: 'edit' },
      { name: 'write' },
    ]);

    expect(createdSessions).toHaveLength(1);
    expect(createdSessions[0]._buildRuntime).toHaveBeenCalledWith({
      activeToolNames: ['read', 'bash', 'edit', 'write'],
      includeAllExtensionTools: true,
    });
    expect(createdSessions[0]._baseToolsOverride).toEqual({
      read: { name: 'read' },
      bash: { name: 'bash' },
      edit: { name: 'edit' },
      write: { name: 'write' },
    });

    await sessionManager.shutdown();
  });
});
