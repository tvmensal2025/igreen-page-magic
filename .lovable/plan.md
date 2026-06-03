# Disparo em Massa PRO — nova aba profissional

Reescrever a aba "Envio em Massa" do WhatsApp com uma página em wizard de 4 passos, mídia completa (imagem/vídeo/áudio/documento), filtros poderosos de origem, anti-bloqueio e relatórios. Substitui o `BulkBlockSendPanel` atual.

## Fluxo da página (wizard)

```
[1 Contatos] → [2 Mensagem] → [3 Envio] → [4 Acompanhar]
```

Topo fixo com stepper, contador de selecionados, botão "Salvar rascunho" e atalho "Testar em mim".

### Passo 1 — Contatos (de onde vêm)
Abas dentro do passo:
- **Do CRM** — filtros combinados: etapa do kanban, consultor, tag, distribuidora/UF (via DDD), valor da conta (min/max), origem (anúncio, orgânico, indicação), data de criação, última interação (>N dias sem responder).
- **Das conversas** — leads que conversaram em X dias, com status (respondeu / não respondeu / bot pausado / humano assumiu), horário da última mensagem.
- **Colar lista** — textarea, aceita um número por linha ou separados por vírgula; auto-limpa máscara.
- **Importar CSV/Excel** — drag-and-drop, mapeamento visual de colunas (nome, telefone, valor_conta, cidade...), preview das 5 primeiras linhas, detecção de duplicados.

Painel lateral direito mostra ao vivo: total, válidos, duplicados, já enviados hoje, em DND (opt-out). Botão "Remover quem já recebeu este disparo nos últimos N dias" (anti-spam).

### Passo 2 — Mensagem
Editor único que aceita:
- **Texto** com toolbar de variáveis ({nome}, {primeiro_nome}, {valor_conta}, {cidade}, {consultor}) e **spintax** `{oi|olá|e aí}` com botão "Gerar 3 variações" para preview.
- **Anexo** (um dos tipos): imagem (jpg/png/webp), vídeo (mp4), áudio (ogg/mp3 — enviado como voice/PTT), documento (pdf, docx, xlsx). Suporta arrastar arquivo, gravação de áudio no navegador (já existe `useAudioRecorder` com OGG/Opus), e seleção da biblioteca de mídia (`ai_media_library`).
- **Ordem de envio** se houver texto + mídia: mídia primeiro / texto primeiro / só legenda na mídia.
- **Saudação dinâmica por horário**: bom dia/boa tarde/boa noite automático.
- Preview ao vivo com o primeiro contato real selecionado, em "balão" WhatsApp, navegável (←/→) para conferir 5 contatos diferentes.
- Carregar/Salvar como template (reusa `useTemplates`).

### Passo 3 — Configurar envio
- **Velocidade**: presets Seguro / Normal / Rápido + custom (blocos de 10–50, pausa 5–60min, intervalo aleatório N–M segundos entre mensagens).
- **Janela permitida**: horário (ex. 08:00–20:00), dias da semana (seg–sex), fuso. Fora da janela, pausa e retoma sozinho.
- **Agendamento**: enviar agora / começar em data+hora.
- **Anti-bloqueio**: typing simulado, pular finais de semana, parar se >X% falhar, rotação automática entre N instâncias do mesmo consultor (se existirem).
- **Confirmação**: tela final com resumo (X contatos, Y mensagens, tempo estimado, custo zero) e botão grande "Iniciar disparo" com double-click confirmation.

### Passo 4 — Acompanhar (vira a tela principal após iniciar)
- Barra de progresso por bloco + total.
- Lista ao vivo: contato, status (fila/enviando/enviado/falha/bloqueado), horário, mensagem usada.
- Botões: Pausar / Retomar / Cancelar / Pular bloco.
- Filtros: só falhas, só enviados.
- **Download relatório CSV** (telefone, nome, status, motivo da falha, mensagem enviada, timestamp).
- Histórico de campanhas anteriores no rodapé, com botão "Reenviar só para quem falhou".

## Arquitetura técnica

### Frontend
- Nova pasta `src/components/whatsapp/bulk-pro/` com:
  - `BulkProPanel.tsx` (orquestrador + stepper)
  - `steps/Step1Contacts.tsx`, `Step2Message.tsx`, `Step3Schedule.tsx`, `Step4Monitor.tsx`
  - `parts/ContactFilters.tsx`, `CsvImporter.tsx`, `MessageEditor.tsx`, `SpintaxPreview.tsx`, `MediaPicker.tsx`, `LivePreview.tsx`, `CampaignHistory.tsx`
  - `useBulkProState.ts` (Zustand-like reducer com persistência em localStorage = rascunho)
  - `useCampaignRunner.ts` (motor de envio, baseado no atual `BulkBlockSendPanel` mas reescrito)
- Em `WhatsAppTab.tsx` trocar `BulkBlockSendPanel` por `BulkProPanel` (mantém o arquivo antigo por 1 release como fallback comentado).
- Reusa: `useAudioRecorder`, `useFileAttach`, `useTemplates`, `uploadMedia`, `sendMessage` do `services/messageSender.ts`.
- Validação com `zod` (schemas para CSV, contato, campanha).

### Backend (Supabase)
- Nova tabela `bulk_campaigns` (id, consultant_id, name, status, message_text, media_url, media_type, total, sent, failed, scheduled_at, started_at, finished_at, config jsonb, created_at) — com GRANTs + RLS por `consultant_id = auth.uid()`.
- Nova tabela `bulk_campaign_targets` (id, campaign_id, phone, name, vars jsonb, status, sent_at, error, message_id) — GRANTs + RLS via campanha do dono.
- Edge function existente de envio é reaproveitada; loop fica no cliente (igual hoje) mas grava progresso na tabela para sobreviver a F5.
- Cron `bulk-scheduler` (nova edge function): roda a cada 1 min, dispara campanhas agendadas cujo `scheduled_at <= now()`.

### Tipos de mídia (atende o pedido)
| Tipo | Aceito | Como envia |
|------|--------|-----------|
| Imagem | jpg, png, webp ≤16MB | mensagem image + legenda |
| Vídeo | mp4 ≤16MB | mensagem video + legenda |
| Áudio | ogg, mp3, m4a ≤16MB | voice/PTT (ogg) ou audio |
| Documento | pdf, docx, xlsx, etc | mensagem document + nome |

## Fora de escopo (próxima fase)
- A/B test de mensagens
- Integração com lista de transmissão nativa do WhatsApp
- Webhooks de status (sentregue/lido) já capturados, só será exibido na v2

## Arquivos a criar/editar
- **novo**: `src/components/whatsapp/bulk-pro/` (10 arquivos)
- **editar**: `src/components/whatsapp/WhatsAppTab.tsx` (trocar import)
- **migration**: `bulk_campaigns` + `bulk_campaign_targets` com GRANTs + RLS
- **nova edge function**: `bulk-scheduler`
- **manter**: `BulkSendPanel.tsx` e `BulkBlockSendPanel.tsx` como fallback (não removidos nesta entrega)
