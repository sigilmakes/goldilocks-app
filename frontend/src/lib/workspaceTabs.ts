const STRUCTURE_EXTENSIONS = new Set(['cif', 'poscar', 'vasp', 'xyz', 'pdb']);

export function getExtension(path: string): string {
  return path.split('.').pop()?.toLowerCase() ?? '';
}

export function isStructurePath(path: string): boolean {
  return STRUCTURE_EXTENSIONS.has(getExtension(path));
}

export function getPathDisplayName(path: string): string {
  return path.split('/').pop() ?? path;
}
