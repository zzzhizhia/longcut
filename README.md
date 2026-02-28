# LongCut

> **Fork Notice** — This repository is forked from [SamuelZ12/longcut](https://github.com/SamuelZ12/longcut) with the following major changes:
>
> - **Database**: Supabase (PostgreSQL) → local SQLite (better-sqlite3, WAL mode)
> - **Auth**: Removed Supabase Auth, CSRF, and rate limiting — now a single-user, no-auth setup
> - **Payments**: Removed Stripe subscriptions/payments and all related pages (pricing, settings, unsubscribe)
> - **AI Providers**: Added Claude adapter (via Agent SDK); Gemini 2.5 Flash recommended for best speed; custom Base URL supported
> - **Dependencies**: Removed @supabase/\*, stripe, postmark; added better-sqlite3
>
> Upstream updates are tracked via the `upstream-main` branch and can be cherry-picked as needed.

LongCut turns long-form YouTube videos into a structured learning workspace. Paste a URL and the app generates highlight reels, timestamped AI answers, and a place to capture your own notes so you can absorb an hour-long video in minutes.

## Overview

The project is a Next.js 15 + React 19 application that wraps AI providers (Gemini / Claude / Grok) and Supadata transcripts with a polished UX. Data is stored locally in SQLite. The experience is optimized for fast iteration using Turbopack, Tailwind CSS v4, and shadcn/ui components.

## Feature Highlights

- AI highlight reels with Smart (quality) and Fast (speed) generation modes, Play All playback, and theme-based re-generation.
- AI-powered quick preview, structured summary, suggested questions, and memorable quotes surfaced in parallel.
- AI chat grounded in the transcript with structured JSON responses, timestamp citations, and fallbacks when the provider rate-limits.
- Transcript viewer that stays in sync with the YouTube player; click any sentence to jump or capture the quote.
- Transcript translation selector supporting 10+ languages via AI-powered LLM translation.
- Personal notes workspace with transcript, chat, and takeaway sources plus an `/all-notes` dashboard for cross-video review.
- Video library with favorites, search, and quick resume at `/my-videos`.
- Aggressive caching of previous analyses and background refresh tasks.

## Architecture

- Frontend stack: Next.js 15 App Router, React 19, TypeScript, Tailwind CSS v4, shadcn/ui, lucide-react, sonner toasts.
- Backend runtime: Next.js route handlers with Zod input validation.
- AI pipeline: `lib/ai-processing.ts` orchestrates provider-agnostic prompts, structured output schemas, fallback handling, and transcript chunking via `lib/ai-providers/`.
- AI providers: Gemini (recommended), Claude (via Agent SDK), Grok — with automatic model cascade and cross-provider fallback (`lib/ai-providers/registry.ts`).
- Transcript & metadata: Supadata API delivers transcripts; lightweight YouTube oEmbed calls pull thumbnails and titles.
- Persistence: Local SQLite database (`data/longcut.db`) stores `video_analyses`, `notes`, and `videos_metadata`.

## Application Pages

- `/` – Landing page with URL input and mode selector.
- `/analyze/[videoId]` – Primary workspace: YouTube player, highlight reels, theme selector, summary/chat/transcript/notes tabs, and suggestions.
- `/my-videos` – Video library with search, favorites, and quick resume.
- `/all-notes` – Notebook aggregating notes across videos with filtering, sorting, markdown rendering, and deletion.

## API Surface

- Video ingestion: `/api/video-info`, `/api/transcript`, `/api/check-video-cache`, `/api/video-analysis`, `/api/update-video-analysis`.
- AI generation: `/api/generate-topics`, `/api/generate-summary`, `/api/quick-preview`, `/api/suggested-questions`, `/api/top-quotes`.
- Conversational: `/api/chat` (provider-agnostic chat with citations).
- Translation: `/api/translate` (LLM-powered batch translation).
- User data: `/api/notes`, `/api/notes/all`, `/api/notes/enhance`, `/api/toggle-favorite`, `/api/random-video`.
- Image generation: `/api/generate-image` (Gemini image model).

## Directory Layout

```
.
├── app/
│   ├── api/                    # Route handlers for AI, caching, notes, etc.
│   ├── analyze/[videoId]/      # Client page for the analysis workspace
│   ├── all-notes/              # Notes dashboard (client component)
│   ├── my-videos/              # Saved video list + favorites
│   ├── v/[slug]/               # SEO-friendly video page
│   ├── layout.tsx              # Root layout with theme provider
│   └── page.tsx                # Landing page
├── components/
│   ├── ai-chat.tsx             # Transcript-aware chat UI
│   ├── highlights-panel.tsx    # Highlight reel cards + controls
│   ├── notes-panel.tsx         # Note capture + listing
│   ├── right-column-tabs.tsx   # Chat / Transcript / Notes tabs
│   ├── language-selector.tsx   # Transcript translation language picker
│   ├── youtube-player.tsx      # Player wrapper with shared playback state
│   └── ui/                     # Reusable shadcn/ui primitives
├── data/                       # SQLite database (auto-created, gitignored)
├── lib/
│   ├── ai-processing.ts        # Prompt building, transcript chunking, candidate pooling
│   ├── ai-providers/           # Gemini, Claude & Grok adapters + registry
│   ├── db.ts                   # SQLite singleton (better-sqlite3, WAL mode)
│   ├── db-queries.ts           # Database query functions
│   ├── notes-client.ts         # Client-side note helpers
│   ├── translation/            # LLM-powered translation client + hooks
│   ├── validation.ts           # Zod schemas shared across endpoints
│   └── utils.ts                # URL parsing, formatting, color helpers, etc.
├── public/                     # Static assets (logos, SVGs)
├── .env.example                # Environment variable reference
├── CLAUDE.md                   # Extended architecture + contributor handbook
└── next.config.ts              # Remote image allowlist, Turbopack rules, webpack tweaks
```

## Local Development

### Prerequisites

- Node.js 18+ (Next.js 15 requires 18.18 or newer)
- `pnpm` (recommended) or `npm`
- API keys for Supadata and at least one AI provider (Gemini recommended)

### 1. Clone & Install

```bash
git clone https://github.com/zzzhizhia/longcut.git
cd longcut
pnpm install
```

### 2. Configure Environment

Copy `.env.example` to `.env.local` and fill in the required values:

```bash
cp .env.example .env.local
```

| Variable | Required | Description |
| --- | --- | --- |
| `AI_PROVIDER` | yes | `gemini` (recommended) / `claude` / `grok` |
| `GEMINI_API_KEY` | yes* | Google Gemini API key |
| `GEMINI_BASE_URL` | optional | Custom Gemini API endpoint (for proxies) |
| `GEMINI_IMAGE_MODEL` | optional | Override image generation model |
| `ANTHROPIC_API_KEY` | optional* | Anthropic API key (or leave empty for local Claude Code auth) |
| `XAI_API_KEY` | optional* | xAI Grok API key |
| `XAI_API_BASE_URL` | optional | Custom Grok API endpoint |
| `SUPADATA_API_KEY` | yes | Supadata transcript API key ([supadata.ai](https://supadata.ai)) |
| `NEXT_PUBLIC_ENABLE_TRANSLATION_SELECTOR` | optional | `true` to show transcript translation dropdown |
| `NEXT_PUBLIC_APP_URL` | optional | Canonical app URL (for sitemap/SEO) |

<sup>\*</sup> At least one provider key must be present, matching your `AI_PROVIDER` choice.

### 3. Run the App

```bash
pnpm dev           # starts Next.js with Turbopack on http://localhost:3000
pnpm lint          # optional: run lint checks (ESLint v9)
```

The SQLite database (`data/longcut.db`) is created automatically on first run. No database setup required.

## Syncing with Upstream

```bash
git fetch upstream
git checkout upstream-main && git pull
git checkout main
git merge upstream-main   # or cherry-pick specific commits
```

## Developer Notes

- Topic generation mode (`smart` vs `fast`) is persisted in localStorage and synced via `useModePreference`.
- All AI calls go through `lib/ai-providers/registry.ts` which handles provider selection, model cascade, and cross-provider fallback.
- Detailed architecture notes, prompts, and database schema live in `CLAUDE.md`; review it before larger changes.

## License

Distributed under the [GNU Affero General Public License v3.0](LICENSE).
