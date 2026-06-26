# Plano: links públicos + fluxo Evolution

## 1. Diagnóstico — por que os links não abrem

As rotas públicas já estão fora do `ProtectedRoute`:

- `/:licenca` → `ConsultantPage`
- `/licenciado/:licenca` → `LicenciadaPage`
- `/cadastro/:licenca` → `CadastroPage`
- `/conexao-telecom|seguros|solar|placas|livre|club|club-pj|green|expansao/:licenca` → `ConexaoProductPage`
- `/r/:licenca/:code?` → `PartnerRedirectPage`
- `/proposta/:token` → `ProposalPublicPage`

Todas usam `useConsultant(licenca)` que lê da **view** `public.consultants_public`. A view existe, mas **não tem GRANT para o role `anon`** (e nem para `authenticated`). Resultado: visitante deslogado recebe permission denied e a página fica em loading/erro. Esse é o motivo real de "link não está público".

A tabela `consultants` em si segue privada (correto — tem dados sensíveis). Só a view enxuta (`id, license, name, phone, cadastro_url, photo_url, igreen_id, licenciada_cadastro_url, facebook_pixel_id, google_analytics_id, created_at, referred_by`) precisa ficar legível por qualquer um.

## 2. Correção (migration única)

```sql
GRANT SELECT ON public.consultants_public TO anon, authenticated;
```

Isso libera todos os links de consultor (incluindo Conexão Green, Placas, Seguros, Solar, Telecom, Livre, Club, Club PJ, Expansão, página de licenciada, cadastro e redirect curto `/r/...`) para abrir sem login.

Nenhuma página pública faz outras queries em tabelas privadas, então não precisa abrir mais nada.

## 3. Fluxo Evolution → Portal (documentação, sem mudança de código)

Como a mensagem caminha hoje:

```text
WhatsApp do cliente
        │
        ▼
Evolution API (instância do consultor)
        │  webhook
        ▼
edge: evolution-webhook
  ├─ parseEvolutionMessage  → extrai phone, pushName, mídia
  ├─ dedup (webhook_message_dedup)
  ├─ upsert customers (cria com pushName ou "Cliente XXXX")
  ├─ grava conversations + customer_memory
  └─ enfileira em whatsapp_message_buffer (janela de agregação)
        │
        ▼
edge: bot-step-runner / flow-engine
  ├─ lê customer_flow_state (sempre Fluxo D agora)
  ├─ resolve bot_flows + bot_flow_steps
  ├─ aplica guard proactive-send-guard (telefone verificado)
  └─ envia resposta via evolution-proxy
        │
        ▼
Portal (Admin / WhatsAppClientsPage)
  ├─ realtime em conversations
  └─ kanban PosVenda + CRM Deals
```

Pontos críticos atuais (todos já implementados, só estou listando para conferência):
- Todos consultores fixados em `active_variants=['D']` e `settings.flow_ab_mode='only_D'`.
- Guard de envio bloqueia disparo se telefone não bate com a instância (log em `outbound_blocked_log`).
- `pushName` capturado e usado no `customers.name`.

Se você quiser que algo mude na ordem (ex.: pular buffer, mudar dedup, alterar quando entra no kanban), me diga qual etapa está errada para ajustar — hoje vou apenas liberar os links.

## Detalhes técnicos

- 1 migration com o GRANT acima.
- Nenhuma mudança de código frontend nem de RLS.
- A view continua com as mesmas colunas; nenhum dado novo é exposto.
