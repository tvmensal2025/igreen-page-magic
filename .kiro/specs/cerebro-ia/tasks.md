# Implementation Plan: Cérebro IA

## Overview

Plano de execução em pedaços pequenos e seguros. A ordem segue: fundação → peças
isoladas → ligar em sombra → comparar → canário → ligado → aposentar a vendedora antiga.
Nada é enviado ao cliente até o canário. O worker do portal, o OCR e o OTP são
REUSADOS, nunca reescritos. Cada tarefa fecha sozinha sem deixar o sistema quebrado.

## Tasks

- [x] 1. Fundação do módulo `cerebro/` (sem ligar em nada)
  - Criar `_shared/cerebro/tipos.ts` referenciando os tipos de `engine/types.ts` sem duplicar.
  - Criar os arquivos das 6 peças do núcleo com a assinatura do contrato do design.
  - Não importar em nenhum webhook ainda; só compila e passa no `deno check`.
  - _Requirements: 1.1, 1.2, 1.4, 17.1_

- [x] 2. Peça N8 — Estado/Memória (isolada)
- [x] 2.1 Leitura de estado reusando `loadFlowState` + `customer_flow_state` + `fluxo_b_state` + `conversation_summary`.
  - _Requirements: 5.1, 5.4, 20.1, 20.2, 20.3_
- [x] 2.2 Escrita campo a campo + histórico para diagnóstico.
  - _Requirements: 5.2, 5.3_
- [x] 2.3 Testes unitários (estado parcial, vazio, corrompido).
  - _Requirements: 5.4_

- [x] 3. Peça N2 — Entendimento (isolada)
- [x] 3.1 Identificar intenção comercial em conjunto pequeno e fechado.
  - _Requirements: 4.1, 4.4, 4.5_
- [x] 3.2 Extrair dados reusando `captureExtractors.ts` e `vendedora/extractors.ts`.
  - _Requirements: 4.2_
- [x] 3.3 Classificar objeção reusando lógica existente.
  - _Requirements: 4.3_
- [x] 3.4 Testes unitários (interesse, dúvida, objeção, indefinido).
  - _Requirements: 4.1, 4.3_

- [x] 4. Peça N3 — Decisor de Passo (o coração) — isolada
- [x] 4.1 Chamar `loadContext` + `runEngine` para decidir o passo a partir de `bot_flow_steps`, sem sequência fixa.
  - _Requirements: 6.1, 6.2, 6.3_
- [x] 4.2 Uma única fonte de etapa (a do fluxo); sem detector de etapa por IA.
  - _Requirements: 6.4_
- [x] 4.3 Padrões de reparo (correção, dúvida fora de hora, cancelamento) em TS.
  - _Requirements: 6.5, 6.6, 6.7_
- [x] 4.4 Repasse de `DeferredAction` (ocr, portal_submit, otp_submit) ao dispatcher; sem executar aqui.
  - _Requirements: 6.1_
- [x] 4.5 Teste: mudar `bot_flow_steps` muda a decisão sem mexer no código.
  - _Requirements: 6.2, 6.3_

- [x] 5. Peça N4 — Escritor (isolada)
- [x] 5.1 Escrever a mensagem do passo reusando RAG, memória e gateway `chatCascade`.
  - _Requirements: 8.1, 8.2, 8.3_
- [x] 5.2 Ajustar o tom por etapa de venda (tabela inspirada em SalesGPT, como dado).
  - _Requirements: 8.1_
- [x] 5.3 Saída sempre em português comercial.
  - _Requirements: 8.4, 13.1_
- [x] 5.4 Teste: escritor não decide passo; só escreve o passo recebido.
  - _Requirements: 8.1_

- [x] 6. Peça N5 — Guarda de Segurança (ponto único)
- [x] 6.1 Consolidar `vendedora/critico.ts` + travas num único ponto antes do envio.
  - _Requirements: 9.1, 9.7_
- [x] 6.2 Bloquear inventar info, vazar chave/erro técnico, pedir dado cedo, alterar dado sem regra.
  - _Requirements: 9.1, 9.2, 9.3, 9.5, 9.6_
- [x] 6.3 Aplicar o glossário único (termo técnico → comercial) na saída.
  - _Requirements: 9.4, 13.1, 13.2, 19.1, 19.2, 19.3_
- [x] 6.4 Teste: nenhuma mensagem sai sem passar pela Guarda.
  - _Requirements: 9.1_

- [x] 7. Peça N1 — Orquestrador (liga as peças, ainda sem webhook)
  - Coordenar N8 → N2 → N3 → N4 → N5 e devolver o resultado.
  - Respeitar o teto de 25s e fail-open (erro → vazio/handoff).
  - Testes do módulo isolado (entrada sintética → saída), sem enviar nada.
  - _Requirements: 1.3, 16.5_

- [x] 8. Métrica de comparação N10 (preparar o modo sombra)
- [x] 8.1 Registro de decisão em `ai_decisions`: passo/ação do Cérebro + do sistema atual + flag de coincidência.
  - _Requirements: 3.1, 3.2, 3.4_
- [x] 8.2 View de taxa de coincidência por estágio sobre `ai_decisions`/`engine_logs`.
  - _Requirements: 15.1, 15.2_
- [x] 8.3 Definir limite e turnos mínimos em `rollout_config` (ex.: 90% / 200 turnos).
  - _Requirements: 15.3_

- [x] 9. Ligar em MODO SOMBRA (decide e registra, NÃO envia)
- [x] 9.1 Chamar o Cérebro em paralelo onde `runEngineV3IfEnabled` já roda, quando `flow_engine_v3 = dark`.
  - _Requirements: 2.1, 2.3, 3.1, 3.3_
- [x] 9.2 Alterar os DOIS webhooks (evolution + whapi) em par.
  - _Requirements: 16.2, 16.3_
- [x] 9.3 Fail-open: erro no Cérebro nunca bloqueia o caminho atual.
  - _Requirements: 16.1, 16.2, 16.3_
- [x] 9.4 Validar que em `dark` nada é enviado ao cliente.
  - _Requirements: 3.3_

- [x] 10. Rodar em sombra e comparar
  - Acompanhar a coincidência (N10) em conversas reais por período definido.
  - Ajustar fluxos no construtor e padrões de reparo até atingir o limite.
  - _Requirements: 14.3, 15.1, 15.3_

- [x] 11. Pipeline de cadastro — não-regressão (ANTES do canário)
- [x] 11.1 `finalizar_cadastro` aciona SOMENTE `dispatchPortalWorker` (Cérebro não monta payload nem chama worker direto).
  - _Requirements: 16.1, 16.3_
- [x] 11.2 Roteamento `digital` vs `autoconexao` (worker-portal-2) preservado.
  - _Requirements: 16.3_
- [x] 11.3 Gate de documentos do Portal 2 respeitado (conta + frente + verso/RG).
  - _Requirements: 16.3_
- [x] 11.4 OCR via dispatcher/hooks e OTP interceptado antes do Cérebro — intactos.
  - _Requirements: 16.2, 16.3_
- [x] 11.5 E2E com `bot-e2e-runner`: conversa completa (texto + foto + documento + finalização) sem regressão.
  - _Requirements: 6.1, 16.1, 16.3_

- [x] 12. Migração de clientes em conversa
- [x] 12.1 Mapa de equivalência: etapa antiga (`fluxo_b_state.etapa`) → passo do fluxo.
  - _Requirements: 5.4, 14.1_
- [x] 12.2 Cliente com cadastro parcial entra no passo equivalente; sem equivalente → handoff.
  - _Requirements: 5.4_
- [x] 12.3 Teste: cliente no meio do cadastro não é reiniciado.
  - _Requirements: 5.4, 14.1_

- [x] 13. Religar automações (follow-up / reativação) ao Cérebro
  - `process-followups` e `ai-followup-cron` chamam o Cérebro (inbound `no_input`/nudge) quando `on`; mantêm vendedora enquanto não for `on`.
  - Teste: follow-up continua funcionando após a virada.
  - _Requirements: 14.1, 14.2_

- [ ] 14. CANÁRIO — ligar para subconjunto de consultores
- [x] 14.1 Em `canary`, o Cérebro responde de verdade só para os consultores do rollout.
  - _Requirements: 2.4, 14.2_
- [x] 14.2 Monitorar coincidência, conversões e alertas; manter vendedora para os demais.
  - _Requirements: 15.2, 15.3_
- [x] 14.3 Rollback em segundos via chave, se preciso.
  - _Requirements: 2.6_

- [x] 15. LIGADO (on) — Cérebro para todos do consultor habilitado
- [x] 15.1 Em `on`, todo turno conversacional passa pelo Cérebro; vendedora antiga não responde mais.
  - _Requirements: 2.5, 14.1_
- [x] 15.2 Confirmar que não existe terceiro caminho conversacional.
  - _Requirements: 14.1_

- [ ] 16. Aposentar a vendedora antiga (limpeza — só após estável em `on`)
  - Remover `vendedora/state-machine.ts`, o orquestrador antigo e o bypass do Fluxo B nos dois webhooks.
  - Garantir que nada mais importa os arquivos removidos; rodar `deno check` e os testes.
  - _Requirements: 14.1_

- [x] 17. Verificação final de não-interferência
  - Confirmar anti-ban, trio de proteção, integração Evolution/Whapi e controle de custo intactos.
  - Apagar os clones de referência (`.tmp/referencias-analise/`).
  - _Requirements: 16.1, 16.2, 16.4, 16.5, 18.2, 18.3_

## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1"], "description": "Fundação do módulo (sem ligar em nada)" },
    { "wave": 2, "tasks": ["2", "3", "6"], "description": "Peças isoladas sem dependência entre si (estado, entendimento, guarda)" },
    { "wave": 3, "tasks": ["4", "5"], "description": "Decisor e Escritor (dependem do estado/entendimento)" },
    { "wave": 4, "tasks": ["7"], "description": "Orquestrador liga as peças" },
    { "wave": 5, "tasks": ["8"], "description": "Métrica de comparação" },
    { "wave": 6, "tasks": ["9"], "description": "Ligar em modo sombra" },
    { "wave": 7, "tasks": ["10"], "description": "Rodar sombra e comparar" },
    { "wave": 8, "tasks": ["11", "12", "13"], "description": "Não-regressão do pipeline, migração e automações (antes do canário)" },
    { "wave": 9, "tasks": ["14"], "description": "Canário" },
    { "wave": 10, "tasks": ["15"], "description": "Ligado para todos" },
    { "wave": 11, "tasks": ["16"], "description": "Aposentar vendedora antiga" },
    { "wave": 12, "tasks": ["17"], "description": "Verificação final e limpeza dos clones" }
  ]
}
```

Regra crítica: a onda 8 (tarefa 11 — não-regressão do worker/OCR/OTP) é obrigatória
ANTES da onda 9 (canário). A tarefa 16 (aposentar a vendedora) só depois da onda 10
(`on`) estável.

## Notes

- Worker do portal, OCR e OTP são REUSADOS (tarefa 11 garante não-regressão). O Cérebro
  decide o QUANDO; `dispatchPortalWorker` e o dispatcher decidem o COMO.
- Nada é enviado ao cliente até a tarefa 14 (canário). Tarefas 1–13 não mudam o que o
  cliente recebe.
- Os dois webhooks (evolution + whapi) são sempre alterados em par (tarefa 9.2).
- A vendedora antiga só é removida na tarefa 16, após `on` estável — evita terceiro
  caminho e mantém rollback fácil até lá.
- Cada peça (tarefas 2–6) é testável isolada antes de ligar qualquer coisa.
