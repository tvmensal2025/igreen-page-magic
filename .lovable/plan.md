# Atualizar mensagem do passo 16 (d_simular_resultado)

## Contexto
O passo 16 do fluxo D (`d_simular_resultado`, simulação rápida) precisa ter sua mensagem atualizada para o novo copy fornecido pelo usuário.

## Mudança

1. **Criar migration** para atualizar o campo `message_text` do step `d_simular_resultado` (id `b1a52222-2222-4222-8222-000000000002`) no fluxo `320bf22c-e383-4f53-a3c0-b88b89b02558`.

2. **Novo texto:**
```
Olha que ótimo! ✨🎉

💡 Sua conta hoje: *R$ {{valor_conta}}*

💚 Economia estimada: *{{economia_range}}* por mês

E o melhor:

✅ Sem investimento

✅ Sem obra

✅ Sem instalação

✅ *Mesma* distribuidora

Bora fazer seu *cadastro agora*? 🚀
```

3. **Diferenças em relação ao texto atual:**
   - Remove o emoji 👀 do início.
   - Cada item ✅ fica em linha própria com quebra de linha entre eles.
   - CTA final muda de "Bora cadastrar? É *gratuito* e *sem fidelidade*. 🚀" para "Bora fazer seu *cadastro agora*? 🚀".

4. **Variáveis já suportadas:** `{{valor_conta}}` e `{{economia_range}}` — ambas são processadas pelo `renderTemplateVars` em `render-vars.ts` (linhas 93-96 e 110-113).

5. **Botões permanecem inalterados:** "Continuar Cadastro", "Ainda tenho dúvida", "Falar com Rafael".

## Detalhes técnicos
- Uma única instrução `UPDATE` na tabela `public.bot_flow_steps`.
- Sem mudança de schema, código frontend ou edge function.
- A variável `{{economia_range}}` gera o formato "R$ {min} a R$ {max}" com base no valor da conta (8% a 20%).
