# Dockerfile — Worker Club (Conexão Club / iGreen Club)
# Playwright Chromium = tunnel TLS Cloudflare (sem UI).

FROM node:20-bookworm-slim

LABEL service="worker-club"
LABEL portal="club.igreenenergy.com.br"
LABEL version="v1.0-2026.07.15"

RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libgbm1 libasound2 libpango-1.0-0 libcairo2 curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN mkdir -p /tmp

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

RUN npx playwright install chromium
RUN npx playwright install-deps chromium

COPY *.mjs ./
COPY test ./test
COPY CLUB-OFICIAL.md README.md ./

ENV NODE_ENV=production
ENV PORT=3102
ENV HEADLESS=1
ENV ALLOW_LIVE_CLUB_POST=true

EXPOSE 3102

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:3102/health || exit 1

CMD ["node", "server.mjs"]
