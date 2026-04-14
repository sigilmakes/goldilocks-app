import { PassThrough } from 'stream';
import { describe, expect, it, vi } from 'vitest';
import { createEditTool, createWriteTool } from '@mariozechner/pi-coding-agent';
import { createPodToolOperations } from '../src/pod-tool-operations';

interface ExecStep {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
}

function createScriptedPodManager(steps: ExecStep[]) {
  const commands: string[][] = [];
  const stdinPayloads: string[] = [];

  const podManager = {
    ensurePod: vi.fn(async () => {}),
    touch: vi.fn(),
    execInPod: vi.fn(async (_userId: string, command: string[]) => {
      const step = steps.shift();
      if (!step) {
        throw new Error(`Unexpected exec call: ${command.join(' ')}`);
      }

      commands.push(command);

      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const stdin = new PassThrough();
      const stdinChunks: Buffer[] = [];

      stdin.on('data', (chunk: Buffer | string) => {
        stdinChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      stdin.on('end', () => {
        stdinPayloads.push(Buffer.concat(stdinChunks).toString('utf8'));
      });

      queueMicrotask(() => {
        if (step.stdout) stdout.write(step.stdout);
        if (step.stderr) stderr.write(step.stderr);
        stdout.end();
        stderr.end();
      });

      return {
        stdin,
        stdout,
        stderr,
        done: Promise.resolve({ exitCode: step.exitCode ?? 0 }),
        close: vi.fn(() => {
          stdin.end();
          stdout.end();
          stderr.end();
        }),
      };
    }),
  };

  return { podManager, commands, stdinPayloads };
}

describe('pod-tool-operations', () => {
  it('does not forward host/service env vars into the sandbox shell', async () => {
    const exec = {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      done: Promise.resolve({ exitCode: 0 }),
      close: vi.fn(() => {
        exec.stdin.end();
        exec.stdout.end();
        exec.stderr.end();
      }),
    };

    let capturedCommand: string[] | null = null;
    const podManager = {
      ensurePod: vi.fn(async () => {}),
      touch: vi.fn(),
      execInPod: vi.fn(async (_userId: string, command: string[]) => {
        capturedCommand = command;
        queueMicrotask(() => {
          exec.stdout.end();
          exec.stderr.end();
        });
        return exec;
      }),
    };

    const { bash } = createPodToolOperations({
      podManager: podManager as any,
      userId: 'user-1',
    });

    await bash.exec('ls -la', '/home/node', {
      onData: () => {},
      env: {
        JWT_SECRET: 'should-not-leak',
        ENCRYPTION_KEY: 'also-bad',
        PATH: '/root/.pi/agent/bin:/app/node_modules/.bin:/usr/bin',
      },
    });

    expect(capturedCommand).toEqual(['sh', '-lc', "cd '/home/node'; ls -la"]);
    expect(capturedCommand?.join(' ')).not.toContain('JWT_SECRET');
    expect(capturedCommand?.join(' ')).not.toContain('ENCRYPTION_KEY');
    expect(capturedCommand?.join(' ')).not.toContain('export PATH=');
  });

  it('streams dedicated python helper scripts into the pod for write operations', async () => {
    const { podManager, commands, stdinPayloads } = createScriptedPodManager([
      { stdout: 'ok\n' },
    ]);

    const { write } = createPodToolOperations({
      podManager: podManager as any,
      userId: 'user-1',
    });

    await write.writeFile('/home/node/demo.txt', 'hello');

    expect(commands).toEqual([
      ['python3', '-', '/home/node/demo.txt', 'aGVsbG8='],
    ]);
    expect(stdinPayloads[0]).toContain("with open(path, 'wb') as handle:");
    expect(stdinPayloads[0]).toContain('base64.b64decode(encoded)');
    expect(commands[0]).not.toContain('-c');
  });

  it('reads binary files through a dedicated python helper script', async () => {
    const { podManager, commands, stdinPayloads } = createScriptedPodManager([
      { stdout: Buffer.from('hello', 'utf8').toString('base64') },
    ]);

    const { read } = createPodToolOperations({
      podManager: podManager as any,
      userId: 'user-1',
    });

    const content = await read.readFile('/home/node/demo.txt');

    expect(content.toString('utf8')).toBe('hello');
    expect(commands).toEqual([
      ['python3', '-', '/home/node/demo.txt'],
    ]);
    expect(stdinPayloads[0]).toContain('base64.b64encode(handle.read())');
    expect(commands[0]).not.toContain('-c');
  });

  it('supports write tool success path, including parent directory creation', async () => {
    const { podManager, commands, stdinPayloads } = createScriptedPodManager([
      { stdout: 'ok\n' },
      { stdout: 'ok\n' },
    ]);

    const operations = createPodToolOperations({
      podManager: podManager as any,
      userId: 'user-1',
    });
    const writeTool = createWriteTool('/home/node', { operations: operations.write });

    const result = await writeTool.execute('tool-1', {
      path: 'nested/demo.txt',
      content: 'hello',
    });

    expect(result.content).toEqual([
      { type: 'text', text: 'Successfully wrote 5 bytes to nested/demo.txt' },
    ]);
    expect(commands).toEqual([
      ['python3', '-', '/home/node/nested'],
      ['python3', '-', '/home/node/nested/demo.txt', 'aGVsbG8='],
    ]);
    expect(stdinPayloads[0]).toContain('os.makedirs(sys.argv[1], exist_ok=True)');
    expect(stdinPayloads[1]).toContain("with open(path, 'wb') as handle:");
  });

  it('supports edit tool success path through the same script-backed transport', async () => {
    const originalContent = 'alpha\n';
    const { podManager, commands, stdinPayloads } = createScriptedPodManager([
      {},
      { stdout: Buffer.from(originalContent, 'utf8').toString('base64') },
      { stdout: 'ok\n' },
    ]);

    const operations = createPodToolOperations({
      podManager: podManager as any,
      userId: 'user-1',
    });
    const editTool = createEditTool('/home/node', { operations: operations.edit });

    const result = await editTool.execute('tool-2', {
      path: 'notes.txt',
      edits: [{ oldText: 'alpha', newText: 'beta' }],
    });

    expect(result.content).toEqual([
      { type: 'text', text: 'Successfully replaced 1 block(s) in notes.txt.' },
    ]);
    expect(commands).toEqual([
      ['test', '-r', '/home/node/notes.txt'],
      ['python3', '-', '/home/node/notes.txt'],
      ['python3', '-', '/home/node/notes.txt', Buffer.from('beta\n', 'utf8').toString('base64')],
    ]);
    expect(stdinPayloads[1]).toContain('base64.b64encode(handle.read())');
    expect(stdinPayloads[2]).toContain("with open(path, 'wb') as handle:");
  });

  it('surfaces python helper failures with the helper name', async () => {
    const { podManager } = createScriptedPodManager([
      { stderr: 'traceback misery\n', exitCode: 1 },
    ]);

    const { write } = createPodToolOperations({
      podManager: podManager as any,
      userId: 'user-1',
    });

    await expect(write.writeFile('/home/node/demo.txt', 'hello')).rejects.toThrow(
      'Python helper write-binary-file.py failed: traceback misery',
    );
  });
});
