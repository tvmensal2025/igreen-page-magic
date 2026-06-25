# Correção do Flow D — Cadastro Rápido não pode cair na simulação

## O que encontrei
O erro não veio da limpeza de `flow_router_rules`. O problema está dentro da configuração do próprio Flow D.

Hoje, no passo inicial `d_welcome`, o botão visível **“⚡ Cadastro rápido”** está configurado errado:

- O botão aparece como **Cadastro rápido**, mas o `id` interno está como `humano`.
- A transição desse botão aponta para um passo de **simulação/conta de luz** (`d_simular_pedir_conta` / `capture_conta`).
- As palavras da transição incluem `Cadastro rápido!`, `rápido!` e `humano`, ou seja: clicar em Cadastro Rápido manda para o caminho de simulação, exatamente o bug que você viu.

Também vi que no `d_resultado` falta blindagem suficiente para textos/botões como **“Cadastrar e finalizar”** e **“Cadastro rápido”** sempre irem para documento.

## Como vou corrigir

### 1. Corrigir os dados do Flow D no banco
Atualizar todos os Flow D ativos para que:

- Botão **Cadastro rápido** não use mais `id: humano`.
- O botão passe a usar um ID claro, por exemplo `cadastro_rapido`.
- A transição de **Cadastro rápido** aponte para o passo de documento do mesmo fluxo:
  - `d_pedir_documento`
  - tipo `capture_documento`

Resultado esperado:

```text
Cadastro rápido → pedir documento com foto
não → escolher simulação
não → simulação rápida
não → humano
```

### 2. Corrigir as palavras-chave do CTA de cadastro
No passo `d_resultado`, garantir que qualquer uma destas entradas vá para documento:

```text
cadastrar
quero me cadastrar
cadastrar e finalizar
cadastro rápido
cadastro_rapido
```

E remover gatilhos perigosos/genéricos como:

```text
rápido!
humano
```

porque `humano` não deve significar cadastro rápido.

### 3. Adicionar uma trava no código dos webhooks
Além de corrigir o banco, vou blindar o código em:

- `supabase/functions/whapi-webhook/handlers/bot-flow.ts`
- `supabase/functions/evolution-webhook/handlers/bot-flow.ts`

Regra nova:

```text
Se Flow D receber botão/texto de Cadastro Rápido ou Cadastrar e Finalizar,
forçar destino para documento, nunca para simulação.
```

Isso evita que o bug volte mesmo se alguém editar errado o FlowBuilder depois.

### 4. Não mexer no que está certo
Não vou alterar:

- `flow_router_rules`
- Flow A
- OCR da conta
- OCR do documento
- OTP
- Portal
- limpeza de duplicatas já feita

## Validação depois da correção
Vou consultar novamente o banco e confirmar:

- `Cadastro rápido` aponta para `d_pedir_documento`.
- `Cadastrar e finalizar` aponta para `d_pedir_documento`.
- Nenhuma transição de Cadastro Rápido aponta para `d_escolher_simulacao`, `d_pedir_conta` ou `d_simular_pedir_conta`.

Também vou revisar o handler para garantir que o fallback de segurança está nos dois canais: Whapi e Evolution.
