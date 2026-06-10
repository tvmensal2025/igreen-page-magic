# Relatório de Auditoria de UI/UX — Padronização iGreen

> Documento de diagnóstico. **Nenhum código de produção foi alterado.**
> Aguardando aprovação antes de executar as correções (etapas no fim).

## Resumo em uma frase

O sistema funciona, mas tem **3 a 4 "designs" diferentes brigando entre si**,
muita cor fora da paleta iGreen, uma área com cara de "terminal hacker" e
nomes técnicos (Lead, Dashboard, CRM) aparecendo para o usuário final.

---

## 1. Rotas / páginas encontradas (em `src/App.tsx`)

Público / consultor:
- `/` → redireciona para `/auth`
- `/auth` — login/cadastro
- `/:licenca` — página pública do consultor (catch-all)
- `/licenciado/:licenca` e `/licenciado/preview`
- `/cadastro/:licenca`
- `/crm` — landing page do CRM
- `/politica-privacidade`, `/install`, `/reset`
- `/assistente`

Área administrativa (`/admin/...`):
- `/admin` (painel principal, com abas internas)
- `/admin/whatsapp-clients`
- `/admin/fluxos`, `/admin/fluxo-b`
- `/admin/saude-bot`, `/admin/saude-producao`
- `/admin/conhecimento`, `/admin/reaquecimento`
- `/admin/conversao`, `/admin/meta-ads`
- `/admin/faq` e várias rotas legadas (redirecionam)

Super admin:
- `/super-admin`, `/super-admin/suporte`

Total: **403 arquivos `.tsx`** em `src/`.

## 2. Componentes globais encontrados

- Biblioteca **shadcn/ui** completa em `src/components/ui/` (button, card,
  input, select, dialog, badge, alert, table, sidebar, toast, tooltip etc.).
- Layout próprio em `src/components/layout/` (AppSidebar, AppHeader, AppTopbar,
  ResizableShell).
- Toasts via **sonner** + toaster do shadcn (293 chamadas a `toast.` no projeto).

## 3. Arquivos de tema / design system

- `tailwind.config.ts` — mapeia tokens via `hsl(var(--...))`. Bom: já é
  centralizado.
- `src/index.css` — tokens de cor reais (light + dark) + dezenas de classes
  utilitárias customizadas (`.btn-cta`, `.feature-card`, `.glass-card`...) +
  **um tema inteiro escopado `.ads-central-2026`** (emerald + dourado).
- `src/styles/painel-elite.css` — **outro tema completo** (`.painel-elite`,
  emerald escuro), que sobrescreve os tokens shadcn dentro do painel admin.

➡️ Existem **pelo menos 3 sistemas de cor concorrentes**: tema global,
`painel-elite` e `ads-central-2026`, além do tema "terminal" do dashboard.

## 4. Cores atuais encontradas

Token global (`index.css`):
- `--primary` verde `130 100% 32%` (≈ `#00A859`, **alinhado** com a marca ✅)
- `--accent` **laranja** `30 100% 50%` ❌ (fora da identidade pedida)
- `--destructive` vermelho `0 84% 60%` ✅

`painel-elite.css`: verde "emerald" escuro `#064e3b` / accent `#059669` +
dourado `#c9a84c`.
`ads-central-2026`: emerald `162 75% 28%` + dourado `40 72% 42%`.

## 5. Cores erradas / fora da paleta (números reais)

Classes Tailwind com cores que **não** são da paleta iGreen:

| Família | Ocorrências |
|---|---|
| blue | 181 |
| orange | 128 |
| purple | 89 |
| violet | 46 |
| cyan | 39 |
| rose | 36 |
| sky | 31 |
| pink | 11 |
| indigo | 9 |
| fuchsia | 1 |
| **Total fora da paleta** | **~566** |

Verde fora do token (hardcoded em vez de usar `primary`):
`emerald-*` 462x, `green-*` 215x, `teal-*` 14x, `lime-*` 12x.

Cores hex cravadas em classes (`bg-[#...]`): **96 ocorrências em 16 arquivos**.
Estilos inline com cor/background: **117 ocorrências**.

Pior ofensor visual: `src/components/admin/dashboard/` (FunnelStrip, MainChart,
RecentClicks, CpcPanel) usa fundo preto `#0a0f0a`, fonte mono e rótulos tipo
`FNL_04`, `CHART_01`, `PNL_02` — **estética de terminal/hacker**, o oposto de
"plataforma profissional".

## 6. Textos técnicos encontrados na interface

- "Lead" / "Leads" aparece em cabeçalhos de tabela e selects em várias telas
  (ConversaoTab, AdminMetaAds, AdminFaq, ResultsDashboard, NetworkHealthPanel,
  PartnerRankingTable, VariantsPanel, SaudeProducao).
- "Dashboard", "CRM Leads", "CRM Clientes" no menu lateral (`AppSidebar`).
- Códigos de painel `FNL_04`, `CHART_01`, etc. visíveis no dashboard.
- 66 arquivos usam `font-mono` (muitos exibem dados como se fossem "código").

## 7. Nomes inconsistentes para a mesma coisa

- "Lead" x "Cliente" x "Cliente interessado" x "Contato" usados de forma
  misturada para a mesma entidade.
- "Dashboard" (menu) x "Painel" (resto do texto).
- "Captação" x "Conversão" x "CRM" como abas separadas sem hierarquia clara.

## 8. Botões com texto/uso ruim

- `Button` base só tem 6 variantes shadcn padrão; o projeto cria botões
  manualmente com cores cravadas (ex.: `bg-[#1877F2]` do Facebook, vários
  `bg-red`, `bg-orange`).
- Botões "verde de marca" (`.btn-cta`) existem na landing, mas o painel usa
  outro verde (painel-elite). Falta um botão principal único.

## 9. Mensagens de erro técnicas

- 149 chamadas `toast.error(...)`. É preciso revisar caso a caso para garantir
  que nenhuma mostre texto cru de API/erro 500/"failed". (Amostragem necessária
  na etapa de execução.)

## 10. Problemas de responsividade (a confirmar com Playwright)

- Tabelas densas (`pe-table`, dashboards) tendem a estourar no mobile.
- Dashboard "terminal" usa grids fixos de 4 colunas.
- A confirmar nos breakpoints 390/430/768/1366/1920px.

## 11. Problemas de contraste (a confirmar)

- Cinzas claros como `text-zinc-500/600` sobre fundo claro em alguns painéis.
- Verde claro sobre branco em chips.
- `--accent` laranja sobre branco.

## 12. Arquivos que precisam ser alterados (prioridade)

Núcleo (alto impacto, baixo risco):
1. `src/index.css` — corrigir `--accent` p/ verde, unificar dourado, revisar dark.
2. `src/styles/painel-elite.css` — alinhar verdes ao token único.
3. `tailwind.config.ts` — opcional: expor `success/warning/info` como tokens.
4. `src/components/ui/button.tsx` e `badge.tsx` — variantes oficiais.

Limpeza de cor (médio esforço):
5. `src/components/admin/dashboard/*` — remover estética terminal.
6. ~16 arquivos com `bg-[#...]` e ~566 ocorrências de cores fora da paleta.

Linguagem:
7. `src/components/layout/AppSidebar.tsx` — renomear itens do menu.
8. Tabelas/selects com "Lead" → "Cliente interessado".

## 13. Plano de correção por prioridade (proposto)

- **Etapa 1 — Tokens.** Unificar paleta em `index.css` + `painel-elite.css`
  (verde único `#00A859`/`#007A3D`, accent deixa de ser laranja, dourado só
  onde fizer sentido). Zero mudança de layout.
- **Etapa 2 — Componentes base.** Padronizar `button`, `badge`, `card`, alertas
  e o dashboard "terminal".
- **Etapa 3 — Cores espalhadas.** Trocar `blue/purple/orange/...` e hex cravados
  por tokens semânticos.
- **Etapa 4 — Linguagem.** Menu, tabelas, selects e títulos para PT-BR humano.
- **Etapa 5 — Mensagens.** Revisar toasts de erro/sucesso.
- **Etapa 6 — Responsividade + contraste** (validação Playwright).
- **Etapa 7 — Varredura final** (`tsc --noEmit`, `vite build`, revisão visual).

## Riscos / cuidados

- Não mexer em nomes internos de banco/variáveis (só no que o usuário vê).
- `painel-elite` e `ads-central-2026` afetam telas inteiras; mudar tokens deles
  exige revisão visual cuidadosa.
- Validar sempre com `npx tsc --noEmit` e `npx vite build` antes de commitar.
