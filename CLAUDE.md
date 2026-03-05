# CLAUDE.md

## Context

This is a hackathon MVP called InfluencePilot.

Core flow:

1. Pull RSS trends
2. Generate creator ideas
3. Upload media
4. Render 3 FFmpeg variants
5. Generate metadata + captions
6. Recommend publish time
7. Upload to YouTube (private)

## Constraints

- local-only operation
- minimal dependencies
- clear reliability over UI polish

## Implementation Notes

- Long tasks are represented as `Job` records and polled by UI.
- Trend clustering uses lightweight keyword overlap (Jaccard), no embeddings.
- Rendering includes intro title card + media + CTA outro.
- `auto` render mode chooses Shorts vs landscape using source orientation and duration.
- YouTube integration supports both live and mock mode.

## Mock Mode Rules

Use mock when:

- `YOUTUBE_UPLOAD_MOCK=true`
- OAuth env vars are missing

Live mode requires:

- Google OAuth credentials
- YouTube Data API v3 enabled

## Developer Checklist

- Ensure FFmpeg is installed locally
- Run `npm run db:reset` before first start
- Validate `.env` values before OAuth tests
