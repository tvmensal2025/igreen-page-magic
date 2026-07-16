# 06 — Rotas, telas e navegação

**Fonte:** `src/App.tsx` (rotas), `src/pages/*`, `src/pages/Admin.tsx`, `src/pages/SuperAdmin.tsx`, `ProtectedRoute.tsx`  
**Data:** 2026-07-16  

---

## 1. Resumo

| Item | Valor |
|---|---|
| Declarações `<Route>` em App.tsx | 50+ paths (incl. redirects) |
| Páginas em `src/pages/` | 39 arquivos |
| Lazy loading | Quase todas as páginas via `React.lazy` |
| Guard de sessão | `ProtectedRoute` (só sessão, não role) |
| Catch-all de licença | `/:licenca` → `ConsultantPage` (**antes** de `*` NotFound) |
| Redirect `/` | → `/auth` |

---

## 2. Matriz de rotas

Legenda proteção: **P** = ProtectedRoute; **Pub** = pública; **Redir** = Navigate.

| Path | Elemento | Proteção | Arquivo da página | Existe? | Notas |
|---|---|---|---|---|---|
| `/auth` | Auth | Pub | `pages/Auth.tsx` | Sim | Login |
| `/tutorial` | Tutorial | Pub | `pages/Tutorial.tsx` | Sim | |
| `/admin` | Admin | P | `pages/Admin.tsx` | Sim | Hub principal + tabs |
| `/admin/whatsapp-clients` | WhatsAppClientsPage | P | `pages/WhatsAppClientsPage.tsx` | Sim | Redirect interno p/ `?tab=clientes` |
| `/admin/clientes-igreen` | Navigate | Redir | — | — | → whatsapp-clients?tab=igreen |
| `/clientes-igreen` | Navigate | Redir | — | — | idem |
| `/admin/fluxos` | FluxoBuilder | P | `pages/FluxoBuilder.tsx` | Sim | |
| `/admin/fluxo-b` | AdminFluxoB | P | `pages/AdminFluxoB.tsx` | Sim | |
| `/admin/saude-bot` | SaudeBot | P | `pages/SaudeBot.tsx` | Sim | |
| `/admin/saude-producao` | SaudeProducao | P | `pages/SaudeProducao.tsx` | Sim | |
| `/admin/portal-monitor` | AdminPortalMonitor | P | `pages/AdminPortalMonitor.tsx` | Sim | |
| `/admin/conhecimento` | AdminKnowledge | P | `pages/AdminKnowledge.tsx` | Sim | |
| `/admin/reaquecimento` | AdminReaquecimento | P | `pages/AdminReaquecimento.tsx` | Sim | |
| `/admin/voz` | AdminVoz | P | `pages/AdminVoz.tsx` | Sim | Também aba `voz` no Admin |
| `/admin/recon` | AdminReconIgreen | P | `pages/AdminReconIgreen.tsx` | Sim | |
| `/admin/conversao` | AdminConversao | P | `pages/AdminConversao.tsx` | Sim | Também aba no Admin |
| `/admin/agendamentos` | Navigate | Redir | — | — | → `/admin?tab=agendamentos` |
| `/admin/meta-ads` | AdminMetaAds | P | `pages/AdminMetaAds.tsx` | Sim | |
| `/admin/protocolos` | AdminProtocolsPage | P | `pages/AdminProtocolsPage.tsx` | Sim | |
| `/admin/motor` | AdminMotorCadencia | P | `pages/AdminMotorCadencia.tsx` | Sim | |
| `/admin/agendamentos-central` | AdminAgendamentosCentral | P | `pages/AdminAgendamentosCentral.tsx` | Sim | |
| `/consultor/mensagens` | ConsultantMessages | P | `pages/ConsultantMessages.tsx` | Sim | |
| `/ajuda` | AjudaPage | P | `pages/AjudaPage.tsx` | Sim | |
| `/admin/ajuda/editor` | AdminTourEditor | P | `pages/AdminTourEditor.tsx` | Sim | |
| `/admin/solar-design` | SolarDesignPage | P | `features/solar-3d/pages/…` | Sim | |
| `/admin/solar-design/:snapshotId` | SolarDesignDetailPage | P | idem | Sim | Param `snapshotId` |
| `/experiments/solar-3d` | SolarDesignPage | P | idem | Sim | Alias experimental |
| `/admin/faq` | Navigate | Redir | — | — | → conhecimento?tab=ia |
| `/admin/fluxos-legado` | Navigate | Redir | — | — | → fluxos |
| `/admin/fluxos-antigo` | Navigate | Redir | — | — | → fluxos |
| `/admin/bot-tools` | Navigate | Redir | — | — | → whatsapp-clients |
| `/admin/bot-audit` | Navigate | Redir | — | — | → whatsapp-clients |
| `/super-admin` | SuperAdmin | P | `pages/SuperAdmin.tsx` | Sim | Role check na página (a confirmar) |
| `/super-admin/suporte` | SuperAdminRemoteSupport | P | `pages/SuperAdminRemoteSupport.tsx` | Sim | |
| `/assistente` | AssistentePage | **Pub?** | `pages/AssistentePage.tsx` | Sim | **Sem ProtectedRoute** |
| `/crm` | CRMLandingPage | Pub | `pages/CRMLandingPage.tsx` | Sim | |
| `/licenciado/preview` | LicenciadaPreview | Pub | `pages/LicenciadaPreview.tsx` | Sim | |
| `/licenciado/:licenca` | LicenciadaPage | Pub | `pages/LicenciadaPage.tsx` | Sim | Param `licenca` |
| `/cadastro/:licenca` | CadastroPage | Pub | `pages/CadastroPage.tsx` | Sim | |
| `/politica-privacidade` | PoliticaPrivacidade | Pub | sim | Sim | |
| `/install` | InstallPage | Pub | sim | Sim | PWA install |
| `/reset` | ResetApp | Pub | sim | Sim | Reset app/cache |
| `/conexao-telecom/:licenca` … `/conexao-club-pj/:licenca` | ConexaoProductPage | Pub | sim | Sim | 7 produtos |
| `/conexao-green/:licenca` | RedirectConexaoGreen | Pub | `ConexaoCanonicalRedirects.tsx` | Sim | Redirect canônico |
| `/conexao-expansao/:licenca` | RedirectConexaoExpansao | Pub | idem | Sim | |
| `/proposta/:token` | ProposalPublicPage | Pub | sim | Sim | Token público |
| `/r/:licenca/:code?` | PartnerRedirectPage | Pub | sim | Sim | QR / short link → `qr-redirect` |
| `/:licenca` | ConsultantPage | Pub | sim | Sim | **Catch-all 1º nível** |
| `/` | Navigate → `/auth` | Redir | — | — | |
| `*` | NotFound | Pub | `pages/NotFound.tsx` | Sim | |

### Páginas existentes sem rota direta em App.tsx

| Arquivo | Situação |
|---|---|
| `src/pages/Index.tsx` | **Sem rota** em App.tsx — possível legado |
| `src/pages/AdminFaq.tsx` | Rota `/admin/faq` redireciona; página pode estar órfã |

**Grau de certeza:** Confirmado ausência de import em App.tsx (grep de rotas). Uso indireto ainda a verificar (código morto — etapa 19).

---

## 3. Catch-all `/:licenca` — riscos de navegação

Comentário no próprio `App.tsx` (linhas 167–169): qualquer rota nova **abaixo** dessa linha seria engolida como licença.

Ordem atual (correta para as rotas listadas): rotas estáticas/admin **acima** do catch-all.

**Colisões potenciais se alguém criar path de 1 segmento sem declarar acima:**

Exemplos hipotéticos: `/billing`, `/status` → cairiam em `ConsultantPage` com `licenca=billing`.

Deep link após reload: BrowserRouter + lazy — funciona se o path estiver declarado; `/:licenca` resolve sempre (mesmo licença inválida — validação na página).

---

## 4. Lazy loading

- Padrão: `lazy(() => import("./pages/..."))`.
- Named exports: `RedirectConexaoGreen/Expansao` usam `.then(m => ({ default: m.X }))` — padrão correto.
- Fallback: spinner full-screen em `Suspense`.
- Risco conhecido tratado em `main.tsx`: `vite:preloadError` / chunk load → nuke SW + reload com anti-loop.

---

## 5. Proteção administrativa

| Camada | O que faz | O que NÃO faz |
|---|---|---|
| `ProtectedRoute` | Exige sessão Supabase | Não checa `role`, aprovação de consultor, super-admin |
| `useAdminAuth` (Admin) | Loading/aprovação consultor | — |
| SuperAdmin page | Deve validar papel (a auditar no corpo) | Guard de rota não filtra |
| RLS | Isolamento de dados | Depende de policies |

**Achado preliminar (não P0 ainda):** `/assistente` pública quanto à rota — necessita leitura da página para ver se autentica internamente.

---

## 6. Parâmetros públicos

| Param | Rotas | Validação esperada (a confirmar na página/EF) |
|---|---|---|
| `licenca` | landings, `/:licenca`, `/r/...` | Consultor existente / slug |
| `token` | `/proposta/:token` | Entropia + existência em EF |
| `snapshotId` | solar detail | UUID + ownership consultor |
| `code` | `/r/:licenca/:code?` | short_code parceiro |

---

## 7. Abas do painel Admin (`/admin?tab=`)

Fonte: `ADMIN_TAB_IDS` em `Admin.tsx` + persistência `localStorage` chave `igreen_admin_active_tab_v1`.

| Tab ID | Painel lazy | Observação |
|---|---|---|
| `dashboard` | DashboardTab | |
| `crm` | CrmTabs | |
| `crm-clientes` | PosVendaKanban / clientes CRM | |
| `conversao` | ConversaoCockpit | |
| `clientes` | CustomerManager | |
| `financeiro` | FinanceiroPanel | |
| `produtos` | ProdutosModule | sub-tabs via `ProdutosTabId` |
| `captacao` | CaptacaoPanel | |
| `parceiros` | ParceirosTab | rodízio/parceiros |
| `whatsapp` | WhatsAppTab | sub: atendimentos/agente/decisoes/… |
| `agendamentos` | AgendamentosHub | |
| `central-anuncios` | AdsCentralTab | aliases `performance`, `anuncios` |
| `links` | LinksTab | alias `preview` |
| `materiais` | MaterialsTab | |
| `audio-studio` | AudioStudio | |
| `voz` | VozTab | |
| `academy` | AcademyTab | |

Aliases de query tratados no init do estado (linhas 95–100+).

---

## 8. Abas Super Admin

Fonte: array `tabs` em `SuperAdmin.tsx` (~linha 270):

| ID | Label |
|---|---|
| `consultores` | Consultores |
| `captacao` | Captação |
| `gestores_ads` | Gestores Ads |
| `saude_rede` | Saúde da Rede |
| `crm` | Análise de clientes |
| `funil` | Funil do Bot |
| `worker` | Worker Phases |
| `auditoria` | Auditoria |
| `ia` | IA / Conhecimento |
| `ia_aprendendo` | IA Aprendendo |
| `plataforma_fb` | Plataforma FB |
| `templates_ads` | Templates de Anúncio |
| `templates_fluxo` | Templates de Fluxo |
| `financeiro` | Financeiro / P&L |
| `rollout` | Rollout V3 |
| `solar` | Solar 3D |

Kill switch bot global: componente `BotGlobalKillSwitch` (referenciado nas regras do projeto) — confirmar aba/local na leitura profunda do SuperAdmin.

---

## 9. Query string vs path

- Admin: navegação primária por **`?tab=`** + localStorage (deep link parcial; reload restaura tab se query ou storage).
- Rotas dedicadas (`/admin/fluxos`, `/admin/meta-ads`, …) coexistem com tabs — possível duplicidade UX (ex.: conversão em tab e em `/admin/conversao`).
- Redirects legados mantidos para não quebrar links antigos em mensagens/materiais.

---

## 10. Checklist etapa 4 (status)

| Verificação | Status |
|---|---|
| Página existe para cada Route | Quase todas confirmadas; Index/AdminFaq órfãs prováveis |
| Import correto / lazy named | OK nos redirects Conexão |
| Rota inacessível | Index.tsx sem rota |
| Rota duplicada funcional | conversao/voz/solar em path + tab |
| Redirect legado | Vários Navigate confirmados |
| Catch-all engolindo rota válida | Mitigado pela ordem atual; frágil a novas rotas |
| Admin protegido | Sessão sim; role incompleto no guard |
| Público expondo dados | Proposta/Solar/landings — auditar EFs |
| Params validados | Pendente (páginas + EFs) |
| Deep link reload | BrowserRouter OK; tab admin via query/storage |
| Estado só em memória | Tour/remote-support — verificar |
| Query string consistente | Aliases existem; documentar contratos |

---

## 11. Próximo

Auditoria frontend profunda (hooks, realtime, storage, permissões de botões) e em paralelo banco/RLS + edge functions prioritárias (`verify_jwt=false`).
