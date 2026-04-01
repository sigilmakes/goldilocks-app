import { resolve } from 'path';

/**
 * Validate that a requested path stays within the user's workspace base directory.
 *
 * Returns the resolved absolute path if valid. Throws if path traversal is detected.
 *
 * LIMITATION: This is a convention-based check, not a sandbox. A determined user
 * with agent access could still escape via symlinks or other mechanisms. Real
 * sandboxing requires containers (P6D).
 *
 * @param basePath - The absolute base workspace path for the user/conversation.
 * @param requestedPath - The path requested (may be relative).
 * @returns The resolved absolute path guaranteed to be within basePath.
 * @throws Error if the resolved path is outside basePath.
 */
export function validateWorkspacePath(basePath: string, requestedPath: string): string {
  const resolved = resolve(basePath, requestedPath);
  if (!resolved.startsWith(basePath)) {
    throw new Error('Path traversal detected');
  }
  return resolved;
}
