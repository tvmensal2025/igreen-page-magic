# Dockerfile — igreen-sync-worker v3
# Playwright stealth com interceptação de token JWT.
# Sem precisar resolver CAPTCHA — captura o Bearer token via intercepção de network.

FROM node:20-bookworm-slim

LABEL service="igreen-sync-worker"
LABEL version="v3.0-2026.06.06"

RUN apt-get update && apt-get install -y --no-install-recommends \
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

ENV NODE_ENV=production
ENV PORT=3102
ENV PLAYWRIGHT_HEADLESS=true

EXPOSE 3102

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:3102/health || exit 1

CMD ["node", "server.mjs"]
