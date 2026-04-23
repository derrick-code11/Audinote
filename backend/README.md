# Audinote Backend

## Structure

```
backend/
  src/
    config/
    controllers/
    middlewares/
    routes/
    services/
    repositories/
    types/
    utils/
    app.ts
    server.ts
```

## Quick Start

1. Copy `.env.example` to `.env`
2. Install dependencies: `npm install`
3. Install **FFmpeg** locally (`brew install ffmpeg` on macOS) — required for merge/split in the lecture pipeline.
4. Set `OPENAI_API_KEY` (and optionally `OPENAI_TRANSCRIPTION_MODEL`, `OPENAI_STRUCTURED_MODEL`) for transcription and notes generation.
5. Run in dev mode: `npm run dev`
6. Generate Prisma client: `npm run prisma:generate`

### Background retention

- The API process runs an **hourly** sweep (and once at startup): expired **upload parts** are deleted from S3 and marked `deleted_from_storage_at`; for **DONE** lectures older than `DERIVED_AUDIO_RETENTION_HOURS`, **merged** and **segment** WAVs under `lectures/{userId}/{lectureId}/derived/` are removed and `derived_audio_deleted_at` is set.

### Docker (API or worker with FFmpeg)

Build from this directory so the image includes FFmpeg, for example:

`docker build -t audinote-backend .`

Use the same image for the web process and the worker process; override `CMD` to `node dist/worker.js` for BullMQ workers on Railway or Kubernetes.

## Railway Deploy

- Pre-deploy command: `npx prisma migrate deploy --schema prisma/schema.prisma`
- Build and start using the provided **Dockerfile** in this folder so **FFmpeg** is available for audio processing. Set the service root to `backend` (or adjust paths). Start command remains `node dist/server.js` after build inside the image.
- `prisma:migrate` is for local development only. Use `prisma:deploy` in production.

### Redis + lecture worker (BullMQ)

- Add a Redis instance and set `REDIS_URL` (`redis://` or `rediss://`) on **both** the API service and a **second** worker service.
- API service: same `npm run start` — it enqueues lecture jobs and no longer runs the pipeline in-process for those lectures.
- Worker service: start command `npm run start:worker` (runs `dist/worker.js` after build). Same env as the API (database, S3, JWT, Google, etc.) so Prisma and pipeline code can run.
- Local: `npm run dev` for the API; with `REDIS_URL` set, run `npm run dev:worker` in another terminal.

## S3 (upload presigns)

- Create a private S3 bucket in `AWS_REGION`.
- Configure a CORS ruleset that allows `PUT` from your web app origin.
- Create IAM credentials with least privilege, scoped to that bucket, for at least `s3:PutObject`.
- Set `AWS_REGION`, `S3_BUCKET`, and `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` (or use an instance role on AWS; Railway typically uses static keys or OIDC, depending on setup).

## Token encryption (Google OAuth tokens at rest)

- Set `TOKEN_ENCRYPTION_KEY` to a base64-encoded 32-byte key. One way to generate:

`openssl rand -base64 32`

## Available Scripts

- `npm run dev` - Start dev server with watch mode
- `npm run dev:worker` - Start BullMQ lecture worker (watch)
- `npm run start:worker` - Start compiled lecture worker (production)
- `npm run build` - Compile TypeScript to `dist`
- `npm run start` - Start compiled server
- `npm run typecheck` - TypeScript type checking
- `npm run prisma:generate` - Generate Prisma client
- `npm run prisma:migrate` - Create/apply local migrations
- `npm run prisma:deploy` - Apply existing migrations in production
- `npm run prisma:studio` - Open Prisma Studio
