# Mapa operacional iGreen — o que o sistema pode fazer

**Atualizado:** 13/07/2026  
**Regra:** automações nascem / permanecem **DESLIGADAS** até você ligar na Central.  
**UI:** botão **?** em `/admin/agendamentos-central` (e Hub de Agendamentos).

---

## Em 30 segundos

1. Lead manda WhatsApp → **sempre grava** (mesmo com bot off).  
2. Bot responde **só se** estiver ligado naquele lead / consultor / kill switch.  
3. Cutucadas automáticas (6h, FAQ, follow-up, bulk…) **só se** o toggle estiver ON.  
4. Para ver tudo: Central → botão **?** → abas Capacidades / Melhorar / Crons.

---

## Capacidades (resumo)

| Capacidade | Status típico |
|---|---|
| Receber WhatsApp / Captação / Portal | Em uso |
| Assumir lead + kill switch (só para de falar) | Em uso |
| Agenda manual, checker 6h, nudge FAQ, follow-up, bulk, reativação, cadência | **Pronto · DESLIGADO** |
| Canal único Whapi+Evolution em todos os crons | Ainda falta (melhoria alta) |

---

## Ordem sugerida para melhorar (sem ligar tudo de uma vez)

1. **Alta** — Piloto checker 6h (1 consultor)  
2. **Alta** — Unificar canal nos crons  
3. **Alta** — Rotina diária Captação (fila 48h/7d) enquanto retenção OFF  
4. **Média** — Nudge FAQ → depois follow-up completo  
5. **Média** — Limpar crons duplicados antes de ligar retenção em massa  

---

## Onde ligar / desligar

- **Central:** `/admin/agendamentos-central` → aba Automações  
- **Kill switch bot:** Super Admin → Assistente Global → `bot_global_enabled`  
- **Bot por lead:** Chat → botão IA ON/OFF (+ banner quando desligado)

---

## Fonte da verdade na UI

O mesmo conteúdo vive em:

- `src/lib/sistemaCapacidadesMapa.ts`
- Componente `SistemaCapacidadesHelp` (botão ?)
