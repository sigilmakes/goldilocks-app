import { cp, mkdir, rm } from 'fs/promises';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const scriptDir = fileURLToPath(new URL('.', import.meta.url));
const packageDir = resolve(scriptDir, '..');
const sourceDir = resolve(packageDir, 'src', 'pod-tool-scripts');
const outputDir = resolve(packageDir, 'dist', 'pod-tool-scripts');

await rm(outputDir, { recursive: true, force: true });
await mkdir(resolve(packageDir, 'dist'), { recursive: true });
await cp(sourceDir, outputDir, { recursive: true });
