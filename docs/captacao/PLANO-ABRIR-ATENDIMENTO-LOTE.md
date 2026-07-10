# Plano — Abrir atendimento em lote (Captação → Conversas)

> Status: **implementado** no cockpit (Conversas).
> Objetivo: o consultor seleciona vários interessados por período (até 60+ dias)
> e abre atendimento + áudio e/ou imagem de uma vez — sem ir um a um.

Mock visual: [`modal-abrir-atendimento-mock.png`](./modal-abrir-atendimento-mock.png)

---

## 1. Por que NÃO reusar o Bulk Pro / Lista de leads

| Bulk Pro (WhatsApp / Lista de leads) | Abrir em lote (Conversas) |
|---|---|
| Contatos frios / captados | Já estão em captação e falaram |
| Mensagem de campanha (wizard 4 passos) | Protocolo + áudio e/ou imagem |
| Objetivo: disparar marketing | Objetivo: não perder fila quente |

A aba **Lista de leads** já tem multi-select + `BulkProPanel`. Em **Conversas**
o valor é operacional: `start-customer-attendance` + templates de mídia.

---

## 2. UX

1. **Selecionar** na lista Conversas
2. Filtro de período: `48h | 7d | 30d | 60d | 90d | Todos` (default **60d**)
3. Atalhos: Todos do período · Só sem atendimento · Limpar
4. CTA **Abrir atendimento** → modal único

### Modal

- Título: `Abrir atendimento`
- Subtítulo: `N clientes · últimos X`
- Lista com pills: `Pronto` / `Já iniciado` / `Sem telefone` + progresso
- Toggle: **Iniciar atendimento** (default ON)
- Select **Áudio** e/ou **Imagem** (templates salvos)
- Precisa de pelo menos 1 ação (protocolo OU áudio OU imagem)
- Intervalo 5s · Parar · Tentar de novo nos falhos

---

## 3. Arquivos

- [`CaptureLeadList.tsx`](../../src/components/captacao/CaptureLeadList.tsx) — multi-select + período
- [`OpenAttendanceBatchDialog.tsx`](../../src/components/captacao/OpenAttendanceBatchDialog.tsx) — modal
- [`runAttendanceBatch.ts`](../../src/components/captacao/runAttendanceBatch.ts) — fila front
- [`CaptacaoPanel.tsx`](../../src/components/captacao/CaptacaoPanel.tsx) — wiring

Por lead: `start-customer-attendance` (se toggle e sem `welcome_sent_at`) → áudio → imagem → sleep 5s.

---

## 4. Fora de escopo (v1)

- Bulk Pro / Lista de leads
- Edge batch dedicada
- Upload ad-hoc no modal (só templates)
- Texto livre em massa
