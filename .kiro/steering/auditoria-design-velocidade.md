---
inclusion: manual
name: auditoria-design-velocidade
description: Prompt canônico da auditoria de design + velocidade (Opus 5 Max / Kiro). Use #auditoria-design-velocidade.
---

# Auditoria Design + Velocidade (Opus / Kiro)

Varredura **certeira** (read-only) de UI e performance do front: cores/tokens, tema light/dark, botões, páginas/abas, contraste, bundle, lazy, Web Vitals, fontes, FOUC.

**Prioridade do dono:** uso intenso no **celular** e em **modo desktop no mobile**. Em todas as páginas o scroll/arrastar com o dedo deve funcionar — nunca cortar conteúdo, nunca travar toque, nunca área morta.

Fonte canônica do prompt:

- Cursor command: `.cursor/commands/auditoria-design-velocidade.md`
- Cópia docs: `docs/PROMPT-AUDITORIA-DESIGN-VELOCIDADE-OPUS.md`

No Kiro: abra o arquivo, copie o bloco **PROMPT**, rode com **Opus 5 Max**, modo somente leitura. **Não edite** código nesta auditoria.

## MCPs obrigatórios

| Server | Uso |
|---|---|
| Browser / Playwright | smoke visual light+dark; mobile+desktop; sem disparar envio/ads |
| Analyzer (`…-analyzer`) | `biome-check` / `analyze-code` em hotspots UI — **sem** format write |
| Context7 | Web Vitals, Vite split, WCAG contraste, font-display |
| Supabase | só URL/sanity se precisar — **sem** apply/deploy/DML |

## Fontes da verdade (não inventar paleta)

| Artefato | Papel |
|---|---|
| `src/index.css` | tokens HSL light/dark (marca `#00A859` / `#007A3D`) |
| `src/styles/painel-elite.css` | `--pe-*` do shell `.painel-elite` |
| `.ads-central-2026` / `--ads-*` | escopo Ads |
| `--pv-*` + `features/produtos/theme.ts` | módulo Produtos |
| `ThemeContext` + `ThemeToggle` + `igreen-theme` | dual light/dark + FOUC |
| `src/components/ui/button.tsx` | variants CVA |
| `src/App.tsx` + `Admin.tsx` | rotas e abas lazy |
| `vite.config.ts` | manualChunks + anti-cache BUILD_ID |

Steering relacionado: `#nomes-e-tema` · `#rotas-ui` · `#convencoes` · regra `.cursor/rules/tema-light-only.mdc`.

## Regra de certeza

Achado P0/P1 **sem** `path:linha` / screenshot / métrica medida = **inválido**. Sem dado = `「não encontrado」` ou `LIMITAÇÃO MCP`. Qualquer P0 ⇒ veredito **NO-GO**.

Scroll/arrastar cortado ou travado (mobile nativo **ou** desktop-no-mobile) em superfície do dia a dia = **P0**. Viewports obrigatórios: ~390 · ~1280 · largura desktop + input touch.

## Pacote já aplicado no código (2026-07-25)

Validado com `npm run build`: preload do entry = só `react-vendor`, `radix`, `icons`, `supabase` (sem three/jspdf/charts/xyflow). Touch 44px sem shrink em `lg:` nas superfícies WhatsApp/Captação/Pós-venda/Produtos/nav. Contraste primary painel+Ads light + badges ink. Fontes no `index.html`. Detalhe em `#AUDITORIA-STEERING`.
