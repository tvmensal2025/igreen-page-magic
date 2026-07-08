# Diagnóstico profundo dos logs e do código

O anúncio foi recusado novamente por **dois problemas diferentes no mesmo ponto da criação do AdSet**.

## O que os logs mostram

1. Primeiro erro real:

```text
subcode=1487079
The field targeting_relaxation is not a valid target spec field
```

Isso acontece em `facebook-create-campaign/index.ts`, dentro do objeto `targeting` do AdSet:

```ts
targeting_relaxation: { lookalike: 1, custom_audience: 1 }
```

Esse campo **não é aceito pela Marketing API v21.0** no `targeting_spec` desse tipo de campanha CTWA. Então a Meta rejeita o conjunto de anúncios antes mesmo do anúncio ir ao ar.

2. Depois aparece erro de WhatsApp:

```text
subcode=1487246
This WhatsApp phone number is not linked to your account
```

Esse erro apareceu no retry seguinte. Pelos logs, a função tentou:

```text
phone=553484314317
phone=5534984314317
```

Ou seja: ela ainda estava tentando variantes com/sem nono dígito. No código atual já existe uma tentativa de corrigir isso com `resolveWabaPhone`, mas há risco de versão implantada/stale ou caminho legado ainda ativo.

3. O `facebook-preflight-check` também está quebrando em um campo Meta:

```text
(#100) Tried accessing nonexisting field (connected_whatsapp_business_account)
```

O arquivo `resolve-waba-phone.ts` ainda tenta esse campo como segunda tentativa. Mesmo que ele ignore quando falha, os logs ficam poluídos e, dependendo do fluxo, a validação pode virar warning em vez de bloqueio claro.

## Causa raiz

O problema não é só “telefone errado”. Existem 3 causas combinadas:

1. `targeting_relaxation` está sendo enviado no targeting e a Meta rejeita.
2. A criação ainda tem lógica/compatibilidade antiga de tentativa de telefone com/sem 9, que pode mascarar o erro verdadeiro e gerar `WHATSAPP_BUSINESS_REQUIRED` depois.
3. O preflight não simula exatamente o mesmo `targeting` que a criação usa; por isso ele pode deixar passar uma campanha que depois falha no publish.

# Plano de correção

## 1. Remover o campo inválido do AdSet

No `facebook-create-campaign/index.ts`, remover do `targeting`:

```ts
targeting_relaxation: { lookalike: 1, custom_audience: 1 }
```

Manter apenas:

```ts
targeting_automation: { advantage_audience: 1 }
```

Isso resolve diretamente o `subcode=1487079`.

## 2. Remover de vez o retry com/sem nono dígito

A criação deve usar somente o número autoritativo retornado por `resolveWabaPhone`:

```ts
const authoritativeDigits = waba.chosen.digits;
```

E criar o AdSet uma única vez com:

```ts
promoted_object: {
  page_id,
  whatsapp_phone_number: authoritativeDigits
}
```

Sem `waWith9`, sem `waWithout9`, sem fallback de telefone.

Se a Meta rejeitar esse número, o retorno deve dizer claramente:

- número usado;
- `phone_number_id` usado;
- lista de números WABA disponíveis;
- mensagem Meta original.

## 3. Fazer o preflight usar o mesmo targeting da criação

Hoje o preflight cria um targeting parecido, mas não idêntico. Vou alinhar o `facebook-preflight-check` para validar o mesmo formato usado no publish:

- `geo_locations`;
- `age_min`/`age_max` normalizados para Advantage+;
- `targeting_automation`;
- `promoted_object` com número resolvido pela WABA.

Assim, se a Meta vai recusar no publish, ela já bloqueia antes.

## 4. Corrigir descoberta WABA sem depender de campo problemático

No `resolve-waba-phone.ts` e `facebook-detect-waba/index.ts`:

- Manter `whatsapp_business_account` como tentativa principal.
- Tratar `connected_whatsapp_business_account` como fallback silencioso, sem gerar erro de log repetido.
- Se não achar WABA pela página, usar fallback por Business.
- Retornar bloqueio amigável quando não encontrar número.

## 5. Melhorar erro visível na UI

Quando a função retornar erro Meta, a UI deve mostrar a causa real:

- Se `1487079`: “Configuração de público inválida. A plataforma precisa atualizar a segmentação.”
- Se `1487246`/`2446885`: “Número WhatsApp não está vinculado à conta/página Meta.”
- Se ambos aparecerem em sequência, priorizar o primeiro erro real de AdSet em vez de sempre mostrar WhatsApp.

## 6. Validar com teste focado

Após a alteração, validar:

- que `targeting_relaxation` não existe mais em nenhum request;
- que o AdSet tenta só um telefone;
- que o preflight retorna bloqueio antes do publish quando WABA/número estiver inválido;
- que a mensagem de erro exibida não mascara o erro real.

# Resultado esperado

Depois dessa correção, a publicação não deve mais falhar por `targeting_relaxation`, e o erro de WhatsApp só aparecerá quando o número autoritativo da WABA realmente estiver incorreto ou não vinculado. A plataforma deixa de tentar “adivinhar” telefone e passa a trabalhar igual ao Gerenciador da Meta: só usa número reconhecido oficialmente pela WABA.