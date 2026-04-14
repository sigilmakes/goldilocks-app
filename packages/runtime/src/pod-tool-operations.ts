import { mkdir, readFile as readLocalFile, rm } from 'fs/promises';
import { dirname, resolve, relative } from 'path';
import { fileURLToPath } from 'url';
import { PodManager } from './pod-manager.js';

interface BashOperations {
  exec: (command: string, cwd: string, options: {
    onData: (data: Buffer) => void;
    signal?: AbortSignal;
    timeout?: number;
    env?: NodeJS.ProcessEnv;
  }) => Promise<{ exitCode: number | null }>;
}

interface ReadOperations {
  readFile: (absolutePath: string) => Promise<Buffer>;
  access: (absolutePath: string) => Promise<void>;
  detectImageMimeType?: (absolutePath: string) => Promise<string | null | undefined>;
}

interface WriteOperations {
  writeFile: (absolutePath: string, content: string) => Promise<void>;
  mkdir: (dir: string) => Promise<void>;
}

interface EditOperations {
  readFile: (absolutePath: string) => Promise<Buffer>;
  writeFile: (absolutePath: string, content: string) => Promise<void>;
  access: (absolutePath: string) => Promise<void>;
}

const REMOTE_CWD = '/home/node';
const PYTHON = 'python3';
const POD_TOOL_SCRIPTS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'pod-tool-scripts');

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function extname(path: string): string {
  const idx = path.lastIndexOf('.');
  return idx >= 0 ? path.slice(idx).toLowerCase() : '';
}

interface ExecResult {
  stdout: Buffer;
  stderr: Buffer;
  exitCode: number | null;
}

interface ExecCommandOptions {
  stdinData?: string | Buffer;
}

async function execCommand(
  podManager: PodManager,
  userId: string,
  command: string[],
  options: ExecCommandOptions = {},
): Promise<ExecResult> {
  await podManager.ensurePod(userId);
  podManager.touch(userId);

  const exec = await podManager.execInPod(userId, command);

  return new Promise<ExecResult>((resolveResult, reject) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutEnded = false;
    let stderrEnded = false;
    let doneResolved = !exec.done;
    let settled = false;
    let exitCode: number | null = 0;

    const finish = () => {
      if (settled || !stdoutEnded || !stderrEnded || !doneResolved) return;
      settled = true;
      exec.close();
      resolveResult({
        stdout: Buffer.concat(stdoutChunks),
        stderr: Buffer.concat(stderrChunks),
        exitCode,
      });
    };

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      exec.close();
      reject(err);
    };

    exec.stdout.on('data', (chunk: Buffer | string) => {
      stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    exec.stderr.on('data', (chunk: Buffer | string) => {
      stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    exec.stdout.on('end', () => {
      stdoutEnded = true;
      finish();
    });
    exec.stderr.on('end', () => {
      stderrEnded = true;
      finish();
    });
    exec.stdout.on('error', (err) => fail(err instanceof Error ? err : new Error(String(err))));
    exec.stderr.on('error', (err) => fail(err instanceof Error ? err : new Error(String(err))));
    exec.stdin.on('error', (err) => fail(err instanceof Error ? err : new Error(String(err))));

    if (exec.done) {
      exec.done.then((result) => {
        exitCode = result.exitCode;
        doneResolved = true;
        finish();
      }).catch((err) => {
        fail(err instanceof Error ? err : new Error(String(err)));
      });
    }

    queueMicrotask(() => {
      try {
        if (options.stdinData !== undefined) {
          exec.stdin.write(options.stdinData);
        }
        exec.stdin.end();
      } catch (err) {
        fail(err instanceof Error ? err : new Error(String(err)));
      }
    });
  });
}

async function execText(
  podManager: PodManager,
  userId: string,
  command: string[],
  options?: ExecCommandOptions,
): Promise<string> {
  const result = await execCommand(podManager, userId, command, options);
  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString('utf8').trim();
    throw new Error(stderr || `Command failed with exit code ${result.exitCode ?? 'null'}`);
  }
  return result.stdout.toString('utf8');
}

async function execBoolean(
  podManager: PodManager,
  userId: string,
  command: string[],
): Promise<boolean> {
  const result = await execCommand(podManager, userId, command);
  return result.exitCode === 0;
}

async function getPythonScript(scriptName: string): Promise<string> {
  const scriptPath = resolve(POD_TOOL_SCRIPTS_DIR, `${scriptName}.py`);
  return readLocalFile(scriptPath, 'utf8');
}

async function execPythonScript(
  podManager: PodManager,
  userId: string,
  scriptName: string,
  args: string[] = [],
): Promise<string> {
  const script = await getPythonScript(scriptName);

  try {
    return await execText(
      podManager,
      userId,
      [PYTHON, '-', ...args],
      { stdinData: script },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Python helper ${scriptName}.py failed: ${message}`);
  }
}

async function readBinaryFile(
  podManager: PodManager,
  userId: string,
  absolutePath: string,
): Promise<Buffer> {
  const encoded = await execPythonScript(podManager, userId, 'read-binary-file', [absolutePath]);
  return Buffer.from(encoded.trim(), 'base64');
}

async function writeBinaryFile(
  podManager: PodManager,
  userId: string,
  absolutePath: string,
  content: Buffer,
): Promise<void> {
  await execPythonScript(podManager, userId, 'write-binary-file', [
    absolutePath,
    content.toString('base64'),
  ]);
}

export function getRemoteWorkspaceCwd(): string {
  return REMOTE_CWD;
}

export function createPodToolOperations(deps: {
  podManager: PodManager;
  userId: string;
}): {
  bash: BashOperations;
  read: ReadOperations;
  write: WriteOperations;
  edit: EditOperations;
} {
  const { podManager, userId } = deps;

  const bash: BashOperations = {
    async exec(command, cwd, options) {
      await podManager.ensurePod(userId);
      podManager.touch(userId);

      // Do not forward the agent-service process environment into the sandbox.
      // The pod already has its own PATH/HOME, and forwarding options.env would
      // leak service secrets and cluster wiring into user tool executions.
      const script = [
        `cd ${shellQuote(cwd)}`,
        command,
      ].filter(Boolean).join('; ');

      const exec = await podManager.execInPod(userId, ['sh', '-lc', script]);

      return new Promise<{ exitCode: number | null }>((resolveResult, reject) => {
        let settled = false;
        let timer: NodeJS.Timeout | undefined;

        const cleanup = () => {
          if (timer) clearTimeout(timer);
          options.signal?.removeEventListener('abort', onAbort);
        };

        const finish = (exitCode: number | null) => {
          if (settled) return;
          settled = true;
          cleanup();
          exec.close();
          resolveResult({ exitCode });
        };

        const fail = (err: Error) => {
          if (settled) return;
          settled = true;
          cleanup();
          exec.close();
          reject(err);
        };

        const onAbort = () => finish(null);

        exec.stdout.on('data', (chunk: Buffer | string) => {
          options.onData(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        exec.stderr.on('data', (chunk: Buffer | string) => {
          options.onData(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        exec.stdout.on('error', (err) => fail(err instanceof Error ? err : new Error(String(err))));
        exec.stderr.on('error', (err) => fail(err instanceof Error ? err : new Error(String(err))));

        if (options.signal?.aborted) {
          finish(null);
          return;
        }
        options.signal?.addEventListener('abort', onAbort, { once: true });

        if (options.timeout && options.timeout > 0) {
          timer = setTimeout(() => finish(null), options.timeout * 1000);
        }

        if (exec.done) {
          exec.done.then((result) => finish(result.exitCode)).catch((err) => {
            fail(err instanceof Error ? err : new Error(String(err)));
          });
        } else {
          exec.stdout.on('end', () => finish(0));
        }
      });
    },
  };

  const read: ReadOperations = {
    async readFile(absolutePath) {
      return readBinaryFile(podManager, userId, absolutePath);
    },
    async access(absolutePath) {
      const ok = await execBoolean(podManager, userId, ['test', '-r', absolutePath]);
      if (!ok) throw new Error(`File not readable: ${absolutePath}`);
    },
    async detectImageMimeType(absolutePath) {
      return MIME_BY_EXT[extname(absolutePath)] ?? null;
    },
  };

  const write: WriteOperations = {
    async writeFile(absolutePath, content) {
      await writeBinaryFile(podManager, userId, absolutePath, Buffer.from(content, 'utf8'));
    },
    async mkdir(dir) {
      await execPythonScript(podManager, userId, 'mkdir', [dir]);
    },
  };

  const edit: EditOperations = {
    async readFile(absolutePath) {
      return readBinaryFile(podManager, userId, absolutePath);
    },
    async writeFile(absolutePath, content) {
      await writeBinaryFile(podManager, userId, absolutePath, Buffer.from(content, 'utf8'));
    },
    async access(absolutePath) {
      const ok = await execBoolean(podManager, userId, ['test', '-r', absolutePath]);
      if (!ok) throw new Error(`File not readable: ${absolutePath}`);
    },
  };

  return { bash, read, write, edit };
}

export async function deleteSessionFile(sessionPath: string): Promise<void> {
  await rm(sessionPath, { force: true });
}

export async function ensureSessionDir(sessionDir: string): Promise<void> {
  await mkdir(sessionDir, { recursive: true });
}

export function resolveSessionPath(sessionDir: string, sessionPath: string): string {
  return resolve(sessionDir, sessionPath);
}

export function isSessionPathInside(sessionDir: string, sessionPath: string): boolean {
  const rel = relative(sessionDir, resolve(sessionPath));
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith('/'));
}
