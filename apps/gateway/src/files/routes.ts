/**
 * File routes -- workspace file operations via the user's pod-backed home directory.
 *
 * Files live on the user's mounted home at /home/node in the pod, backed by a host
 * path managed by the pod manager. Read/raw/move/delete still use pod exec, while
 * list/search/write now operate directly on the host-mounted path to avoid any shell
 * interpolation with user-controlled input.
 *
 * Note: These routes are scoped per user (via auth), not per conversation.
 *
 * Route order matters (Express matches first):
 *   1. GET /           -- list (static)
 *   2. POST /upload    -- upload (static)
 *   3. POST /move      -- move (static)
 *   4. POST /mkdir     -- mkdir (static)
 *   5. GET /<path>/raw -- raw download (specific, before catch-all)
 *   6. GET /<path>     -- read file (regex catch-all, also used for PUT/DELETE)
 */

import { promises as fs } from 'fs';
import { dirname, relative, resolve, sep } from 'path';
import { Router, Response } from 'express';
import { CONFIG } from '@goldilocks/config';
import { sessionManager } from '@goldilocks/runtime';
import { verifyToken, AuthRequest } from '../auth/middleware.js';

const router = Router();
const SEARCH_LIMIT = 50;
const SEARCH_MAX_DEPTH = 2;

router.use(verifyToken);

// --- Helpers -----------------------------------------------------------------

interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'dir';
  children?: FileEntry[];
  size?: number;
  modified?: number;
}

interface FlatFileEntry {
  path: string;
  type: 'file' | 'dir';
  size: number;
  modified: number;
}

async function execCommand(userId: string, command: string[]): Promise<string> {
  const podManager = sessionManager.getPodManager();
  await podManager.ensurePod(userId);
  const exec = await podManager.execInPod(userId, command);

  return new Promise((resolveOutput, reject) => {
    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    let settled = false;

    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      exec.close();
      if (err) {
        reject(err);
        return;
      }
      const output = Buffer.concat(chunks).toString();
      const errOutput = Buffer.concat(errChunks).toString().trim();
      if (errOutput) console.error(`exec stderr for user ${userId}: ${errOutput}`);
      resolveOutput(output);
    };

    exec.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    exec.stderr.on('data', (chunk: Buffer) => errChunks.push(chunk));
    exec.stdout.on('end', () => finish());
    exec.stderr.on('end', () => finish());
    exec.stdout.on('error', (err) => finish(err instanceof Error ? err : new Error(String(err))));
    exec.stderr.on('error', (err) => finish(err instanceof Error ? err : new Error(String(err))));

    setTimeout(() => finish(new Error('Exec timed out')), 30_000);
  });
}

function sanitizePath(path: string): string {
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    decoded = path;
  }
  return decoded.replace(/\0/g, '').replace(/^\/+/, '');
}

function getUserHomeRoot(userId: string): string {
  const podManager = sessionManager.getPodManager() as { getUserHomeHostPath?: (userId: string) => string };
  if (typeof podManager.getUserHomeHostPath === 'function') {
    return podManager.getUserHomeHostPath(userId);
  }
  if (CONFIG.nodeEnv === 'test') {
    return resolve(CONFIG.workspaceRoot, userId);
  }
  throw new Error('PodManager does not expose a host user-home path');
}

function resolveUserPath(userId: string, path: string): { root: string; absolutePath: string; relativePath: string } {
  const root = resolve(getUserHomeRoot(userId));
  const sanitized = sanitizePath(path);
  if (!sanitized) {
    throw new Error('Invalid path');
  }

  const absolutePath = resolve(root, sanitized);
  if (absolutePath !== root && !absolutePath.startsWith(`${root}${sep}`)) {
    throw new Error('Invalid path');
  }

  return {
    root,
    absolutePath,
    relativePath: relative(root, absolutePath),
  };
}

async function ensureUserHome(userId: string): Promise<string> {
  const root = getUserHomeRoot(userId);
  await fs.mkdir(root, { recursive: true });
  return root;
}

async function writeUserFile(userId: string, path: string, content: Buffer): Promise<void> {
  const { absolutePath } = resolveUserPath(userId, path);
  await fs.mkdir(dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, content);
}

async function collectWorkspaceEntries(
  root: string,
  options: { search?: string; maxDepth?: number; limit?: number } = {}
): Promise<FlatFileEntry[]> {
  await fs.mkdir(root, { recursive: true });

  const results: FlatFileEntry[] = [];
  const searchTerm = options.search?.toLowerCase();
  const maxDepth = options.maxDepth ?? Number.POSITIVE_INFINITY;
  const limit = options.limit ?? Number.POSITIVE_INFINITY;

  const walk = async (currentRelativePath = ''): Promise<boolean> => {
    const currentAbsolutePath = currentRelativePath ? resolve(root, currentRelativePath) : root;
    const entries = await fs.readdir(currentAbsolutePath, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (entry.name.startsWith('.')) {
        continue;
      }

      const entryRelativePath = currentRelativePath ? `${currentRelativePath}/${entry.name}` : entry.name;
      const entryAbsolutePath = resolve(root, entryRelativePath);
      const stats = await fs.stat(entryAbsolutePath);
      const matchesSearch = !searchTerm || entry.name.toLowerCase().includes(searchTerm);

      if (matchesSearch) {
        results.push({
          path: entryRelativePath,
          type: entry.isDirectory() ? 'dir' : 'file',
          size: stats.size,
          modified: stats.mtimeMs,
        });

        if (results.length >= limit) {
          return true;
        }
      }

      const entryDepth = entryRelativePath.split('/').length;
      if (entry.isDirectory() && entryDepth < maxDepth) {
        const shouldStop = await walk(entryRelativePath);
        if (shouldStop) {
          return true;
        }
      }
    }

    return false;
  };

  await walk();
  return results;
}

function buildTree(flat: FlatFileEntry[]): FileEntry[] {
  const root: FileEntry[] = [];
  const index: Map<string, FileEntry> = new Map();

  function ensureAncestors(path: string): FileEntry | null {
    const parts = path.split('/').filter(Boolean);
    let children: FileEntry[] = root;
    let currentPath = '';

    for (let i = 0; i < parts.length - 1; i++) {
      currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i];
      const existing = index.get(currentPath);
      if (existing) {
        children = existing.children!;
        continue;
      }
      const dir: FileEntry = {
        name: parts[i],
        path: currentPath,
        type: 'dir',
        children: [],
      };
      index.set(currentPath, dir);
      children.push(dir);
      children = dir.children!;
    }

    return parts.length > 1 ? index.get(parts.slice(0, -1).join('/')) ?? null : null;
  }

  for (const entry of flat) {
    const parts = entry.path.split('/').filter(Boolean);
    const name = parts[parts.length - 1];

    const fileEntry: FileEntry = {
      name,
      path: entry.path,
      type: entry.type,
      size: entry.size,
      modified: entry.modified,
      children: entry.type === 'dir' ? [] : undefined,
    };

    index.set(entry.path, fileEntry);

    if (parts.length === 1) {
      root.push(fileEntry);
    } else {
      const parent = ensureAncestors(entry.path);
      if (parent?.children) {
        parent.children.push(fileEntry);
      } else {
        root.push(fileEntry);
      }
    }
  }

  const sort = (entries: FileEntry[]) => {
    entries.sort((a, b) => {
      if (a.type === 'dir' && b.type === 'file') return -1;
      if (a.type === 'file' && b.type === 'dir') return 1;
      return a.name.localeCompare(b.name);
    });
    for (const entry of entries) {
      if (entry.children) sort(entry.children);
    }
  };

  sort(root);
  return root;
}

function invalidPathResponse(res: Response): void {
  res.status(400).json({ error: 'Invalid path' });
}

// --- Route 1: GET / -- List workspace files as a tree ------------------------

router.get('/', async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const search = typeof req.query.search === 'string' ? req.query.search : undefined;

  try {
    const userHome = await ensureUserHome(req.user.id);
    const flat = await collectWorkspaceEntries(userHome, search
      ? { search, maxDepth: SEARCH_MAX_DEPTH, limit: SEARCH_LIMIT }
      : undefined);

    res.json({ entries: buildTree(flat) });
  } catch (err) {
    console.error('Error listing files:', err);
    res.json({ entries: [] });
  }
});

// --- Route 2: POST /upload ---------------------------------------------------

router.post('/upload', async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { filename, content } = req.body as { filename?: string; content?: string };

  if (!filename || !content) {
    res.status(400).json({ error: 'filename and content are required' });
    return;
  }

  const safeName = filename.replace(/[^a-zA-Z0-9._/-]/g, '_').replace(/\/+/g, '/');
  if (safeName.startsWith('.') || safeName.includes('..')) {
    res.status(400).json({ error: 'Invalid filename' });
    return;
  }

  try {
    const fileBuffer = Buffer.from(content, 'base64');
    await writeUserFile(req.user.id, safeName, fileBuffer);

    res.status(201).json({ ok: true, name: safeName.split('/').pop() ?? safeName, path: safeName, size: fileBuffer.length });
  } catch (err) {
    if (err instanceof Error && err.message === 'Invalid path') {
      invalidPathResponse(res);
      return;
    }
    console.error('Error uploading file:', err);
    res.status(500).json({ error: 'Failed to upload file' });
  }
});

// --- Route 3: POST /move -----------------------------------------------------

router.post('/move', async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { from, to } = req.body as { from?: string; to?: string };

  if (!from || !to) {
    res.status(400).json({ error: 'from and to are required' });
    return;
  }

  let safeFrom: string;
  let safeTo: string;
  try {
    safeFrom = resolveUserPath(req.user.id, from).relativePath;
    safeTo = resolveUserPath(req.user.id, to).relativePath;
  } catch {
    invalidPathResponse(res);
    return;
  }

  if (!safeFrom || !safeTo || safeFrom === safeTo) {
    res.status(400).json({ error: 'Invalid from or to path' });
    return;
  }

  try {
    const destDir = safeTo.split('/').slice(0, -1).join('/');
    if (destDir) {
      await execCommand(req.user.id, ['mkdir', '-p', `/home/node/${destDir}`]);
    }

    await execCommand(req.user.id, ['mv', `/home/node/${safeFrom}`, `/home/node/${safeTo}`]);
    res.json({ ok: true, from: safeFrom, to: safeTo });
  } catch (err) {
    console.error('Error moving file:', err);
    res.status(500).json({ error: 'Failed to move file' });
  }
});

// --- Route 3.5: POST /mkdir -- Create a directory ---------------------------

router.post('/mkdir', async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { path: dirPath } = req.body as { path?: string };

  if (!dirPath) {
    res.status(400).json({ error: 'path is required' });
    return;
  }

  let safePath: string;
  try {
    safePath = resolveUserPath(req.user.id, dirPath).relativePath;
  } catch {
    invalidPathResponse(res);
    return;
  }

  if (!safePath || safePath.startsWith('.')) {
    res.status(400).json({ error: 'Invalid path' });
    return;
  }

  try {
    await execCommand(req.user.id, ['mkdir', '-p', `/home/node/${safePath}`]);
    res.json({ ok: true, path: safePath });
  } catch (err) {
    console.error('Error creating directory:', err);
    res.status(500).json({ error: 'Failed to create directory' });
  }
});

// --- Route 4: GET /<path>/raw -- Raw binary download -------------------------

router.get(/^\/(.+)\/raw$/, async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  let safePath: string;
  try {
    safePath = resolveUserPath(req.user.id, req.params[0] as string).relativePath;
  } catch {
    invalidPathResponse(res);
    return;
  }

  try {
    const podManager = sessionManager.getPodManager();
    await podManager.ensurePod(req.user.id);
    const exec = await podManager.execInPod(req.user.id, ['cat', `/home/node/${safePath}`]);

    const chunks: Buffer[] = [];
    exec.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));

    await new Promise<void>((resolvePromise) => {
      exec.stdout.on('end', () => { exec.close(); resolvePromise(); });
      setTimeout(() => { exec.close(); resolvePromise(); }, 30_000);
    });

    const buffer = Buffer.concat(chunks);
    const filename = safePath.split('/').pop() ?? safePath;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.status(200).end(buffer);
  } catch (err) {
    console.error('Error serving raw file:', err);
    res.status(404).json({ error: 'File not found' });
  }
});

// --- Route 5: GET /<path> -- Read file content -------------------------------

router.get(/^\/(.+)$/, async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  if (req.path.endsWith('/raw')) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  let safePath: string;
  try {
    safePath = resolveUserPath(req.user.id, req.params[0] as string).relativePath;
  } catch {
    invalidPathResponse(res);
    return;
  }

  try {
    const content = await execCommand(req.user.id, ['cat', `/home/node/${safePath}`]);
    res.json({ content });
  } catch (err) {
    console.error('Error reading file:', err);
    res.status(404).json({ error: 'File not found or could not be read' });
  }
});

// --- Route 6: PUT /<path> -- Create or update a file ------------------------

router.put(/^\/(.+)$/, async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  let safePath: string;
  try {
    safePath = resolveUserPath(req.user.id, req.params[0] as string).relativePath;
  } catch {
    invalidPathResponse(res);
    return;
  }

  const { content } = req.body as { content?: string };
  if (content === undefined) {
    res.status(400).json({ error: 'content is required' });
    return;
  }

  try {
    const fileBuffer = Buffer.from(content, 'utf8');
    await writeUserFile(req.user.id, safePath, fileBuffer);

    res.status(200).json({ ok: true, path: safePath, size: fileBuffer.length });
  } catch (err) {
    if (err instanceof Error && err.message === 'Invalid path') {
      invalidPathResponse(res);
      return;
    }
    console.error('Error writing file:', err);
    res.status(500).json({ error: 'Failed to write file' });
  }
});

// --- Route 7: DELETE /<path> -------------------------------------------------

router.delete(/^\/(.+)$/, async (req: AuthRequest, res: Response) => {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  let safePath: string;
  try {
    safePath = resolveUserPath(req.user.id, req.params[0] as string).relativePath;
  } catch {
    invalidPathResponse(res);
    return;
  }

  try {
    await execCommand(req.user.id, ['rm', '-rf', `/home/node/${safePath}`]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Error deleting file:', err);
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

export default router;
