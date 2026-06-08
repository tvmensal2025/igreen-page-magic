# 05 — Fluxos do Sistema

> Última atualização: 08/06/2026

---

## 1. Fluxo de Captação de Lead

```
Tráfego pago (Meta Ads)
  → Clique no anúncio com fbclid
  → /:licenca (ConsultantPage)
  → Formulário multi-step:
     1. CEP + valor da conta
     2. "Garantir minha economia" (CTA)
     3. CPF
     4. WhatsApp
     5. Email
     6. Endereço completo
     7. Distribuidora
     8. Tipo de documento
     9. Perguntas finais
  → Salva em `customers` (status parcial em cada step)
  → Registra lead_source (fbclid, utm_source, parceiro)
  → Dispara cadastro no portal iGreen (Worker)
  → Notifica consultor por WhatsApp
  → Lead entra no CRM (Kanban)
```

**Onde pode falhar:**
- Lead abandona no meio → dados parciais ficam no banco sem follow-up automático
- Worker offline → cadastro no portal falha silenciosamente
- Fbclid não capturado → perde atribuição de campanha

**Arquivos envolvidos:** `ConsultantPage.tsx`, `CadastroPage.tsx`, `captacao/`, `finalize-capture/`, `worker-portal/`

---

## 2. Fluxo de WhatsApp (Bot Automático)

```
INBOUND:
  WhatsApp do cliente
    → Evolution API
    → POST /functions/v1/evolution-webhook
    → Parsing do evento
    → CONNECTION_UPDATE? → handlers/connection.ts
    → MESSAGE? →
      - Dedup (webhook_message_dedup)
      - Rate limit (try_acquire_rate_limit)
      - Customer lock (try_acquire_customer_lock)
      - Identifica/cria customer
      - Download de mídia (se anexo)
      - OTP intercept? (handlers/otp-intercept.ts)
      - Bot enabled? Global flag? Consultor enabled?
      - Paused? (takeover manual ativo?)
      - Rota engine:
        * Legacy step-based (handlers/bot-flow.ts)
        * Conversacional (handlers/conversational/)
        * Engine v3 (engine/)
      - Gera resposta
      - Anti-ban (checkSendQuota)
      - Typing presence (humanJitterMs)
      - Envia resposta
      - Log step transition
      - CRM stage sync
      - Release lock
```

**Onde pode falhar:**
- Lock não adquirido → mensagem descartada (raro, mas possível)
- Quota anti-ban atingida → resposta não enviada
- Gemini quota esgotada → IA não responde
- Media download falha → vai para inbound_media_retry
- Worker falha no cadastro → cliente fica preso no step

---

## 3. Fluxo Manual (Chat do Consultor)

```
Consultor abre /admin → Tab WhatsApp → ChatView
  → useChats() carrega lista de contatos (Evolution API)
  → Seleciona contato
  → useMessages() carrega histórico
  → MessageComposer:
    - Texto livre
    - Template (TemplatePickerPopover)
    - Áudio (AudioRecorderInline)
    - Mídia (MediaLibraryPicker)
    - Documento
  → messageSender.sendWhatsAppMessage()
  → Per-contact rate limit (5s)
  → evolutionApi proxy → Evolution API
  → Auto-takeover: marca customer como "manual" por 30min
  → Bot pausa para aquele cliente
```

**Onde pode falhar:**
- Sessão expirada → EvolutionAuthError (tela de login)
- Instância desconectada → mensagem não sai
- Rate limit do frontend diferente do backend → inconsistência

---

## 4. Fluxo de Campanhas (Meta Ads)

```
Consultor → /admin/meta-ads
  → ConnectFacebookCard: OAuth2 (facebook-oauth-start → callback)
  → Seleciona: Ad Account, Page, Pixel (facebook-select-assets)
  → Cria campanha:
    - Wizard completo (CreateCampaignWizard)
    - OU Express (ExpressCampaignDialog) — IA gera copy
  → facebook-create-campaign (Edge Function)
  → Facebook Marketing API cria campanha/adset/ad
  → CAPI: eventos de conversão (facebook-capi)
  → Crons:
    - facebook-sync-metrics (diário)
    - facebook-campaign-healthcheck
    - facebook-auto-pause (se gasto > orçamento)
    - facebook-balance-reconcile
  → Dashboard com métricas em tempo real
  → Wallet controla gasto (prepaid, não crédito)
```

**Onde pode falhar:**
- Token OAuth expira → facebook-token-refresh precisa funcionar
- Balance insuficiente → campanha deveria pausar automaticamente
- Pixel mal configurado → CAPI não funciona → sem otimização
- Auto-pause falha → gasta mais que o orçamento

---

## 5. Fluxo de Reaquecimento

```
Leads frios (sem interação há X dias)
  → reactivation-cron identifica leads elegíveis
  → reactivation-send dispara mensagens
  → Usa templates de reaquecimento
  → Se lead responde → volta para fluxo automático
  → Se não responde → marca como cold
```

---

## 6. Fluxo de Follow-up

```
Bot envia mensagem → cliente não responde
  → ai-followup-cron verifica (intervalo configurável)
  → Identifica customers sem resposta por X horas
  → Gera follow-up contextual (IA)
  → Verifica anti-ban + quiet hours
  → Envia follow-up
  → Máximo 2-3 follow-ups antes de desistir
```

---

## 7. Fluxo de Pós-Venda

```
Lead fecha negócio (cadastro concluído)
  → CRM move para stage "pós-venda"
  → pos-venda-auto-progress: avança etapas automaticamente
  → pos-venda-bucket-cron: verifica status do cadastro no portal
  → Envia atualizações ao cliente
  → Notifica consultor de mudanças de status
```

---

## 8. Fluxo de IA Vendedora (Conversacional)

```
Mensagem do cliente chega
  → flow-router decide: "conversational"
  → _shared/vendedora/:
    - state-machine.ts: gerencia estados (apresentação → qualificação → objeção → fechamento)
    - perfilador.ts: extrai perfil do lead
    - memory.ts: recupera memória de conversas anteriores
    - rag.ts: busca knowledge base relevante
    - orchestrator.ts: monta prompt com contexto
    - gateway.ts: chama Gemini
    - closer.ts: detecta oportunidade de fechamento
    - critico.ts: analisa qualidade da resposta gerada
  → Resposta humanizada + CTA
  → Registra aprendizado
```

---

## 9. Fluxo de Webhook → CRM

```
Mensagem processada → resultado do bot-flow
  → syncDealStageFromStep: mapeia step → estágio CRM
  → crm-auto-progress: avança deals automaticamente
  → KanbanBoard (frontend) mostra posição atualizada
  → Lead temperature classifier: classifica quente/morno/frio
```

---

## 10. Fluxo de Cadastro no Portal iGreen

```
Customer tem todos os dados preenchidos
  → finalize-capture / Worker Portal
  → Worker Playwright:
    - Abre portal iGreen (digital.igreenenergy.com.br)
    - Preenche formulário automaticamente
    - Intercepta OTP → submit-otp Edge Function
    - Tira screenshots de cada step
    - Retorna status (sucesso/erro)
  → Atualiza customer no banco
  → Se erro → portal-offline-retry (retry cron)
  → Se sucesso → pós-venda ativado
```

**Onde pode falhar:**
- Portal iGreen offline
- OTP não chega
- Portal muda HTML (quebraria Playwright)
- Worker sem capacidade (fila)

---

## 11. Pontos Críticos do Funil

| Etapa | Risco de Perda | Motivo |
|-------|----------------|--------|
| Anúncio → Landing | ALTO | CTA fraco, landing lenta |
| Landing → CEP/Conta | MÉDIO | Formulário confuso |
| CEP → CPF | ALTO | Desconfiança (pedir CPF cedo) |
| CPF → WhatsApp | MÉDIO | Já pediu dado sensível antes |
| WhatsApp → Bot responde | ALTO | Bot pode demorar, quota, ban |
| Bot → Cadastro completo | ALTO | Muitos steps, abandono |
| Cadastro → Portal fechado | MÉDIO | Worker falha, OTP |
| Pós-venda → Ativação | BAIXO | Processo mais simples |
