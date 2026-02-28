import { getDb } from './db';

// ─── Video Analyses ──────────────────────────────────────────

export interface VideoAnalysisRow {
  id: string;
  youtube_id: string;
  title: string;
  author: string | null;
  thumbnail_url: string | null;
  duration: number;
  transcript: string | null;
  topics: string | null;
  summary: string | null;
  suggested_questions: string | null;
  model_used: string | null;
  language: string | null;
  available_languages: string | null;
  slug: string | null;
  created_at: string;
  updated_at: string;
}

export function getVideoByYoutubeId(youtubeId: string): VideoAnalysisRow | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM video_analyses WHERE youtube_id = ?').get(youtubeId) as VideoAnalysisRow | undefined;
}

export function getVideoById(id: string): VideoAnalysisRow | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM video_analyses WHERE id = ?').get(id) as VideoAnalysisRow | undefined;
}

interface UpsertVideoInput {
  youtubeId: string;
  title: string;
  author?: string | null;
  duration?: number;
  thumbnailUrl?: string | null;
  transcript?: unknown;
  topics?: unknown;
  summary?: string | null;
  suggestedQuestions?: unknown;
  modelUsed?: string | null;
  language?: string | null;
  availableLanguages?: string[] | null;
  slug?: string | null;
}

export function upsertVideoAnalysis(input: UpsertVideoInput): { id: string } {
  const db = getDb();

  const existing = getVideoByYoutubeId(input.youtubeId);
  const now = new Date().toISOString();

  if (existing) {
    db.prepare(`
      UPDATE video_analyses SET
        title = ?,
        author = ?,
        duration = ?,
        thumbnail_url = ?,
        transcript = ?,
        topics = ?,
        summary = COALESCE(?, summary),
        suggested_questions = COALESCE(?, suggested_questions),
        model_used = COALESCE(?, model_used),
        language = COALESCE(?, language),
        available_languages = COALESCE(?, available_languages),
        slug = COALESCE(?, slug),
        updated_at = ?
      WHERE youtube_id = ?
    `).run(
      input.title,
      input.author ?? null,
      input.duration ?? 0,
      input.thumbnailUrl ?? null,
      input.transcript ? JSON.stringify(input.transcript) : existing.transcript,
      input.topics ? JSON.stringify(input.topics) : existing.topics,
      input.summary ?? null,
      input.suggestedQuestions ? JSON.stringify(input.suggestedQuestions) : null,
      input.modelUsed ?? null,
      input.language ?? null,
      input.availableLanguages ? JSON.stringify(input.availableLanguages) : null,
      input.slug ?? null,
      now,
      input.youtubeId
    );

    // Also track in videos_metadata
    db.prepare(`
      INSERT INTO videos_metadata (youtube_id, video_analysis_id, accessed_at)
      VALUES (?, ?, ?)
      ON CONFLICT(youtube_id) DO UPDATE SET
        video_analysis_id = excluded.video_analysis_id,
        accessed_at = excluded.accessed_at
    `).run(input.youtubeId, existing.id, now);

    return { id: existing.id };
  }

  const id = generateId();
  db.prepare(`
    INSERT INTO video_analyses (id, youtube_id, title, author, duration, thumbnail_url, transcript, topics, summary, suggested_questions, model_used, language, available_languages, slug, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.youtubeId,
    input.title,
    input.author ?? null,
    input.duration ?? 0,
    input.thumbnailUrl ?? null,
    input.transcript ? JSON.stringify(input.transcript) : null,
    input.topics ? JSON.stringify(input.topics) : null,
    input.summary ?? null,
    input.suggestedQuestions ? JSON.stringify(input.suggestedQuestions) : null,
    input.modelUsed ?? null,
    input.language ?? null,
    input.availableLanguages ? JSON.stringify(input.availableLanguages) : null,
    input.slug ?? null,
    now,
    now
  );

  // Track in videos_metadata
  db.prepare(`
    INSERT INTO videos_metadata (youtube_id, video_analysis_id, accessed_at)
    VALUES (?, ?, ?)
    ON CONFLICT(youtube_id) DO UPDATE SET
      video_analysis_id = excluded.video_analysis_id,
      accessed_at = excluded.accessed_at
  `).run(input.youtubeId, id, now);

  return { id };
}

export function updateVideoAnalysis(youtubeId: string, updates: {
  summary?: string | null;
  suggestedQuestions?: unknown;
}): { success: boolean; videoId: string | null } {
  const db = getDb();
  const existing = getVideoByYoutubeId(youtubeId);

  if (!existing) {
    return { success: false, videoId: null };
  }

  const setClauses: string[] = ['updated_at = ?'];
  const values: unknown[] = [new Date().toISOString()];

  if (updates.summary !== undefined) {
    setClauses.push('summary = ?');
    values.push(updates.summary);
  }
  if (updates.suggestedQuestions !== undefined) {
    setClauses.push('suggested_questions = ?');
    values.push(JSON.stringify(updates.suggestedQuestions));
  }

  values.push(youtubeId);

  db.prepare(`UPDATE video_analyses SET ${setClauses.join(', ')} WHERE youtube_id = ?`).run(...values);

  return { success: true, videoId: existing.id };
}

// ─── Notes ───────────────────────────────────────────────────

export interface NoteRow {
  id: string;
  video_id: string;
  source: string;
  source_id: string | null;
  note_text: string;
  metadata: string | null;
  created_at: string;
  updated_at: string;
}

function mapNote(row: NoteRow) {
  return {
    id: row.id,
    userId: 'local',
    videoId: row.video_id,
    source: row.source,
    sourceId: row.source_id,
    text: row.note_text,
    metadata: safeJsonParse(row.metadata, null),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getNotesByVideoId(videoId: string) {
  const db = getDb();
  const rows = db.prepare(
    'SELECT * FROM notes WHERE video_id = ? ORDER BY created_at DESC'
  ).all(videoId) as NoteRow[];
  return rows.map(mapNote);
}

export function getNotesByYoutubeId(youtubeId: string) {
  const video = getVideoByYoutubeId(youtubeId);
  if (!video) return [];
  return getNotesByVideoId(video.id);
}

export function createNote(input: {
  videoId?: string;
  youtubeId?: string;
  source: string;
  sourceId?: string | null;
  text: string;
  metadata?: unknown;
}) {
  const db = getDb();

  let targetVideoId = input.videoId;
  if (!targetVideoId && input.youtubeId) {
    const video = getVideoByYoutubeId(input.youtubeId);
    targetVideoId = video?.id;
  }

  if (!targetVideoId) {
    return null;
  }

  const id = generateId();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO notes (id, video_id, source, source_id, note_text, metadata, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    targetVideoId,
    input.source,
    input.sourceId ?? null,
    input.text,
    input.metadata ? JSON.stringify(input.metadata) : null,
    now,
    now
  );

  const row = db.prepare('SELECT * FROM notes WHERE id = ?').get(id) as NoteRow;
  return mapNote(row);
}

export function deleteNote(noteId: string): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM notes WHERE id = ?').run(noteId);
  return result.changes > 0;
}

export function getAllNotesWithVideo() {
  const db = getDb();
  const rows = db.prepare(`
    SELECT
      n.*,
      va.youtube_id,
      va.title as video_title,
      va.author as video_author,
      va.thumbnail_url as video_thumbnail,
      va.duration as video_duration,
      va.slug as video_slug
    FROM notes n
    LEFT JOIN video_analyses va ON n.video_id = va.id
    ORDER BY n.created_at DESC
  `).all() as (NoteRow & {
    youtube_id: string;
    video_title: string;
    video_author: string;
    video_thumbnail: string;
    video_duration: number;
    video_slug: string | null;
  })[];

  return rows.map(row => ({
    ...mapNote(row),
    video: row.youtube_id ? {
      youtubeId: row.youtube_id,
      title: row.video_title,
      author: row.video_author,
      thumbnailUrl: row.video_thumbnail,
      duration: row.video_duration,
      slug: row.video_slug,
    } : null,
  }));
}

// ─── Favorites & Videos Metadata ────────────────────────────

export function toggleFavorite(youtubeId: string, isFavorite: boolean): { success: boolean; isFavorite: boolean } {
  const db = getDb();

  const video = getVideoByYoutubeId(youtubeId);
  if (!video) {
    return { success: false, isFavorite: false };
  }

  db.prepare(`
    INSERT INTO videos_metadata (youtube_id, video_analysis_id, is_favorite, accessed_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(youtube_id) DO UPDATE SET
      is_favorite = excluded.is_favorite,
      accessed_at = datetime('now')
  `).run(youtubeId, video.id, isFavorite ? 1 : 0);

  return { success: true, isFavorite };
}

export function getAllUserVideos() {
  const db = getDb();
  const rows = db.prepare(`
    SELECT
      vm.*,
      va.youtube_id as va_youtube_id,
      va.title,
      va.author,
      va.thumbnail_url,
      va.duration,
      va.topics,
      va.summary,
      va.slug,
      va.created_at as va_created_at,
      va.updated_at as va_updated_at
    FROM videos_metadata vm
    LEFT JOIN video_analyses va ON vm.video_analysis_id = va.id
    WHERE va.topics IS NOT NULL
    ORDER BY vm.accessed_at DESC
  `).all() as any[];

  return rows.map(row => ({
    id: row.id,
    accessed_at: row.accessed_at,
    is_favorite: Boolean(row.is_favorite),
    video: {
      id: row.video_analysis_id,
      youtube_id: row.va_youtube_id,
      title: row.title,
      author: row.author,
      thumbnail_url: row.thumbnail_url,
      duration: row.duration,
      topics: safeJsonParse(row.topics, null),
      summary: row.summary,
      slug: row.slug,
      created_at: row.va_created_at,
      updated_at: row.va_updated_at,
    },
  }));
}

// ─── Random Video ────────────────────────────────────────────

export function getRandomVideo() {
  const db = getDb();
  const row = db.prepare(`
    SELECT youtube_id, title, author, duration, thumbnail_url, slug, language
    FROM video_analyses
    WHERE topics IS NOT NULL
    ORDER BY RANDOM()
    LIMIT 1
  `).get() as {
    youtube_id: string;
    title: string;
    author: string;
    duration: number;
    thumbnail_url: string;
    slug: string | null;
    language: string | null;
  } | undefined;

  return row ?? null;
}

// ─── Sitemap ─────────────────────────────────────────────────

export function getVideosForSitemap() {
  const db = getDb();
  return db.prepare(`
    SELECT slug, updated_at, youtube_id, title
    FROM video_analyses
    ORDER BY updated_at DESC
    LIMIT 50000
  `).all() as { slug: string | null; updated_at: string; youtube_id: string; title: string }[];
}

// ─── Helpers ─────────────────────────────────────────────────

function safeJsonParse<T = unknown>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    console.warn('[db-queries] Failed to parse JSON, using fallback:', value.slice(0, 100));
    return fallback;
  }
}

function generateId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Parse JSON fields from a video analysis row.
 * Returns typed objects instead of raw JSON strings.
 */
export function parseVideoRow(row: VideoAnalysisRow) {
  return {
    ...row,
    transcript: safeJsonParse(row.transcript, null),
    topics: safeJsonParse(row.topics, null),
    suggested_questions: safeJsonParse(row.suggested_questions, null),
    available_languages: safeJsonParse(row.available_languages, null),
  };
}
