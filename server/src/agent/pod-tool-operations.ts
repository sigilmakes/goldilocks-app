import { mkdir, rm } from 'fs/promises';
import { resolve, relative } from 'path';
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

interface FindOperations {
  exists: (absolutePath: string) => Promise<boolean>;
  glob: (pattern: string, cwd: string, options: { ignore: string[]; limit: number }) => Promise<string[]>;
}

interface GrepOperations {
  isDirectory: (absolutePath: string) => Promise<boolean>;
  readFile: (absolutePath: string) => Promise<string>;
}

interface LsOperations {
  exists: (absolutePath: string) => Promise<boolean>;
  stat: (absolutePath: string) => Promise<{ isDirectory: () => boolean }>;
  readdir: (absolutePath: string) => Promise<string[]>;
}

const REMOTE_CWD = '/home/node';
const PYTHON = 'python3';

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

async function execCommand(
  podManager: PodManager,
  userId: string,
  command: string[],
): Promise<ExecResult> {
  await podManager.ensurePod(userId);
  podManager.touch(userId);

  const exec = await podManager.execInPod(userId, command);

  return new Promise<ExecResult>((resolve, reject) => {
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutEnded = false;
    let stderrEnded = false;
    let settled = false;
    let exitCode: number | null = 0;

    const finish = () => {
      if (settled || !stdoutEnded || !stderrEnded) return;
      settled = true;
      exec.close();
      resolve({
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

    if (exec.done) {
      exec.done.then((result) => {
        exitCode = result.exitCode;
        if (stdoutEnded && stderrEnded) finish();
      }).catch((err) => {
        fail(err instanceof Error ? err : new Error(String(err)));
      });
    }
  });
}

async function execText(
  podManager: PodManager,
  userId: string,
  command: string[],
): Promise<string> {
  const result = await execCommand(podManager, userId, command);
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

async function readBinaryFile(
  podManager: PodManager,
  userId: string,
  absolutePath: string,
): Promise<Buffer> {
  const encoded = await execText(podManager, userId, [
    PYTHON,
    '-c',
    'import base64,sys; print(base64.b64encode(open(sys.argv[1],"rb").read()).decode("ascii"))',
    absolutePath,
  ]);
  return Buffer.from(encoded.trim(), 'base64');
}

async function writeBinaryFile(
  podManager: PodManager,
  userId: string,
  absolutePath: string,
  content: Buffer,
): Promise<void> {
  const encoded = content.toString('base64');
  await execText(podManager, userId, [
    PYTHON,
    '-c',
    [
      'import base64, os, sys',
      'path = sys.argv[1]',
      'os.makedirs(os.path.dirname(path), exist_ok=True)',
      'with open(path, "wb") as fh:',
      '    fh.write(base64.b64decode(sys.argv[2]))',
      'print("ok")',
    ].join('; '),
    absolutePath,
    encoded,
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
  find: FindOperations;
  grep: GrepOperations;
  ls: LsOperations;
} {
  const { podManager, userId } = deps;

  const bash: BashOperations = {
    async exec(command, cwd, options) {
      await podManager.ensurePod(userId);
      podManager.touch(userId);

      const envExports = Object.entries(options.env ?? {})
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => `export ${key}=${shellQuote(String(value))}`)
        .join('; ');

      const script = [
        `cd ${shellQuote(cwd)}`,
        envExports,
        command,
      ].filter(Boolean).join('; ');

      const exec = await podManager.execInPod(userId, ['sh', '-lc', script]);

      return new Promise<{ exitCode: number | null }>((resolve, reject) => {
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
          resolve({ exitCode });
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
      await execText(podManager, userId, [PYTHON, '-c', 'import os,sys; os.makedirs(sys.argv[1], exist_ok=True); print("ok")', dir]);
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

  const find: FindOperations = {
    async exists(absolutePath) {
      return execBoolean(podManager, userId, ['test', '-e', absolutePath]);
    },
    async glob(pattern, cwd, options) {
      const output = await execText(podManager, userId, [
        PYTHON,
        '-c',
        [
          'import glob, json, os, sys',
          'pattern = sys.argv[1]',
          'cwd = sys.argv[2]',
          'ignore = set(filter(None, sys.argv[3].split("\n")))',
          'limit = int(sys.argv[4])',
          'matches = []',
          'for path in sorted(glob.glob(os.path.join(cwd, pattern), recursive=True)):',
          '    rel = os.path.relpath(path, cwd)',
          '    if rel == ".": continue',
          '    parts = rel.split(os.sep)',
          '    if any(part in ignore for part in parts): continue',
          '    matches.append(rel.replace(os.sep, "/"))',
          '    if len(matches) >= limit: break',
          'print(json.dumps(matches))',
        ].join('; '),
        pattern,
        cwd,
        options.ignore.join('\n'),
        String(options.limit),
      ]);
      return JSON.parse(output) as string[];
    },
  };

  const grep: GrepOperations = {
    async isDirectory(absolutePath) {
      const exists = await execBoolean(podManager, userId, ['test', '-e', absolutePath]);
      if (!exists) throw new Error(`Path not found: ${absolutePath}`);
      return execBoolean(podManager, userId, ['test', '-d', absolutePath]);
    },
    async readFile(absolutePath) {
      const buffer = await readBinaryFile(podManager, userId, absolutePath);
      return buffer.toString('utf8');
    },
  };

  const ls: LsOperations = {
    async exists(absolutePath) {
      return execBoolean(podManager, userId, ['test', '-e', absolutePath]);
    },
    async stat(absolutePath) {
      const isDirectory = await execBoolean(podManager, userId, ['test', '-d', absolutePath]);
      return { isDirectory: () => isDirectory };
    },
    async readdir(absolutePath) {
      const output = await execText(podManager, userId, [
        PYTHON,
        '-c',
        'import json, os, sys; print(json.dumps(sorted(os.listdir(sys.argv[1]))))',
        absolutePath,
      ]);
      return JSON.parse(output) as string[];
    },
  };

  return { bash, read, write, edit, find, grep, ls };
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
