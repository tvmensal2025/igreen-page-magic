## Diagnóstico

Analisei o lead do WhatsApp `11971254913` / `5511971254913` (`b5bbc2c2-2b25-4e55-a78d-524276c26b7c`) e o fluxo executado.

### O que aconteceu no teste

1. O lead iniciou corretamente:
   - `Oi`
   - recebeu `d_welcome`
   - clicou `Quero simular`
   - entrou em `aguardando_conta`

2. O lead digitou valor antes da foto:
   - `Eu gasto 300 reais por mes`
   - depois `300 reais`

3. O bot não usou esse valor para simular naquele momento.
   - Ele apenas pediu novamente a foto/PDF da conta.
   - O motivo técnico é que, em `aguardando_conta`, o texto com valor só é salvo se `customer.electricity_bill_value` ainda estiver vazio, mas a resposta não dispara a simulação nem avança para um CTA claro.

4. Depois o lead mandou a conta.
   - O OCR leu a conta e salvou `electricity_bill_value = 1576.34`.
   - Ao clicar `✅ SIM`, a simulação foi enviada:
     - `Sua conta hoje: R$ 1.576,34`
     - economia estimada `R$ 126 a R$ 316`

5. Mais tarde, no cadastro, o bot pediu novamente valor médio:
   - `Qual o valor médio da sua conta de luz?`
   - o lead respondeu `900`
   - depois, ao finalizar, o bot voltou a pedir a foto da conta obrigatória.

### Causa provável

Há dois problemas de regra no fluxo:

1. **Valor digitado antes da foto não dispara simulação inicial.**
   - O bot aceita o texto como possível valor, mas continua preso em `aguardando_conta` pedindo foto.
   - Isso explica “não simulou no início”.

2. **O valor digitado no fallback de cadastro (`ask_bill_value`) pode sobrescrever ou competir com o valor real do OCR.**
   - No lead atual, o banco terminou certo com `1576.34`, mas durante a jornada o bot perguntou `900` depois, criando a percepção de que “errou ao salvar o valor da conta”.
   - O fluxo não deveria pedir `ask_bill_value` se já existe conta OCR confirmada ou valor da conta salvo.

### Estado atual do lead

O lead está em `portal_submitting`, com:

- `electricity_bill_value = 1576.34`
- `distribuidora = CPFL PIRATININGA`
- `numero_instalacao = 2095093800`
- `bill_holder_name = BRUNO MANOEL DOS SANTOS`
- worker do portal disparado com status `200`

Ou seja: ele chegou ao final, mas o caminho teve prompts incorretos e confusos.

## Plano de correção

### 1. Corrigir `aguardando_conta` para simular quando o cliente digita valor

Quando o lead estiver em `aguardando_conta` e mandar texto como `300 reais`:

- salvar `electricity_bill_value`
- enviar a simulação inicial com base no valor digitado
- oferecer o próximo CTA correto:
  - se quiser cadastro completo, pedir a foto da conta para OCR/validação
  - se o fluxo permitir seguir só com média, avançar para documento conforme regra existente

Isso evita o loop “me manda a foto” sem simular.

### 2. Blindar `ask_bill_value` para não sobrescrever valor do OCR

Se o cliente já tem:

- `electricity_bill_value` preenchido
- ou `electricity_bill_photo_url`
- ou `bill_holder_name`/`distribuidora` vindos do OCR

então o step `ask_bill_value` não deve pedir/salvar novo valor médio. Ele deve pular para o próximo dado faltante ou finalizar.

### 3. Evitar retorno para “foto da conta obrigatória” depois de dados preenchidos

No fechamento (`ask_finalizar`/finalização), se a conta já foi enviada e OCR salvo, não deve voltar para `aguardando_conta`.

A regra será: só pedir foto da conta se não houver foto/OCR/valor válido.

### 4. Aplicar a mesma correção nos dois canais

Ajustar os handlers equivalentes:

- `supabase/functions/whapi-webhook/handlers/bot-flow.ts`
- `supabase/functions/evolution-webhook/handlers/bot-flow.ts`

Assim Whapi e Evolution ficam consistentes.

### 5. Validar com o cenário real

Depois da alteração, testar o cenário:

```text
Oi
Quero simular
300 reais
```

Resultado esperado:

```text
Simulação enviada imediatamente com R$ 300,00
Bot não pede novamente o mesmo dado
Fluxo segue para foto da conta/documento conforme regra do cadastro
```

E testar também:

```text
envia conta
confirma SIM
finaliza cadastro
```

Resultado esperado:

```text
Valor OCR preservado
Sem pergunta duplicada de valor médio
Sem retorno indevido para foto obrigatória
```