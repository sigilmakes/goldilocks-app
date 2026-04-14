/**
 * Centralized file-kind registry — single source of truth for
 * how a path maps to a viewer, icon, and language.
 */

import { getFileExtension } from './fileAssociations';

// -- Canonical file kinds -----------------------------------------------------

export type FileKind =
  | 'structure'
  | 'markdown'
  | 'image'
  | 'pdf'
  | 'text'
  | 'binary';

export type ViewerKind =
  | 'structure'
  | 'milkdown'
  | 'monaco'
  | 'pdf'
  | 'image'
  | 'none';

export type FileIconKind = 'structure' | 'image' | 'code' | 'pdf' | 'file' | 'directory';

export interface ResolvedFileKind {
  kind: FileKind;
  preferredViewer: ViewerKind;
  icon: FileIconKind;
  monacoLanguage?: string;
}

// -- Extension sets ------------------------------------------------------------

const STRUCTURE_EXTENSIONS = new Set(['cif', 'poscar', 'vasp', 'xyz', 'pdb']);

const MONACO_LANGUAGE_MAP: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  json: 'json', jsonc: 'json',
  css: 'css', scss: 'scss', less: 'less',
  html: 'html', htm: 'html', xml: 'xml', svg: 'xml',
  py: 'python',
  rs: 'rust', go: 'go',
  java: 'java', kt: 'kotlin', kts: 'kotlin',
  c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp', cc: 'cpp',
  cs: 'csharp', rb: 'ruby', php: 'php',
  sh: 'shell', bash: 'shell', zsh: 'shell', fish: 'shell',
  yaml: 'yaml', yml: 'yaml',
  toml: 'ini', ini: 'ini', cfg: 'ini',
  sql: 'sql', lua: 'lua', swift: 'swift', r: 'r',
  graphql: 'graphql', gql: 'graphql',
  md: 'markdown',
};

const IMAGE_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'tif', 'tiff', 'avif',
]);

// Icon classification — broader than the Monaco language map so that
// files like .rs, .go, .c, .cpp, .rb, .sql, .lua, .swift etc.
// get a code icon even if the user hasn't configured them in Monaco.
const CODE_ICON_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
  'py', 'rs', 'go', 'java', 'kt', 'kts',
  'c', 'h', 'cpp', 'hpp', 'cc', 'cs', 'rb', 'php',
  'sh', 'bash', 'zsh', 'fish',
  'json', 'jsonc', 'yaml', 'yml', 'toml', 'ini', 'cfg',
  'sql', 'lua', 'swift', 'r', 'graphql', 'gql',
  'css', 'scss', 'less', 'html', 'htm', 'xml', 'svg',
  'in', 'out', 'txt', 'log', 'csv', 'env',
  'md',
]);

// -- Resolver ------------------------------------------------------------------

/**
 * Resolve the canonical file kind for a given path, considering
 * the user's configured extension lists.
 */
export function resolveFileKind(
  path: string,
  monacoExtensions: string[] = [],
  imageExtensions: string[] = [],
): ResolvedFileKind {
  const ext = getFileExtension(path);

  // 1. Built-in structure files always take priority
  if (STRUCTURE_EXTENSIONS.has(ext)) {
    return { kind: 'structure', preferredViewer: 'structure', icon: 'structure' };
  }

  // 2. Built-in PDF
  if (ext === 'pdf') {
    return { kind: 'pdf', preferredViewer: 'pdf', icon: 'pdf' };
  }

  // 3. Built-in Markdown
  if (ext === 'md') {
    return { kind: 'markdown', preferredViewer: 'milkdown', icon: 'file', monacoLanguage: 'markdown' };
  }

  // 4. User-configured extensions (computed inline — no mutable cache)
  const imageSet = new Set(imageExtensions);
  const monacoSet = new Set(monacoExtensions);

  if (imageSet.has(ext)) {
    return { kind: 'image', preferredViewer: 'image', icon: 'image' };
  }

  if (monacoSet.has(ext)) {
    return {
      kind: 'text',
      preferredViewer: 'monaco',
      icon: 'code',
      monacoLanguage: MONACO_LANGUAGE_MAP[ext] ?? 'plaintext',
    };
  }

  // 5. Fallback: heuristic based on known extensions
  if (IMAGE_EXTENSIONS.has(ext)) {
    return { kind: 'image', preferredViewer: 'image', icon: 'image' };
  }

  if (ext in MONACO_LANGUAGE_MAP || CODE_ICON_EXTENSIONS.has(ext)) {
    return {
      kind: 'text',
      preferredViewer: 'monaco',
      icon: 'code',
      monacoLanguage: MONACO_LANGUAGE_MAP[ext] ?? 'plaintext',
    };
  }

  // 6. Unknown → binary
  return { kind: 'binary', preferredViewer: 'none', icon: 'file' };
}

// -- Re-export helpers for backward compat -------------------------------------

export { STRUCTURE_EXTENSIONS, MONACO_LANGUAGE_MAP };

/**
 * Quick check: is this path a structure file?
 */
export function isStructurePath(path: string): boolean {
  return STRUCTURE_EXTENSIONS.has(getFileExtension(path));
}

/**
 * Get display name from a path (last segment).
 */
export function getPathDisplayName(path: string): string {
  return path.split('/').pop() ?? path;
}

/**
 * Get the file-icon kind for a browser tree entry (does not depend on user settings).
 */
export function getFileIconKind(name: string, isDir: boolean): FileIconKind {
  if (isDir) return 'directory';
  const ext = getFileExtension(name);
  if (STRUCTURE_EXTENSIONS.has(ext)) return 'structure';
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (ext === 'pdf') return 'pdf';
  if (CODE_ICON_EXTENSIONS.has(ext)) return 'code';
  return 'file';
}

/**
 * Get the Monaco language for a path (used by MonacoEditor).
 */
export function getMonacoLanguage(path: string): string {
  const ext = getFileExtension(path);
  return MONACO_LANGUAGE_MAP[ext] ?? 'plaintext';
}