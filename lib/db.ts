import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

function getHomeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || require('os').homedir();
}

const DB_PATH = process.env.NODE_ENV === 'production'
  ? path.join(getHomeDir(), '.longcut', 'longcut.db')
  : path.join(process.cwd(), 'data', 'longcut.db');

function createDatabase(): Database.Database {
  // Ensure data directory exists
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(DB_PATH);

  // Enable WAL mode and foreign keys
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Initialize schema
  db.exec(`
    CREATE TABLE IF NOT EXISTS video_analyses (
      id TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
      youtube_id TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      author TEXT,
      thumbnail_url TEXT,
      duration INTEGER DEFAULT 0,
      transcript TEXT,
      topics TEXT,
      summary TEXT,
      suggested_questions TEXT,
      model_used TEXT,
      language TEXT,
      available_languages TEXT,
      slug TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
      video_id TEXT NOT NULL REFERENCES video_analyses(id) ON DELETE CASCADE,
      source TEXT NOT NULL,
      source_id TEXT,
      note_text TEXT NOT NULL,
      metadata TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS videos_metadata (
      id TEXT PRIMARY KEY DEFAULT (hex(randomblob(16))),
      youtube_id TEXT NOT NULL UNIQUE,
      video_analysis_id TEXT REFERENCES video_analyses(id) ON DELETE SET NULL,
      accessed_at TEXT DEFAULT (datetime('now')),
      is_favorite INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_notes_video_id ON notes(video_id);
    CREATE INDEX IF NOT EXISTS idx_videos_metadata_youtube_id ON videos_metadata(youtube_id);
    CREATE INDEX IF NOT EXISTS idx_video_analyses_youtube_id ON video_analyses(youtube_id);
  `);

  return db;
}

// Cache the database connection in globalThis to prevent multiple connections during hot reload
const globalForDb = globalThis as unknown as { __db?: Database.Database };

export function getDb(): Database.Database {
  if (!globalForDb.__db) {
    globalForDb.__db = createDatabase();
  }
  return globalForDb.__db;
}
