# Plano — Abrir atendimento em lote (Captação → Conversas)

> Status: **especificação para implementar no Lovable** (ainda não codificado no cockpit).
> Objetivo: o consultor seleciona vários interessados das últimas 48h e abre
> atendimento + áudio de abertura de uma vez — sem ir um a um.

Mock visual: [`modal-abrir-atendimento-mock.png`](./modal-abrir-atendimento-mock.png)

---

## 1. Por que NÃO reusar o Bulk Pro / Lista de leads

| Bulk Pro (WhatsApp / Lista de leads) | Abrir em lote (Conversas) |
|---|---|
| Contatos frios / captados | Já estão em captação e falaram |
| Mensagem de campanha (wizard 4 passos) | Protocolo + áudio de abertura |
| Objetivo: disparar marketing | Objetivo: não perder fila quente de 48h |

A aba **Lista de leads** já tem multi-select + `BulkProPanel`. Em **Conversas**
o valor é operacional: `start-customer-attendance` + template de áudio.

---

## 2. UX aprovada (modal único)

Uma tela, uma decisão — sem wizard.

1. **Quem** — lista dos selecionados + status (`Pronto` / `Já iniciado`)
2. **O quê** — um áudio de abertura já escolhido (play para ouvir)
3. **Ação** — botão verde `Abrir para N`

Texto de apoio: *“Envia protocolo + áudio, com intervalo de 5s entre cada.”*

### Entrada na UI

- Em `CaptureLeadList` (“Conversas”): botão **Selecionar**
- Checkbox nos cards só no modo seleção
- Atalhos: **Últimas 48h**, **Todos sem atendimento**, **Limpar**
- Com N > 0: barra/CTA abre o modal (não o empty state do cockpit)

### Modal

- Título: `Abrir atendimento`
- Subtítulo: `N clientes · últimas 48h`
- Lista scrollável com avatar + nome + pill de status
- Bloco único de áudio (template salvo do consultor)
- Footer: `Cancelar` | `Abrir para N`
- Quem já tem `welcome_sent_at`: pill `Já iniciado` — **não reenviar** protocolo

---

## 3. Comportamento técnico

### Por lead elegível (`Pronto`)

1. Chamar `start-customer-attendance` (`customerId` + `consultantId`)
   - Idempotente: se já enviou, pular / marcar `Já iniciado`
2. Enviar o template de áudio (mesmo caminho do composer da Captação /
   `sendWhatsAppMessage` com `mediaCategory: "audio"`)
3. Aguardar intervalo (ex.: 5s) antes do próximo — anti rate-limit

### Backend (preferível)

- Nova edge `start-customer-attendance-batch` **ou** fila controlada no front
  com delay + progresso por item
- Resposta por target: `ok` | `skipped_already_sent` | `no_phone` | `send_failed`
- Nunca 5xx por falha de canal (mesmo padrão da edge atual)

### Arquivos prováveis

- `src/components/captacao/CaptureLeadList.tsx` — multi-select + filtros
- `src/components/captacao/CaptacaoPanel.tsx` — CTA + modal
- Novo: `src/components/captacao/OpenAttendanceBatchDialog.tsx`
- `src/hooks/useCustomerAttendance.ts` / edge batch
- Reuso: `useTemplates` (áudios salvos), `sendWhatsAppMessage`

### Não misturar

- Não abrir `BulkProPanel` neste fluxo
- Não alterar a aba **Lista de leads**

---

## 4. Critérios de pronto (Lovable)

- [ ] Modo seleção na lista Conversas
- [ ] Filtro “últimas 48h” e “sem atendimento”
- [ ] Modal igual ao mock (hierarquia clara, CTA com número)
- [ ] Protocolo + áudio com intervalo entre envios
- [ ] Progresso ✓ / ✗ por pessoa + retry dos que falharam
- [ ] Mobile: lista estreita ainda usável
- [ ] Quem já iniciou não recebe protocolo de novo

---

## 5. Riscos

- Rate limit WhatsApp / Whapi / Evolution
- Reenvio acidental em quem já tem `welcome_sent_at`
- Áudio template sem URL / canal desconectado
- Lista mobile com checkbox + progresso

---

## 6. Contexto do produto (hoje)

- Cockpit 1 a 1: `CaptacaoPanel` + `AttendanceStatusBar` → `start-customer-attendance`
- Lista Conversas: `CaptureLeadList` (sem multi-select)
- Empty state: “Selecione um cliente interessado para começar”
- Disparo em massa marketing: `CapturedLeadsPanel` → `BulkProPanel`
