# Simulação rápida vs completa — Fluxo Whapi (botões)

## Problema

Hoje, ao clicar em **"Quero simular"** no `d_welcome`, o bot vai direto para `d_pedir_conta` (capture_conta). Quem não quer mandar a foto na primeira mensagem fica travado.

## Solução

Dar **dois caminhos de simulação** no boas-vindas. A conta de luz só é pedida quando o cliente clicar em **"Quero me cadastrar"** (depois de ver a prévia da economia) — coerente com a regra `separate-bill-doc-flow`.

WhatsApp permite no máximo **3 botões**, então removemos "Falar com Rafael" do `d_welcome` (continua acessível via palavra-chave `humano` / fallback IA).

```text
d_welcome  (3 botões)
  ├─ 📸 Conta completa  ──→  d_pedir_conta (capture_conta + OCR) → fluxo atual
  ├─ 💡 Só o valor      ──→  d_simular_valor → d_simular_resultado
  │                                              └─ ✅ Quero me cadastrar → d_pedir_conta
  └─ 🤔 Como funciona   ──→  (inalterado)
```

## Mudanças no banco (flow `320bf22c-…` — Fluxo Whapi botões)

### 1. Atualizar `d_welcome`

**Texto novo:**
> Olá, seja muito *Bem-Vindo(a)*! 😊
> Sou a assistente virtual do *{{representante}}* e vou te mostrar se a sua conta de luz tem perfil pra *economizar todo mês* com a iGreen 💚
>
> Como você prefere começar?
>
> 📸 *Simulação completa* — me manda a foto da conta de luz e eu calculo o valor exato.
> 💡 *Simulação rápida* — me diz só o valor médio da conta e eu já te dou uma prévia.

**Botões (`captures._buttons`) — só 3:**
- `simular_completa` → "📸 Conta completa"
- `simular_valor` → "💡 Só o valor"
- `como` → "🤔 Como funciona"

**Transições:**
- `simular_completa` (+ alias `simular`, `conta`, `foto`) → `d_pedir_conta`
- `simular_valor` (+ alias `valor`, `rapida`, `rápida`) → novo `d_simular_valor`
- `como` → step "como funciona" atual
- Palavra-chave `humano`/`rafael`/`atendente` → `goto_special: humano` (mantém saída pra humano sem ocupar botão)

### 2. Novo step `d_simular_valor`

- `step_type: message`, `wait_for: reply`
- Captura: `electricity_bill_value`
- Texto:
  > Show! 💡 Me manda só o *valor médio* da sua conta de luz por mês (ex: *300*). Pode escrever só o número.
- Default → `d_simular_resultado`.

### 3. Novo step `d_simular_resultado`

- `step_type: message`, `wait_for: reply`
- Texto:
  > Olha que ótimo, *{{nome}}*! 👀✨
  > Com uma conta de cerca de *R$ {{valor_conta}}/mês*, você economiza aproximadamente *{{economia_mensal}}* todo mês com a iGreen — *até 20% de desconto garantido em contrato*. 💚
  >
  > Bora cadastrar? É *gratuito* e *sem fidelidade*.
- Botão único: `quero_cadastrar` → "✅ Quero me cadastrar"
- Transição (gatilhos `cadastrar`, `quero`, `sim` + default) → `d_pedir_conta`.
  - A foto da conta só é pedida aqui, depois do "quero".

### 4. `d_pedir_conta` (inalterado)

Continua capture_conta com OCR; segue o fluxo atual (confirma dados → CTA cadastrar → `capture_documento`).

## Fluxos não afetados

- **Fluxo Padrão** e **Fluxo Padrão (B - sem áudio)** já são lineares e já têm step que pergunta valor. Não mudam.
- Engine (`whapi-webhook/handlers/bot-flow.ts`) já renderiza `{{valor_conta}}` e `{{economia_mensal}}` (regra `discount-rate-20`: `valor * 0.20`).

## Como aplicar

Uma única migration:
1. `INSERT` dos dois novos steps (`d_simular_valor`, `d_simular_resultado`) com UUIDs estáveis.
2. `UPDATE` no `d_welcome` (`message_text`, `captures._buttons`, `transitions`).

Sem mudança de schema, código TS ou edge function.