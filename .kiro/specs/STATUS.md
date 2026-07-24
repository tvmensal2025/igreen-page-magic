# Status das specs Kiro (anti-ruído para agentes)

Atualizado: **2026-07-24**. Specs **não** são fonte de verdade operacional — steering + código são.  
Antes de seguir um `.kiro/specs/*/design.md`, leia este arquivo **e** o campo `agentStatus` no `.config.kiro` da pasta (quando existir).

| Pasta | Status | Nota para IA |
|---|---|---|
| `_done/*` | **archived** | Histórico. Não implementar. |
| `evolution-whatsapp-integration` (em `_done`) | **archived / Evolution-first** | Perigoso se lido como atual. |
| `whatsapp-flow-reliability-fix` | **archived-risk** | Evolution→webhook — **superseded** Whapi. Banner no `design.md`. |
| `whatsapp-message-send-fix` | **archived-risk** | Evolution API. Banner no `design.md`. |
| `evolution-multiconsultor-pronto` | **historical** | Dual-channel; banner Whapi no `requirements.md`. |
| `bot-engine-channel-unification` | **reference-legacy** | Paridade; banner Whapi no `requirements.md`. |
| `flow-engine-v3-rewrite` | **active-ref / caution** | Apontado por `#flow-engine-v3`; mantém paridade legada Evolution, mas Whapi é o canal primário. Banner aplicado em `requirements.md`. |
| `cerebro-ia` | **active-ref** | Apontado por `#cerebro-fluxo-b`. |
| `portal2-ocr-feedback-loop` | **active-ref** | OCR Portal 2. |
| `rodizio-leads-anuncio` | **active-ref** | Distinguir parceiro ≠ criativo. |
| `scheduled-messages` | **active-ref / caution** | Agenda humana; sem quiet hours bot. O texto ainda cita Evolution API; Whapi é primário. Banner aplicado em `requirements.md`. |
| `security-hardening-lgpd` | **active-ref** | |
| `acompanhamento-proposta` / `vendas-acompanhamento` | **active-ish** | Esteira/propostas. |
| `cashback-keyword-routing` | **caution** | Keyword **não** escolhe campanha UUID. |
| `captacao-fluxo-d-conversao` / `flow-business-hours` / `whatsapp-dashboard-metrics` | **stale?** | Confirmar no código antes de seguir. |
| `whatsapp-flow-architecture-v3` | **historical** | |
| `iris-construtor-finalizacao` | **stale-isolated** | |
| `auditoria-fluxos-2026-06` / `fluxo-d-auditoria` | **audit-snapshot** | Só leitura. |

## Regra
Se a spec contradiz `#regras-duras` / `#wa-webhook` / Whapi primário → **a regra dura vence**.
