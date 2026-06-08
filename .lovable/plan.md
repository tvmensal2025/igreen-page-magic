# Suporte Remoto Super Admin — "iGreen Assist"

Funcionalidade isolada para o Super Admin (rafael.ids@icloud.com) prestar suporte remoto dentro do navegador do consultor: ver a tela, abrir/fechar abas, clicar, preencher campos e navegar pelo portal iGreen — com autorização explícita por código de uso único e log completo de ações.

## Como vai funcionar (visão do usuário)

1. **Consultor** clica em "Pedir ajuda ao suporte" no Admin.
2. Aparece um modal: "Aguardando o suporte aceitar...".
3. **Super Admin** recebe uma notificação ("Rafael Ferreira 2 está pedindo ajuda") e clica "Aceitar".
4. Na tela do **consultor** aparece um código de 6 dígitos que muda a cada 30s (estilo TOTP). Ele lê o código por telefone/whats.
5. **Super Admin** digita o código. Se bater, a sessão abre.
6. Banner vermelho fixo no topo da tela do consultor: "🔴 Suporte ativo — Rafael está vendo sua tela. [Encerrar]".
7. Super Admin vê a tela do consultor em tempo real (WebRTC screen share) e pode pedir para executar ações via painel lateral.
8. Consultor encerra quando quiser. Tudo fica logado.

## Fluxo alternativo (Super Admin inicia)

Super Admin pode também solicitar acesso primeiro. Aparece popup no consultor com "Rafael está pedindo acesso. [Autorizar] [Recusar]". Se autorizar, mostra o código rotativo e segue o fluxo acima.

## Stack escolhida (e por quê)

| Necessidade | Solução | Motivo |
|---|---|---|
| Ver a tela do consultor | **WebRTC** (`getDisplayMedia` + `RTCPeerConnection`) | Padrão usado por Google Meet, peer-to-peer, baixa latência, zero servidor de mídia. |
| Sinalização (trocar SDP/ICE) | **Supabase Realtime Channels** | Já temos Supabase, sem infra nova. |
| Executar ações no DOM do consultor | **Mensagens via Realtime → handler isolado no app** | Roda no contexto do app, não precisa extensão. Limita a ações seguras pré-aprovadas. |
| Controle fora do app (outras abas/sites) | **Extensão Chrome já existente** (`igreen-sync`) ganha módulo `remote-control` | A extensão tem permissão `tabs` e pode injetar scripts em abas autorizadas. |
| Autorização | **Código TOTP de 6 dígitos** + validação server-side via edge function | Padrão de mercado (AnyDesk/TeamViewer). |
| Auditoria | Tabela `remote_support_logs` no Supabase | Toda ação fica registrada com timestamp, ator, target, payload. |

**Isolamento:** tudo vive em `src/features/remote-support/` + extension/igreen-sync/remote/ + edge functions próprias. Nenhum código existente é modificado além de:
- adicionar 1 botão "Pedir ajuda" no header do Admin
- adicionar 1 entrada "Suporte Remoto" no menu do Super Admin
- a extensão ganha 1 novo content script opt-in (não mexe no bridge atual)

## Arquitetura técnica

```text
┌────────────────────┐         Supabase Realtime          ┌────────────────────┐
│  Consultor (web)   │ ◄──── canal: support:{sessionId} ──► │ Super Admin (web)  │
│                    │                                     │                    │
│  - Banner suporte  │ ◄═══════ WebRTC (vídeo tela) ═════►│  - Player de vídeo │
│  - Action handler  │ ◄════ DataChannel (comandos) ═════►│  - Painel comandos │
│  - Extensão opt-in │                                     │                    │
└─────────┬──────────┘                                     └─────────┬──────────┘
          │                                                          │
          └──────────────► Supabase (Postgres + Edge) ◄───────────────┘
                          - sessions, logs, códigos TOTP
                          - edge: request-session, authorize-session,
                                  verify-code, end-session
```

### Banco de dados (novas tabelas)

- `remote_support_sessions` — id, requester_id (consultor), operator_id (super admin), status (`requested`|`pending_code`|`active`|`ended`|`rejected`), started_at, ended_at, end_reason, ip_requester, ip_operator
- `remote_support_codes` — session_id, code_hash (bcrypt do código atual), rotates_at, attempts, max_attempts (3), consumed_at
- `remote_support_logs` — session_id, actor (`operator`|`requester`|`system`), action (`open_url`|`close_tab`|`click`|`fill`|`screen_started`|`screen_stopped`|`session_ended`), target (selector/URL), payload jsonb, created_at

RLS:
- Consultor vê só suas próprias sessions/logs (`requester_id = auth.uid()`).
- Super Admin (via `is_super_admin`) vê tudo.
- Códigos: só edge function (service_role) lê/escreve. Cliente nunca recebe o hash.

### Edge Functions

- `remote-support-request` — consultor cria sessão (`status=requested`), notifica super admin via Realtime broadcast.
- `remote-support-accept` — super admin aceita; gera primeiro código de 6 dígitos, salva hash, status vira `pending_code`. Retorna o código **apenas via Realtime ao consultor** (nunca ao operador).
- `remote-support-rotate-code` — chamada a cada 30s pelo consultor; gera novo código e invalida o anterior.
- `remote-support-verify-code` — operador envia código; edge valida hash, conta tentativas, ativa sessão se ok (`status=active`). 3 erros = `rejected`.
- `remote-support-end` — qualquer lado encerra; status `ended`, fecha canal.
- `remote-support-log` — registra ação no log (chamada pelo handler do consultor).

### Cliente — Consultor

- `src/features/remote-support/RemoteSupportProvider.tsx` — monta no `App.tsx` (1 linha), escuta Realtime para sessions onde `requester_id = auth.uid()`.
- `RequestHelpButton.tsx` — botão no header do Admin.
- `IncomingOperatorRequestDialog.tsx` — popup quando o Super Admin inicia.
- `ActiveSessionBanner.tsx` — banner vermelho fixo com botão Encerrar e código rotativo visível.
- `actionHandler.ts` — recebe comandos via DataChannel e executa apenas a allowlist:
  - `navigate(url)` — `window.location.href` se mesma origem; abre nova aba se externa
  - `openTab(url)`, `closeTab(tabId)` — via extensão
  - `click(selector)`, `fill(selector, value)`, `scrollTo(selector)` — no DOM do app
  - `screenshot()` — captura via `getDisplayMedia` (já ativo)
  - Cada execução chama `remote-support-log` antes.
- `screenShare.ts` — `getDisplayMedia` + `RTCPeerConnection` + signaling via Realtime.

### Cliente — Super Admin

- `src/pages/SuperAdminRemoteSupport.tsx` — lista de pedidos pendentes + sessões ativas.
- `SupportSessionView.tsx` — player `<video>` com a tela do consultor, painel lateral de comandos (campo URL, botão "Abrir aba", inspetor simples para gerar seletor a partir de coordenadas), histórico de ações.
- `CodeEntryDialog.tsx` — campo para digitar o código de 6 dígitos.

### Extensão Chrome (módulo opt-in)

- `extension/igreen-sync/remote/content.js` + `background.js` — só ativa se a aba enviou `enable-remote-support` (vindo do app durante sessão ativa). Permite `tabs.create`, `tabs.remove`, `tabs.update`, e screenshot de outras abas.
- Manifesto bump para `1.5.0`, adiciona permissão `scripting` se ainda não tiver, mantém `all_frames: true`.
- Sem essa extensão o suporte ainda funciona — só perde controle de outras abas; tela do app continua compartilhada.

### Segurança

- Super Admin gate por `is_super_admin(auth.uid())` em **todas** edge functions de operador.
- Código de 6 dígitos: gerado via `crypto.randomInt`, hash bcrypt, rotação 30s, 3 tentativas, expira ao consumir.
- Sessão sempre iniciada por confirmação humana do consultor (clicar aceitar ou ler código).
- Banner persistente impossível de fechar via comando (handler ignora ações sobre o próprio elemento).
- Allowlist de ações — o operador nunca executa JS arbitrário no DOM.
- Logs imutáveis (RLS bloqueia UPDATE/DELETE para todos exceto service_role).
- WebRTC com DTLS-SRTP (padrão do browser), peer-to-peer — Supabase só vê sinalização.

### Auditoria

Página `/super-admin/suporte/historico` lista todas as sessões com filtro por consultor/data e drill-down nos logs.

## Entregáveis (ordem de implementação)

1. **Migração SQL**: 3 tabelas + RLS + função `generate_support_code()` + trigger de log imutável.
2. **6 Edge Functions** acima.
3. **Provider + hooks** do consultor (`useRemoteSupport`, `useScreenShare`).
4. **UI consultor**: botão Pedir ajuda, dialog de autorização, banner ativo.
5. **UI super admin**: página `/super-admin/suporte`, lista de pedidos, view de sessão com player + painel de comandos.
6. **Módulo extensão** `remote/` + bump 1.5.0 + repack ZIP.
7. **Página de histórico/auditoria**.
8. Documentação curta em `docs/suporte-remoto.md`.

## Fora do escopo (não vou fazer agora)

- Controle do sistema operacional fora do navegador (precisaria RustDesk).
- Gravação de vídeo (só log textual).
- Suporte simultâneo de múltiplos operadores na mesma sessão.
- Chat de texto integrado (usar WhatsApp como hoje).

## O que vou precisar de você

Nada extra agora — toda infra é Supabase + browser nativo. Sem secrets novos.
