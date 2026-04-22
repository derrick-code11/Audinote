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

## Available Scripts

- `npm run dev` - Start dev server with watch mode
- `npm run build` - Compile TypeScript to `dist`
- `npm run start` - Start compiled server
- `npm run typecheck` - TypeScript type checking
- `npm run prisma:generate` - Generate Prisma client
- `npm run prisma:migrate` - Create/apply local migrations
- `npm run prisma:studio` - Open Prisma Studio
