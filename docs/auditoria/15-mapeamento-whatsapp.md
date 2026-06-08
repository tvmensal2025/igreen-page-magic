# 15 — Mapeamento Profundo do Código WhatsApp

> Última atualização: 08/06/2026
> Análise gerada via script Python (dados reais, não estimativa). Scripts em `.tmp/wa_analysis/`.

---

## Metodologia

Esta análise NÃO usa estimativas. Foi gerada por scripts Python que contam:
- Linhas reais (total, código, comentário, branco)
- Hooks React (useState, useRef, useCallback, useEffect)
- Funções nomeadas e seus ranges de linha exatos
- Grafo de acoplamento (qual função usa qual estado/ref/função)
- Consumidores reais (quem importa e quais campos usa)

---

## 1. Inventário Real de Arquivos

| Arquivo | Total | Código | Coment. | Branco | Papel |
|---------|-------|--------|---------|--------|-------|
| `hooks/useWhatsApp.ts` | **870** | 735 | 34 | 101 | Orquestrador |
| `hooks/whatsapp/whatsappHelpers.ts` | 122 | 98 | 7 | 17 | Funções puras |
| `hooks/whatsapp/whatsappStateChecks.ts` | 105 | 88 | 7 | 10 | Factory de checks |
| `hooks/whatsapp/useWhatsAppInstanceDb.ts` | 78 | 63 | 6 | 9 | Persistência DB |
| `hooks/whatsapp/whatsappHealth.ts` | 56 | 45 | 4 | 7 | Factory de health |
| **TOTAL** | **1.231** | 1.029 | 58 | 144 | — |

**Conclusão:** O subsistema já está parcialmente decomposto. O problema está concentrado num único arquivo: `useWhatsApp.ts` com 870 linhas (70% do total).

---

## 2. Densidade do useWhatsApp.ts

| Métrica | Valor |
|---------|-------|
| Estados (useState) | 14 |
| Refs (useRef) | 9 |
| useCallback | 14 |
| useEffect | 2 |
| Funções internas | 18 |
| Chamadas setState | 178 |
| Chamadas addLog | 49 |
| Blocos try/catch | 15 |
| BroadcastChannel | 3 |
| Chamadas supabase | 2 |

**14 estados + 9 refs num só hook** confirma a alta complexidade.

---

## 3. Ranges de Linha Exatos (as 18 funções)

| Linhas | Tamanho | Função |
|--------|---------|--------|
| L84–88 | 5 | setStatus |
| L89–93 | 5 | setHealth |
| L94–97 | 4 | addLog |
| L98–102 | 5 | stopPolling |
| L103–108 | 6 | health (factory) |
| L109–112 | 4 | checks (factory) |
| L113–133 | 21 | haltRecovery |
| L134–149 | 16 | handleAuthFailure |
| L150–176 | 27 | markConnected |
| **L177–324** | **148** | **startPolling** |
| **L325–516** | **192** | **createAndConnect** |
| L517–554 | 38 | refreshQr |
| L555–588 | 34 | disconnect |
| **L589–678** | **90** | **safeReset** |
| L679–681 | 3 | reconnect |
| **L682–848** | **167** | **useEffect (init mount)** |
| L849–870 | 22 | return |

**4 blocos concentram 597 linhas (69%):** `createAndConnect` (192), `useEffect init` (167), `startPolling` (148), `safeReset` (90).

---

## 4. Grafo de Acoplamento (o dado mais importante)

### Refs compartilhados — quais funções tocam cada ref

| Ref | Compartilhamento | Funções que usam |
|-----|------------------|------------------|
| `timeoutCountRef` | 🔴 **6 funções** | stopPolling, haltRecovery, startPolling, createAndConnect, disconnect, safeReset |
| `instanceSavedRef` | 🟡 4 | markConnected, createAndConnect, disconnect, safeReset |
| `lockRef` | 🟡 3 | createAndConnect, disconnect, safeReset |
| `graceCountRef` | 🟡 3 | haltRecovery, markConnected, startPolling |
| `statusRef` | 🟡 3 | setStatus, markConnected, startPolling |
| `healthRef` | 🟡 3 | setHealth, stopPolling, startPolling |
| `recoveryCyclesRef` | 🟡 3 | stopPolling, haltRecovery, startPolling |
| `mountedRef` | 🟢 2 | startPolling, createAndConnect |
| `pollRef` | 🟢 2 | stopPolling, startPolling |

### Facilidade de extração (score = refs_quentes×2 + chamadas)

| Nível | Função | Score |
|-------|--------|-------|
| FÁCIL | addLog, setHealth, setStatus | 0 |
| FÁCIL | reconnect | 1 |
| FÁCIL | stopPolling | 2 |
| FÁCIL | handleAuthFailure | 3 |
| MÉDIO | markConnected | 5 |
| MÉDIO | haltRecovery | 6 |
| MÉDIO | refreshQr | 6 |
| DIFÍCIL (núcleo) | disconnect | 8 |
| DIFÍCIL (núcleo) | startPolling | 9 |
| DIFÍCIL (núcleo) | safeReset | 10 |
| DIFÍCIL (núcleo) | createAndConnect | 11 |

---

## 5. Conclusão Técnica (CORRIGE a proposta anterior)

A proposta inicial de "dividir em 4 hooks isolados" era **simplista demais**. Os dados mostram que:

> **`startPolling`, `createAndConnect`, `safeReset` e `disconnect` formam um NÚCLEO ACOPLADO.** Eles compartilham `timeoutCountRef` (6 usuários), `instanceSavedRef`, `lockRef` e chamam-se mutuamente. Separá-los em hooks independentes exigiria passar todos os refs por parâmetro — o que aumenta a complexidade em vez de reduzir.

### Decomposição correta (baseada no acoplamento real)

```
src/hooks/
├── useWhatsApp.ts                          ← FACADE (~80 ln): mesma interface pública
└── whatsapp/
    ├── whatsappHelpers.ts                  ← (mantém)
    ├── whatsappHealth.ts                   ← (mantém)
    ├── whatsappStateChecks.ts              ← (mantém)
    ├── useWhatsAppInstanceDb.ts            ← (mantém)
    ├── useWhatsAppSuperAdmin.ts            ← NOVO (~60 ln) — TOTALMENTE ISOLÁVEL
    │     (bloco WHAPI do useEffect: lê settings + fallback email)
    ├── useWhatsAppConnection.ts            ← NÚCLEO (~430 ln) — refs quentes ficam JUNTOS
    │     (setStatus, setHealth, addLog, stopPolling, haltRecovery,
    │      handleAuthFailure, markConnected, startPolling,
    │      createAndConnect, disconnect, safeReset, refreshQr, reconnect)
    └── useWhatsAppInit.ts                  ← NOVO (~120 ln) — recebe o núcleo por parâmetro
          (useEffect de mount: fatal lock, primeiro checkState, start)
```

### Por que essa divisão e não outra

| Decisão | Justificativa (dado) |
|---------|---------------------|
| Super admin isolado | Só usa supabase/settings, ZERO refs do núcleo, score baixo |
| Núcleo permanece unido | timeoutCountRef tem 6 usuários; quebrar = passar 9 refs por parâmetro |
| Init separado | useEffect (167 ln) só CHAMA o núcleo, não compartilha refs internos |
| Facade mantém interface | WhatsAppTab usa 19 campos; Admin usa 2 → não podem quebrar |

### Ganho realista

| Antes | Depois |
|-------|--------|
| 1 arquivo de 870 ln | Maior arquivo ~430 ln (núcleo) |
| Super admin no meio do polling | Arquivo próprio de 60 ln (e facilita a correção do email hardcoded da Fase 2) |
| Init de 167 ln misturado | Arquivo próprio testável |
| Tudo num escopo | 3 escopos com fronteira clara |

**Importante:** Mesmo após a decomposição, o núcleo de conexão continuará grande (~430 linhas) por natureza — é uma state machine com circuit breaker. Isso é aceitável e esperado. A meta não é "arquivos pequenos a qualquer custo", e sim **fronteiras claras de responsabilidade sem quebrar o acoplamento que existe por um bom motivo**.

---

## 6. Consumidores (impacto de mudança)

| Consumidor | Campos usados | Risco se interface mudar |
|-----------|---------------|--------------------------|
| `components/whatsapp/WhatsAppTab.tsx` | 19 campos (todos) | 🔴 ALTO |
| `pages/Admin.tsx` | 2 (instanceName, isWhapi) | 🟡 MÉDIO |
| `components/whatsapp/ConnectionPanel.tsx` | 0 (só importa o tipo `OperationalHealth`) | 🟢 BAIXO |

**Regra de ouro:** a facade `useWhatsApp` DEVE retornar exatamente os mesmos 19 campos com os mesmos nomes e tipos. Nenhum consumidor pode perceber a mudança.

---

## 7. Dependências Internas Atuais

```
useWhatsApp.ts
  ├── whatsappHelpers      (constantes + funções puras)
  ├── whatsappHealth       (factory)
  ├── whatsappStateChecks  (factory)
  └── useWhatsAppInstanceDb (hook DB)

whatsappHealth.ts → whatsappHelpers
whatsappStateChecks.ts → whatsappHealth, whatsappHelpers
```

Estrutura de dependência é limpa e sem ciclos. A nova decomposição deve preservar isso.

---

## 8. Ordem Segura de Execução (revisada com dados)

| Step | Ação | Risco | Como testar |
|------|------|-------|-------------|
| 1 | Extrair `useWhatsAppSuperAdmin.ts` (bloco WHAPI do init) | BAIXO | Super admin conecta via Whapi |
| 2 | Extrair `useWhatsAppInit.ts` (useEffect mount) recebendo callbacks do núcleo | MÉDIO | Página carrega e detecta status correto |
| 3 | Mover o núcleo (13 funções) para `useWhatsAppConnection.ts` mantendo refs juntos | MÉDIO | Conectar, QR, desconectar, reset, polling |
| 4 | Reduzir `useWhatsApp.ts` a facade que compõe os 3 + retorna 19 campos | ZERO | WhatsAppTab e Admin sem alteração |

Cada step = 1 commit. Reversível com `git revert`.

**NÃO mexer:** lógica de polling, BroadcastChannel anti-ban, fatal lock, intervalos. Apenas MOVER código, nunca alterar comportamento.
