# Por que o bot pediu o CEP do 11971254913

## Diagnóstico (logs reais 06/06 09:30–09:34)

Linha do tempo da conversa:
```text
09:32:01  lead envia foto da conta
09:32:08  OCR Gemini grava: name + electricity_bill_value (só esses 2 capture_field_events)
09:32:17  confirmando_dados_conta "1"
...
09:34:00  autoResolveCepIfNeeded() roda:
          🔍 ViaCEP https://viacep.com.br/ws/SP/CAPIVARI/ELIZA%20FAVOTTO%20ANGELIN/json/
          ⚠️ ViaCEP não retornou CEP específico → pergunta ao usuário
09:34:04  📤 "Qual o seu *CEP*? (8 dígitos)"
09:34:19  lead digita "13323-472"
09:34:26  cep=13323472, street="Rua João Leme do Prado", city="Salto", state="SP" ← endereço real
```

## Causa raiz

O OCR (Gemini 2.5 Flash, `supabase/functions/_shared/ocr.ts`) leu campos errados desta fatura:

- `cep = ""` (não extraiu)
- `cidade = "CAPIVARI"` (é o endereço da agência da CPFL, não do imóvel)
- `endereco = "ELIZA FAVOTTO ANGELIN"` (é nome de pessoa, não logradouro)

Com `cep` vazio e endereço plausível, o fallback `buscarCepPorEndereco` rodou contra ViaCEP, que devolveu só CEPs genéricos de setor (final `000`) e o `autoResolveCepIfNeeded` corretamente desistiu — só que o endereço de referência era ruim de origem. Não é loop nem bug de fluxo: é OCR pegando o bloco errado da fatura (CPFL imprime o endereço da concessionária e o nome do titular anterior em destaque, e o Gemini confundiu com endereço de instalação).

O CEP **está** na fatura — o lead conferiu e digitou `13323-472` — mas o prompt atual não força o modelo a olhar o bloco "ENDEREÇO DE INSTALAÇÃO / UNIDADE CONSUMIDORA".

## O que mudar

Arquivo: `supabase/functions/_shared/ocr.ts` (função `processarOcrConta`, prompt nas linhas 179-202).

1. **Prompt mais cirúrgico para endereço/CEP**
   - Trocar item 2 ("ENDEREÇO DE INSTALAÇÃO (rua/avenida, sem número)") por instrução explícita:
     > "Procure o bloco **ENDEREÇO DE INSTALAÇÃO / UNIDADE CONSUMIDORA / LOCAL DE FORNECIMENTO**. NÃO use o endereço de correspondência, da agência, do PAGADOR ou da distribuidora. O endereço de instalação fica perto do número da instalação / código do cliente."
   - Item 5 (CEP): adicionar "O CEP de instalação tem 8 dígitos no formato XXXXX-XXX e fica junto do endereço de instalação. Devolva sempre os 8 dígitos quando visível na fatura."
   - Item 1 (NOME): reforçar "nome do titular contratante; NÃO confundir com nome impresso no histórico/segunda via".

2. **Validação anti-confusão street↔nome**
   - Após `JSON.parse`, se `dados.endereco` tiver ≤ 2 palavras **e** nenhum prefixo de logradouro (`R\b|RUA|AV|AVENIDA|AL|ALAMEDA|TRAV|ROD|PRAÇA|PR\b|EST\b|ESTRADA`), descartar (`dados.endereco = ""`) — evita que "ELIZA FAVOTTO ANGELIN" caia em `address_street` e contamine o ViaCEP reverso.
   - Se `dados.cep` ficou vazio e `dados.endereco` foi descartado, deixar tudo vazio em vez de mandar lixo pro fallback.

3. **Segunda passada só pra CEP quando falta**
   - Em `processarOcrConta`, se depois do parse `dados.cep === ""` e `gemData.candidates[0].content.parts[0].text` for grande o bastante, rodar uma chamada Gemini extra curta (`gemini-2.5-flash-lite`, max 256 tok) com prompt focado:
     > "Encontre apenas o CEP (8 dígitos) do endereço de instalação nesta fatura. Responda JSON {\"cep\":\"XXXXXXXX\"} ou {\"cep\":\"\"}."
   - Custo marginal (~$0.00005). Só roda quando o primeiro pass falhou no CEP — não impacta a maioria dos cadastros que já vêm completos.

4. **Telemetria pra acompanhar**
   - Log estruturado em `bot-flow.ts` (linha ~3198, quando cai no `buscarCepPorEndereco`):
     `logStructured("warn","ocr_cep_missing",{ customer_id, has_street:!!updates.address_street, has_city:!!updates.address_city })`
   - Permite dashboard rápido de "quantos % das contas saem do OCR sem CEP" pra medir o ganho.

## Fora do escopo

- Não mexer no fluxo do `ask_cep` (já funciona certo — só foi acionado porque o OCR falhou).
- Não mexer no `worker-portal-2` nem no `detect-doc-type`.
- Não tocar nas correções recentes de `ask_phone_confirm`/`confirmar_titularidade`.

## Validação após implementar

1. Re-rodar a foto da conta do lead `b189ceb6-6880-405e-a211-08c0ab0117cd` via `reprocess-capture` e confirmar que `dados.cep === "13323472"` e `dados.endereco` começa com "RUA" / "R " etc.
2. Esperar próximo cadastro real e checar nos logs: `ocr_cep_missing` não deve aparecer pra contas CPFL/Enel padrão.
