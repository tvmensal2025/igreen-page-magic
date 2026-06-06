# Dockerfile — igreen-sync-worker v6
# Playwright + Tor (proxy residencial para login) + 2captcha (resolve reCAPTCHA)
# Fluxo: login via Tor → reCAPTCHA via 2captcha → token JWT → API direta

FROM node:20-bookworm-slim

LABEL service="igreen-sync-worker"
LABEL version="v6.0-2026.06.06"

# Instala Tor + deps do Chromium
RUN apt-get update && apt-get install -y --no-install-recommends \
    tor \
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libgbm1 libasound2 libpango-1.0-0 libcairo2 curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

RUN npx playwright install chromium
RUN npx playwright install-deps chromium

COPY *.mjs ./
COPY torrc ./

ENV NODE_ENV=production
ENV PORT=3102
ENV PLAYWRIGHT_HEADLESS=true

EXPOSE 3102

HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=3 \
  CMD curl -f http://localhost:3102/health || exit 1

# Inicia Tor em background e depois o worker
CMD tor -f /app/torrc & sleep 10 && node server.mjs
