# Diagnóstico

Hoje `finalize-capture` valida só 10 campos genéricos (incluindo `rg` que o Portal 2 nem usa) e **não valida** os campos que o portal realmente exige: `numero_instalacao`, `address_street`, `address_neighborhood`, `address_city`, `address_state`, `distribuidora`, `media_consumo`. Resultado: lead chega no portal sem `media_consumo`, worker recebe 0 kWh, `/bonus/rules` devolve 404 e o lead "volta" silenciosamente.

Regra de negócio do cliente: **R$/kWh ≈ 1,0** (faixa aceitável 0,7–1,5). Se valor da conta ÷ consumo cair fora dessa faixa, é OCR errado e **não pode ir pro portal**.

# Plano

## 1. Novo validador único — `src/lib/captacao/portalValidation.ts`

Função pura `validateForPortal(customer): { ok, missing[], invalid[], suggestions{} }` com a lista REAL do Portal 2:

**Identificação**
- `name` (≥ 3 chars, 2 palavras)
- `cpf` (11 dígitos válidos)
- `data_nascimento` (formato `DD/MM/YYYY`, idade 18–100)

**Contato**
- `phone_whatsapp` (10–11 dígitos com DDD)
- `email` (regex válido)

**Endereço (todos obrigatórios — portal exige)**
- `cep` (8 dígitos)
- `address_street`, `address_number`, `address_neighborhood`, `address_city`, `address_state` (UF de 2 letras)

**Conta de luz**
- `distribuidora` (não vazio)
- `numero_instalacao` (≥ 6 dígitos)
- `electricity_bill_value` > 0
- `media_consumo` > 0
- **Cruzamento R$/kWh**: `ratio = electricity_bill_value / media_consumo`; precisa estar em **[0.7, 1.5]**. Fora disso → `invalid: 'consumo_vs_valor'` com sugestão `Math.round(electricity_bill_value / 1.0)` kWh.

**Documentos**
- `document_front_url`, `document_back_url` (ou `nao_aplicavel` p/ CNH), `electricity_bill_photo_url`

**Bloqueios extras**
- `name_mismatch_flag` sem `name_mismatch_acknowledged_at`

Retorna `missing` (faltando) e `invalid` (preenchido mas errado, com `reason` + `suggestion` quando aplicável).

## 2. `finalize-capture` usa o mesmo validador no servidor

Reescrever a checagem do edge function pra:
- Importar o validador (mesma lógica duplicada em TS Deno — copiar pra `supabase/functions/_shared/portalValidation.ts`).
- Se `missing.length || invalid.length` → retornar `{ ok:false, error:'incomplete', missing, invalid }` **com status 400** (já é o padrão).
- **Nunca** marcar `portal_submitting` nem chamar o worker se algo estiver inválido.

Adicionar também: revalidar `media_consumo`/`electricity_bill_value` mesmo se "preenchidos" (o caso do lead atual onde `media_consumo=NULL`).

## 3. Card de captação mostra exatamente o que falta/está errado

Hoje a barra "PROGRESSO DO CADASTRO 10/10" e o botão CADASTRAR ficam verdes mesmo com `media_consumo=NULL` e `numero_instalacao` vazio porque a lista de campos do frontend não bate com a do portal.

Alterações:

- **`src/components/captacao/CaptureSheet.tsx`** e **`CaptureLeadCard.tsx`**: substituir a lista hardcoded de campos pela lista canônica do validador. O contador "X/Y" e os checkmarks passam a refletir a verdade.
- Adicionar `media_consumo` e `numero_instalacao` como campos editáveis (input numérico) na ficha do lead.
- Quando `invalid: 'consumo_vs_valor'`: mostrar banner amarelo no card:
  > ⚠️ Valor R$ {valor} ÷ consumo {kwh} kWh = R${ratio}/kWh — fora da faixa esperada (≈R$1/kWh). Confirme o consumo correto.
  > [Usar sugestão: {suggestion} kWh]
- Botão **CADASTRAR** fica **desabilitado** enquanto `!validation.ok`, com tooltip listando os 3 primeiros itens pendentes.

## 4. Auto-estimar `media_consumo` na captura, mas como **sugestão** (não envio cego)

Quando o OCR da conta extrair `electricity_bill_value` e não tiver `consumomedio`, preencher `media_consumo` com `Math.round(valor / 1.0)` clampado [50, 3000] **mas marcar `media_consumo_estimated=true`** (nova coluna boolean). No card aparece etiqueta "estimado — confira" e o consultor precisa confirmar (clicar no campo e salvar) antes do botão CADASTRAR liberar.

Migração:
```sql
ALTER TABLE customers ADD COLUMN media_consumo_estimated boolean DEFAULT false;
```

## 5. Banner de erro do portal continua, mas vira raro

Mantém o `PortalStatusTracker` atual; com as guardas acima, só apareceria pra falhas reais do worker (offline, duplicate phone/cpf que o portal só pega no POST final). Adicionar no `friendlyPortalError` o caso "Consumo médio não informado" → instrução "Edite o consumo no card e reenvie".

## Fora de escopo
- OCR de `consumomedio` direto do PDF (separado — depende do `capture-extract`/`extract-pdf-text`).
- Pré-checar duplicate phone via API iGreen (endpoint não existe).
- Mexer no worker remoto.

## Validação pós-implementação
1. Lead `482c0262…`: abrir card → barra mostra "8/12" com `media_consumo`, `numero_instalacao`, etc. faltando → botão CADASTRAR desabilitado.
2. Preencher consumo = 1500 kWh, valor = 200 → banner amarelo (ratio 0,13) → bloqueia envio.
3. Ajustar consumo = 200 kWh → 10/12 → 12/12 → CADASTRAR libera → worker recebe payload completo → cadastro segue.
