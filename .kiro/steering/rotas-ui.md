---
inclusion: auto
name: rotas-ui
description: Rotas React Router e páginas admin. Use ao mexer em App.tsx, pages ou navegação.
---

# Rotas UI (src/App.tsx)

### Público
| Rota | Page | Faz |
|---|---|---|
| `/auth` | Auth | Login consultor |
| `/crm` | CRMLandingPage | Landing CRM |
| `/:licenca` | ConsultantPage | Landing consultor |
| `/cadastro/:licenca` | CadastroPage | Form lead |
| `/conexao-*/:licenca` | ConexaoProductPage | Landings produto |
| `/proposta/:token` | ProposalPublicPage | Orçamento público |
| `/r/:licenca/:code?` | PartnerRedirectPage | QR → WA (`qr-redirect`) |
| `/assistente` | AssistentePage | Chat público |

### Consultor `/admin`
Shell `Admin.tsx` (abas WhatsApp/CRM/ads/voz…). Atalhos:
| Rota | Page |
|---|---|
| `/admin/motor` | AdminMotorCadencia |
| `/admin/fluxos` | FluxoBuilder |
| `/admin/fluxo-b` | AdminFluxoB |
| `/admin/reaquecimento` | AdminReaquecimento |
| `/admin/saude-bot` | SaudeBot |
| `/admin/meta-ads` | AdminMetaAds |
| `/admin/portal-monitor` | AdminPortalMonitor |
| `/admin/voz` | → tab voz |
| `/admin/agendamentos-central` | AdminAgendamentosCentral |
| `/admin/solar-design` | features/solar-3d |
| `/consultor/mensagens` | ConsultantMessages |
| `/ajuda` | AjudaPage |

### Superadmin
| Rota | Page |
|---|---|
| `/super-admin` | SuperAdmin (kill switch, plataforma) |
| `/super-admin/suporte` | SuperAdminRemoteSupport |
| `/admin/saude-producao` | SaudeProducao |

CRM/captação/agenda vivem como **abas** em `/admin` (`components/whatsapp`, `captacao`), não rotas soltas.
