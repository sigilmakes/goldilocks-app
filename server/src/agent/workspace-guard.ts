import { resolve } from 'path';
import { realpathSync, existsSync } from 'fs';

/**
 * Validate that a requested path stays within the user's workspace base directory.
 *
 * Uses realpathSync to resolve symlinks before checking the prefix, preventing
 * symlink-based path traversal attacks (§4.6).
 *
 * LIMITATION: This prevents symlink escapes for files that exist, but a
 * determined user with agent access could still escape via other mechanisms.
 * Real sandboxing requires containers (P6D).
 *
 * @param basePath - The absolute base workspace path for the user/conversation.
 * @param requestedPath - The path requested (may be relative).
 * @returns The resolved absolute path guaranteed to be within basePath.
 * @throws Error if the resolved path is outside basePath.
 */
export function validateWorkspacePath(basePath: string, requestedPath: string): string {
  const resolved = resolve(basePath, requestedPath);

  // First check: resolved path must start with basePath (catches ../ traversal)
  if (!resolved.startsWith(basePath)) {
    throw new Error('Path traversal detected');
  }

  // Second check: if the file exists, resolve symlinks and verify again
  if (existsSync(resolved)) {
    const realPath = realpathSync(resolved);
    const realBase = realpathSync(basePath);
    if (!realPath.startsWith(realBase)) {
      throw new Error('Symlink path traversal detected');
    }
  }

  return resolved;
}
