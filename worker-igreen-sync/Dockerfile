# Dockerfile — igreen-sync-worker v4
# Usa ScraperAPI como proxy para contornar Cloudflare.
# Imagem leve, sem Playwright/Chromium.

FROM node:20-alpine

LABEL service="igreen-sync-worker"
LABEL version="v4.0-2026.06.06"

RUN apk add --no-cache curl ca-certificates

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY *.mjs ./

ENV NODE_ENV=production
ENV PORT=3102

EXPOSE 3102

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:3102/health || exit 1

CMD ["node", "server.mjs"]
