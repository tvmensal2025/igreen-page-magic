# Plano: fazer o teste de lead validar a Vendedora V2 de verdade

## Diagnóstico

O último teste não provou a V2 porque a execução caiu em V1/legacy:

- Primeiro turno `oi`: resposta veio com `variantId: "b.legacy"` e `phase: "fluxo_b_chat"`.
- Segundo/terceiro turnos: veio `variantId: "b.v1"`, mas `phase: "vendedora_v1"`, não `vendedora_v2`.
- Turno `900`: voltou para `variantId: "b.legacy"`, porque o tester `dryRun` não persistia `variant_id`; cada mensagem sorteava variante de novo.
- O runtime da Edge Function também não estava com `VENDEDORA_V2_ENABLED=true`, então mesmo quando sorteou `b.v1`, rodou V1.
- Existem logs repetidos de módulo (`node:zlib`, `bufferutil`, `utf-8-validate`) na Edge Function; eles não derrubaram a resposta 200, mas indicam ruído/dependência incompatível que precisa ser removido se estiver vindo do import atual.

## Mudanças propostas

### 1. Forçar V2 no modo de teste

Editar `supabase/functions/fluxo-b-ai/index.ts` para aceitar um campo explícito no body, por exemplo:

```json
{ "forceVariantId": "b.v1", "forceV2": true }
```

No `dryRun`, o `syntheticCustomer` será criado com:

- `variant_id: "b.v1"`
- `fluxo_b_variant: "v1"`
- `fluxo_b_state` preservado entre turnos pelo `customerState`

Assim o teste deixa de sortear variante a cada mensagem.

### 2. Remover dependência de env para o teste V2

Editar `supabase/functions/_shared/fluxo-b-ai.ts` para permitir override seguro somente em `dryRun/tester`, sem afetar produção WhatsApp:

- Se `customer.__force_vendedora_v2 === true`, usar `runVendedoraV2`.
- Caso contrário, manter regra atual: `VENDEDORA_V2_ENABLED=true`.

Isso permite testar a V2 agora, mesmo antes do rollout global.

### 3. Ajustar o painel “Testar lead simulado”

Editar `src/components/admin/flow-builder/FluxoBEditor.tsx` para mandar sempre no teste:

- `forceVariantId: "b.v1"`
- `forceV2: true`

Também ajustar o merge do estado simulado para preservar `variant_id`, `fluxo_b_variant`, `name`, `electricity_bill_value`, `email` e `fluxo_b_state` entre turnos.

### 4. Mostrar claramente que é V2

No tester, atualizar o texto/metadata para mostrar:

- `variantId` retornado como `b.v1+v2`
- modelo `deterministic_template` nas etapas mecânicas
- debug “Decisão interna (v2)” quando `debug.phase` ou equivalente indicar V2

### 5. Auditar o erro de módulo da Edge Function

Rastrear qual import está puxando dependências incompatíveis (`node:zlib`, `bufferutil`, `utf-8-validate`) e corrigir com import Deno/esm compatível, provavelmente fixando o `@supabase/supabase-js` ou removendo path que puxa realtime/ws.

### 6. Validar com teste real do fluxo

Após implementar, testar via Edge Function com a sequência:

1. `oi` → deve retornar `variantId: b.v1+v2`, fase/debug V2 e abertura.
2. `sim` → deve pedir nome via template/determinístico ou etapa correta.
3. `Sirlene` → deve extrair nome e pedir valor.
4. `900` → deve extrair valor e apresentar simulação, não cair em legacy.
5. `quero` → deve confirmar interesse e pedir foto da conta.

Critério de aceite: nenhuma resposta do tester pode voltar com `b.legacy`, `vendedora_v1` ou `fluxo_b_chat` quando o modo V2 estiver ativo.

## Observação importante

A pasta `.lovable/` está no `.gitignore`; planos salvos em `.lovable/plan.md` podem não persistir no snapshot. Se quiser manter planos versionados, o próximo passo seria remover essa entrada do `.gitignore`, mas não vou mexer nisso sem pedido explícito.