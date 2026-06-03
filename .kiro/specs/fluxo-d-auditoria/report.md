# Auditoria do Fluxo D

Flow ID: `320bf22c-e383-4f53-a3c0-b88b89b02558`
Total de passos: **16** (todos ativos)
Data: 2026-06-03T18:02:53.766Z

> **Regra:** cada passo é avaliado isoladamente. Cópias com IDs diferentes são passos independentes.

## Resumo

| Severidade | Quantidade |
|---|---|
| CRIT | 0 |
| HIGH | 0 |
| MED | 0 |
| LOW | 0 |
| INFO | 1 |

Runtime: **22/22** jornadas PASS (Whapi + Evolution).

## 1. Auditoria estática por passo

### ✅ pos1 `d_welcome` (message) — sem defeitos

### ✅ pos2 `d_pedir_conta` (capture_conta) — sem defeitos

### ✅ pos3 `d_como_funciona` (message) — sem defeitos

### ✅ pos4 `d_resultado` (message) — sem defeitos

### ✅ pos5 `d_pedir_documento` (capture_documento) — sem defeitos

### ✅ pos6 `d_pedir_email` (capture_email) — sem defeitos

### ✅ pos7 `d_confirmar_telefone` (confirm_phone) — sem defeitos

### ℹ️ pos8 `d_duvidas` (message) — "Esclarecer dúvidas"

- **INFO** fallback.mode=ai_answer + 3 botões re-emitidos OK.

### ✅ pos9 `d_handoff` (message) — sem defeitos

### ✅ pos10 `d_finalizar` (finalizar_cadastro) — sem defeitos

### ✅ pos15 `d_simular_valor` (message) — sem defeitos

### ✅ pos16 `d_simular_resultado` (message) — sem defeitos

### ✅ pos17 `d_escolher_simulacao` (message) — sem defeitos

### ✅ pos18 `d_simular_pedir_conta` (capture_conta) — sem defeitos

### ✅ pos19 `d_como_funciona_copy_in3s` (message) — sem defeitos

### ✅ pos20 `d_como_funciona_copy_qwpu` (message) — sem defeitos

## 2. Reachability a partir de d_welcome

Passos alcançáveis: **14/16**

Nenhum passo ativo inalcançável.

## 3. Simulação de runtime (engine v3 emulado)

Capabilities: Whapi=`{supportsButtons:true, maxButtons:3}`, Evolution=`{supportsButtons:false, maxButtons:0}`.

### ✅ [Whapi] Happy path FOTO

```
  turn 1: btn=quero_simular via btn=quero_simular → d_escolher_simulacao | exp=d_escolher_simulacao ✅ kind?true btns?true
  turn 2: btn=simular_completa via btn=simular_completa → d_pedir_conta | exp=d_pedir_conta ✅ kind?true
  turn 3: image via media_ok → d_resultado | exp=d_resultado ✅ kind?true btns?true
  turn 4: btn=cadastrar via btn=cadastrar → d_pedir_documento | exp=d_pedir_documento ✅ kind?true
  turn 5: image via media_ok → d_pedir_email | exp=d_pedir_email ✅
  turn 6: txt="joao@email.com" via capture_ok → d_confirmar_telefone | exp=d_confirmar_telefone ✅
  turn 7: txt="11999998888" via capture_ok → d_finalizar | exp=d_finalizar ✅ kind?true
```

### ✅ [Whapi] Happy path VALOR

```
  turn 1: btn=quero_simular via btn=quero_simular → d_escolher_simulacao | exp=d_escolher_simulacao ✅
  turn 2: btn=simular_rapida via btn=simular_rapida → d_simular_valor | exp=d_simular_valor ✅
  turn 3: txt="300" via default → d_simular_resultado | exp=d_simular_resultado ✅ kind?true btns?true
  turn 4: btn=cadastrar via btn=cadastrar → d_simular_pedir_conta | exp=d_simular_pedir_conta ✅ kind?true
  turn 5: image via media_ok → d_pedir_documento | exp=d_pedir_documento ✅
```

### ✅ [Whapi] Dúvida + IA (BUG ORIGINAL)

```
  turn 1: btn=duvida via btn=duvida → d_como_funciona_copy_qwpu | exp=d_como_funciona_copy_qwpu ✅
  turn 2: btn=duvida via btn=duvida → d_duvidas | exp=d_duvidas ✅ kind?true btns?true
  turn 3: txt="tem fidelidade?" via fb.ai_answer → d_duvidas | exp=d_duvidas ✅ aiBtns?true
  turn 4: btn=cadastrar via btn=cadastrar → d_pedir_documento | exp=d_pedir_documento ✅
```

### ✅ [Whapi] Loop dúvidas 3x

```
  turn 1: txt="como funciona?" via fb.ai_answer → d_duvidas | exp=d_duvidas ✅ aiBtns?true
  turn 2: txt="e a multa?" via fb.ai_answer → d_duvidas | exp=d_duvidas ✅ aiBtns?true
  turn 3: txt="demora quanto?" via fb.ai_answer → d_duvidas | exp=d_duvidas ✅ aiBtns?true
  turn 4: btn=humano via btn=humano → humano | exp=HUMANO ✅
```

### ✅ [Whapi] Handoff via texto no welcome

```
  turn 1: txt="humano" via txt~"humano" → humano | exp=HUMANO ✅
```

### ✅ [Whapi] Handoff via texto no resultado

```
  turn 1: txt="rafael" via txt~"rafael" → humano | exp=HUMANO ✅
```

### ✅ [Whapi] Texto 'cadastrar' no welcome (sem atalho global → fallback)

```
  turn 1: txt="cadastrar" via fb.repeat → d_welcome | exp=d_welcome ✅
```

### ✅ [Whapi] Texto em capture_conta

```
  turn 1: txt="qualquer coisa" via default → d_resultado | exp=d_resultado ✅
```

### ✅ [Whapi] Numéricos 1/2/3 no welcome

```
  turn 1: txt="1" via txt~"1" → d_escolher_simulacao | exp=d_escolher_simulacao ✅
```

### ✅ [Whapi] Numérico 2 no welcome → como funciona

```
  turn 1: txt="2" via txt~"2" → d_como_funciona | exp=d_como_funciona ✅
```

### ✅ [Whapi] Numérico 3 no welcome → handoff

```
  turn 1: txt="3" via txt~"3" → humano | exp=HUMANO ✅
```

### ✅ [Evolution] Happy path FOTO

```
  turn 1: btn=quero_simular via btn=quero_simular → d_escolher_simulacao | exp=d_escolher_simulacao ✅ kind?true btns?true
  turn 2: btn=simular_completa via btn=simular_completa → d_pedir_conta | exp=d_pedir_conta ✅ kind?true
  turn 3: image via media_ok → d_resultado | exp=d_resultado ✅ kind?true btns?true
  turn 4: btn=cadastrar via btn=cadastrar → d_pedir_documento | exp=d_pedir_documento ✅ kind?true
  turn 5: image via media_ok → d_pedir_email | exp=d_pedir_email ✅
  turn 6: txt="joao@email.com" via capture_ok → d_confirmar_telefone | exp=d_confirmar_telefone ✅
  turn 7: txt="11999998888" via capture_ok → d_finalizar | exp=d_finalizar ✅ kind?true
```

### ✅ [Evolution] Happy path VALOR

```
  turn 1: btn=quero_simular via btn=quero_simular → d_escolher_simulacao | exp=d_escolher_simulacao ✅
  turn 2: btn=simular_rapida via btn=simular_rapida → d_simular_valor | exp=d_simular_valor ✅
  turn 3: txt="300" via default → d_simular_resultado | exp=d_simular_resultado ✅ kind?true btns?true
  turn 4: btn=cadastrar via btn=cadastrar → d_simular_pedir_conta | exp=d_simular_pedir_conta ✅ kind?true
  turn 5: image via media_ok → d_pedir_documento | exp=d_pedir_documento ✅
```

### ✅ [Evolution] Dúvida + IA (BUG ORIGINAL)

```
  turn 1: btn=duvida via btn=duvida → d_como_funciona_copy_qwpu | exp=d_como_funciona_copy_qwpu ✅
  turn 2: btn=duvida via btn=duvida → d_duvidas | exp=d_duvidas ✅ kind?true btns?true
  turn 3: txt="tem fidelidade?" via fb.ai_answer → d_duvidas | exp=d_duvidas ✅ aiBtns?true
  turn 4: btn=cadastrar via btn=cadastrar → d_pedir_documento | exp=d_pedir_documento ✅
```

### ✅ [Evolution] Loop dúvidas 3x

```
  turn 1: txt="como funciona?" via fb.ai_answer → d_duvidas | exp=d_duvidas ✅ aiBtns?true
  turn 2: txt="e a multa?" via fb.ai_answer → d_duvidas | exp=d_duvidas ✅ aiBtns?true
  turn 3: txt="demora quanto?" via fb.ai_answer → d_duvidas | exp=d_duvidas ✅ aiBtns?true
  turn 4: btn=humano via btn=humano → humano | exp=HUMANO ✅
```

### ✅ [Evolution] Handoff via texto no welcome

```
  turn 1: txt="humano" via txt~"humano" → humano | exp=HUMANO ✅
```

### ✅ [Evolution] Handoff via texto no resultado

```
  turn 1: txt="rafael" via txt~"rafael" → humano | exp=HUMANO ✅
```

### ✅ [Evolution] Texto 'cadastrar' no welcome (sem atalho global → fallback)

```
  turn 1: txt="cadastrar" via fb.repeat → d_welcome | exp=d_welcome ✅
```

### ✅ [Evolution] Texto em capture_conta

```
  turn 1: txt="qualquer coisa" via default → d_resultado | exp=d_resultado ✅
```

### ✅ [Evolution] Numéricos 1/2/3 no welcome

```
  turn 1: txt="1" via txt~"1" → d_escolher_simulacao | exp=d_escolher_simulacao ✅
```

### ✅ [Evolution] Numérico 2 no welcome → como funciona

```
  turn 1: txt="2" via txt~"2" → d_como_funciona | exp=d_como_funciona ✅
```

### ✅ [Evolution] Numérico 3 no welcome → handoff

```
  turn 1: txt="3" via txt~"3" → humano | exp=HUMANO ✅
```

