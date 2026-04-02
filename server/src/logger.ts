/**
 * File logger — writes to DATA_DIR/logs/ so logs survive pod restarts.
 * With the hostPath bind-mount, these are readable directly from the host
 * at ./data/logs/ even after pods are deleted.
 *
 * Also mirrors to console so Tilt/kubectl logs still work.
 */

import { mkdirSync, appendFileSync } from 'fs';
import { resolve } from 'path';
import { CONFIG } from './config.js';

const logDir = resolve(CONFIG.dataDir, 'logs');
mkdirSync(logDir, { recursive: true });

function timestamp(): string {
  return new Date().toISOString();
}

function write(level: string, tag: string, message: string, data?: unknown) {
  const ts = timestamp();
  const line = data
    ? `[${ts}] [${level}] [${tag}] ${message} ${JSON.stringify(data, null, 2)}`
    : `[${ts}] [${level}] [${tag}] ${message}`;

  // File — append to daily log + tag-specific log
  const date = ts.slice(0, 10);
  try {
    appendFileSync(resolve(logDir, `${date}.log`), line + '\n');
    appendFileSync(resolve(logDir, `${tag}.log`), line + '\n');
  } catch {
    // Don't crash if logging fails
  }

  // Console
  if (level === 'ERROR') {
    console.error(`[${tag}]`, message, data ?? '');
  } else {
    console.log(`[${tag}]`, message, data ?? '');
  }
}

export const log = {
  info: (tag: string, message: string, data?: unknown) => write('INFO', tag, message, data),
  warn: (tag: string, message: string, data?: unknown) => write('WARN', tag, message, data),
  error: (tag: string, message: string, data?: unknown) => write('ERROR', tag, message, data),
};
