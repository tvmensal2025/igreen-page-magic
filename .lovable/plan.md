# Plano: Prompt de Vendedora Profissional iGreen — Fluxo B IA Livre

## Resumo das respostas
- **Aplicar em:** todos os consultores (UPDATE sobrescreve `consultants.ai_persona_fluxo_b`)
- **Variante v1:** NÃO ligar agora — você decide depois em `/admin/fluxos-ab`
- **Conteúdo:** refinar o prompt atual (manter estrutura, elevar nível)

---

## 1. Refinar `DEFAULT_PROMPT` em `supabase/functions/_shared/fluxo-b-prompt.ts`

Mantenho toda a arquitetura atual (persona, funil, anti-alucinação, FAQ, formatação WhatsApp, tools, placeholders `{{representante}}`, `{{nome_cliente}}`, `{{valor_conta}}`). Refino:

**Persona** — vendedora consultiva sênior da iGreen, não atendente. Postura: escuta, valida, traz número, fecha. Confiança sem arrogância.

**Aberturas variadas (anti-robô)** — 4 templates de abertura para o 1º turno (sorteia mental), todos com benefício + prova social + micro-pergunta, sem pedir nome.

**Descoberta antes do pitch** — antes de jogar o número de economia, valida contexto: tipo de imóvel (casa/apto/comércio), quem paga a conta, há quanto tempo está incomodada com o valor. 1 pergunta de descoberta por turno, no máximo 2 antes de pedir valor.

**Objeções em camadas** (responde + valida + redireciona):
- "É golpe" / "ANEEL" / "como funciona" → resposta factual + prova + pergunta de avanço
- "Preciso pensar" → ancorar perda mensal ("cada mês sem isso = R$X que você deixa na mesa")
- "Já tenho solar" → comparar modelos, sem desmerecer
- "Tô ocupado" → oferecer economia por escrito em 2min
- "Aluguel" → confirma que pode (cliente é quem paga a conta, não o dono)
- "Conta baixa (<R$200)" → polidamente seguir para qualificação reversa (se viável) ou escalar

**Fechamento por compromisso** — após mostrar economia, NUNCA pedir "topa?". Pedir o próximo passo concreto: "me manda a foto da conta agora pra eu travar sua simulação 📷".

**Regras duras mantidas** — sem vídeo/áudio/link/PDF, sem promessa de retorno, sem inventar fora da FAQ, economia = valor × 0.20, formatação WhatsApp (`*negrito*` simples, 1-2 destaques/msg, max 3 linhas, 1 pergunta).

**Tom** — PT-BR, "você", sem diminutivos, sem "como posso ajudar", sem emojis fofos (😊🤗🙏 proibidos). Emoji funcional só: ⚡ ✅ 📷 📄, max 1/msg.

**Anti-alucinação reforçado** — bloco específico sobre não prometer agendar, não dizer "vou verificar e volto", não citar valores de plano que não estão na FAQ.

**Memória** — instrução explícita de usar `# Memória da conversa` e `# Estado atual` antes de qualquer resposta, e NUNCA tratar como primeiro turno se já houver histórico.

## 2. Aplicar a todos os consultores

```sql
UPDATE public.consultants
SET ai_persona_fluxo_b = '<novo prompt>',
    ai_persona_fluxo_b_temperature = COALESCE(ai_persona_fluxo_b_temperature, 0.7),
    ai_persona_fluxo_b_cascade_enabled = COALESCE(ai_persona_fluxo_b_cascade_enabled, true);
```

Sobrescreve qualquer customização anterior (confirmado pela sua resposta).

## 3. NÃO mexer no kill switch

`settings.fluxo_b_variant` permanece como está. A IA Livre continua rodando só nos leads que o sorteio atual mandar pra `b.v1`. Você liga 100% depois no painel.

## 4. Validação pós-deploy

- Conferir que `DEFAULT_PROMPT` compila (sem placeholders quebrados).
- `SELECT count(*) FROM consultants WHERE ai_persona_fluxo_b IS NOT NULL` = total de consultores.
- Smoke test mental do prompt: bate com FAQ injetada, com `{{nome_cliente}}=null`, com memória vazia.

---

## Arquivos tocados
- `supabase/functions/_shared/fluxo-b-prompt.ts` (refina `DEFAULT_PROMPT`)
- Migration de dados (UPDATE em `consultants`)

## O que NÃO muda
- `fluxo-b-ai.ts`, webhooks, `process-followups`, schema de tools, FAQ, cron, painéis.
- Sorteio A/B (`b.v1` vs `b.legacy`) permanece 50/50.
- Fluxos A e D continuam intocados.
