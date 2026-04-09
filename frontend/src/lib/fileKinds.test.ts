import { describe, it, expect } from 'vitest';
import {
  resolveFileKind,
  getFileIconKind,
  getMonacoLanguage,
  isStructurePath,
  getPathDisplayName,
} from './fileKinds';

// Note: getFileExtension (from fileAssociations.ts) does path.split('.').pop()?.toLowerCase()
// This means:
//   'Makefile' → 'makefile' (the whole string, no dot separator)
//   '.env'     → 'env'      (after the dot)
//   'log.1'    → '1'
//   'POSCAR'   → 'poscar'   (the whole string, lowercased)

describe('resolveFileKind', () => {
  it('resolves CIF/POSCAR/VASP/XYZ/PDB as structure', () => {
    expect(resolveFileKind('structure.cif', [], [])).toMatchObject({ kind: 'structure', preferredViewer: 'structure' });
    expect(resolveFileKind('POSCAR', [], [])).toMatchObject({ kind: 'structure', preferredViewer: 'structure' });
    expect(resolveFileKind('input.vasp', [], [])).toMatchObject({ kind: 'structure', preferredViewer: 'structure' });
    expect(resolveFileKind('molecule.xyz', [], [])).toMatchObject({ kind: 'structure', preferredViewer: 'structure' });
    expect(resolveFileKind('protein.pdb', [], [])).toMatchObject({ kind: 'structure', preferredViewer: 'structure' });
  });

  it('resolves PDF as pdf', () => {
    expect(resolveFileKind('doc.pdf', [], [])).toMatchObject({ kind: 'pdf', preferredViewer: 'pdf' });
  });

  it('resolves Markdown as markdown with milkdown viewer', () => {
    expect(resolveFileKind('README.md', [], [])).toMatchObject({ kind: 'markdown', preferredViewer: 'milkdown', monacoLanguage: 'markdown' });
  });

  it('resolves user-configured image extensions', () => {
    // 'rs' is not a builtin image ext, but user configured it as one
    const result = resolveFileKind('foo.rs', [], ['rs']);
    expect(result).toMatchObject({ kind: 'image', preferredViewer: 'image' });
  });

  it('resolves user-configured monaco extensions', () => {
    // 'foo' is not a builtin monaco ext, but user configured it as one
    const result = resolveFileKind('build.foo', ['foo'], []);
    expect(result).toMatchObject({ kind: 'text', preferredViewer: 'monaco' });
  });

  it('resolves builtin image extensions regardless of user config', () => {
    const result = resolveFileKind('photo.png', [], []);
    expect(result).toMatchObject({ kind: 'image', preferredViewer: 'image', icon: 'image' });
  });

  it('falls back to monaco for known code extensions when no user config', () => {
    expect(resolveFileKind('script.py', [], [])).toMatchObject({ kind: 'text', preferredViewer: 'monaco', monacoLanguage: 'python' });
    expect(resolveFileKind('app.tsx', [], [])).toMatchObject({ kind: 'text', preferredViewer: 'monaco', monacoLanguage: 'typescript' });
    expect(resolveFileKind('config.json', [], [])).toMatchObject({ kind: 'text', preferredViewer: 'monaco', monacoLanguage: 'json' });
  });

  it('resolves unknown extensions as binary', () => {
    expect(resolveFileKind('weird.xyz123', [], [])).toMatchObject({ kind: 'binary', preferredViewer: 'none', icon: 'file' });
  });
});

describe('getFileIconKind', () => {
  it('returns directory for directories', () => {
    expect(getFileIconKind('src', true)).toBe('directory');
  });

  it('returns structure for structure extensions', () => {
    expect(getFileIconKind('file.cif', false)).toBe('structure');
    expect(getFileIconKind('POSCAR', false)).toBe('structure');
  });

  it('returns image for builtin image extensions', () => {
    expect(getFileIconKind('photo.png', false)).toBe('image');
    expect(getFileIconKind('photo.jpg', false)).toBe('image');
  });

  it('returns pdf for PDF files', () => {
    expect(getFileIconKind('doc.pdf', false)).toBe('pdf');
  });

  it('returns code for known code extensions', () => {
    // Extensions in CODE_ICON_EXTENSIONS (ts, py, rs, etc.)
    expect(getFileIconKind('app.ts', false)).toBe('code');
    expect(getFileIconKind('app.py', false)).toBe('code');
    expect(getFileIconKind('main.rs', false)).toBe('code');
    // csv, env, txt are in CODE_ICON_EXTENSIONS
    expect(getFileIconKind('data.csv', false)).toBe('code');
    expect(getFileIconKind('.env', false)).toBe('code');
  });

  it('returns file for unknown extensions', () => {
    // 'Makefile' → ext='makefile' → not in CODE_ICON_EXTENSIONS → 'file'
    expect(getFileIconKind('Makefile', false)).toBe('file');
    // 'log.1' → ext='1' → not in CODE_ICON_EXTENSIONS → 'file'
    expect(getFileIconKind('log.1', false)).toBe('file');
    // 'readme' → ext='readme' → not in CODE_ICON_EXTENSIONS → 'file'
    expect(getFileIconKind('readme', false)).toBe('file');
  });
});

describe('getMonacoLanguage', () => {
  it('maps known extensions to Monaco language IDs', () => {
    expect(getMonacoLanguage('app.ts')).toBe('typescript');
    expect(getMonacoLanguage('app.js')).toBe('javascript');
    expect(getMonacoLanguage('style.css')).toBe('css');
    expect(getMonacoLanguage('style.scss')).toBe('scss');
    expect(getMonacoLanguage('app.json')).toBe('json');
    expect(getMonacoLanguage('index.html')).toBe('html');
    expect(getMonacoLanguage('script.py')).toBe('python');
    expect(getMonacoLanguage('config.yaml')).toBe('yaml');
    expect(getMonacoLanguage('main.rs')).toBe('rust');
    expect(getMonacoLanguage('app.go')).toBe('go');
    expect(getMonacoLanguage('README.md')).toBe('markdown');
  });

  it('returns plaintext for unknown extensions', () => {
    expect(getMonacoLanguage('file.xyz123')).toBe('plaintext');
    expect(getMonacoLanguage('Makefile')).toBe('plaintext');
  });
});

describe('isStructurePath', () => {
  it('returns true for CIF, POSCAR, VASP, XYZ, PDB', () => {
    expect(isStructurePath('file.cif')).toBe(true);
    expect(isStructurePath('POSCAR')).toBe(true);
    expect(isStructurePath('input.vasp')).toBe(true);
    expect(isStructurePath('molecule.xyz')).toBe(true);
    expect(isStructurePath('model.pdb')).toBe(true);
  });

  it('returns false for non-structure files', () => {
    expect(isStructurePath('README.md')).toBe(false);
    expect(isStructurePath('script.py')).toBe(false);
    expect(isStructurePath('photo.png')).toBe(false);
  });

  it('handles paths with directories', () => {
    // getFileExtension('workspace/structures/input.cif') = 'cif'
    expect(isStructurePath('workspace/structures/input.cif')).toBe(true);
    // Leading ./ is NOT handled by getFileExtension — the whole
    // './relative/POSCAR' becomes the "extension" after split('.').pop()
    // which is './relative/POSCAR'.toLowerCase() = './relative/poscar',
    // not a recognized structure extension.
    expect(isStructurePath('./relative/POSCAR')).toBe(false);
  });
});

describe('getPathDisplayName', () => {
  it('returns the last path segment', () => {
    expect(getPathDisplayName('src/components/Button.tsx')).toBe('Button.tsx');
    expect(getPathDisplayName('README.md')).toBe('README.md');
  });

  it('returns empty string for trailing slash', () => {
    expect(getPathDisplayName('workspace/')).toBe('');
  });

  it('returns the full path if no separators', () => {
    expect(getPathDisplayName('POSCAR')).toBe('POSCAR');
  });
});