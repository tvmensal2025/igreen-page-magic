# Dockerfile — igreen-sync-worker v8
# HTTP direto contra api-voffice.igreenenergy.com.br (same method as worker-portal).
# Sem Playwright, sem Tor, sem captcha.

FROM node:20-alpine

LABEL service="igreen-sync-worker"
LABEL version="v8.0-2026.06.07"

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY *.mjs ./

ENV NODE_ENV=production
ENV PORT=3102

EXPOSE 3102

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3102/health || exit 1

CMD ["node", "server.mjs"]
