# Production image: Node + FFmpeg.
FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

RUN npm run prisma:generate && npm run build

ENV NODE_ENV=production
EXPOSE 4000

CMD ["node", "dist/server.js"]
