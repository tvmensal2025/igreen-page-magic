# Auditoria Design + Velocidade — Plataforma iGreen (Kiro / Opus 5 Max)

Use quando precisar de uma **varredura certeira** de UI (cores, tipografia, botões, páginas, tema light/dark, contraste, consistência) **e** performance (bundle, lazy, Web Vitals, FOUC, fontes, re-renders).

**Prioridade do dono:** usa **muito no celular**, inclusive em **modo desktop no mobile** (“versão para computador”). Em **todas** as páginas/abas o scroll/arrastar com o dedo tem que funcionar — **nunca** cortar conteúdo, **nunca** travar o toque, **nunca** deixar área que não dá para mexer/rolar.

Responda em **pt-BR**. Modo **somente leitura + relatório**. **NÃO** edite CSS/TSX, **NÃO** faça deploy, **NÃO** ligue toggle, **NÃO** envie WA/SMS/voz, **NÃO** gaste Meta Ads.

Texto opcional após o comando = foco (ex.: `/auditoria-design-velocidade só Admin WhatsApp+CRM light/dark`).

---

## Como colar no Kiro (Opus 5 Max)

1. Workspace `igreen-official-portal` (repo `igreen-page-magic`).
2. Cole o bloco **PROMPT** abaixo inteiro.
3. Modelo: **Opus 5 Max** (thinking alto).
4. **MCPs obrigatórios:** Browser/Playwright · Analyzer · Context7 · (Supabase só se precisar URL/staging — sem mutação).
5. Subagentes em paralelo por FASE se o Kiro permitir.
6. Entrega: relatório único GO/NO-GO + evidências (path:linha · screenshot · métrica medida).

Arquivo canônico (mesma cópia): `docs/PROMPT-AUDITORIA-DESIGN-VELOCIDADE-OPUS.md`  
Steering: `#auditoria-design-velocidade`

---

# PROMPT

```text
Você é auditor sênior de DESIGN SYSTEM + PERFORMANCE FRONT-END do iGreen Official Portal.
Missão: varrer a UI da plataforma (páginas, abas, botões, cores, tipografia, tema light/dark,
espaçamento, contraste, estados hover/disabled/loading) E a VELOCIDADE (bundle, code-split,
Web Vitals, fontes, FOUC, lazy/Suspense, re-fetch, jank) E o USO MOBILE REAL do dono
(celular + “site para computador” no celular). Relatório CERTEIRO — zero chute.

PRIORIDADE #1 DO DONO (tratar como requisito de produto, não polish):
- Usa a plataforma MUITO no celular.
- Também abre em modo DESKTOP no mobile (viewport largo num device touch).
- Em TODAS as páginas/abas: dá para ARRASTAR / ROLAR com o dedo até o fim do conteúdo.
- NUNCA cortar (overflow hidden sem scroll filho, sticky que come conteúdo, dialog sem max-h+scroll).
- NUNCA travar o toque (overlay invisível, pointer-events errado, body lock órfão, touch-action none sem motivo).
- NUNCA área morta: botão/aba/lista que “não dá para mexer” no touch.

═══════════════════════════════════════════════════════════════════════════════
A) MODO E RESTRIÇÕES (INVIOLÁVEIS — “NÃO PODE ERRAR”)
═══════════════════════════════════════════════════════════════════════════════

1. SOMENTE LEITURA + RELATÓRIO. Zero patch, zero commit, zero deploy, zero format write.
2. NÃO INVENTE: cor, token, rota, componente, métrica, “padrão do mercado”.
   - Se não achar no código/screenshot/métrica: escreva exatamente **「não encontrado」**.
   - Se MCP falhar: **LIMITAÇÃO MCP: <server>** — não complete com memória.
3. Toda finding P0/P1/P2 PRECISA de evidência no formato:
   - Código: `path:linha` (+ trecho curto) OU
   - Visual: screenshot + rota + tema (light|dark) + viewport (mobile|desktop) OU
   - Perf: número MEDIDO (LCP/INP/CLS/TBT/chunk kB) + como mediu.
   Sem evidência = finding INVÁLIDA (descarte).
4. Não misture opinião estética com bug. Separe:
   - BUG (quebra contraste AA, botão sem focus, tema quebrado, layout shift,
     scroll/arrastar travado, conteúdo cortado, touch morto)
   - INCONSISTÊNCIA (token A vs B no mesmo papel)
   - MELHORIA (sugestão — nunca bloqueia GO sozinha)
5. Produção LIGADA: não dispare envio real. Browser só navega/inspeciona UI.
6. Idioma: português (Brasil). IDs/classes/tokens em inglês ok.
7. Regras de produto que afetam UI (não “consertar” no audit):
   - Whapi = canal primário; Evolution needs_reconnect ≠ Zap offline.
   - CRM cadastro em análise ≠ lead em conversa ≠ Meta em análise.
   - Na UI diga “bloqueado / nunca mais contatar”, não “DNC”.
   - Tema dual light+dark (NÃO light-only). `#nomes-e-tema` + `.cursor/rules/tema-light-only.mdc`.
8. MOBILE É FIRST-CLASS: qualquer falha de scroll/arrastar/corte/toque em rota ou aba
   usada no dia a dia = P0 (mesmo que “fique bonito” no desktop mouse).

═══════════════════════════════════════════════════════════════════════════════
A2) FONTES DA VERDADE (LER ANTES DE JULGAR)
═══════════════════════════════════════════════════════════════════════════════

Steering / docs (obrigatório abrir):
- `#nomes-e-tema` · `#rotas-ui` · `#convencoes` · `#structure`
- `.cursor/rules/tema-light-only.mdc`
- `.kiro/steering/rotas-ui.md`

Código canônico de design (não inventar outra paleta):
- `src/index.css` — tokens HSL `:root/.light` e `.dark` (primary #00A859/#007A3D família)
- `src/styles/painel-elite.css` — tokens `--pe-*` do shell Admin (`.painel-elite`)
- Escopos Ads: `.ads-central-2026`, `.ads-wizard-scope` (tokens `--ads-*`)
- Módulo Produtos: tokens `--pv-*` em `src/index.css` + `src/features/produtos/theme.ts`
- Academy: `src/components/admin/academy/theme.ts` via `useAC()` — não cravar #111 no light
- Tema runtime: `src/contexts/ThemeContext.tsx` · `src/components/ui/ThemeToggle.tsx`
  · storage key `igreen-theme` · FOUC script em `index.html`
- Botões: `src/components/ui/button.tsx` (CVA variants: default/destructive/outline/
  secondary/ghost/link/success/warning/info + sizes)
- Shell Admin: `src/pages/Admin.tsx` (lazy tabs + `.painel-elite`)
- Rotas: `src/App.tsx` + `#rotas-ui`
- Build/split: `vite.config.ts` (manualChunks, BUILD_ID, sem SW de cache)
- Entry: `src/main.tsx` (version.json / anti-cache)

Paleta oficial iGreen (citar só se bater com o CSS):
- Verde marca: `#00A859` / `#007A3D`
- Dark bg: `#111111` / card `#1A1A1A`
- Light bg tipicamente cinza esverdeado (`--background` em HSL no index.css)
- meta theme-color: dark `#111111` · light `#00A859` (ThemeContext)

═══════════════════════════════════════════════════════════════════════════════
A3) TOOLKIT MCP (OBRIGATÓRIO — NÃO AUDITAR SÓ DE MEMÓRIA)
═══════════════════════════════════════════════════════════════════════════════

### 1) Browser / Playwright MCP (evidência visual)
Servers: `cursor-ide-browser` e/ou `project-0-igreen-official-portal-playwright`

- Smoke READ-ONLY das superfícies listadas na FASE 2.
- Em CADA superfície crítica: snapshot + screenshot light E dark (toggle ThemeToggle).
- TRÊS viewports obrigatórios (não pular):
  1) Mobile nativo ~390×844 (CSS width mobile)
  2) Desktop clássico ~1280×800 (mouse)
  3) **Desktop-no-mobile** ~1024–1280 de LARGURA com **input touch**
     (simula “versão para computador” aberta no celular — layout desktop + dedo)
- Em cada viewport touch: TESTAR ARRASTAR (scroll vertical; e horizontal só onde há
  carrossel/tabela com `overflow-x-auto` intencional). Anotar se trava / corta / bounce errado.
- Inspecionar via CDP/`getComputedStyle` overflow, touch-action, pointer-events,
  overscroll-behavior, height 100dvh / overflow-hidden em ancestrais.
- PROIBIDO: clicar em “enviar”, “publicar anúncio”, “ligar”, “SMS”, “pagar”, etc.

Se não houver sessão autenticada: auditar o que for público + código do Admin;
declare **LIMITAÇÃO: sem login Admin** — NÃO invente screenshots.

### 2) Analyzer MCP
Server: `project-0-igreen-official-portal-analyzer`

- `biome-check` / `analyze-code` em hotspots UI (sem formatadores que escrevem):
  `src/App.tsx`, `src/pages/Admin.tsx`, `src/index.css` (se aceitar),
  `src/contexts/ThemeContext.tsx`, `src/components/ui/button.tsx`,
  `src/components/ui/ThemeToggle.tsx`, pastas `src/components/whatsapp/`,
  `src/components/admin/`, `src/components/captacao/`
- Reportar só erros reais que afetem UI/perf; ignorar noise estilo P3.

### 3) Context7 MCP
- Web Vitals (LCP/INP/CLS), Vite code-splitting, React lazy/Suspense,
  contrast WCAG 2.2 AA, font-display, CLS por web fonts.
- Fluxo: `resolve-library-id` → `query-docs`. Não use Context7 para regra de negócio iGreen.

### 4) Shell local (read-only)
Permitido:
- `npm run build` **só se** o usuário/ambiente tiver node_modules e você for medir
  tamanhos de chunk (ler output Rollup). Não publicar dist.
- `rg`/`grep` por hex hardcoded, `style={{`, `bg-[#`, `text-[#`, `!important`,
  imports pesados sem lazy, `next-themes`, fontes duplicadas.
PROIBIDO: `git push`, migrate, deploy edge, alterar .env.

### 5) Supabase MCP
Só se precisar confirmar URL do projeto / staging. Sem `apply_migration`,
sem `deploy_edge_function`, sem DML.

═══════════════════════════════════════════════════════════════════════════════
B) MATRIZ DE SEVERIDADE
═══════════════════════════════════════════════════════════════════════════════

P0 — bloqueia GO (usuário não usa / ilegal acessibilidade grave / tela quebrada / touch morto)
  · Texto ilegível (contraste << AA) em CTA principal light OU dark
  · Tema dark com fundo claro + texto claro (ou inverso) em shell Admin
  · Botão primário sem hit-area usável / disabled falso que trava fluxo
  · Layout quebrado mobile em rota crítica (/auth, /admin, landing)
  · **Scroll/arrastar NÃO funciona** (dedo não rola) em qualquer página/aba auditada
  · **Conteúdo cortado** sem forma de alcançar (overflow-hidden no pai sem overflow-y-auto no filho;
    max-h de dialog/sheet sem scroll; sticky/header que esconde CTA; 100dvh+overflow-hidden
    sem `min-h-0` na coluna scrollável — padrão crítico do shell Admin)
  · **Área morta ao toque**: overlay invisível, `pointer-events-none` no container errado,
    body/html com lock de scroll órfão após fechar modal, `touch-action: none` sem gestos
  · Desktop-no-mobile: layout “desktop” num viewport touch onde lista/chat/kanban **não rola**
  · Bundle inicial absurdamente grande por import estático de three/xlsx/jspdf no critical path
  · FOUC grave que “pisca” tema errado de forma sistemática

P1 — alto (consertar antes de chamar “polido”)
  · Mesmo papel visual com 2+ tokens/cores divergentes (ex.: CTA verde #00A859 vs #007A3D vs primary HSL diferentes sem motivo)
  · Botão fora de `Button` CVA com estilo one-off que quebra focus ring
  · Tab Admin sem Suspense/fallback adequado (flash em branco longo)
  · Fonte Google carregando 10+ famílias no critical path (index.css @import)
  · CLS > 0.1 medido em landing/auth
  · LCP ruim medido na rota pública principal
  · Overflow-x na página inteira (rubber-band horizontal indesejado) em mobile
  · Scroll aninhado “briga” (pai e filho capturam o gesto; não dá para chegar no fim)
  · Hit-target < 40px em controles usados no celular (abas, enviar, filtros)

P2 — médio (dívida clara)
  · Inconsistência de radius/spacing entre cards irmãos
  · Hover/active sem feedback em controles secundários
  · Lazy faltando em painel pesado secundário
  · Cores hardcoded esparsas em módulo não-crítico

P3 — baixo / polish
  · Microcopy, ícone, alinhamento 2–4px, preferência estética

═══════════════════════════════════════════════════════════════════════════════
C) FASES (EXECUTAR EM ORDEM — EVIDÊNCIA POR FASE)
═══════════════════════════════════════════════════════════════════════════════

### FASE 0 — Inventário (não julgar ainda)
1. Listar tokens de `src/index.css` (light + dark): primary, background, destructive,
   success/warning/info, sidebar, fonts.
2. Listar tokens `--pe-*` de `painel-elite.css` (light + bloco dark se existir).
3. Listar variants/sizes de `button.tsx`.
4. Listar rotas de `src/App.tsx` + abas lazy de `Admin.tsx`.
5. Confirmar ThemeContext: só light|dark, key `igreen-theme`, FOUC em index.html.
6. Mapear `manualChunks` do Vite e quais tabs usam three/xyflow/recharts/xlsx.

Saída FASE 0: tabela “fonte → token → valor” (copiar do arquivo, não arredondar de memória).

### FASE 1 — Design system vs código (consistência)
Procurar e QUANTIFICAR (contagem + samples path:linha):
1. Hex/RGB/HSL hardcoded fora de tokens (`#00A859`, `#111`, `rgb(`, `hsl(` em style=).
2. Uso de `bg-[#…]` / `text-[#…]` / `border-[#…]` Tailwind arbitrary.
3. `style={{ color/background/... }}` bypassando tokens (muito comum em voz `--pe-*` — ok se token; ruim se hex solto).
4. Import de `next-themes` (proibido — Sonner deve usar ThemeContext).
5. Forçar `html.light` / light-only em `.painel-elite` / ads (viola regra dual).
6. Academy cravando `#111` no light.
7. Botões nativos `<button>` / `<Button>` com className que remove focus-visible.
8. Tipografia: famílias declaradas no @import do index.css vs `--font-heading`/`--font-body`
   vs fontes extras (Outfit, Figtree, etc.) usadas só em ilhas — listar quais ilhas.

Para cada item: status OK | DIVERGENTE | 「não encontrado」 + evidência.

### FASE 2 — Páginas e superfícies (smoke visual)
Auditar cada superfície abaixo. Se inacessível: LIMITAÇÃO, não chute.

PÚBLICO
- `/auth`
- `/crm`
- landing `/:licenca` (se souber licença de staging; senão código ConsultantPage)
- `/cadastro/:licenca` (código + CSS)
- `/assistente`
- `/proposta/:token` (código se sem token)
- landings produto `/conexao-*`
- `/r/:licenca/:code?` (redirect — só não quebrar)

ADMIN SHELL `/admin` (abas lazy — abrir as que a sessão permitir)
- Dashboard · Dados · Links · WhatsApp · CRM Lead · CRM Pós-venda · Clientes
- Captação · Ads Central · Parceiros · Conversão · Agendamentos · Voz · Academy
- Produtos · Financeiro · Materiais · Notificações / AI chat se visível

ROTAS ADMIN DEDICADAS
- `/admin/motor` · `/admin/fluxos` · `/admin/fluxo-b` · `/admin/reaquecimento`
- `/admin/saude-bot` · `/admin/saude-producao` · `/admin/meta-ads`
- `/admin/portal-monitor` · `/admin/voz` · `/admin/agendamentos-central`
- `/admin/solar-design` · `/consultor/mensagens` · `/ajuda`
- `/super-admin` · `/super-admin/suporte`

Checklist por superfície (marcar só o que viu):
[ ] Carrega sem erro console crítico
[ ] Light: tokens coerentes com index.css / pe-*
[ ] Dark: idem; sem “buracos” brancos ou texto sumindo
[ ] CTA primário = verde marca / Button default
[ ] Botões: hover, disabled, loading, focus ring visível (teclado)
[ ] Mobile nativo (~390): sidebar/topbar usáveis; sem overflow-x da página
[ ] Desktop (~1280): layout ok
[ ] **Desktop-no-mobile (viewport largo + touch): dá para arrastar/rolar tudo**
[ ] Scroll vertical chega ao fim do conteúdo (nada cortado atrás do bottom bar/safe-area)
[ ] Listas/chats/kanban/tabelas internas rolam com o dedo (filho com overflow-y-auto + min-h-0)
[ ] Modais/Drawers/Sheets: conteúdo longo rola; backdrop não “come” o gesto após fechar
[ ] Não há overlay invisível bloqueando toque
[ ] Empty/loading/error states existem e são legíveis
[ ] Não há cards/overlays com contraste falho

### FASE 2B — Scroll / arrastar / corte (OBRIGATÓRIA — prioridade do dono)
Hipótese a provar ou refutar em CADA aba/rota crítica (evidência screenshot ou CDP):

Código a vasculhar (rg) — samples com path:linha:
1. `overflow-hidden` em ancestrais de listas (Admin shell usa `h-[100dvh] … overflow-hidden`
   — o filho scrollável PRECISA `min-h-0` + `overflow-y-auto` / `overflow-auto`)
2. `h-screen` / `100dvh` / `100vh` sem cadeia `flex` + `min-h-0`
3. `position: fixed` / sticky headers sem compensar padding no conteúdo
4. `touch-action: none` | `overscroll-behavior: none` | `pointer-events: none` em wrappers largos
5. body scroll lock (Radix Dialog) que não libera ao unmount
6. `overflow-x: hidden` no `body`/`#root` escondendo conteúdo em vez de layout responsivo
7. Tabelas largas sem `overflow-x-auto` (cortam) OU com overflow-x na página inteira (puxa horizontal)
8. Kanban / carrossel: gesto horizontal não pode matar scroll vertical da página

Teste manual (Browser MCP) — protocolo mínimo por superfície:
- Abrir superfície → scroll com dedo (ou drag sintético) do topo até o fim
- Abrir item longo (chat, drawer, dialog) → rolar interno → fechar → confirmar que a página
  de baixo VOLTA a rolar
- Em desktop-no-mobile: repetir nas abas WhatsApp, CRM, Captação, Ads, Agendamentos, Voz,
  Dashboard, Parceiros (as que a sessão permitir)
- Anotar: OK | CORTA | TRAVA | ÁREA_MORTA | 「não testado: limitação」

Qualquer CORTA / TRAVA / ÁREA_MORTA em superfície do dia a dia = **P0**.

### FASE 3 — Botões, controles e estados
1. Inventariar variants realmente usadas no Admin (rg `variant=`).
2. CTAs destrutivos usam `destructive` (não primary vermelho solto)?
3. Hit-target ≥ 44px em mobile nos CTAs principais? (medir screenshot/CDP)
4. Links vs buttons: ação ≠ navegação semântica errada em fluxos críticos.
5. Spinners: preferir tokens (`--pe-emerald` / primary) — achar divergências.
6. Dialogs/Drawers: focus trap + contraste header/body (Radix).

### FASE 4 — Acessibilidade e contraste (medido)
1. Amostrar 8 pares texto/fundo críticos (CTA, muted, sidebar active, pe-text-muted)
   e verificar WCAG 2.2 AA (4.5:1 texto normal; 3:1 large/UI).
2. Focus visível em Tab order do shell Admin (topbar → nav → conteúdo).
3. `prefers-reduced-motion`: há animações sem escape? (framer-motion / CSS)
4. `color-scheme` e meta theme-color batem com ThemeContext?

### FASE 5 — Velocidade e peso (medido)
1. `vite.config.ts`: manualChunks presentes? sourcemap false? chunkSizeWarningLimit?
2. Critical path: `App.tsx` / `Admin.tsx` — o que é lazy vs import estático?
3. Risco: three / @react-three / xlsx / jspdf / xyflow / recharts puxados cedo demais.
4. Fontes: contar famílias no @import Google Fonts do index.css; impacto LCP/CLS.
5. FOUC: script síncrono index.html + ThemeProvider — descrever sequência real do código.
6. Anti-cache: BUILD_ID + version.json + ausência de SW de cache (comentários vite).
7. Se conseguir build: listar top 15 chunks por tamanho (kB). Marcar >900kB.
8. Se Browser: Performance/Web Vitals em `/auth` e `/admin` (LCP, INP, CLS) — números.
9. Waterfall: requests bloqueantes (CSS fontes, JS vendor) — só o observado.
10. Re-render smells (código): lists sem key estável, fetch em loop, missing suspense boundary
    — só com path:linha; sem “talvez”.

### FASE 6 — Síntese cruzada design × velocidade
- Onde design “bonito” custa peso (ex.: muitas fontes, three no solar, framer em lista).
- Onde inconsistência de token gera CSS morto / duplicação.
- Quick wins (≤1h) vs projetos (>1d) — SEM implementar.

═══════════════════════════════════════════════════════════════════════════════
D) FORMATO DO RELATÓRIO FINAL (OBRIGATÓRIO)
═══════════════════════════════════════════════════════════════════════════════

# Auditoria Design + Velocidade — iGreen Official Portal
Data: YYYY-MM-DD  ·  Modelo: Opus 5 Max  ·  Modo: read-only

## Veredito
GO | GO COM RESSALVAS | NO-GO
1 frase. Contagem: P0=_ P1=_ P2=_ P3=_ · Limitações MCP: …

## Scorecard (0–10, justificar em 1 linha cada)
| Eixo | Nota | Evidência-âncora |
|---|---|---|
| Tokens / cores | /10 | |
| Tema light/dark | /10 | |
| Botões / controles | /10 | |
| Páginas / layout | /10 | |
| Mobile scroll/arrastar (nativo + desktop-no-mobile) | /10 | |
| A11y contraste | /10 | |
| Bundle / code-split | /10 | |
| Web Vitals / runtime | /10 | |
| Fontes / FOUC | /10 | |

## Achados (ordenar P0→P3)
Para cada:
### [P?] TÍTULO CURTO
- Superfície: rota/aba
- Evidência: path:linha e/ou screenshot e/ou métrica
- Impacto: usuário X sofre Y
- Correção sugerida (1–3 bullets, NÃO aplicar)
- Esforço: S / M / L

## Inventário FASE 0 (anexo compacto)
Tokens + rotas + chunks — tabelas curtas.

## Matriz superfície × tema × touch
Tabela: Superfície | Light | Dark | Mobile390 | Desktop1280 | DesktopTouch | Scroll/Arrastar | Corta? | Nota | Limitação?

Legenda Scroll/Arrastar: OK | CORTA | TRAVA | ÁREA_MORTA | N/T
Qualquer CORTA/TRAVA/ÁREA_MORTA em aba do dia a dia ⇒ contribui para NO-GO.

## Quick wins (máx 10)
Lista priorizada só com achados evidenciados.

## O que NÃO foi possível verificar
Lista honesta (sem login, sem build, MCP X down…).

## Declaração de certeza
“Nenhum achado P0/P1 foi emitido sem evidência path/screenshot/métrica.
Itens sem evidência foram marcados 「não encontrado」 ou LIMITAÇÃO.”

═══════════════════════════════════════════════════════════════════════════════
E) ANTI-ALUCINAÇÃO (CHECKLIST FINAL ANTES DE ENTREGAR)
═══════════════════════════════════════════════════════════════════════════════

[ ] Cada P0/P1 tem path:linha OU screenshot OU métrica medida
[ ] Nenhuma cor citada que não exista em index.css / painel-elite / screenshot
[ ] Nenhuma rota citada fora de App.tsx / rotas-ui (ou marcada não encontrada)
[ ] Não recomendei “voltar light-only”
[ ] Não tratei Evolution needs_reconnect como Zap offline
[ ] Não disparei envio / ads / migrate / deploy
[ ] Separei BUG vs INCONSISTÊNCIA vs MELHORIA
[ ] Limitações MCP declaradas
[ ] Testei (ou declarei limitação) os 3 viewports: mobile390 · desktop1280 · desktop-no-mobile touch
[ ] FASE 2B preenchida: nenhuma superfície do dia a dia ficou sem status de scroll/arrastar
[ ] Veredito coerente com P0 (qualquer P0 ⇒ NO-GO; scroll travado/cortado = P0)

FIM. Entregue só o relatório no formato D.
```
