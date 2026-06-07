# Dockerfile — igreen-sync-worker v13
# Tor (IP residencial) + Playwright Chromium (passa CF) + 2captcha (resolve reCAPTCHA)
# + OpenAI Vision para debug visual + fallback context.request.post /v1/login
# com recaptchaToken quando o clique no botão "Entrar" não dispara a chamada.

FROM node:20-bookworm-slim

LABEL service="igreen-sync-worker"
LABEL version="v13.0-2026.06.07"

# Deps de sistema: Tor + libs do Chromium headless
RUN apt-get update && apt-get install -y --no-install-recommends \
    tor \
    ca-certificates \
    wget \
    fonts-liberation \
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libgbm1 libpango-1.0-0 libcairo2 libasound2 libatspi2.0-0 libx11-6 \
    libxcb1 libxext6 libxi6 libxtst6 libgtk-3-0 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund \
 && npx playwright install chromium

COPY *.mjs torrc ./

ENV NODE_ENV=production
ENV PORT=3102
ENV TOR_SOCKS_PROXY=socks5://127.0.0.1:9050

EXPOSE 3102

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:3102/health || exit 1

# Sobe Tor em background e depois o worker
CMD ["sh", "-c", "tor -f /app/torrc & sleep 5 && node server.mjs"]
