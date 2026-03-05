# Creator Pilot

Creator Pilot is a hackathon MVP that turns trending news + creator media into a YouTube-ready video pipeline:

News trends -> content ideas -> media selection -> FFmpeg render variants -> metadata/captions -> scheduling recommendation -> YouTube upload.

The app is intentionally local-first and monorepo-only for reliability and speed.

## Stack

- Frontend: Next.js (App Router), React, TypeScript, TailwindCSS
- Backend: Next.js Route Handlers (`/app/api/*`)
- Database: SQLite + Prisma
- AI: Gemini via OpenAI-compatible Chat Completions API
- Trend ingest: `rss-parser`
- Rendering: FFmpeg
- Publishing: Google OAuth + YouTube Data API v3 (`googleapis`)

## Features (MVP)

- Onboarding profile (`niche`, `tone`, `timezone`, RSS sources)
- Curated RSS defaults if user does not provide sources
- Trend detection from RSS feeds (up to 3 clusters via keyword overlap / Jaccard)
- Idea generation (3 ideas per selected trend)
- Media upload (`mp4`, `mov`, `png`, `jpg`) stored at `/uploads/{userId}/{jobId}`
- FFmpeg video render (intro card + captioned body + CTA outro) with 3 variants
- Auto format choice (`shorts` vs `landscape`) based on source orientation + duration, with user override
- Metadata generation (title, description, hashtags, 3 caption variants, tags)
- Scheduling recommendation (next weekday between 5-8pm local time)
- YouTube upload with:
  - real upload when OAuth is configured and mock mode disabled
  - full mock fallback when `YOUTUBE_UPLOAD_MOCK=true` or OAuth env vars are missing
- Job system (`queued`, `running`, `complete`, `failed`) with polling UI

## Project Structure

```text
app/
  onboarding/
  dashboard/
  jobs/[id]/
  api/
    profile/
    sources/
    trends/
    ideas/
    media/
    render/
    metadata/
    schedule/
    youtube/
    youtube/callback/
    jobs/[id]/
lib/
  db.ts
  rss.ts
  trends.ts
  ideas.ts
  llm.ts
  render.ts
  youtube.ts
  jobs.ts
prisma/
  schema.prisma
uploads/
renders/
```

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Create env file:

```bash
cp .env.example .env
```

3. Ensure FFmpeg is installed:

```bash
ffmpeg -version
ffprobe -version
```

4. Initialize local DB schema + Prisma client:

```bash
npm run db:reset
```

5. Start dev server:

```bash
npm run dev
```

6. Open [http://localhost:3000](http://localhost:3000)

## Environment Variables

```env
DATABASE_URL="file:./dev.db"

LLM_API_KEY=""
LLM_MODEL="gemini-2.5-pro"
LLM_MODEL_HARD="gemini-3.1-pro-preview"
LLM_BASE_URL="https://generativelanguage.googleapis.com/v1beta/openai"

GOOGLE_CLIENT_ID=""
GOOGLE_CLIENT_SECRET=""
GOOGLE_REDIRECT_URI="http://localhost:3000/api/youtube/callback"

APP_BASE_URL="http://localhost:3000"
YOUTUBE_UPLOAD_MOCK="true"
```

With the default `DATABASE_URL`, Prisma uses `prisma/dev.db`.

## API Key Setup

### LLM API (Gemini default)

1. Create an API key from your provider dashboard.
2. Set `LLM_API_KEY`.
3. Set `LLM_MODEL` (default model, example: `gemini-2.5-pro`).
4. Set `LLM_MODEL_HARD` (escalation model, example: `gemini-3.1-pro-preview`).
5. If using another compatible endpoint, set `LLM_BASE_URL`.

If LLM config is missing, fallback logic is used for ideas/metadata/trend polishing.
When configured, the app routes most prompts to `LLM_MODEL` and escalates hard/failed attempts to `LLM_MODEL_HARD`.

### Google OAuth + YouTube Data API v3

1. Open [Google Cloud Console](https://console.cloud.google.com/).
2. Create/select a project.
3. Enable **YouTube Data API v3**.
4. Configure OAuth consent screen.
5. Create OAuth client credentials (Web Application).
6. Add redirect URI exactly:
   - `http://localhost:3000/api/youtube/callback`
7. Copy credentials into:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
8. Set `YOUTUBE_UPLOAD_MOCK=false` to force live uploads.

Default behavior:

- If `YOUTUBE_UPLOAD_MOCK=true`: mock upload mode.
- If OAuth env vars are missing: app automatically falls back to mock mode.

## Workflow

- `/onboarding`: profile setup + RSS + YouTube connect
- `/dashboard`: 7-step workflow
  1. Fetch trends
  2. Select trend
  3. Generate ideas
  4. Upload media
  5. Render video
  6. Generate metadata
  7. Upload to YouTube
- `/jobs/[id]`: live job debug page

## Notes

- This MVP runs single-user local mode by default.
- Data model is extensible for multi-user and additional platforms later.
- YouTube scheduling (`publishAt`) is best-effort and may be omitted by API constraints; uploads remain private.

## 4-Minute Demo Script

### 0:00 - 0:35 Onboarding

- Open `/onboarding`
- Enter niche, tone, timezone
- Leave RSS empty to show curated defaults behavior
- Click **Connect YouTube** (show mock mode or OAuth redirect)
- Save and continue

### 0:35 - 1:20 Trend Detection

- On dashboard step 1, click **Fetch trends**
- Explain RSS fetch + heuristic clustering into up to 3 trends
- Select one trend in step 2

### 1:20 - 2:00 Idea Generation

- Click **Generate ideas**
- Show 3 generated concepts (title, hook, outline, CTA)
- Select one idea

### 2:00 - 2:40 Upload + Render

- Upload sample media files (`mp4`, `mov`, `png`, `jpg`)
- In render step, keep `Auto` format (or force shorts)
- Start render job and show 3 variant outputs with selected format reason

### 2:40 - 3:20 Metadata + Scheduling

- Click **Generate metadata + schedule**
- Show generated YouTube title, description, hashtags, caption variants
- Show next weekday 5-8pm local recommendation and reasoning

### 3:20 - 4:00 YouTube Upload

- In step 7, choose a render variant
- Upload as private
- Mention that live upload uses YouTube Data API v3 and mock fallback is available
- Open job output showing returned video ID or mock upload ID

## Troubleshooting

- `ffmpeg not found`: install FFmpeg and confirm with `ffmpeg -version`
- RSS fetch empty: verify feed URLs are valid and reachable
- OAuth callback error: verify `GOOGLE_REDIRECT_URI` and OAuth app redirect URI match exactly
- Google "app hasn't been verified" screen: keep OAuth app in Testing mode, add your Google account under test users, then proceed via Advanced for local/dev testing
- Upload in mock mode unexpectedly: check `YOUTUBE_UPLOAD_MOCK` and OAuth env vars
