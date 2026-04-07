export type ImageBackground = 'checkered' | 'dark' | 'light';
export type ImageFitMode = 'contain' | 'actual';
export type PdfDefaultZoom = 50 | 75 | 100 | 125 | 150 | 200;

export interface WorkspaceViewerSettings {
  monacoExtensions: string[];
  imageViewerExtensions: string[];
  imageBackground: ImageBackground;
  imageFitMode: ImageFitMode;
  pdfDefaultZoom: PdfDefaultZoom;
  monacoFontSize: number;
  monacoTabSize: 2 | 4 | 8;
  monacoWordWrap: boolean;
  monacoLineNumbers: boolean;
  monacoMinimap: boolean;
}

export const DEFAULT_MONACO_EXTENSIONS = [
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
  'json', 'jsonc', 'css', 'scss', 'less', 'html', 'htm', 'xml',
  'py', 'rs', 'go', 'java', 'kt', 'kts',
  'c', 'h', 'cpp', 'hpp', 'cc', 'cs', 'rb', 'php',
  'sh', 'bash', 'zsh', 'fish',
  'yaml', 'yml', 'toml', 'ini', 'cfg',
  'sql', 'lua', 'swift', 'r', 'graphql', 'gql',
  'txt', 'log', 'csv', 'in', 'out', 'env',
];

export const DEFAULT_IMAGE_EXTENSIONS = [
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'tif', 'tiff', 'avif',
];

export const DEFAULT_WORKSPACE_VIEWER_SETTINGS: WorkspaceViewerSettings = {
  monacoExtensions: DEFAULT_MONACO_EXTENSIONS,
  imageViewerExtensions: DEFAULT_IMAGE_EXTENSIONS,
  imageBackground: 'checkered',
  imageFitMode: 'contain',
  pdfDefaultZoom: 100,
  monacoFontSize: 14,
  monacoTabSize: 4,
  monacoWordWrap: true,
  monacoLineNumbers: true,
  monacoMinimap: false,
};

export function normalizeExtension(value: string): string {
  return value.trim().toLowerCase().replace(/^\./, '');
}

export function normalizeExtensions(values: string[]): string[] {
  return Array.from(new Set(values.map(normalizeExtension).filter(Boolean)));
}

export function parseExtensionList(input: string): string[] {
  return normalizeExtensions(input.split(','));
}

export function formatExtensionList(values: string[]): string {
  return normalizeExtensions(values).join(', ');
}

export function getFileExtension(path: string): string {
  return path.split('.').pop()?.toLowerCase() ?? '';
}

export function matchesConfiguredExtension(path: string, extensions: string[]): boolean {
  const extension = getFileExtension(path);
  return normalizeExtensions(extensions).includes(extension);
}
