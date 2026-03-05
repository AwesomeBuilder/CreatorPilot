# AGENT.md

## Project

InfluencePilot hackathon MVP.

Goal: turn trending RSS news + creator media into YouTube-ready renders, metadata, scheduling suggestions, and upload actions.

## Priorities

- reliability over polish
- end-to-end workflow over depth
- local-first simplicity

## Engineering Rules

- Keep everything in this single Next.js repo
- Avoid microservices and infra-heavy patterns
- Prefer clear, testable route handlers and small library modules
- Use SQLite + Prisma for durable local state
- Use job records for long-running work (trend fetch, idea gen, render, upload)

## Runtime Modes

- Single-user local mode now
- Data model supports multi-user extension later
- YouTube upload defaults to mock if OAuth env vars are not present

## Quick Commands

```bash
npm install
cp .env.example .env
npm run db:reset
npm run dev
```

## Key Paths

- `/Users/priyam/Documents/Projects/Work/CreatorPilot/app/dashboard/page.tsx`
- `/Users/priyam/Documents/Projects/Work/CreatorPilot/app/api/*`
- `/Users/priyam/Documents/Projects/Work/CreatorPilot/lib/*`
- `/Users/priyam/Documents/Projects/Work/CreatorPilot/prisma/schema.prisma`

## Notes For Future Expansion

- Add real auth/session for multi-user
- Add platform abstraction for TikTok/Instagram publishing
- Add persistent queue worker if moving beyond local MVP constraints
