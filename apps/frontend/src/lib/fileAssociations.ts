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

function isImageBackground(value: unknown): value is ImageBackground {
  return value === 'checkered' || value === 'dark' || value === 'light';
}

function isImageFitMode(value: unknown): value is ImageFitMode {
  return value === 'contain' || value === 'actual';
}

function isPdfDefaultZoom(value: unknown): value is PdfDefaultZoom {
  return value === 50 || value === 75 || value === 100 || value === 125 || value === 150 || value === 200;
}

function isMonacoTabSize(value: unknown): value is 2 | 4 | 8 {
  return value === 2 || value === 4 || value === 8;
}

function clampFontSize(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_WORKSPACE_VIEWER_SETTINGS.monacoFontSize;
  return Math.min(24, Math.max(10, Math.round(numeric)));
}

export function normalizeWorkspaceViewerSettings(
  value?: Partial<WorkspaceViewerSettings>
): WorkspaceViewerSettings {
  const requestedImageExtensions = normalizeExtensions(
    value?.imageViewerExtensions ?? DEFAULT_WORKSPACE_VIEWER_SETTINGS.imageViewerExtensions
  );
  const requestedMonacoExtensions = normalizeExtensions(
    value?.monacoExtensions ?? DEFAULT_WORKSPACE_VIEWER_SETTINGS.monacoExtensions
  ).filter((extension) => !requestedImageExtensions.includes(extension));

  return {
    monacoExtensions: requestedMonacoExtensions,
    imageViewerExtensions: requestedImageExtensions,
    imageBackground: isImageBackground(value?.imageBackground)
      ? value.imageBackground
      : DEFAULT_WORKSPACE_VIEWER_SETTINGS.imageBackground,
    imageFitMode: isImageFitMode(value?.imageFitMode)
      ? value.imageFitMode
      : DEFAULT_WORKSPACE_VIEWER_SETTINGS.imageFitMode,
    pdfDefaultZoom: isPdfDefaultZoom(value?.pdfDefaultZoom)
      ? value.pdfDefaultZoom
      : DEFAULT_WORKSPACE_VIEWER_SETTINGS.pdfDefaultZoom,
    monacoFontSize: clampFontSize(value?.monacoFontSize),
    monacoTabSize: isMonacoTabSize(value?.monacoTabSize)
      ? value.monacoTabSize
      : DEFAULT_WORKSPACE_VIEWER_SETTINGS.monacoTabSize,
    monacoWordWrap: typeof value?.monacoWordWrap === 'boolean'
      ? value.monacoWordWrap
      : DEFAULT_WORKSPACE_VIEWER_SETTINGS.monacoWordWrap,
    monacoLineNumbers: typeof value?.monacoLineNumbers === 'boolean'
      ? value.monacoLineNumbers
      : DEFAULT_WORKSPACE_VIEWER_SETTINGS.monacoLineNumbers,
    monacoMinimap: typeof value?.monacoMinimap === 'boolean'
      ? value.monacoMinimap
      : DEFAULT_WORKSPACE_VIEWER_SETTINGS.monacoMinimap,
  };
}
