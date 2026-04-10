import { PassThrough } from 'stream';
import { describe, expect, it, vi } from 'vitest';
import { createPodToolOperations } from '../../server/src/agent/pod-tool-operations';

function createExecStreams() {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdin = new PassThrough();
  return {
    stdin,
    stdout,
    stderr,
    done: Promise.resolve({ exitCode: 0 }),
    close: vi.fn(() => {
      stdin.end();
      stdout.end();
      stderr.end();
    }),
  };
}

describe('pod-tool-operations bash env forwarding', () => {
  it('does not forward host/service env vars into the sandbox shell', async () => {
    const exec = createExecStreams();
    let capturedCommand: string[] | null = null;

    const podManager = {
      ensurePod: vi.fn(async () => {}),
      touch: vi.fn(),
      execInPod: vi.fn(async (_userId: string, command: string[]) => {
        capturedCommand = command;
        // End streams on next tick so the operation resolves.
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
});
