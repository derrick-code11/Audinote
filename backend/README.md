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
3. Run in dev mode: `npm run dev`
4. Generate Prisma client: `npm run prisma:generate`

## Railway Deploy

- Pre-deploy command: `npx prisma migrate deploy --schema prisma/schema.prisma`
- Start command: `npm run start`
- `prisma:migrate` is for local development only. Use `prisma:deploy` in production.

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
- `npm run build` - Compile TypeScript to `dist`
- `npm run start` - Start compiled server
- `npm run typecheck` - TypeScript type checking
- `npm run prisma:generate` - Generate Prisma client
- `npm run prisma:migrate` - Create/apply local migrations
- `npm run prisma:deploy` - Apply existing migrations in production
- `npm run prisma:studio` - Open Prisma Studio
