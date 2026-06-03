# Auditoria do Fluxo D

Flow ID: `320bf22c-e383-4f53-a3c0-b88b89b02558`
Total de passos: **16** (todos ativos)
Data: 2026-06-03T17:56:30.987Z

> **Regra:** cada passo é avaliado isoladamente. Cópias com IDs diferentes são passos independentes.

## Resumo

| Severidade | Quantidade |
|---|---|
| CRIT | 0 |
| HIGH | 23 |
| MED | 1 |
| LOW | 0 |
| INFO | 1 |

Runtime: **20/22** jornadas PASS (Whapi + Evolution).

## 1. Auditoria estática por passo

### 🟠 pos1 `d_welcome` (message) — "Boas-vindas com botões"

- **HIGH** transitions[0] tem trigger_phrase "um" — runtime faz messageText.includes("um"), casa com qualquer texto contendo "um" (ex: "humano" contém "um"). Trocar por âncora exata ou remover.
- **HIGH** transitions[1] tem trigger_phrase "como" — runtime faz messageText.includes("como"), casa com qualquer texto contendo "como" (ex: "humano" contém "um"). Trocar por âncora exata ou remover.
- **HIGH** transitions[1] tem trigger_phrase "dois" — runtime faz messageText.includes("dois"), casa com qualquer texto contendo "dois" (ex: "humano" contém "um"). Trocar por âncora exata ou remover.
- **HIGH** transitions[2] tem trigger_phrase "três" — runtime faz messageText.includes("três"), casa com qualquer texto contendo "três" (ex: "humano" contém "um"). Trocar por âncora exata ou remover.
- **HIGH** transitions[2] tem trigger_phrase "tres" — runtime faz messageText.includes("tres"), casa com qualquer texto contendo "tres" (ex: "humano" contém "um"). Trocar por âncora exata ou remover.

### ✅ pos2 `d_pedir_conta` (capture_conta) — sem defeitos

### 🟠 pos3 `d_como_funciona` (message) — "Como funciona"

- **HIGH** transitions[0] tem trigger_phrase "dois" — runtime faz messageText.includes("dois"), casa com qualquer texto contendo "dois" (ex: "humano" contém "um"). Trocar por âncora exata ou remover.
- **HIGH** transitions[1] tem trigger_phrase "três" — runtime faz messageText.includes("três"), casa com qualquer texto contendo "três" (ex: "humano" contém "um"). Trocar por âncora exata ou remover.
- **HIGH** transitions[1] tem trigger_phrase "tres" — runtime faz messageText.includes("tres"), casa com qualquer texto contendo "tres" (ex: "humano" contém "um"). Trocar por âncora exata ou remover.

### 🟠 pos4 `d_resultado` (message) — "Resultado da simulação"

- **HIGH** transitions[0] tem trigger_phrase "um" — runtime faz messageText.includes("um"), casa com qualquer texto contendo "um" (ex: "humano" contém "um"). Trocar por âncora exata ou remover.
- **HIGH** transitions[1] tem trigger_phrase "tres" — runtime faz messageText.includes("tres"), casa com qualquer texto contendo "tres" (ex: "humano" contém "um"). Trocar por âncora exata ou remover.
- **HIGH** transitions[1] tem trigger_phrase "três" — runtime faz messageText.includes("três"), casa com qualquer texto contendo "três" (ex: "humano" contém "um"). Trocar por âncora exata ou remover.

### ✅ pos5 `d_pedir_documento` (capture_documento) — sem defeitos

### ✅ pos6 `d_pedir_email` (capture_email) — sem defeitos

### ✅ pos7 `d_confirmar_telefone` (confirm_phone) — sem defeitos

### ℹ️ pos8 `d_duvidas` (message) — "Esclarecer dúvidas"

- **INFO** fallback.mode=ai_answer + 3 botões re-emitidos OK.

### ✅ pos9 `d_handoff` (message) — sem defeitos

### ✅ pos10 `d_finalizar` (finalizar_cadastro) — sem defeitos

### ✅ pos15 `d_simular_valor` (message) — sem defeitos

### 🟠 pos16 `d_simular_resultado` (message) — "Resultado da simulação - Si"

- **HIGH** transitions[0] tem trigger_phrase "dois" — runtime faz messageText.includes("dois"), casa com qualquer texto contendo "dois" (ex: "humano" contém "um"). Trocar por âncora exata ou remover.
- **HIGH** transitions[0] tem trigger_phrase "como" — runtime faz messageText.includes("como"), casa com qualquer texto contendo "como" (ex: "humano" contém "um"). Trocar por âncora exata ou remover.
- **HIGH** transitions[1] tem trigger_phrase "tres" — runtime faz messageText.includes("tres"), casa com qualquer texto contendo "tres" (ex: "humano" contém "um"). Trocar por âncora exata ou remover.
- **HIGH** transitions[1] tem trigger_phrase "três" — runtime faz messageText.includes("três"), casa com qualquer texto contendo "três" (ex: "humano" contém "um"). Trocar por âncora exata ou remover.

### 🟠 pos17 `d_escolher_simulacao` (message) — "Completa ou Rapida"

- **HIGH** transitions[0] tem trigger_phrase "um" — runtime faz messageText.includes("um"), casa com qualquer texto contendo "um" (ex: "humano" contém "um"). Trocar por âncora exata ou remover.
- **HIGH** transitions[1] tem trigger_phrase "dois" — runtime faz messageText.includes("dois"), casa com qualquer texto contendo "dois" (ex: "humano" contém "um"). Trocar por âncora exata ou remover.

### ✅ pos18 `d_simular_pedir_conta` (capture_conta) — sem defeitos

### 🟠 pos19 `d_como_funciona_copy_in3s` (message) — "Como funciona (2)"

- **HIGH** transitions[0] tem trigger_phrase "dois" — runtime faz messageText.includes("dois"), casa com qualquer texto contendo "dois" (ex: "humano" contém "um"). Trocar por âncora exata ou remover.
- **HIGH** transitions[1] tem trigger_phrase "três" — runtime faz messageText.includes("três"), casa com qualquer texto contendo "três" (ex: "humano" contém "um"). Trocar por âncora exata ou remover.
- **HIGH** transitions[1] tem trigger_phrase "tres" — runtime faz messageText.includes("tres"), casa com qualquer texto contendo "tres" (ex: "humano" contém "um"). Trocar por âncora exata ou remover.

### 🟠 pos20 `d_como_funciona_copy_qwpu` (message) — "Como funciona (3)"

- **HIGH** transitions[0] tem trigger_phrase "dois" — runtime faz messageText.includes("dois"), casa com qualquer texto contendo "dois" (ex: "humano" contém "um"). Trocar por âncora exata ou remover.
- **HIGH** transitions[1] tem trigger_phrase "três" — runtime faz messageText.includes("três"), casa com qualquer texto contendo "três" (ex: "humano" contém "um"). Trocar por âncora exata ou remover.
- **HIGH** transitions[1] tem trigger_phrase "tres" — runtime faz messageText.includes("tres"), casa com qualquer texto contendo "tres" (ex: "humano" contém "um"). Trocar por âncora exata ou remover.
- **MED** Typo em botão "cadastrar": título "✅Continuar Cadastro" sem espaço após o emoji.

## 2. Reachability a partir de d_welcome

Passos alcançáveis: **14/16**

Passos ativos inalcançáveis (candidatos a `is_active=false`):

- pos9 `d_handoff` (id=7a85cc99-6fdf-4e5c-8752-d51b92e9bd09)
- pos19 `d_como_funciona_copy_in3s` (id=dc43c090-62e8-4429-bc7d-d5e2230c2a26)

Migration sugerida (desativa **apenas** estes passos, não toca em mais nada):

```sql
UPDATE bot_flow_steps SET is_active=false WHERE id IN ('7a85cc99-6fdf-4e5c-8752-d51b92e9bd09', 'dc43c090-62e8-4429-bc7d-d5e2230c2a26');
```

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

### ❌ [Whapi] Handoff via texto no welcome

```
  turn 1: txt="humano" via txt~"um" → d_escolher_simulacao | exp=HUMANO ❌
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

### ❌ [Evolution] Handoff via texto no welcome

```
  turn 1: txt="humano" via txt~"um" → d_escolher_simulacao | exp=HUMANO ❌
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

