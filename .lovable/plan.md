# Plano — Corrigir botões do Fluxo D do bot

## O que está errado hoje

A auditoria do banco encontrou 2 bugs reais e 1 menor nos botões do Fluxo D:

### Bug 1 — Destino errado pós "Como funciona" 🔴
No passo `d_como_funciona` (alcançado pelo botão "Como funciona" do welcome), depois do áudio + vídeo, o botão **"✅ Quero me cadastrar"** leva o cliente de volta para a tela de **escolher simulação** (rápida/completa), em vez de seguir direto para o cadastro. Quem já viu como funciona não quer voltar a escolher simulação — quer pedir a conta de luz.

### Bug 2 — Botão "Falar com Rafael" hardcoded ⚠️
Em **6 passos diferentes** do Fluxo D, o botão de handoff humano aparece como **"👨‍💼 Falar com Rafael"** (nome fixo no banco). O sistema já usa `{{representante}}` em todas as mensagens de texto, mas os botões ficaram presos no nome "Rafael". É exatamente o que você descreveu — o texto do próximo botão "está errado, deveria ser falar com o representante".

Passos afetados: `d_welcome`, `d_como_funciona`, `d_resultado`, `d_duvidas`, `d_simular_resultado`, `d_como_funciona_copy_qwpu`.

### Bug 3 — Inconsistência menor
Existem 2 passos ativos com `slot_key = 'como_funciona'`:
- `d_como_funciona` (pos 3) → botão "Quero me cadastrar" com destino errado (bug 1)
- `d_como_funciona_copy_qwpu` (pos 20) → botão "Continuar Cadastro" com destino correto

A cópia já está certa; só o original precisa do conserto do destino.

## O que vou fazer

**Uma única migração SQL** que altera só os campos errados, sem mexer em IDs, posições, trigger_phrases não-Rafael, nem em qualquer transição de outros passos:

### 1. Corrigir destino do botão de cadastro em `d_como_funciona`
Mudar o `goto_step_id` da transition que dispara em "Quero me cadastrar" no passo `c87d76f8-...` (d_como_funciona):
- **De:** `b1a53333-...` (d_escolher_simulacao)
- **Para:** `279d3926-...` (d_pedir_conta) — segue o mesmo caminho que o usuário teria se tivesse escolhido "simular" no welcome

### 2. Renomear "Falar com Rafael" → "Falar com o representante" nos 6 passos
Atualizar o título do botão em todas as 6 ocorrências (`UPDATE bot_step_transitions` filtrando por `goto_special='humano'` e título contendo "Rafael"). Mantenho:
- O destino (`goto_special = 'humano'`) — handoff intacto
- Os emojis e `trigger_phrases` existentes (incluindo "rafael" como palavra-chave para quem digitar o nome)

Uso texto literal **"Falar com o representante"** em vez de `{{representante}}` no título do botão porque o WhatsApp não interpola variáveis em títulos de botão interativo (limite de 20 caracteres + render literal). A mensagem de texto continua usando `{{representante}}` normalmente.

## Por que isso não quebra o fluxo

- Não removo nenhum botão nem passo.
- Não mexo em `step_key`, `step_id`, `position`, `slot_key`.
- Não toco em transições de outros passos.
- Só altero 2 campos: `transitions.title` (texto do botão) em 6 linhas + `transitions.goto_step_id` em 1 linha.
- `d_pedir_conta` (novo destino do Bug 1) já é o passo natural depois de "escolher simulação completa" — o fluxo de cadastro continua idêntico.
- Mantenho a cópia `d_como_funciona_copy_qwpu` como está (já estava correta).

## Verificação

Após aplicar, simulo no painel `/admin/fluxo-b → Simulador`:
1. Digito "oi" → vejo o welcome com 3 botões, confirmo "Falar com o representante"
2. Clico "Como funciona" → recebo áudio+vídeo, vejo "Quero me cadastrar" + "Tenho uma pergunta" + "Falar com o representante"
3. Clico "Quero me cadastrar" → confirmo que pede a conta de luz (não volta pra escolher simulação)

## Arquivos tocados

- 1 migração nova em `supabase/migrations/` (única alteração, ~10 linhas de SQL)
- Nenhum arquivo de código frontend/edge function muda