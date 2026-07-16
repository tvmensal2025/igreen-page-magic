# 00 — Fotografia do repositório

**Data da fotografia:** 2026-07-16  
**Modo:** somente leitura  
**Workspace Cursor:** `/home/dev/Documents/ultra-cursor/igreen-official-portal`  
**Repositório Git real (cwd resolvido):** `/home/dev/Documents/ultra-cursor/igreen-page-magic`  

> Nota: o path do workspace aponta para `igreen-official-portal`, mas o `.git` e o código vivem em `igreen-page-magic` (mesmo conteúdo / symlink ou mount). Todas as contagens abaixo foram feitas a partir do cwd do Git.

---

## 1. Estado Git

| Campo | Valor |
|---|---|
| Branch | `fix/hardening-auditoria` |
| Tracking | `origin/fix/hardening-auditoria` |
| Working tree | limpa (sem alterações staged/unstaged) |
| HEAD | `daa22c04c497a1bb0668ce18df403e94d587cc61` |
| Autor | tvmensal2025 \<tvmensal2025@gmail.com\> |
| Data | Thu Jul 16 01:00:47 2026 +0000 |
| Mensagem | `test(captacao): cobre meta inbound e URL embutida de mídia` |

---

## 2. Escala do repositório (excluindo caches)

Exclusões aplicadas na contagem: `node_modules/`, `.git/`, `dist/`, `build/`, `coverage/`, `.cache/`, `.next/`, `.tmp/`, `tmp/`, pastas de screenshots locais.

| Métrica | Valor |
|---|---|
| Arquivos totais (após exclusões) | **2.817** |
| Linhas de texto (aprox.) | **486.506** |
| Arquivos em `src/` (ts/tsx/js/css) | **893** |
| Edge Function dirs (`supabase/functions/*`) | **196** (+ `_shared`) |
| Migrations SQL | **722** |
| Páginas (`src/pages`) | **39** arquivos |
| Componentes (`src/components`) | **544** arquivos |
| Hooks (`src/hooks`) | **78** arquivos |
| Docs Markdown (repo limpo) | **277** |
| Entradas explícitas em `config.toml` `[functions.*]` | **71** |
| `verify_jwt = false` no config | **59** |
| `verify_jwt = true` no config | **12** |

### 2.1 Quantidade de arquivos por extensão (top)

| Extensão | Arquivos | Linhas (texto) |
|---|---:|---:|
| `.ts` | 858 | 196.245 |
| `.sql` | 723 | 40.180 |
| `.tsx` | 583 | 135.243 |
| `.md` | 277 | 68.030 |
| `.webp` | 119 | — |
| `.mjs` | 51 | 13.976 |
| `.png` | 37 | — |
| `.json` | 25 | 22.711 |
| `.sh` | 17 | 949 |
| `.py` | 16 | 4.338 |
| `.js` | 11 | 1.797 |
| `.yml` | 2 | 259 |
| `.toml` | 1 | 246 |

### 2.2 Linhas por linguagem (aprox., texto)

| Linguagem | Linhas |
|---|---:|
| TypeScript (`.ts` + `.tsx`) | ~331.488 |
| Markdown | ~68.030 |
| SQL | ~40.180 |
| JSON | ~22.711 |
| JavaScript (`.js` + `.mjs`) | ~15.773 |
| Python | ~4.338 |
| CSS | ~2.160 |
| Shell | ~949 |

---

## 3. Estrutura de pastas (nível relevante)

```
.
├── .agents/                  # skills locais do agente
├── .cursor/rules/            # regras do projeto (PT-BR, produção, Grok)
├── .github/workflows/        # CI + deploy edge functions
├── .kiro/                    # specs Kiro (125 arquivos)
├── compress-worker/          # Express + MinIO compressão
├── docs/                     # documentação + auditorias anteriores
├── experiments/              # solar-3d-ai experimental
├── fixtures/
├── mem/                      # memórias de features
├── public/                   # assets estáticos (vídeos, imagens, SW kill-switch)
├── scripts/                  # scripts operacionais + manual-tests
├── src/                      # frontend React
│   ├── components/           # admin, captacao, whatsapp, wallet, voz…
│   ├── contexts/
│   ├── features/             # help, onboarding, produtos, remote-support, solar-3d
│   ├── hooks/
│   ├── integrations/supabase/
│   ├── lib/
│   ├── pages/
│   ├── services/
│   └── test/
├── supabase/
│   ├── functions/            # 196 edge functions + _shared
│   └── migrations/           # 722 SQL
├── tests/e2e/                # Playwright
├── worker-club/              # iGreen Club (BullMQ + Playwright)
├── worker-igreen-sync/       # sync legado Portal (Tor/Playwright)
└── worker-portal-2/          # Portal 2 (BullMQ + Playwright + HMAC)
```

### Pastas pedidas na auditoria — presença

| Pasta | Status |
|---|---|
| `src/App.tsx` | Presente (a confirmar conteúdo na etapa de rotas) |
| `src/main.tsx` | Presente |
| `src/pages/` | Presente (39 arquivos) |
| `src/components/` | Presente |
| `src/hooks/` | Presente |
| `src/contexts/` | Presente |
| `src/services/` | Presente |
| `src/lib/` | Presente |
| `src/features/` | Presente |
| `src/integrations/` | Presente |
| `src/integrations/supabase/` | Presente |
| `supabase/functions/` | Presente |
| `supabase/migrations/` | Presente |
| `worker-portal-2/` | Presente |
| `worker-igreen-sync/` | Presente |
| `compress-worker/` | Presente |
| `worker-club/` | Presente |
| `scripts/` | Presente |
| `.github/workflows/` | Presente |
| `docker-compose*` | **Ausente** (não encontrado) |

---

## 4. Arquivos muito grandes (≥200 KB)

### Código / dados relevantes para auditoria

| Tamanho | Arquivo | Observação |
|---:|---|---|
| 383 KB | `src/integrations/supabase/types.ts` | Tipos gerados Supabase |
| 353 KB / 6.590 linhas | `supabase/functions/whapi-webhook/handlers/bot-flow.ts` | Monólito bot Whapi |
| 332 KB / 6.290 linhas | `supabase/functions/evolution-webhook/handlers/bot-flow.ts` | Monólito bot Evolution (duplicação estrutural) |
| 277 KB | `supabase/migrations/20260715150100_seed_br_municipios.sql` | Seed geográfico |
| 135 KB | `worker-igreen-sync/server.mjs` | Worker monolítico |
| 603 KB | `package-lock.json` | Lock npm |

### Assets / mídia (não lidos como código)

PDFs e vídeos em `public/` e `docs/` chegam a dezenas de MB (ex.: `public/BANNER-504x904.pdf` ~39 MB, `public/videos/igreen-club.mp4` ~28 MB). Inventariados; não analisados como lógica.

### Artefatos na raiz (aparentemente abandono / debug)

27 imagens na raiz do repo (`*.webp`, `*.png`, `*.jpeg`) — ex.: `proposta-full.png`, `wizard-step*.png`, `conexao-*.webp`. Prováveis artefatos de design/teste versionados indevidamente junto com o código.

---

## 5. Arquivos duplicados / espelhados (evidência preliminar)

Nomes de arquivo repetidos em caminhos distintos (amostra):

| Nome | Contextos aparentes |
|---|---|
| `bot-flow.ts` | `whapi-webhook/handlers/` e `evolution-webhook/handlers/` (~12.880 linhas somadas) |
| `clubValidation.ts` / `portalValidation.ts` | `_shared` e/ou workers |
| `state-machine.ts`, `templates.ts`, `intent-classifier.ts` | possíveis forks Evolution/Whapi ou fluxo-b |
| `distribuidoras.ts`, `discount-rates.ts` | `_shared` vs workers |
| `XpFloater.tsx`, `use-toast.ts`, `utils.ts` | padrões comuns / possíveis cópias |

**Grau de certeza nesta etapa:** nomes duplicados confirmados; equivalência semântica será analisada nas etapas de inventário e código morto.

---

## 6. Build / cache versionados

| Item | Situação |
|---|---|
| `dist/` | Existe localmente; **não** está no Git (`git ls-files dist` = 0). `.gitignore` cobre `dist`. |
| `node_modules/` | Presente localmente; ignorado. Também em `worker-portal-2/` e `worker-club/`. |
| `*.tsbuildinfo` | Presentes localmente; cobertos por `.gitignore`. |
| `supabase/.temp/` | Ignorado. |
| `.lovable/` | Ignorado (metadata Lovable). |

---

## 7. Segredos e credenciais (somente indícios — conteúdo mascarado)

| Achado | Situação |
|---|---|
| `.env` / `.env.*` no Git | **Não** versionados (gitignore). Existem apenas `.env.example` e `supabase/functions/.env.example`. |
| Segredo potencial em settings | `.gitignore` menciona `.kiro/settings/mcp.json` com tokens — **não commitado** (regra explícita). |
| `.cursor/mcp.json` | Ignorado (caminhos locais). |
| Migrations com nome `*_secret*` | Ex.: `20260710020000_voice_dialer_cron_secret.sql` — **nome** sugere provisioning de secret via SQL; conteúdo será auditado na etapa SQL **sem revelar valores**. |
| Frontend | `.env.example` documenta `VITE_SUPABASE_ANON_KEY`, TURN credentials (expostas no bundle por natureza Vite) — esperado; risco a classificar depois. |
| `vite.config.ts` | Proxy de dev aponta para `https://zlzasfhcxcznaprrragl.supabase.co` (project ref público no código). |

**Nenhum `.env` real foi aberto nem impresso nesta etapa.**

---

## 8. Dependências e versões (package.json raiz)

**Nome do pacote:** `vite_react_shadcn_ts` @ `0.0.0` (legado Lovable).

### Scripts

| Script | Comando |
|---|---|
| `dev` | `vite` |
| `build` | `vite build` |
| `build:dev` | `vite build --mode development` |
| `lint` | `eslint .` |
| `typecheck` | `tsc -b --noEmit` |
| `preview` | `vite preview` |
| `test` | `vitest run` |
| `test:watch` | `vitest` |

### Runtime principal (amostra)

| Pacote | Versão |
|---|---|
| `react` / `react-dom` | ^18.3.1 |
| `react-router-dom` | ^6.30.1 |
| `@tanstack/react-query` | ^5.83.0 |
| `@supabase/supabase-js` | ^2.108.2 |
| `vite` | ^5.4.19 |
| `typescript` | ^5.8.3 |
| `vitest` | ^3.2.4 |
| `@playwright/test` | ^1.57.0 |
| `zod` | ^3.25.76 |
| `vite-plugin-pwa` | ^1.3.0 (devDependency) |
| `workbox-window` | ^7.4.1 |
| `@sentry/react` | ^8.45.0 |
| `three` / `@react-three/*` | presente (Solar 3D) |
| `xlsx`, `jspdf`, `pdfjs-dist` | documentos |

Locks presentes: `package-lock.json`, `bun.lock` / `bun.lockb`, `deno.lock`.

### Workers (pacotes separados)

| Worker | Entry | Deps principais |
|---|---|---|
| `worker-portal-2` | `server.mjs` | express, bullmq, playwright-chromium, supabase-js, ws |
| `worker-club` | `server.mjs` | mesmas deps (espelho estrutural) |
| `worker-igreen-sync` | `server.mjs` | apenas playwright-chromium (v15.0.0) |
| `compress-worker` | `server.js` | express, multer, minio |

---

## 9. Configurações TypeScript

| Arquivo | Observação |
|---|---|
| `tsconfig.json` | Project references; `strictNullChecks: false`; `noImplicitAny: false` |
| `tsconfig.app.json` | `strict: false`; target ES2020; paths `@/*` → `./src/*`; include só `src` |
| `tsconfig.node.json` | Config Vite/node |

**Implicação:** tipagem frouxa no frontend — aumenta risco de `any`/null bugs; já reconhecido no ESLint (`no-explicit-any` = warn legado).

---

## 10. ESLint

Arquivo: `eslint.config.js` (flat config).

- Ignora: `dist`, `supabase/functions/**`, workers legados listados, screenshots, fixtures.
- `no-explicit-any`: warn geral; **error** só em poucos arquivos do flow engine v3.
- `allowEmptyCatch: true` — catch vazio permitido (padrão fail-open do projeto).
- Edge Functions **fora** do ESLint do frontend (cobertura via Deno no CI).

---

## 11. Vite / PWA

Arquivo: `vite.config.ts`.

- Plugin React SWC.
- `__BUILD_ID__` + `dist/version.json` para detecção de versão nova.
- **Sem** registro de Service Worker de cache (comentário explícito: anti-cache stuck).
- `vite-plugin-pwa` está no `package.json` mas **não** está plugado em `vite.config.ts` → **divergência documentação/deps vs código**.
- Proxy `/functions-proxy` → projeto Supabase `zlzasfhcxcznaprrragl` (somente dev).
- `sourcemap: false` em produção.
- Manual chunks: react, supabase, radix, charts, three, jspdf, etc.
- Dev server: `0.0.0.0:8080`.

---

## 12. Supabase

| Campo | Valor |
|---|---|
| `project_id` (config.toml) | `zlzasfhcxcznaprrragl` |
| Edge functions no disco | 196 dirs |
| Explicitamente configuradas no toml | 71 |
| Funções no disco sem bloco `[functions.*]` | dezenas (usam default do gateway; muitos crons/internas) |
| Funções no toml sem pasta | **nenhuma** (comm vazio) |
| Migrations | 722 arquivos `.sql` |

Prioridade futura: todas com `verify_jwt = false` (59 entradas) — webhooks, crons, propostas públicas, solar, lead-intake, stripe, voz, etc.

---

## 13. GitHub Actions

| Workflow | Função |
|---|---|
| `.github/workflows/ci.yml` | Vitest+lint+typecheck; Deno check parcial; Deno tests; purity lint do engine v3; verificação de specs Kiro |
| `.github/workflows/deploy-edge-functions.yml` | Deploy **manual** (`workflow_dispatch`) — push em main **não** dispara (billing) |

---

## 14. Docker

| Arquivo | Status |
|---|---|
| `worker-portal-2/Dockerfile` | Presente |
| `worker-club/Dockerfile` | Presente |
| `worker-igreen-sync/Dockerfile` | Presente |
| `compress-worker/Dockerfile` | Presente |
| `docker-compose.yml` | **Ausente** |

Deploy de workers aparenta ser via Docker individual (EasyPanel documentado em `worker-club/EASYPANEL.md`).

---

## 15. Inventário `public/` (sem leitura de binários)

| Tipo | Qtd |
|---|---:|
| webp | 107 |
| png | 21 |
| mp4 | 9 |
| jpeg/jpg | 15 |
| js | 5 (incl. opus encoder / SW kill-switches) |
| pdf | 2 (banners grandes) |
| outros | svg, mp3, json, txt |

---

## 16. Documentação pré-existente vs esta auditoria

Já existe `docs/auditoria/` com relatórios anteriores (01–17). Esta série vive em `docs/auditoria-completa/` e **não confia** na documentação antiga como fonte primária — divergências serão registradas em `14-divergencias-documentacao-codigo.md`.

Arquivos soltos na raiz (`ANALISE_*.md`, `DOCUMENTATION.md`, `LOVABLE_TASKS.md`, etc.) sugerem histórico Lovable + análises manuais acumuladas.

---

## 17. Observações iniciais (ainda sem classificação P0–P4)

Itens a investigar com evidência nas próximas etapas (fotografia apenas):

1. Dois monólitos `bot-flow.ts` (Whapi + Evolution) — risco de divergência comportamental.
2. 59 edge functions com `verify_jwt = false` — cada uma precisa de autenticação alternativa comprovada.
3. TypeScript `strict: false` no app.
4. `vite-plugin-pwa` instalado mas não usado; estratégia anti-SW documentada no Vite.
5. ~125 funções no disco sem entrada explícita no `config.toml`.
6. Imagens e PDFs pesados versionados; 27 imagens na raiz.
7. Workers Club e Portal 2 compartilham stack (BullMQ/Playwright) — isolamento a comprovar.
8. Nome do pacote ainda `vite_react_shadcn_ts` (legado Lovable).

---

## 18. Próximo passo

Inventário programático AST de funções (frontend → backend → workers → SQL), com checkpoint em `STATUS.md`.
