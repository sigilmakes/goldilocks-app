import { readFileSync, readdirSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../..');
const gatewayEntry = resolve(repoRoot, 'apps/gateway/src/index.ts');
const agentServiceEntry = resolve(repoRoot, 'apps/agent-service/src/index.ts');
const gatewaySourceRoot = resolve(repoRoot, 'apps/gateway/src');

function readGatewaySourceFiles(dir: string): string[] {
  const files: string[] = [];
  const entries = readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      continue;
    }
    if (entry.isDirectory()) {
      files.push(...readGatewaySourceFiles(fullPath));
      continue;
    }
    if (fullPath.endsWith('.ts')) {
      files.push(fullPath);
    }
  }

  return files;
}

describe('Wave 1 startup secret guards', () => {
  it('gateway validates required secrets at startup', () => {
    const source = readFileSync(gatewayEntry, 'utf8');
    expect(source).toContain('CONFIG.validateRequiredSecrets();');
  });

  it('agent-service validates required secrets at startup', () => {
    const source = readFileSync(agentServiceEntry, 'utf8');
    expect(source).toContain('CONFIG.validateRequiredSecrets();');
  });
});

describe('Wave 1 shell interpolation regression guard', () => {
  it('gateway source contains no sh -c command invocations', () => {
    const files = readGatewaySourceFiles(gatewaySourceRoot);
    const offenders: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      if (/['"]sh['"]\s*,\s*['"]-c['"]/.test(source)) {
        offenders.push(file.replace(`${repoRoot}/`, ''));
      }
    }

    expect(offenders).toEqual([]);
  });
});
