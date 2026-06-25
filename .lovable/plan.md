# Análise Completa do Fluxo D — 3 entradas

Fluxo ativo único: `b643764c-…` (Fluxo Padrão D).

## 1️⃣ 💚 Quero simular

```
d_welcome ─► d_escolher_simulacao
              ├─ 📸 Simulação completa ─► d_pedir_conta (foto) ─► d_resultado
              │                                                   ├─ ✅ Continuar Cadastro ─► d_pedir_documento ✓
              │                                                   ├─ 🎥 Como funciona  ─► d_como_funciona_copy_qwpu
              │                                                   └─ 👨‍💼 Rafael        ─► humano ✓
              └─ 💡 Simulação rápida   ─► d_simular_valor (digita R$) ─► d_simular_resultado
                                                                          ├─ ✅ Quero me cadastrar ─► d_simular_pedir_conta ⚠️
                                                                          ├─ 🎥 Como funciona      ─► d_como_funciona
                                                                          └─ 👨‍💼 Rafael            ─► humano ✓
```

**Status:** ✅ funciona. **Atenção:** Em "Simulação rápida → Quero me cadastrar", o banco aponta para `d_simular_pedir_conta` (pede foto da conta novamente). Porém o **guard do webhook** (`_flowDQuickCadastroIntent`) intercepta a frase "quero me cadastrar" e força `d_pedir_documento`, então na prática vai direto pro documento. **Consistente com Cadastro Rápido**, mas inconsistente com o que está salvo no FlowBuilder — se alguém olhar o builder, vai pensar que está errado.

## 2️⃣ 🎥 Como funciona

```
d_welcome ─► d_como_funciona
              ├─ ✅ Quero me cadastrar   ─► (banco) d_pedir_conta  /  (guard) d_pedir_documento ⚠️
              ├─ 💬 Tenho uma pergunta   ─► d_duvidas
              │                              ├─ cadastrar ─► d_pedir_documento ✓
              │                              ├─ humano    ─► humano ✓
              │                              └─ nova_pergunta ─► IA responde e volta
              └─ 👨‍💼 Rafael               ─► humano ✓
```

**Status:** ✅ funciona. **Mesma inconsistência**: o guard força documento direto quando o usuário diz "quero me cadastrar", mesmo que o builder diga pra pedir a conta primeiro.

## 3️⃣ ⚡ Cadastro rápido

```
d_welcome ─► d_pedir_documento ─► d_pedir_email ─► d_confirmar_telefone ─► d_finalizar ✓
```

**Status:** ✅ 100% correto. Banco e guard concordam.

---

## 🟢 O que está perfeito
- Roteamento dos 3 botões iniciais
- Handoff "humano/Rafael" funciona em todas as telas
- Guard duplo no webhook protege contra edições erradas
- Apenas 1 fluxo D ativo

## 🟡 Inconsistências (não quebram, mas confundem)

1. **Guard sobrescreve o builder em "Quero me cadastrar"**
   O regex `\bcadastrar\b` faz qualquer transição que contenha essa palavra ir para `d_pedir_documento`, mesmo quando o builder mandaria pedir a conta antes (d_como_funciona, d_simular_resultado). Hoje funciona, mas se você editar o builder pra "primeiro pedir conta", o guard vai ignorar.
   **Resolver:** ou (a) atualizar o banco pra refletir o que o guard faz (todos os "Quero me cadastrar" → `d_pedir_documento`), ou (b) estreitar o guard pra disparar só com "cadastro rápido"/"cadastro_rapido", deixando "quero me cadastrar" passar pelo builder.

2. **Passo dangling**: `d_como_funciona_copy_in3s` (position 19) não é alvo de ninguém. Pode ser removido.

3. **Typos visíveis ao cliente**:
   - `d_finalizar`: "Tudo certo,!" (vírgula sobrando)
   - `d_duvidas`: "Me manda anda sua *pergunta*" ("anda" sobrando — provavelmente era "agora")
   - `d_como_funciona_copy_qwpu`: trigger `✅Continuar Cadastro` sem espaço (não casa com o título do botão "✅ Continuar Cadastro" — só funciona porque "cadastrar" também está na lista)

## 🔴 Risco real (depois de muito teste mental)
Nenhum. Os 3 caminhos chegam ao final do cadastro. O usuário não fica preso, não recebe simulação no lugar de cadastro, não cai em humano por engano.

---

## Recomendação

Posso aplicar tudo de uma vez (sem mexer em código, só dados):

- **Fix A**: Alinhar banco com guard — todos os "✅ Quero me cadastrar / Continuar Cadastro" passam a apontar direto pra `d_pedir_documento` no builder.
- **Fix B**: Apagar o passo dangling `d_como_funciona_copy_in3s`.
- **Fix C**: Corrigir os typos em `d_finalizar`, `d_duvidas` e o trigger `✅Continuar Cadastro`.

Confirma se aplico **A+B+C**, ou só um subset?
