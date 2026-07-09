
# Protocolo de Atendimento Profissional

Sistema determinístico para rastrear 100% dos leads CTWA sem revisão manual, com identidade visual profissional.

## 1. Formato do código: `2026-0042-A`

- **`2026`** — ano corrente (reinicia todo 1º de janeiro).
- **`0042`** — sequencial global da campanha, 4 dígitos com zero à esquerda (suporta até 9999 campanhas/ano).
- **`-A`, `-B`, `-C`...** — sufixo por instância WhatsApp vinculada à campanha (rodízio).

Exemplo real: campanha Jaraguá em 2026, 3ª criada no ano, com 2 instâncias no rodízio → protocolos `2026-0003-A` (instância principal) e `2026-0003-B` (secundária).

### Geração (à prova de colisão)

Sequência controlada por tabela dedicada `campaign_protocol_sequence (year, last_seq)` com função `next_campaign_protocol(year)` `SECURITY DEFINER` que faz `UPDATE ... RETURNING last_seq+1` atômico. Zero chance de duplicata mesmo com criações simultâneas.

Sufixo de instância atribuído na ordem em que a instância entra na pool do rodízio (A = primeira, B = segunda...). Registrado em coluna nova `rodizio_pool_members.protocol_suffix CHAR(1)`.

## 2. Como aparece na mensagem (bloco destacado)

Template aplicado automaticamente no momento da criação/reparo do anúncio no Meta:

```text
{mensagem_original_do_consultor}

━━━━━━━━━━━━━━━━━━
📋 Protocolo de atendimento
*2026-0042-A*
━━━━━━━━━━━━━━━━━━
```

- Separadores tornam o bloco visualmente inconfundível.
- Protocolo em negrito para leitura rápida.
- Fica no rodapé para não competir com a copy de venda.
- Cliente pode citar o protocolo em qualquer contato futuro → busca instantânea no admin.

## 3. Registro e rastreio (Admin)

### 3a. Coluna nova em cada card de campanha (Admin → Campanhas Facebook)

- Badge com o protocolo (`2026-0042`) + botão copiar.
- Ao expandir, lista sufixos por instância: `-A telefone …1234`, `-B telefone …5678`.

### 3b. Nova página `/admin/protocolos`

Tabela com:

| Protocolo | Campanha | Instância | Status | Leads recebidos | Último lead | Ações |
|-----------|----------|-----------|--------|-----------------|-------------|-------|

- Filtro por ano, status (ativa/pausada), consultor.
- Busca por protocolo (cliente diz "meu protocolo é 2026-0042-A" → operador acha na hora).
- Métricas: total de leads por protocolo, taxa de conversão, tempo médio de resposta.
- Export CSV.

## 4. Configuração automática (sem toque humano)

1. **Criar campanha** (`facebook-create-campaign`): chama `next_campaign_protocol(2026)` → recebe `42` → monta `2026-0042` → salva em `facebook_campaigns.tracking_protocol` → para cada instância na pool, gera `2026-0042-A/B/...` → injeta bloco na `initial_message` antes de enviar ao Meta.
2. **Reparar campanha existente** (`facebook-repair-campaign-tracking`): mesmo fluxo, mas atualiza o creative no Meta preservando `video_data`/`image_url`.
3. **Adicionar instância nova à pool**: trigger atribui próximo sufixo livre e re-injeta o bloco nas creatives daquela instância.
4. **Match no webhook** (`evolution-webhook` + `whapi-webhook`): regex `/\b(20\d{2})-(\d{4})-([A-Z])\b/` na primeira mensagem → resolve campanha + instância exatas. Fallback atual (`ad_id`, `ctwa_clid`, fuzzy) permanece como segunda linha de defesa.

## 5. Migração das campanhas ativas hoje

Script único: para cada campanha ativa sem protocolo, gerar `2026-####-X` e chamar `facebook-repair-campaign-tracking`. Executa uma vez, log de sucesso/erro por campanha.

---

## Detalhes técnicos

- **DB**: nova tabela `campaign_protocol_sequence`, função `next_campaign_protocol(int)`, coluna `rodizio_pool_members.protocol_suffix`, coluna `facebook_campaigns.tracking_protocol` já existe (será re-formatada para o novo padrão).
- **Shared**: `_shared/campaign-tracking.ts` recebe novo helper `formatProtocolBlock(protocol)` e `parseProtocolFromText(text)` com regex acima.
- **Edge functions afetadas**: `facebook-create-campaign`, `facebook-repair-campaign-tracking`, `evolution-webhook`, `whapi-webhook`.
- **Frontend**: novo componente `ProtocolBadge`, nova rota `/admin/protocolos` (`ProtocolsPage.tsx`), coluna no card de campanha existente.
- **Retrocompatibilidade**: protocolos antigos `FB-#####` continuam sendo reconhecidos pelo parser (regex dupla) até serem migrados.
