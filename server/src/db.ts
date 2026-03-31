import Database from 'better-sqlite3';
import { mkdirSync, existsSync, readdirSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { CONFIG } from './config.js';

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    // Ensure data directory exists
    const dbDir = dirname(CONFIG.dbPath);
    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true });
    }
    
    db = new Database(CONFIG.dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

export function runMigrations(): void {
  const database = getDb();
  
  // Create migrations tracking table
  database.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    )
  `);
  
  // Get applied migrations
  const applied = new Set(
    database.prepare('SELECT name FROM migrations').all()
      .map((row: any) => row.name)
  );
  
  // Find migration files
  const migrationsDir = resolve(dirname(new URL(import.meta.url).pathname), 'migrations');
  
  if (!existsSync(migrationsDir)) {
    console.log('No migrations directory found, skipping migrations');
    return;
  }
  
  const files = readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();
  
  // Run pending migrations
  for (const file of files) {
    if (applied.has(file)) continue;
    
    console.log(`Running migration: ${file}`);
    const sql = readFileSync(join(migrationsDir, file), 'utf-8');
    
    database.transaction(() => {
      database.exec(sql);
      database.prepare('INSERT INTO migrations (name) VALUES (?)').run(file);
    })();
    
    console.log(`  ✓ Applied ${file}`);
  }
}
