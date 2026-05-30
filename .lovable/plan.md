# Garantir ordem do fluxo: Conta → Simulação → Documento

## Problema identificado

No fluxo **D (botões)** do consultor `0c2711ad…`, vários gatilhos de "Cadastrar" pulam direto para `d_pedir_documento` **sem antes coletar a conta de luz e mostrar a simulação**.

Caminhos errados hoje:

```text
d_duvidas        ── "Quero cadastrar" ──► d_pedir_documento   ❌ (sem conta)
d_como_funciona  ── "Cadastrar agora"  ──► d_pedir_documento   ❌ (sem conta)
```

Foi exatamente isso que aconteceu no lead `bd64e790…`: depois de ouvir o áudio de "como funciona" e cair em "dúvidas", ele clicou **Quero cadastrar** e o bot pediu o RG/CNH antes da conta.

## Regra que vale para todos os flows

`d_pedir_conta` ➜ `d_resultado` (simulação) ➜ **só então** `d_pedir_documento` ➜ email/telefone ➜ finalizar.

```text
welcome ─► pedir_conta ─► resultado(simulação) ─► pedir_documento ─► email ─► telefone ─► finalizar
                ▲                    │
                │                    └─ "cadastrar" só aqui leva ao documento
"cadastrar"/"simular"/"1" sempre cai aqui antes da simulação
```

## Mudanças

### 1. Migration — corrigir transitions do flow D

No `bot_flow_steps` do flow `320bf22c-e383-4f53-a3c0-b88b89b02558`:

- **d_duvidas** (`38c0d101`): trigger `cadastrar / Quero cadastrar` passa a apontar para `d_pedir_conta` (`279d3926`) em vez de `d_pedir_documento`.
- **d_como_funciona** (`c87d76f8`): trigger `Cadastrar agora / cadastrar / 📝 Cadastrar agora / btn_mpru57ht` passa a apontar para `d_pedir_conta`.
- **d_welcome** (`aee7b26c`): adicionar gatilho explícito `cadastrar / quero cadastrar` ➜ `d_pedir_conta` (hoje só "simular/1" leva à conta).
- **d_resultado** (`4df1f90a`): mantém `cadastrar` ➜ `d_pedir_documento` (correto: já passou pela simulação).

### 2. Guardas em runtime (idempotência)

Em `supabase/functions/_shared/conversation-helpers.ts` e nos dispatchers `whapi-webhook/handlers/bot-flow.ts` e `evolution-webhook/handlers/bot-flow.ts`:

- **Antes de disparar `d_pedir_documento`**, verificar:
  - se `customer.electricity_bill_url` ou `customer.media_consumo` estiverem vazios ➜ redirecionar para `d_pedir_conta` (mesmo se a transition mandar para documento).
  - se `customer.document_front_url` já estiver preenchido ➜ pular para o próximo passo faltante (`getNextMissingStep`).
- **Antes de disparar `d_pedir_conta`**: se já há conta + `media_consumo` válidos, pular para `d_resultado`.
- **Antes de disparar `d_como_funciona`**: se já houve outbound desse step nas últimas 24h da mesma conversa, pular direto para `d_duvidas` (sem re-enviar áudio + vídeo).

### 3. Outros consultores

Verificar se algum outro flow ativo (variants A/B) tem o mesmo desvio "cadastrar → documento" antes da simulação. Hoje só o D usa `capture_conta`/`capture_documento`; os outros são hardcoded — não exigem mudança de dados, só herdarão as guardas de runtime.

## Validação

1. Lead novo no sandbox: enviar "Oi" → "Cadastrar" no welcome → bot deve pedir **conta de luz** (não documento).
2. Conversa que ficou em dúvidas: "Quero cadastrar" → bot pede **conta**.
3. Após simulação: "Cadastrar agora" → bot pede **documento**.
4. Reenviar PDF da CNH não deve ser pedido novamente se `document_front_url` já existe.
5. Áudio + vídeo de "como funciona" não devem repetir na segunda passagem.

## Fora do escopo

- OCR / worker portal-2 (já corrigidos).
- Reordenar positions físicas no `bot_flow_steps` — só as `transitions` mudam, o que é suficiente.
